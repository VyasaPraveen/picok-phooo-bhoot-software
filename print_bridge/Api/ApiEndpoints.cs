using System.Text.Json;
using Epixs.PrintBridge.Core;
using Epixs.PrintBridge.Payments;
using Epixs.PrintBridge.Printing;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Epixs.PrintBridge.Api;

/// <summary>Minimal-API endpoints implementing docs/BRIDGE_API.md (v1).</summary>
internal static class ApiEndpoints
{
    public const long MaxImageBytes = 30L * 1024 * 1024;
    private const long MaxImagePixels = 120_000_000;
    private const int MaxOrderIdLength = 64;
    private const int MaxDescriptionLength = 255;

    private static readonly JsonSerializerOptions JsonIn = new(JsonSerializerDefaults.Web);

    public static void Map(IEndpointRouteBuilder app, BridgeServices services)
    {
        app.MapGet("/api/ping", () => Results.Json(
            new PingResponse(AppInfo.Name, AppInfo.Version, AppInfo.MachineName, RequiresKey: true)));

        app.MapGet("/api/status", () => Results.Json(BuildStatus(services)));

        app.MapPost("/api/print", (HttpRequest request, CancellationToken ct) => HandlePrintAsync(request, services, ct));

        app.MapPost("/api/test-print", (HttpRequest request, CancellationToken ct) => HandleTestPrintAsync(request, services, ct));

        app.MapGet("/api/jobs/{jobId}", (string jobId) =>
        {
            var job = services.Jobs.Get(jobId);
            if (job is null)
                return Error(StatusCodes.Status404NotFound, "Job not found");
            var s = job.Snapshot();
            return Results.Json(new JobResponse(s.JobId, s.OrderId, s.Status, s.Message, s.Copies, Iso.Utc(s.UpdatedAt)));
        });

        app.MapPost("/api/payments/qr", (HttpRequest request, CancellationToken ct) => HandleCreateQrAsync(request, services, ct));

        app.MapGet("/api/payments/qr/{qrId}", async (string qrId, CancellationToken ct) =>
        {
            var session = await services.Payments.GetAsync(qrId, ct);
            return session is null ? Error(StatusCodes.Status404NotFound, "QR not found") : Results.Json(ToStatus(session));
        });

        app.MapGet("/api/payments/qr/{qrId}/image", (string qrId) =>
        {
            var session = services.Payments.Find(qrId);
            return session is null
                ? Error(StatusCodes.Status404NotFound, "QR not found")
                : Results.Bytes(session.ImagePng, "image/png");
        });

        app.MapPost("/api/payments/qr/{qrId}/close", async (string qrId, CancellationToken ct) =>
        {
            var session = await services.Payments.CloseAsync(qrId, ct);
            return session is null ? Error(StatusCodes.Status404NotFound, "QR not found") : Results.Json(ToStatus(session));
        });

        app.MapFallback(() => Error(StatusCodes.Status404NotFound, "Not found"));
    }

    public static IResult Error(int statusCode, string message) =>
        Results.Json(new ErrorResponse(message), statusCode: statusCode);

    private static StatusResponse BuildStatus(BridgeServices services)
    {
        var printer = services.PrinterStatus.GetStatus();
        var payments = services.Payments.Status;
        var profiles = services.Settings.Snapshot().Profiles.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
        return new StatusResponse(
            new PrinterInfo(printer.Name, printer.Online, printer.State, printer.Message, printer.JobsInQueue),
            new PaymentsInfo(payments.Provider, payments.Ready, payments.Message),
            profiles);
    }

    private static async Task<IResult> HandlePrintAsync(HttpRequest request, BridgeServices services, CancellationToken ct)
    {
        if (!request.HasFormContentType)
            return Error(StatusCodes.Status400BadRequest, "Expected multipart/form-data with 'image' and 'meta' parts");

        IFormCollection form;
        try
        {
            form = await request.ReadFormAsync(ct);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return Error(StatusCodes.Status413PayloadTooLarge, "Image is larger than 30 MB");
        }
        catch (Exception ex) when (ex is InvalidDataException or BadHttpRequestException or IOException)
        {
            return Error(StatusCodes.Status400BadRequest, "Malformed multipart request");
        }

        // meta: normally a text field, but accept it as a file part too.
        string? metaJson = form["meta"];
        if (string.IsNullOrWhiteSpace(metaJson) && form.Files.GetFile("meta") is { } metaFile)
        {
            using var reader = new StreamReader(metaFile.OpenReadStream());
            metaJson = await reader.ReadToEndAsync(ct);
        }
        if (string.IsNullOrWhiteSpace(metaJson))
            return Error(StatusCodes.Status400BadRequest, "Missing 'meta' part");

        PrintMeta? meta;
        try
        {
            meta = JsonSerializer.Deserialize<PrintMeta>(metaJson, JsonIn);
        }
        catch (JsonException)
        {
            return Error(StatusCodes.Status400BadRequest, "'meta' is not valid JSON");
        }
        if (meta is null)
            return Error(StatusCodes.Status400BadRequest, "'meta' is not valid JSON");

        var orderId = meta.OrderId?.Trim();
        if (string.IsNullOrEmpty(orderId) || orderId.Length > MaxOrderIdLength)
            return Error(StatusCodes.Status400BadRequest, $"orderId is required (max {MaxOrderIdLength} characters)");
        var media = MediaCatalog.Find(meta.Media);
        if (media is null)
            return Error(StatusCodes.Status400BadRequest, "media must be one of 4x6, 2x6, 3.5x5, 5x7, 6x8");
        var finish = MediaCatalog.NormalizeFinish(meta.Finish);
        if (finish is null)
            return Error(StatusCodes.Status400BadRequest, "finish must be gloss or matte");
        var copies = meta.Copies ?? 1;
        if (copies is < 1 or > 10)
            return Error(StatusCodes.Status400BadRequest, "copies must be between 1 and 10");

        var image = form.Files.GetFile("image");
        if (image is null || image.Length == 0)
            return Error(StatusCodes.Status400BadRequest, "Missing 'image' part");
        if (image.Length > MaxImageBytes)
            return Error(StatusCodes.Status413PayloadTooLarge, "Image is larger than 30 MB");

        var jobId = PrintJobManager.NewJobId();
        var path = PrintJobManager.IncomingPath(jobId);
        try
        {
            await using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                await image.CopyToAsync(file, ct);

            if (ValidateImage(path) is { } problem)
            {
                File.Delete(path);
                return Error(StatusCodes.Status400BadRequest, problem);
            }
        }
        catch
        {
            TryDelete(path);
            throw;
        }

        var job = services.Jobs.Enqueue(jobId, orderId, media, finish, copies, meta.Reprint ?? false, path);
        return Results.Json(new JobAccepted(job.JobId, JobStatus.Queued), statusCode: StatusCodes.Status202Accepted);
    }

    private static async Task<IResult> HandleTestPrintAsync(HttpRequest request, BridgeServices services, CancellationToken ct)
    {
        TestPrintRequest? body = null;
        if (request.ContentLength is > 0 || request.Headers.TransferEncoding.Count > 0)
        {
            try
            {
                body = await JsonSerializer.DeserializeAsync<TestPrintRequest>(request.Body, JsonIn, ct);
            }
            catch (JsonException)
            {
                return Error(StatusCodes.Status400BadRequest, "Body is not valid JSON");
            }
        }

        var media = MediaCatalog.Find(body?.Media ?? "4x6");
        if (media is null)
            return Error(StatusCodes.Status400BadRequest, "media must be one of 4x6, 2x6, 3.5x5, 5x7, 6x8");
        var finish = MediaCatalog.NormalizeFinish(body?.Finish ?? "gloss");
        if (finish is null)
            return Error(StatusCodes.Status400BadRequest, "finish must be gloss or matte");

        var job = services.Jobs.EnqueueTestSheet(media, finish);
        return Results.Json(new JobAccepted(job.JobId, JobStatus.Queued), statusCode: StatusCodes.Status202Accepted);
    }

    private static async Task<IResult> HandleCreateQrAsync(HttpRequest request, BridgeServices services, CancellationToken ct)
    {
        QrCreateBody? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync<QrCreateBody>(request.Body, JsonIn, ct);
        }
        catch (JsonException)
        {
            return Error(StatusCodes.Status400BadRequest, "Body is not valid JSON");
        }

        var orderId = body?.OrderId?.Trim();
        if (string.IsNullOrEmpty(orderId) || orderId.Length > MaxOrderIdLength)
            return Error(StatusCodes.Status400BadRequest, $"orderId is required (max {MaxOrderIdLength} characters)");
        if (body!.Amount is not { } amount || amount < PaymentService.MinAmount || amount > PaymentService.MaxAmount)
            return Error(StatusCodes.Status400BadRequest,
                $"amount must be whole paise between {PaymentService.MinAmount} and {PaymentService.MaxAmount}");
        var description = string.IsNullOrWhiteSpace(body.Description) ? $"Order {orderId}" : body.Description.Trim();
        if (description.Length > MaxDescriptionLength)
            description = description[..MaxDescriptionLength];

        try
        {
            var session = await services.Payments.CreateAsync(orderId, amount, description, ct);
            return Results.Json(new QrCreateResponse(
                session.QrId,
                session.Provider.Name,
                session.Amount,
                session.UpiString,
                $"/api/payments/qr/{Uri.EscapeDataString(session.QrId)}/image",
                Iso.Utc(session.ExpiresAt)));
        }
        catch (PaymentNotAvailableException ex)
        {
            return Error(StatusCodes.Status503ServiceUnavailable, $"Payments are not available: {ex.Message}");
        }
        catch (PaymentException ex)
        {
            Log.Warn($"QR create failed for order {orderId}: {ex.Message}");
            return Error(StatusCodes.Status502BadGateway, ex.Message);
        }
    }

    private static QrStatusResponse ToStatus(QrSession session)
    {
        var s = session.Snapshot();
        return new QrStatusResponse(s.QrId, s.Status, s.PaymentId, s.Method, s.Amount, s.PayerVpa, s.Message);
    }

    /// <summary>Returns an error message when the file is not a decodable image of sane size.</summary>
    private static string? ValidateImage(string path)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var img = Image.FromStream(stream, useEmbeddedColorManagement: false, validateImageData: true);
            if (img.Width < 1 || img.Height < 1 || (long)img.Width * img.Height > MaxImagePixels)
                return "Image dimensions are not supported";
            return null;
        }
        catch (ArgumentException)
        {
            return "File is not a valid image (PNG or JPEG expected)";
        }
        catch (OutOfMemoryException)
        {
            return "File is not a valid image (PNG or JPEG expected)";
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Warn($"Could not delete {Path.GetFileName(path)}: {ex.Message}");
        }
    }
}
