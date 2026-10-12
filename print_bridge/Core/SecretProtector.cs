using System.Security.Cryptography;
using System.Text;

namespace Epixs.PrintBridge.Core;

/// <summary>DPAPI (current Windows user) protection for secrets stored in settings.json.</summary>
public static class SecretProtector
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("EPIXS.PrintBridge.Secret.v1");

    public static string Protect(string plain)
    {
        if (string.IsNullOrEmpty(plain))
            return string.Empty;
        var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), Entropy, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(bytes);
    }

    /// <summary>Returns null when the value is empty or cannot be decrypted (e.g. another Windows user).</summary>
    public static string? Unprotect(string? protectedBase64)
    {
        if (string.IsNullOrEmpty(protectedBase64))
            return null;
        try
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(protectedBase64), Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return null;
        }
    }
}
