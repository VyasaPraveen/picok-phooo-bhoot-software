using System.Security.Cryptography;
using Epixs.PrintBridge.Core;

namespace Epixs.PrintBridge.Cloud;

/// <summary>
/// End-to-end encryption of print files (docs/CLOUD_API.md): the kiosk wraps a random AES-256-GCM key with
/// this PC's RSA-OAEP (SHA-256) public key. The RSA private key never leaves this PC (DPAPI-protected).
/// </summary>
public sealed class JobCrypto : IDisposable
{
    public const string Algorithm = "RSA-OAEP-256+A256GCM";
    private const int TagBytes = 16;
    private const int IvBytes = 12;

    private readonly RSA _rsa;

    private JobCrypto(RSA rsa, string publicKeySpki)
    {
        _rsa = rsa;
        PublicKeySpki = publicKeySpki;
        KeyId = KeyIdOf(publicKeySpki);
    }

    /// <summary>Base64 SPKI public key, as published at /booths/{b}/bridge/publicKey.</summary>
    public string PublicKeySpki { get; }

    /// <summary>The kiosk's <c>enc.kid</c> for this key: first 16 lowercase hex chars of SHA-256 over the SPKI DER bytes.</summary>
    public string KeyId { get; }

    public static string KeyIdOf(string publicKeySpki) =>
        Convert.ToHexStringLower(SHA256.HashData(Convert.FromBase64String(publicKeySpki)))[..16];

    /// <summary>Loads the saved key pair, or creates (and saves) a new RSA 2048 pair when there is none.</summary>
    public static JobCrypto LoadOrCreate(SettingsStore settings)
    {
        var cloud = settings.Snapshot().Cloud;
        var pkcs8 = SecretProtector.Unprotect(cloud.PrivateKeyProtected);
        if (pkcs8 is not null)
        {
            try
            {
                var rsa = RSA.Create();
                rsa.ImportPkcs8PrivateKey(Convert.FromBase64String(pkcs8), out _);
                var spki = Convert.ToBase64String(rsa.ExportSubjectPublicKeyInfo());
                if (spki != cloud.PublicKeySpki)
                    settings.Update(s => s.Cloud.PublicKeySpki = spki);
                return new JobCrypto(rsa, spki);
            }
            catch (Exception ex) when (ex is CryptographicException or FormatException)
            {
                var copy = settings.Backup("printkey");
                Log.Error($"Cloud: saved print key could not be loaded ({ex.Message}); creating a new one. " +
                          $"Old settings kept in {copy ?? "(no copy)"}. Pair this PC again if the booth rejects the new key.");
            }
        }
        else if (cloud.PrivateKeyProtected.Length > 0)
        {
            var copy = settings.Backup("printkey");
            Log.Error("Cloud: saved print key could not be decrypted (another Windows user?); creating a new one. " +
                      $"Old settings kept in {copy ?? "(no copy)"}. Pair this PC again if the booth rejects the new key.");
        }

        var created = RSA.Create(2048);
        var newSpki = Convert.ToBase64String(created.ExportSubjectPublicKeyInfo());
        var privateKey = created.ExportPkcs8PrivateKey();
        var protectedKey = SecretProtector.Protect(Convert.ToBase64String(privateKey));
        CryptographicOperations.ZeroMemory(privateKey);
        settings.Update(s =>
        {
            s.Cloud.PrivateKeyProtected = protectedKey;
            s.Cloud.PublicKeySpki = newSpki;
        });
        Log.Info("Cloud: created a new RSA 2048 key pair for print file encryption");
        return new JobCrypto(created, newSpki);
    }

    /// <summary>Decrypts a job's data. Throws <see cref="CryptographicException"/> or <see cref="FormatException"/>.</summary>
    public byte[] Decrypt(string alg, string wrappedKeyB64, string ivB64, string dataB64)
    {
        if (!string.Equals(alg, Algorithm, StringComparison.Ordinal))
            throw new CryptographicException($"Unsupported encryption \"{alg}\"");

        var iv = Convert.FromBase64String(ivB64);
        var data = Convert.FromBase64String(dataB64);
        if (iv.Length != IvBytes)
            throw new CryptographicException("IV must be 12 bytes");
        if (data.Length <= TagBytes)
            throw new CryptographicException("Encrypted file is empty");

        var key = _rsa.Decrypt(Convert.FromBase64String(wrappedKeyB64), RSAEncryptionPadding.OaepSHA256);
        try
        {
            if (key.Length != 32)
                throw new CryptographicException("Wrapped key is not an AES-256 key");

            // WebCrypto AES-GCM output = ciphertext || 16-byte tag.
            var cipherLength = data.Length - TagBytes;
            var plain = new byte[cipherLength];
            using var gcm = new AesGcm(key, TagBytes);
            gcm.Decrypt(iv, data.AsSpan(0, cipherLength), data.AsSpan(cipherLength), plain);
            return plain;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    public void Dispose() => _rsa.Dispose();
}
