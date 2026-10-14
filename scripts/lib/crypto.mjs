import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const ITERATIONS = 250_000;
const toB64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(passphrase, salt, iterations, usage) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

// Same format the browser decrypts in site/app.js.
export async function encryptJson(value, passphrase) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS, 'encrypt');
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

export async function decryptJson(payload, passphrase) {
  const key = await deriveKey(passphrase, fromB64(payload.salt), payload.iterations, 'decrypt');
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, key, fromB64(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
