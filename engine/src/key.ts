/**
 * Reversible key serialization — the mapping between placeholders and original values.
 * Canonical form is versioned JSON (`key.v1`); CSV is the human/Excel export (RFC-4180). The key
 * lives only in the browser and, if downloaded, only on the user's device (KEY-01) — it never
 * touches a server. `docId` (a hash of the source, set by the caller) lets restore warn when a key
 * belongs to a different document.
 */
import type { EntityType, KeyRow } from "./types";

const CSV_HEADER = "placeholder,original,type";
const KEY_VERSION = "key.v1";

export interface KeyFile {
  readonly version: typeof KEY_VERSION;
  readonly docId?: string;
  readonly createdAt?: string;
  readonly rows: readonly KeyRow[];
}

/** Quote a CSV field per RFC-4180 when it contains a comma, quote, or newline. */
function csvEscape(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** KeyRow[] → RFC-4180 CSV (with header). No BOM here — the download layer adds it. */
export function toCsv(rows: readonly KeyRow[]): string {
  const body = rows
    .map((r) => [r.placeholder, r.original, r.type].map(csvEscape).join(","))
    .join("\r\n");
  return body.length > 0 ? `${CSV_HEADER}\r\n${body}` : CSV_HEADER;
}

/** Minimal RFC-4180 parser (handles quoted fields with commas/quotes/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV → KeyRow[] (drops the header; ignores malformed short rows). */
export function fromCsv(csv: string): KeyRow[] {
  const rows = parseCsv(csv);
  if (rows.length <= 1) {
    return [];
  }
  return rows
    .slice(1)
    .filter((r) => r.length >= 3)
    .map((r) => ({ placeholder: r[0], original: r[1], type: r[2] as EntityType }));
}

/** KeyRow[] → canonical `key.v1` JSON (pretty). `meta` (docId/createdAt) is optional. */
export function toKeyFile(
  rows: readonly KeyRow[],
  meta?: { docId?: string; createdAt?: string },
): string {
  const file: KeyFile = {
    version: KEY_VERSION,
    ...(meta?.docId ? { docId: meta.docId } : {}),
    ...(meta?.createdAt ? { createdAt: meta.createdAt } : {}),
    rows,
  };
  return JSON.stringify(file, null, 2);
}

/** Parse a `key.v1` JSON file back to rows; throws on an unrecognized shape. */
export function fromKeyFile(json: string): KeyRow[] {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== KEY_VERSION ||
    !Array.isArray((parsed as { rows?: unknown }).rows)
  ) {
    throw new Error("Unrecognized key file (expected version key.v1).");
  }
  return (parsed as { rows: KeyRow[] }).rows.map((r) => ({
    placeholder: String(r.placeholder),
    original: String(r.original),
    type: r.type,
  }));
}
