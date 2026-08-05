/**
 * MIME type per file extension, for the redacted-file download. Extracted to a pure module so it is
 * unit-testable, and built on a NULL-prototype object so a user-supplied name like `x.__proto__` /
 * `x.constructor` can never resolve to an inherited property (which would hand `new Blob({ type })` an
 * object/function instead of a string). Unknown extensions fall back to a safe binary default.
 */
const MIME_BY_EXT: Record<string, string> = Object.assign(Object.create(null), {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  txt: "text/plain;charset=utf-8",
  csv: "text/csv;charset=utf-8",
});

/** Resolve a file name to a MIME type; always returns a string (safe binary default when unknown). */
export function mimeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
