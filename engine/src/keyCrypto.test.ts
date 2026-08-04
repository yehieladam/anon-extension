import { describe, expect, it } from "vitest";
import { decryptKeyRows, encryptKeyRows, isEncryptedKeyFile } from "./keyCrypto";
import type { KeyRow } from "./types";

const ROWS: KeyRow[] = [
  { placeholder: "[ת״ז_1]", original: "123456709", type: "ISRAELI_ID" },
  { placeholder: "[שם_1]", original: "ישראל ישראלי", type: "PERSON" },
  { placeholder: "[טלפון_1]", original: "052-1234567", type: "IL_PHONE" },
];

describe("keyCrypto", () => {
  it("round-trips key rows through encrypt → decrypt with the right passphrase", async () => {
    const envelope = await encryptKeyRows(ROWS, "correct horse battery staple");
    const restored = await decryptKeyRows(envelope, "correct horse battery staple");
    expect(restored).toEqual(ROWS);
  });

  it("produces a self-describing envelope with no plaintext PII in it", async () => {
    const envelope = await encryptKeyRows(ROWS, "pw");
    expect(isEncryptedKeyFile(envelope)).toBe(true);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("123456709");
    expect(serialized).not.toContain("ישראל ישראלי");
    expect(envelope.kdf.iterations).toBeGreaterThanOrEqual(600_000);
  });

  it("fails cleanly (WRONG_PASSPHRASE) on a wrong passphrase", async () => {
    const envelope = await encryptKeyRows(ROWS, "right");
    await expect(decryptKeyRows(envelope, "wrong")).rejects.toThrow("WRONG_PASSPHRASE");
  });

  it("fails cleanly on a tampered ciphertext", async () => {
    const envelope = await encryptKeyRows(ROWS, "pw");
    const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + "AAAA" };
    await expect(decryptKeyRows(tampered, "pw")).rejects.toThrow("WRONG_PASSPHRASE");
  });

  it("isEncryptedKeyFile distinguishes an envelope from a plain key file", () => {
    expect(isEncryptedKeyFile({ version: "key.v1", rows: [] })).toBe(false);
    expect(isEncryptedKeyFile(null)).toBe(false);
    expect(isEncryptedKeyFile("nope")).toBe(false);
  });
});
