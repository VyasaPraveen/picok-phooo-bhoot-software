using System.Security.Cryptography;
using System.Text;

namespace Epixs.PrintBridge.Core;

public static class PairingKey
{
    // Uppercase alphanumerics without the easily confused 0/O and 1/I.
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    public const int Length = 6;

    public static string Generate() => RandomNumberGenerator.GetString(Alphabet, Length);

    public static bool IsWellFormed(string? key) =>
        key is { Length: Length } && key.All(c => Alphabet.Contains(c));

    /// <summary>Constant-time comparison (hashing first removes any length-dependent timing).</summary>
    public static bool Matches(string? provided, string expected)
    {
        var a = SHA256.HashData(Encoding.UTF8.GetBytes((provided ?? string.Empty).Trim().ToUpperInvariant()));
        var b = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        return CryptographicOperations.FixedTimeEquals(a, b) && !string.IsNullOrEmpty(provided);
    }
}
