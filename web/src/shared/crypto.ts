/** PIN hash shared with the Android app: SHA-256 hex of "picok-booth::" + PIN. */
export async function hashPin(pin: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`picok-booth::${pin}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const DEFAULT_ADMIN_PIN = '2580';
export const DEFAULT_OPERATOR_PIN = '1470';

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode(...u8.subarray(i, i + chunk));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Key id of a bridge public key: first 16 hex chars of SHA-256 over the SPKI DER bytes. */
export async function keyId(publicKeySpkiB64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', fromBase64(publicKeySpkiB64));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * Encrypts a print file end-to-end for the Print Bridge (docs/CLOUD_API.md):
 * random AES-256-GCM key + 12-byte IV for the file, AES key wrapped with the bridge's
 * RSA-OAEP (SHA-256) public key. Firebase only ever stores ciphertext.
 */
export async function encryptForBridge(file: Blob, publicKeySpkiB64: string) {
  const rsa = await crypto.subtle.importKey(
    'spki',
    fromBase64(publicKeySpkiB64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, await file.arrayBuffer());
  const rawKey = await crypto.subtle.exportKey('raw', aes);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, rawKey);
  return {
    enc: { alg: 'RSA-OAEP-256+A256GCM', key: toBase64(wrapped), iv: toBase64(iv), kid: await keyId(publicKeySpkiB64) },
    data: toBase64(cipher),
  };
}
