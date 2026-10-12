// Seals the GitHub token with a key derived from the maintainer's passphrase, so only
// ciphertext is ever written to disk. Web Crypto only: PBKDF2-SHA256 then AES-256-GCM.

const ITERATIONS = 600_000; // OWASP's PBKDF2-HMAC-SHA256 recommendation
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

export class WrongPassphrase extends Error {}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(secret, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(secret)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function unseal(vault, passphrase) {
  // Never derive with fewer rounds than this version writes, whatever the stored record says.
  if (vault?.v !== 1 || vault.kdf !== 'PBKDF2-SHA256' || !(vault.iterations >= ITERATIONS && vault.iterations <= 10_000_000)) {
    throw new Error('The saved token is in a format this version cannot read. Remove it and save it again.');
  }
  const key = await deriveKey(passphrase, fromBase64(vault.salt), vault.iterations);
  try {
    return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(vault.iv) }, key, fromBase64(vault.ciphertext)));
  } catch {
    throw new WrongPassphrase('Wrong passphrase.');
  }
}
