/**
 * XML text-node entity coding — pure string helpers shared by the Office redaction plumbing
 * (web/src/worker/officeRedact.ts), the file restore path, and the Office self-verify. Framework-free
 * (no DOM), so the verify can live in the engine and be unit-tested in node.
 */

const NAMED_DECODE: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
];

/** Decode the XML entities that can appear inside a text node (named + numeric). `&amp;` last. */
export function decodeXml(text: string): string {
  let out = text;
  for (const [pattern, replacement] of NAMED_DECODE) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  );
  out = out.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
  return out.replace(/&amp;/g, "&");
}

/** Re-encode text for an XML text node. `&` first so we never double-escape. */
export function encodeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
