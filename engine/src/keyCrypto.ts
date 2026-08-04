/**
 * Restore-key encryption (KEY-01). The key maps placeholders back to the original PII. By default it
 * lives only in the tab's memory and dies when the tab closes — the differentiation claim. Download is
 * opt-in, and on download we offer passphrase encryption (a checkbox that is CHECKED by default), so a
 * key file at rest on the user's disk is useless without the passphrase.
 *
 * Crypto is the platform's own: PBKDF2-SHA256 (600k iterations) derives an AES-256-GCM key from the
 * passphrase. No dependency, no server, framework-free — `crypto.subtle`, `btoa`/`atob` and
 * `TextEncoder` are all available in the browser and in Node 20 (so this stays unit-testable headless).
 */
import type { KeyRow } from "./types";
import { toKeyFile, fromKeyFile } from "./key";

const ENC_VERSION = "mechikon-key-enc.v1";
const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;

export interface EncryptedKeyFile {
  readonly version: typeof ENC_VERSION;
  readonly kdf: {
    readonly algo: "PBKDF2-SHA256";
    readonly iterations: number;
    readonly salt: string; // base64
  };
  readonly nonce: string; // base64 (AES-GCM IV)
  readonly ciphertext: string; // base64
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt the key rows under a passphrase into a self-describing envelope (safe to write to disk). */
export async function encryptKeyRows(
  rows: readonly KeyRow[],
  passphrase: string,
): Promise<EncryptedKeyFile> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const aesKey = await deriveAesKey(passphrase, salt, KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(toKeyFile(rows));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, plaintext),
  );
  return {
    version: ENC_VERSION,
    kdf: { algo: "PBKDF2-SHA256", iterations: KDF_ITERATIONS, salt: toBase64(salt) },
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

/** Decrypt an envelope back to key rows. Throws `WRONG_PASSPHRASE` on a bad passphrase / tampered file. */
export async function decryptKeyRows(
  envelope: EncryptedKeyFile,
  passphrase: string,
): Promise<KeyRow[]> {
  const salt = fromBase64(envelope.kdf.salt);
  const nonce = fromBase64(envelope.nonce);
  const ciphertext = fromBase64(envelope.ciphertext);
  const aesKey = await deriveAesKey(passphrase, salt, envelope.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aesKey,
      ciphertext as BufferSource,
    );
  } catch {
    // AES-GCM authentication failure — wrong passphrase or a corrupted/tampered file.
    throw new Error("WRONG_PASSPHRASE");
  }
  return fromKeyFile(new TextDecoder().decode(plaintext));
}

/** Is this parsed JSON an encrypted key envelope (vs a plain key.v1 file)? */
export function isEncryptedKeyFile(value: unknown): value is EncryptedKeyFile {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === ENC_VERSION
  );
}
