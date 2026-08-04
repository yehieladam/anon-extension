/**
 * Overlay redaction for Office files (.docx / .xlsx). A document the user uploads is an official file
 * with a logo, letterhead and styling — we must NOT rebuild it from extracted text. Instead we open
 * the original zip, rewrite only the visible text nodes with their PII replaced in place, and repack
 * every other part (media, styles, headers) byte-for-byte. The engine's overlay core (engine/overlay)
 * does the pure text math; this module is only the zip + XML plumbing, which needs a browser/worker.
 *
 * One detection pass runs over the whole document's concatenated text, so the placeholder numbering
 * ([שם_1] …) and the restore key are coherent across body, headers and footers. Values split across
 * several runs (Word does this constantly) are handled by the overlay char-walk.
 *
 * Limitations (documented, not hidden): xlsx numbers stored as numeric cells (not shared strings) are
 * not yet redacted here; rich-text run splits inside a cell are handled, inline sheet strings are not.
 * These are follow-ups — see docs/tasks.md.
 */
import type { AnonymizeResult } from "@engine/types";
import { anonymizeDeterministic } from "@engine/pipeline";
import { applyOverlay, toReplacements, type Segment } from "@engine/overlay";
import { extractText } from "./extract";

/**
 * How to anonymize the document's text. Injected so the caller decides deterministic-only vs full
 * (with NER names) — when the model is loaded, files get names redacted too. May be async (NER is).
 */
export type Anonymize = (text: string) => AnonymizeResult | Promise<AnonymizeResult>;

export interface RedactedFile {
  readonly bytes: Uint8Array;
  readonly result: AnonymizeResult;
}

/**
 * Result of processing an uploaded file: always the detection result (drives the on-screen chips and
 * restore key); `bytes` is the redacted file to download, present only for types we can rewrite
 * (docx/xlsx overlay, txt/csv plain). For pdf/xls we still detect and preview, but there is no
 * download here yet (PDF is the separate mupdf redaction track).
 */
export interface FileRedaction {
  readonly result: AnonymizeResult;
  readonly bytes?: Uint8Array;
}

/** A single editable text node located in one XML part of the zip. */
interface TextNode {
  readonly path: string;
  readonly innerStart: number;
  readonly innerEnd: number;
  /** Group id (part + paragraph/string index) — a separator is inserted between different groups. */
  readonly group: string;
}

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

/**
 * Find every `<tag>…</tag>` text node in a part, tagging each with a group id built from the part
 * order and the number of `groupTag` openings before it (paragraph in docx, `<si>` in xlsx). Nodes in
 * the same group are concatenated with no separator (they are one logical line); different groups get
 * a newline so detection never bridges unrelated text.
 */
function collectNodes(part: string, path: string, partOrder: number, tag: string, groupTag: string): {
  nodes: TextNode[];
  decoded: string[];
} {
  const nodeRegex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const groupRegex = new RegExp(`<${groupTag}\\b`, "g");
  const groupStarts: number[] = [];
  for (let match = groupRegex.exec(part); match !== null; match = groupRegex.exec(part)) {
    groupStarts.push(match.index);
  }
  const nodes: TextNode[] = [];
  const decoded: string[] = [];
  for (let match = nodeRegex.exec(part); match !== null; match = nodeRegex.exec(part)) {
    const inner = match[1];
    const innerStart = match.index + (match[0].length - inner.length - (tag.length + 3));
    const groupIndex = countBefore(groupStarts, match.index);
    nodes.push({ path, innerStart, innerEnd: innerStart + inner.length, group: `${partOrder}:${groupIndex}` });
    decoded.push(decodeXml(inner));
  }
  return { nodes, decoded };
}

/** Number of ascending `starts` strictly less than `pos` (binary search). */
function countBefore(starts: readonly number[], pos: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (starts[mid] < pos) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Core: given the ordered parts and their editable nodes, run one detection pass over the whole
 * concatenated stream, then splice the redacted text back into each part. Returns the new part
 * strings plus the AnonymizeResult (for the UI chips + restore key).
 */
async function redactParts(
  parts: ReadonlyArray<{ path: string; content: string }>,
  tag: string,
  groupTag: string,
  anonymize: Anonymize,
): Promise<{ updated: Map<string, string>; result: AnonymizeResult }> {
  const allNodes: TextNode[] = [];
  const segments: Segment[] = [];
  let concat = "";
  let previousGroup: string | null = null;

  parts.forEach((part, order) => {
    const { nodes, decoded } = collectNodes(part.content, part.path, order, tag, groupTag);
    nodes.forEach((node, i) => {
      if (previousGroup !== null && node.group !== previousGroup) {
        concat += "\n";
      }
      previousGroup = node.group;
      const start = concat.length;
      concat += decoded[i];
      segments.push({ start, end: concat.length });
      allNodes.push(node);
    });
  });

  const result = await anonymize(concat);
  const rewritten = applyOverlay(concat, segments, toReplacements(concat, result));

  // Splice each node's new text back, per part, from the last node to the first so offsets hold.
  const updated = new Map<string, string>(parts.map((part) => [part.path, part.content]));
  for (let i = allNodes.length - 1; i >= 0; i -= 1) {
    const node = allNodes[i];
    if (rewritten[i] === concatSliceOfNode(concat, segments[i])) {
      continue; // unchanged node — skip the splice
    }
    const content = updated.get(node.path) as string;
    updated.set(
      node.path,
      content.slice(0, node.innerStart) + encodeXml(rewritten[i]) + content.slice(node.innerEnd),
    );
  }
  return { updated, result };
}

function concatSliceOfNode(concat: string, segment: Segment): string {
  return concat.slice(segment.start, segment.end);
}

/** docx: body + headers + footers + notes, in reading order. */
export const DOCX_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

async function loadZip(buffer: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  return JSZip.loadAsync(buffer);
}

async function redactOffice(
  buffer: ArrayBuffer,
  matchPart: (name: string) => boolean,
  order: (name: string) => number,
  tag: string,
  groupTag: string,
  anonymize: Anonymize,
): Promise<RedactedFile> {
  const zip = await loadZip(buffer);
  const paths = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && matchPart(name))
    .sort((a, b) => order(a) - order(b));
  const parts = await Promise.all(
    paths.map(async (path) => ({ path, content: await zip.files[path].async("string") })),
  );
  const { updated, result } = await redactParts(parts, tag, groupTag, anonymize);
  for (const [path, content] of updated) {
    zip.file(path, content);
  }
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return { bytes, result };
}

/** Body first, then header1, header2…, then footers, then notes — a stable reading order. */
function docxOrder(name: string): number {
  if (name === "word/document.xml") return 0;
  if (name.includes("header")) return 100 + numberIn(name);
  if (name.includes("footer")) return 200 + numberIn(name);
  return 300;
}

function numberIn(name: string): number {
  const match = name.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** Redact a .docx by overlaying placeholders onto its `<w:t>` runs, preserving everything else. */
export function redactDocx(buffer: ArrayBuffer, anonymize: Anonymize = anonymizeDeterministic): Promise<RedactedFile> {
  return redactOffice(buffer, (name) => DOCX_PART.test(name), docxOrder, "w:t", "w:p", anonymize);
}

/** Redact a .xlsx by overlaying placeholders onto its shared-string `<t>` nodes. */
export function redactXlsx(buffer: ArrayBuffer, anonymize: Anonymize = anonymizeDeterministic): Promise<RedactedFile> {
  return redactOffice(buffer, (name) => name === "xl/sharedStrings.xml", () => 0, "t", "si", anonymize);
}

/** Anonymize a plain-text buffer and return it as bytes (txt / csv — no formatting to preserve). */
async function redactPlainText(buffer: ArrayBuffer, anonymize: Anonymize): Promise<FileRedaction> {
  const result = await anonymize(new TextDecoder().decode(buffer));
  return { result, bytes: new TextEncoder().encode(result.anonymizedText) };
}

/**
 * Process an uploaded file: overlay-redact when we can rewrite the format, otherwise fall back to
 * detection-only (still shows PII + enables restore). Routed by extension. `anonymize` is injected so
 * files pick up NER names once the model is loaded (defaults to deterministic-only).
 */
export async function redactFile(
  fileName: string,
  buffer: ArrayBuffer,
  anonymize: Anonymize = anonymizeDeterministic,
): Promise<FileRedaction> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "docx":
      return redactDocx(buffer, anonymize);
    case "xlsx":
      return redactXlsx(buffer, anonymize);
    case "txt":
    case "csv":
      return redactPlainText(buffer, anonymize);
    case "pdf": {
      // Overlay redaction on the original PDF (true removal + self-verify). Lazy import so mupdf loads
      // only when a PDF is actually processed (P0I-02) and to break the officeRedact↔pdfRedact cycle.
      const { redactPdf } = await import("./pdfRedact");
      return redactPdf(buffer, anonymize);
    }
    default:
      // xls (legacy binary, not a zip): detect + preview only, no redacted download.
      return { result: await anonymize(await extractText(fileName, buffer)) };
  }
}
