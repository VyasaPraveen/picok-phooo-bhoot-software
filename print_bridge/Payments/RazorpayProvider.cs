using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Payments;

/// <summary>Razorpay dynamic UPI QR codes (POST /v1/payments/qr_codes). The key secret never leaves this PC.</summary>
public sealed class RazorpayProvider : IPaymentProvider
{
    private const string ApiBase = "https://api.razorpay.com/";
    private const int MaxImageBytes = 5 * 1024 * 1024;

    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        AllowAutoRedirect = true,
    })
    {
        Timeout = TimeSpan.FromSeconds(20),
    };

    private readonly AuthenticationHeaderValue _auth;

    public RazorpayProvider(string keyId, string keySecret) => _auth = BasicAuth(keyId, keySecret);

    public string Name => "razorpay";

    public async Task<QrCreated> CreateQrAsync(QrCreateRequest request, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["type"] = "upi_qr",
            ["name"] = request.BusinessName,
            ["usage"] = "single_use",
            ["fixed_amount"] = true,
            ["payment_amount"] = request.Amount,
            ["description"] = request.Description,
            ["close_by"] = request.ExpiresAt.ToUnixTimeSeconds(),
            ["notes"] = new JsonObject { ["order_id"] = request.OrderId },
        };

        var json = await SendAsync(_auth, HttpMethod.Post, "v1/payments/qr_codes", body, ct);
        var id = json["id"]?.GetValue<string>();
        if (string.IsNullOrEmpty(id))
            throw new PaymentException("Razorpay returned no QR id");

        var imageContent = json["image_content"]?.GetValue<string>();
        var upi = imageContent is not null && imageContent.StartsWith("upi://", StringComparison.OrdinalIgnoreCase) ? imageContent : null;
        var imageUrl = json["image_url"]?.GetValue<string>();

        var png = await DownloadPngAsync(imageUrl, ct);
        if (png is null)
        {
            if (upi is null)
                throw new PaymentException("Razorpay QR image could not be downloaded");
            png = QrImage.Png(upi); // same payload, rendered locally
        }
        return new QrCreated(id, upi, png);
    }

    public async Task<PaymentCheck> CheckAsync(QrSession session, CancellationToken ct)
    {
        var json = await SendAsync(_auth, HttpMethod.Get, $"v1/payments/qr_codes/{Uri.EscapeDataString(session.QrId)}/payments", null, ct);
        if (json["items"] is not JsonArray items)
            return PaymentCheck.NotPaid;

        foreach (var item in items.OfType<JsonObject>())
        {
            var status = item["status"]?.GetValue<string>();
            var amount = item["amount"]?.GetValue<long>() ?? 0;
            if (status is "captured" or "authorized" && amount >= session.Amount)
            {
                return new PaymentCheck(true,
                    item["id"]?.GetValue<string>(),
                    item["method"]?.GetValue<string>() ?? "upi",
                    item["vpa"]?.GetValue<string>(),
                    amount);
            }
        }
        return PaymentCheck.NotPaid;
    }

    public async Task CloseAsync(QrSession session, CancellationToken ct) =>
        await SendAsync(_auth, HttpMethod.Post, $"v1/payments/qr_codes/{Uri.EscapeDataString(session.QrId)}/close", null, ct);

    /// <summary>Verifies keys with GET /v1/payments?count=1. Returns (ok, message).</summary>
    public static async Task<(bool Ok, string Message)> TestKeysAsync(string keyId, string keySecret, CancellationToken ct)
    {
        try
        {
            await SendAsync(BasicAuth(keyId, keySecret), HttpMethod.Get, "v1/payments?count=1", null, ct);
            var mode = keyId.StartsWith("rzp_live_", StringComparison.Ordinal) ? "live" : keyId.StartsWith("rzp_test_", StringComparison.Ordinal) ? "test" : "unknown";
            return (true, $"Keys accepted by Razorpay ({mode} mode)");
        }
        catch (PaymentException ex)
        {
            return (false, ex.Message);
        }
    }

    private static AuthenticationHeaderValue BasicAuth(string keyId, string keySecret) =>
        new("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{keyId}:{keySecret}")));

    private static async Task<JsonObject> SendAsync(AuthenticationHeaderValue auth, HttpMethod method, string path, JsonObject? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, ApiBase + path);
        request.Headers.Authorization = auth;
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null)
            request.Content = JsonContent.Create(body);
        else if (method == HttpMethod.Post)
            request.Content = new StringContent("{}", Encoding.UTF8, "application/json");

        HttpResponseMessage response;
        try
        {
            response = await Http.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            throw new PaymentException("Cannot reach Razorpay – check the internet connection", ex);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            throw new PaymentException("Razorpay did not respond in time", ex);
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            JsonObject? json = null;
            try
            {
                json = JsonNode.Parse(text) as JsonObject;
            }
            catch (JsonException)
            {
            }

            if (response.IsSuccessStatusCode && json is not null)
                return json;

            var description = json?["error"]?["description"]?.GetValue<string>();
            var message = response.StatusCode switch
            {
                HttpStatusCode.Unauthorized => "Razorpay rejected the API keys (check Key Id and Key Secret)",
                _ when !string.IsNullOrWhiteSpace(description) => $"Razorpay: {description}",
                _ => $"Razorpay error (HTTP {(int)response.StatusCode})",
            };
            Log.Warn($"Razorpay {method} {path.Split('?')[0]} failed: HTTP {(int)response.StatusCode} {description}");
            throw new PaymentException(message);
        }
    }

    private static async Task<byte[]?> DownloadPngAsync(string? imageUrl, CancellationToken ct)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            return null;
        try
        {
            using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > MaxImageBytes)
                return null;
            var bytes = await response.Content.ReadAsByteArrayAsync(ct);
            if (bytes.Length > MaxImageBytes)
                return null;
            if (QrImage.IsPng(bytes))
                return bytes;
            return ConvertToPng(bytes);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            Log.Warn($"Could not download Razorpay QR image: {ex.Message}");
            return null;
        }
    }

    private static byte[]? ConvertToPng(byte[] bytes)
    {
        try
        {
            using var input = new MemoryStream(bytes);
            using var image = Image.FromStream(input);
            using var output = new MemoryStream();
            image.Save(output, System.Drawing.Imaging.ImageFormat.Png);
            return output.ToArray();
        }
        catch (ArgumentException)
        {
            return null; // not an image (e.g. an HTML page)
        }
    }
}
