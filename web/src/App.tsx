import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as Comlink from "comlink";
import type { AnonymizeResult, EntityType, KeyRow } from "@engine/types";
import type { ManualTerm } from "@engine/manual";
import type { RestoreResult } from "@engine/restore";
import { toKeyFile, fromKeyFile } from "@engine/key";
import {
  encryptKeyRows,
  decryptKeyRows,
  isEncryptedKeyFile,
  type EncryptedKeyFile,
} from "@engine/keyCrypto";
import { getEngine } from "./worker/engineClient";
import { useNetwork } from "./lib/useNetworkCount";
import { mimeFor } from "./lib/mime";
import { isScanOcrEnabled } from "./lib/scanFlag";
import { scanNoticeFor } from "./lib/scanNotice";
import { loadNer, useNer } from "./worker/nerController";

/** Progress of the slow scanned-PDF OCR op (Stage 5). "model" = the one-time NER load precedes OCR. */
type ScanProgress = { phase: "model" | "reading" | "verifying"; page?: number; total?: number };

/** What produced the current result — so we can re-run it with NER once the model is ready. `scan` marks
 * a file that classified as a scanned PDF, so EVERY re-run path (NER-ready, manual terms) routes it back
 * through the OCR pass instead of the text path. */
type Source =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly name: string; readonly buffer: ArrayBuffer; readonly scan?: boolean };

/** AGPL-3.0 §13: users interacting over a network must be offered the corresponding source. */
const SOURCE_URL = "https://github.com/yehieladam/anon-extension";
const COPIED_RESET_MS = 1500;
const MANUAL_ONLY_KEY = "mechikon.manualOnly";

/** Read the persisted manual-only preference (default off = automatic detection). */
function readManualOnly(): boolean {
  try {
    return localStorage.getItem(MANUAL_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the manual-only preference so it survives reloads. */
function writeManualOnly(on: boolean): void {
  try {
    localStorage.setItem(MANUAL_ONLY_KEY, on ? "1" : "0");
  } catch {
    // Private mode / storage disabled — the toggle still works for this session.
  }
}

/** Insert the "redacted" suffix before the extension: report.docx → report_מושחר.docx */
function redactedName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot === -1 ? fileName : fileName.slice(0, dot);
  const ext = dot === -1 ? "" : fileName.slice(dot);
  return `${base}_מושחר${ext}`;
}

/** Trigger a browser download of a blob under the given filename. */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** EntityType → i18n label key, for the per-type count chips. */
const TYPE_LABEL: Record<EntityType, string> = {
  ISRAELI_ID: "entity.id",
  IL_COMPANY: "entity.company",
  IL_PHONE: "entity.phone",
  IL_IBAN: "entity.iban",
  IL_CASE: "entity.case",
  IL_LAND: "entity.land",
  IL_POLICY: "entity.policy",
  IL_INSURED: "entity.insured",
  EMAIL_ADDRESS: "entity.email",
  PERSON: "entity.name",
  ORGANIZATION: "entity.org",
  LOCATION: "entity.place",
  MANUAL: "entity.manual",
  IL_NUMBER: "entity.number",
};

/** Split on placeholder tokens and render each as a subtle pill so the redactions read clearly. */
const TOKEN_SPLIT = /(\[[^[\]]*_\d+\])/g;
const IS_TOKEN = /^\[[^[\]]*_\d+\]$/;
function highlight(text: string): ReactNode[] {
  return text.split(TOKEN_SPLIT).map((part, index) =>
    IS_TOKEN.test(part) ? (
      <mark
        key={index}
        className="mx-0.5 rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[0.92em] font-medium text-ink"
      >
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/** A clickable word/number run: letters/digits (Hebrew or Latin) with internal connectors kept whole
 *  (so "052-1234567" / "14.07.1981" / "טל׳" stay one unit). */
const WORD_RUN = /[0-9A-Za-z֐-׿]+(?:[.\-/'’׳״][0-9A-Za-z֐-׿]+)*/g;

/**
 * Render the anonymized text as an INTERACTIVE preview: already-redacted spans show as token pills
 * (a manual one is clickable to UNDO), and every remaining word/number is clickable to redact it.
 * This is how the user hand-picks redactions — clicking a word adds it as a manual term everywhere.
 */
function renderInteractive(
  text: string,
  manualTokenToTerm: ReadonlyMap<string, string>,
  onPick: (word: string) => void,
  onUndo: (term: string) => void,
  pickTitle: string,
  undoTitle: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  for (const part of text.split(TOKEN_SPLIT)) {
    if (IS_TOKEN.test(part)) {
      const term = manualTokenToTerm.get(part);
      if (term !== undefined) {
        nodes.push(
          <button
            key={key++}
            type="button"
            title={undoTitle}
            onClick={() => onUndo(term)}
            className="mx-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[0.92em] font-medium text-amber-800 transition hover:bg-amber-200"
          >
            {part}
          </button>,
        );
      } else {
        nodes.push(
          <mark
            key={key++}
            className="mx-0.5 rounded-md bg-ink/[0.06] px-1.5 py-0.5 text-[0.92em] font-medium text-ink"
          >
            {part}
          </mark>,
        );
      }
      continue;
    }
    let last = 0;
    for (const match of part.matchAll(WORD_RUN)) {
      const start = match.index;
      const word = match[0];
      if (start > last) {
        nodes.push(<span key={key++}>{part.slice(last, start)}</span>);
      }
      nodes.push(
        <button
          key={key++}
          type="button"
          title={pickTitle}
          onClick={() => onPick(word)}
          className="rounded transition hover:bg-ink/[0.08] hover:ring-1 hover:ring-ink/20"
        >
          {word}
        </button>,
      );
      last = start + word.length;
    }
    if (last < part.length) {
      nodes.push(<span key={key++}>{part.slice(last)}</span>);
    }
  }
  return nodes;
}

export function App() {
  const { t } = useTranslation();
  const net = useNetwork();
  const ner = useNer();

  const [input, setInput] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [status, setStatus] = useState<null | "working" | "reading">(null);
  const [result, setResult] = useState<AnonymizeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [scannedNotice, setScannedNotice] = useState(false);
  const [formulaNotice, setFormulaNotice] = useState(false);
  const [selfVerifyNotice, setSelfVerifyNotice] = useState(false);
  // Scanned-PDF OCR (Stage 5): a scan awaiting the NER model before its single OCR pass, the live
  // per-page progress, and the two-tier refusal ("lowQuality" = readable-poorly; "unsafe" = the rare
  // internal-safety refusals SCAN_UNMAPPABLE_PII / SCAN_SELFVERIFY_FAILED).
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanNotice, setScanNotice] = useState<null | "lowQuality" | "unsafe">(null);
  // The redacted file bytes ready for download (the burned-token PDF / redacted office file).
  const [redacted, setRedacted] = useState<{ bytes: Uint8Array; name: string; mime: string } | null>(
    null,
  );
  const [restoreInput, setRestoreInput] = useState("");
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  // Manual redaction — user-added terms the automatic detectors missed.
  const [manualTerms, setManualTerms] = useState<ManualTerm[]>([]);
  const [manualInput, setManualInput] = useState("");
  // Optional custom placeholder name for a typed manual term — ASCII/Latin only (it is burned onto the
  // PDF, where Hebrew won't render), so the input sanitizes to uppercase A–Z as the user types.
  const [manualLabel, setManualLabel] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  // Manual-only mode: redact ONLY the user's chosen terms — no automatic detection, no 185MB model.
  // Persisted so a user who prefers it never triggers a model load. A ref mirrors it so the many
  // worker-calling callbacks read the latest value without each depending on it (no stale closures).
  const [manualOnly, setManualOnly] = useState<boolean>(() => readManualOnly());
  const manualOnlyRef = useRef(manualOnly);
  manualOnlyRef.current = manualOnly;
  // Restore-key download/upload (KEY-01): the key is in-memory by default; download is opt-in and
  // encryption (passphrase) is on by default.
  const [encryptKey, setEncryptKey] = useState(true);
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [uploadedKey, setUploadedKey] = useState<KeyRow[] | null>(null);
  const [pendingEnc, setPendingEnc] = useState<EncryptedKeyFile | null>(null);
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [keyError, setKeyError] = useState<"wrong" | "invalid" | null>(null);
  // Restore a FILE (docx/txt with placeholders) back to its original values.
  const [restoreFileError, setRestoreFileError] = useState<"unsupported" | "nokey" | "generic" | null>(
    null,
  );
  const [restoreUnmatched, setRestoreUnmatched] = useState(0);

  const busy = status !== null;

  const showResult = useCallback((anonymized: AnonymizeResult) => {
    setResult(anonymized);
    setRestoreInput(anonymized.anonymizedText);
    setRestoreResult(null);
    setRedacted(null);
    setScannedNotice(false);
    setScanNotice(null); // a fresh result clears any leftover scan refusal from a prior file
  }, []);

  const onAnonymize = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || busy) {
      return;
    }
    setStatus("working");
    setFileError(false);
    setSource({ kind: "text", text });
    setManualTerms([]);
    try {
      // Manual-only: redact just the chosen terms, no model. Otherwise instant deterministic now, then
      // load NER for names (it upgrades the result when ready).
      showResult(await getEngine().anonymizeSmart(text, [], manualOnlyRef.current));
      if (!manualOnlyRef.current) {
        void loadNer();
      }
    } finally {
      setStatus(null);
    }
  }, [input, busy, showResult]);

  // The single OCR pass for a scanned PDF (Stage 5). Runs ONLY once NER is ready (names come from NER on
  // the OCR text) so there is no wasted deterministic-only pass; per-page progress streams from the
  // worker; the three refusal codes map to the two-tier notice; any failure pulls the download (never
  // hand back a scan we could not fully redact + verify).
  const runScanRedaction = useCallback(
    async (name: string, buffer: ArrayBuffer, terms: readonly ManualTerm[], isCancelled?: () => boolean) => {
      setStatus("reading");
      setScanNotice(null);
      setFileError(false);
      const onProgress = Comlink.proxy((event: ScanProgress) => {
        if (!isCancelled?.()) setScanProgress(event);
      });
      try {
        const { result, bytes } = await getEngine().redactFile(name, buffer, terms, true, onProgress);
        if (isCancelled?.()) return; // source changed / unmounted during the multi-second OCR
        showResult(result);
        if (bytes) {
          setRedacted({ bytes, name: redactedName(name), mime: mimeFor(name) });
        }
      } catch (error) {
        if (isCancelled?.()) return;
        setRedacted(null);
        const kind = scanNoticeFor(error instanceof Error ? error.message : "");
        if (kind) {
          setSource(null);
          setScanNotice(kind);
        } else {
          setFileError(true);
        }
      } finally {
        if (!isCancelled?.()) {
          setScanProgress(null);
          setStatus(null);
        }
      }
    },
    [showResult],
  );

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file || busy) {
        return;
      }
      setStatus("reading");
      setFileError(false);
      setScannedNotice(false);
      setFormulaNotice(false);
      setSelfVerifyNotice(false);
      setScanNotice(null);
      setManualTerms([]);
      try {
        const buffer = await file.arrayBuffer();
        // Scan route (flag-gated): classify BEFORE committing the source, so a scan is marked
        // `scan:true` atomically (no window where the NER-ready effect sees a scan source without the
        // flag and misroutes it to the text path). OCR runs only after NER is ready (H3 — a name-bearing
        // doc is never redacted/downloadable name-unredacted): run now if ready, else the NER-ready
        // effect runs it on the ready transition.
        if (isScanOcrEnabled() && file.name.toLowerCase().endsWith(".pdf")) {
          const kind = await getEngine().classifyPdf(buffer);
          if (kind === "scan") {
            setSource({ kind: "file", name: file.name, buffer, scan: true });
            if (ner.status === "ready") {
              await runScanRedaction(file.name, buffer, []);
            } else {
              void loadNer();
              setStatus(null);
            }
            return;
          }
        }
        setSource({ kind: "file", name: file.name, buffer });
        const { result: anonymized, bytes } = await getEngine().redactFile(
          file.name,
          buffer,
          [],
          false,
          undefined,
          manualOnlyRef.current,
        );
        showResult(anonymized);
        if (bytes) {
          setRedacted({ bytes, name: redactedName(file.name), mime: mimeFor(file.name) });
        }
        if (!manualOnlyRef.current) {
          void loadNer();
        }
      } catch (error) {
        // A scanned/image PDF has no text layer — refuse with a specific notice instead of a falsely
        // "clean" result (the message survives Comlink from the worker).
        if (error instanceof Error && error.message.includes("NO_TEXT_LAYER")) {
          setSource(null);
          setScannedNotice(true);
        } else if (error instanceof Error && error.message.includes("XLSX_FORMULA_PII")) {
          // A number produced by a formula can't be safely overlaid (recalc regenerates it) — refuse.
          setSource(null);
          setFormulaNotice(true);
        } else if (
          error instanceof Error &&
          (error.message.includes("OFFICE_SELFVERIFY_FAILED") || error.message.includes("TEXT_SELFVERIFY_FAILED"))
        ) {
          // A detected value survived in the output (office file) or in the tokenized AI-text (PDF) — the
          // AI-text is machine-consumed with no human review, so a leak there is a HARD refuse of both.
          setSource(null);
          setSelfVerifyNotice(true);
        } else {
          setFileError(true);
        }
      } finally {
        setStatus(null);
      }
    },
    [busy, showResult, ner.status, runScanRedaction],
  );

  // When the model finishes loading, re-run whatever is on screen so names get redacted too.
  const previousNerStatus = useRef(ner.status);
  useEffect(() => {
    const wasReady = previousNerStatus.current === "ready";
    previousNerStatus.current = ner.status;
    // Manual-only never loads NER, so there is no names-upgrade pass to run (and the shown result is
    // already final). Guard defensively in case the model was warmed before the user switched modes.
    if (manualOnlyRef.current || ner.status !== "ready" || wasReady || source === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // A scan deferred until the model was ready: run its single OCR pass now (not the text/office
        // upgrade), sharing this effect's cancellation so a stale pass can't commit after source changes.
        if (source.kind === "file" && source.scan) {
          await runScanRedaction(source.name, source.buffer, manualTerms, () => cancelled);
          return;
        }
        if (source.kind === "text") {
          const upgraded = await getEngine().anonymizeSmart(source.text, manualTerms);
          if (!cancelled) {
            showResult(upgraded);
          }
          return;
        }
        const { result: upgraded, bytes } = await getEngine().redactFile(
          source.name,
          source.buffer,
          manualTerms,
        );
        if (cancelled) {
          return;
        }
        showResult(upgraded);
        if (bytes) {
          setRedacted({ bytes, name: redactedName(source.name), mime: mimeFor(source.name) });
        }
      } catch {
        // The NER-pass redaction genuinely failed (e.g. the TEXT self-verify refused a leaky AI-text, or
        // an office self-verify). Never leave the earlier deterministic-only download in place — that
        // would hand back a file the user believes is fully redacted. Surface the error and pull it.
        if (!cancelled) {
          setFileError(true);
          setRedacted(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ner.status, source, showResult, manualTerms, runScanRedaction]);

  // Re-run the current source with a new set of manual terms (add/remove a hand-picked redaction).
  const reprocessManual = useCallback(
    async (terms: ManualTerm[]) => {
      if (!source) {
        return;
      }
      // A scan must re-run through the OCR pass (with scanOcr), never the text path — otherwise the
      // re-run hits NO_TEXT_LAYER and destroys the already-good redacted download.
      if (source.kind === "file" && source.scan) {
        await runScanRedaction(source.name, source.buffer, terms);
        return;
      }
      setStatus(source.kind === "file" ? "reading" : "working");
      setFileError(false);
      try {
        if (source.kind === "text") {
          showResult(await getEngine().anonymizeSmart(source.text, terms, manualOnlyRef.current));
        } else {
          const { result, bytes } = await getEngine().redactFile(
            source.name,
            source.buffer,
            terms,
            false,
            undefined,
            manualOnlyRef.current,
          );
          showResult(result);
          if (bytes) {
            setRedacted({ bytes, name: redactedName(source.name), mime: mimeFor(source.name) });
          }
        }
      } catch {
        // A manual term re-triggered redaction that failed — pull any stale download so the user never
        // saves a file that is not actually fully redacted.
        setFileError(true);
        setRedacted(null);
      } finally {
        setStatus(null);
      }
    },
    [source, showResult, runScanRedaction],
  );

  // Toggle manual-only mode. Update the ref synchronously so the reprocess below runs under the new
  // mode; persist the choice; warm the model when switching back to automatic; re-run the current doc.
  const onToggleManualOnly = useCallback(() => {
    const next = !manualOnlyRef.current;
    manualOnlyRef.current = next;
    setManualOnly(next);
    writeManualOnly(next);
    if (!next) {
      void loadNer();
    }
    if (source) {
      void reprocessManual(manualTerms);
    }
  }, [source, manualTerms, reprocessManual]);

  const onAddManual = useCallback(() => {
    const value = manualInput.trim();
    if (value.length === 0 || manualTerms.some((t) => t.value === value)) {
      setManualInput("");
      setManualLabel("");
      return;
    }
    const label = manualLabel.trim(); // already sanitized to uppercase A–Z by the input
    const terms = [...manualTerms, label ? { value, label } : { value }];
    setManualTerms(terms);
    setManualInput("");
    setManualLabel("");
    void reprocessManual(terms);
  }, [manualInput, manualLabel, manualTerms, reprocessManual]);

  const onRemoveManual = useCallback(
    (value: string) => {
      const terms = manualTerms.filter((t) => t.value !== value);
      setManualTerms(terms);
      void reprocessManual(terms);
    },
    [manualTerms, reprocessManual],
  );

  // Click-to-redact: clicking a word/number in the preview adds it as a manual term (redacted at every
  // occurrence). No-op if it is already redacted, so a double-click can't create a duplicate.
  const onPickWord = useCallback(
    (word: string) => {
      const value = word.trim();
      if (value.length === 0 || manualTerms.some((t) => t.value === value)) {
        return;
      }
      const terms = [...manualTerms, { value }];
      setManualTerms(terms);
      void reprocessManual(terms);
    },
    [manualTerms, reprocessManual],
  );

  // Which visible tokens came from a MANUAL pick — those are the ones a click can UNDO (auto-detected
  // PII tokens are left static so a stray click can't un-redact real identifiers).
  const manualTokenToTerm = useMemo(() => {
    const map = new Map<string, string>();
    if (result) {
      for (const row of result.key) {
        if (row.type === "MANUAL") {
          map.set(row.placeholder, row.original);
        }
      }
    }
    return map;
  }, [result]);

  // Retry loading the names model after it failed — the block is environmental (fetch/WASM), not the
  // file. On the resulting idle→loading→ready transition the re-run effect recomputes with names and
  // the download button reappears.
  const onRetryNer = useCallback(() => {
    void loadNer();
  }, []);

  const onDownload = useCallback(() => {
    if (!redacted) {
      return;
    }
    // reason: Comlink returns a Uint8Array<ArrayBufferLike>, which TS 5.7 will not narrow to the
    // ArrayBuffer-backed view BlobPart wants; the bytes are a plain copy, so the cast is safe.
    const blob = new Blob([redacted.bytes as BlobPart], { type: redacted.mime });
    downloadBlob(blob, redacted.name);
  }, [redacted]);

  const onDownloadKey = useCallback(async () => {
    if (!result || result.key.length === 0) {
      return;
    }
    const content =
      encryptKey && keyPassphrase.length > 0
        ? JSON.stringify(await encryptKeyRows(result.key, keyPassphrase), null, 2)
        : toKeyFile(result.key);
    downloadBlob(new Blob([content], { type: "application/json" }), "מפתח-שחזור.json");
  }, [result, encryptKey, keyPassphrase]);

  const onUploadKey = useCallback(async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setKeyError(null);
    setPendingEnc(null);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (isEncryptedKeyFile(parsed)) {
        setPendingEnc(parsed); // needs a passphrase to unlock
        return;
      }
      setUploadedKey(fromKeyFile(text));
    } catch {
      setKeyError("invalid");
    }
  }, []);

  const onUnlockKey = useCallback(async () => {
    if (!pendingEnc) {
      return;
    }
    try {
      const rows = await decryptKeyRows(pendingEnc, unlockPassphrase);
      setUploadedKey(rows);
      setPendingEnc(null);
      setUnlockPassphrase("");
      setKeyError(null);
    } catch {
      setKeyError("wrong");
    }
  }, [pendingEnc, unlockPassphrase]);

  const onCopy = useCallback(async () => {
    if (!result) {
      return;
    }
    await navigator.clipboard.writeText(result.anonymizedText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [result]);

  // Prefer an uploaded key (restore in a later/fresh session) over the in-memory session key.
  const activeKey = uploadedKey ?? result?.key ?? null;

  const onRestore = useCallback(async () => {
    const restored = await getEngine().restore(restoreInput, activeKey ?? []);
    setRestoreResult(restored);
  }, [restoreInput, activeKey]);

  const onRestoreFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return;
      }
      setRestoreFileError(null);
      setRestoreUnmatched(0);
      if (!activeKey || activeKey.length === 0) {
        setRestoreFileError("nokey");
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const { bytes, unmatched } = await getEngine().restoreFile(file.name, buffer, activeKey);
        const dot = file.name.lastIndexOf(".");
        const name =
          dot === -1
            ? `${file.name}_משוחזר`
            : `${file.name.slice(0, dot)}_משוחזר${file.name.slice(dot)}`;
        downloadBlob(new Blob([bytes as BlobPart], { type: mimeFor(file.name) }), name);
        setRestoreUnmatched(unmatched.length);
      } catch (error) {
        setRestoreFileError(
          error instanceof Error && error.message.includes("RESTORE_UNSUPPORTED")
            ? "unsupported"
            : "generic",
        );
      }
    },
    [activeKey],
  );

  const chips = useMemo(() => {
    if (!result) {
      return [];
    }
    const counts = new Map<EntityType, number>();
    for (const row of result.key) {
      counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [result]);

  const statusLine =
    status === "reading"
      ? t("input.reading")
      : status === "working"
        ? t("input.working")
        : fileError
          ? t("input.fileError")
          : t("input.uploadHint");

  const steps = [
    { title: t("flow.step1.title"), desc: t("flow.step1.desc") },
    { title: t("flow.step2.title"), desc: t("flow.step2.desc") },
    { title: t("flow.step3.title"), desc: t("flow.step3.desc") },
    { title: t("flow.step4.title"), desc: t("flow.step4.desc") },
  ];

  const trustItems = [
    { key: "noSignup", d: "M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" },
    { key: "offline", d: "M4 4l16 16M8.5 8.6A9 9 0 0 0 5 12m14 0a9 9 0 0 0-3.2-4M12 20h.01" },
    { key: "openSource", d: "M9 18l-6-6 6-6m6 12l6-6-6-6" },
  ] as const;

  return (
    <div dir="rtl" className="min-h-screen bg-white text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-[19px] font-semibold tracking-tight" dir="ltr">
          Mechikon
        </span>
        {(() => {
          // The badge proves DESTINATION, not just count: a request to any host that is not same-origin
          // or a model host is an exfiltration signal → red alarm naming the host. Otherwise emerald
          // (0 main requests) or amber (some benign main request), plus the one-time model count.
          const unexpected = net.unexpected + ner.unexpectedRequests;
          const unexpectedHost = net.unexpectedHost ?? ner.unexpectedHost;
          const dotColor = unexpected > 0 ? "bg-red-500" : net.count === 0 ? "bg-emerald-500" : "bg-amber-500";
          return (
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${unexpected > 0 ? "text-red-600" : "text-zinc-400"}`}
              aria-live="polite"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
              {unexpected > 0 ? (
                <span className="font-medium">
                  {t("trust.badge.unexpected", { host: unexpectedHost ?? "?" })}
                </span>
              ) : (
                <>
                  {t("trust.badge.count", { count: net.count })}
                  {/* Once the model is loaded, show a STATUS, not a rising request count: the count
                      includes cache-served requests on reload and misreads as a re-download (it is not —
                      the model is fetched once and served from the browser cache thereafter). */}
                  {ner.status === "ready" ? (
                    <span className="text-zinc-300">· {t("trust.badge.modelLoaded")}</span>
                  ) : (
                    ner.modelRequests > 0 && (
                      <span className="text-zinc-300">· {t("trust.badge.model", { count: ner.modelRequests })}</span>
                    )
                  )}
                </>
              )}
            </span>
          );
        })()}
      </header>

      <main className="mx-auto max-w-2xl px-6">
        <section className="pt-12 text-center sm:pt-16">
          <img
            src="/logo.png"
            alt="Mechikon"
            className="mx-auto h-24 w-24 object-contain sm:h-28 sm:w-28"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
          <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-[3.25rem]">
            {t("hero.title")}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-zinc-500">
            {t("hero.subtitle")}
          </p>
        </section>

        <section className="mt-12">
          <div className="rounded-3xl border border-hairline bg-white p-2 shadow-card transition focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_40px_-16px_rgba(0,0,0,0.18)]">
            <textarea
              dir="rtl"
              lang="he"
              spellCheck={false}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="min-h-[168px] w-full resize-none rounded-2xl bg-transparent p-4 text-[17px] leading-relaxed outline-none placeholder:text-zinc-400"
              placeholder={t("input.paste.placeholder")}
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-hairline px-4 text-[14px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-surface">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t("input.upload")}
                <input
                  type="file"
                  accept=".docx,.xlsx,.xls,.csv,.pdf,.txt"
                  className="hidden"
                  disabled={busy}
                  onChange={(event) => {
                    void onFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={onAnonymize}
                disabled={busy || input.trim().length === 0}
                className="min-h-[44px] rounded-full bg-ink px-6 text-[15px] font-medium text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-30"
              >
                {t("input.submit")}
              </button>
            </div>
          </div>
          <label className="mt-3 flex min-h-[44px] cursor-pointer select-none items-center gap-2 px-2 text-[13px] text-zinc-600">
            <input
              type="checkbox"
              checked={manualOnly}
              onChange={onToggleManualOnly}
              disabled={busy}
              className="h-4 w-4 accent-ink"
            />
            <span>{t("input.manualOnly")}</span>
          </label>
          <p className={`mt-1 px-2 text-xs ${fileError ? "text-amber-600" : "text-zinc-400"}`}>
            {statusLine}
          </p>
          {scannedNotice && (
            <div
              className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800"
              role="alert"
            >
              {t("input.scannedPdf")}
            </div>
          )}
          {formulaNotice && (
            <div
              className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800"
              role="alert"
            >
              {t("input.formulaPii")}
            </div>
          )}
          {selfVerifyNotice && (
            <div
              className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800"
              role="alert"
            >
              {t("input.selfVerifyFailed")}
            </div>
          )}
          {scanNotice && (
            <div
              className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800"
              role="alert"
            >
              {scanNotice === "lowQuality" ? t("input.scanLowQuality") : t("input.scanUnsafe")}
            </div>
          )}
          {scanProgress && (
            <div className="mt-3 rounded-2xl border border-hairline bg-surface px-4 py-3" aria-live="polite">
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-hairline border-t-ink" aria-hidden />
                <span>
                  {scanProgress.phase === "verifying"
                    ? t("input.scanVerifying", { page: scanProgress.page ?? 1, total: scanProgress.total ?? 1 })
                    : t("input.scanReading", { page: scanProgress.page ?? 1, total: scanProgress.total ?? 1 })}
                </span>
              </div>
            </div>
          )}
          {source?.kind === "file" && source.scan && ner.status === "error" && !redacted && (
            <div
              className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-800"
              role="alert"
            >
              <span>{t("input.scanNamesBlocked")}</span>
              <button
                type="button"
                onClick={onRetryNer}
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-amber-300 px-4 text-xs font-medium hover:bg-amber-100"
              >
                {t("result.retryNames")}
              </button>
            </div>
          )}
          {ner.status === "loading" && (
            <div className="mt-3 rounded-2xl border border-hairline bg-surface px-4 py-3" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-600">
                <span>{t(ner.cachedBefore ? "ner.loadingCached" : "ner.loading")}</span>
                <span className="tabular-nums text-zinc-400">{ner.progress}%</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-hairline">
                <div
                  className="h-full rounded-full bg-ink transition-[width] duration-300"
                  style={{ width: `${ner.progress}%` }}
                />
              </div>
            </div>
          )}
          {ner.status === "error" && (
            <p className="mt-3 px-2 text-xs text-amber-600">{t("ner.error")}</p>
          )}
        </section>

        {result && (
          <section className="mt-8 animate-[fadeIn_0.25s_ease]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  {result.key.length > 0
                    ? t("result.found", { count: result.key.length })
                    : t("result.none")}
                </span>
                {chips.map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs text-zinc-600"
                  >
                    {t(TYPE_LABEL[type])}
                    <span className="tabular-nums text-zinc-400">{count}</span>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setShowManualInput((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    showManualInput
                      ? "bg-ink text-white"
                      : "border border-hairline bg-white text-ink shadow-sm hover:bg-surface"
                  }`}
                >
                  {t("manual.add")}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {redacted &&
                  // A redacted FILE only has names removed once NER has settled. Never hand back the
                  // file before that (trust: no second chance). While loading -> a pending pill; if the
                  // model FAILED -> withhold the download entirely and offer a retry (the deterministic
                  // ID/phone/company chips are already shown, so nothing detected is hidden). Manual-only
                  // never uses NER, so its result is final immediately — skip the NER gate entirely.
                  (!manualOnly &&
                  source?.kind === "file" &&
                  (ner.status === "loading" || ner.status === "idle") ? (
                    <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-hairline px-4 text-[13px] font-medium text-zinc-400">
                      {t("result.downloadPending")}
                    </span>
                  ) : !manualOnly && source?.kind === "file" && ner.status === "error" ? (
                    <button
                      type="button"
                      onClick={onRetryNer}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-4 text-[13px] font-medium text-red-700 transition hover:bg-red-100"
                    >
                      {t("result.retryNames")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onDownload}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition hover:opacity-90"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {t("result.download")}
                    </button>
                  ))}
                {result.key.length > 0 && (
                  <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-hairline px-4 text-[13px] font-medium text-ink transition hover:bg-surface"
                  >
                    {copied ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M5 12l4.5 4.5L19 7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                    {copied ? t("result.copied") : t("result.copy")}
                  </button>
                )}
              </div>
            </div>

            {(showManualInput || manualTerms.length > 0) && (
              <div className="mb-3 rounded-2xl border border-hairline bg-surface p-3">
                {showManualInput && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        dir="rtl"
                        value={manualInput}
                        onChange={(event) => setManualInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onAddManual();
                          }
                        }}
                        placeholder={t("manual.placeholder")}
                        className="min-h-[40px] flex-1 rounded-xl border border-hairline bg-white px-3 text-[14px] outline-none placeholder:text-zinc-400"
                      />
                      <input
                        dir="ltr"
                        value={manualLabel}
                        // ASCII/Latin only — sanitize to uppercase A–Z so the token renders on the PDF
                        // and the user physically cannot enter a name that would break.
                        onChange={(event) =>
                          setManualLabel(event.target.value.replace(/[^A-Za-z]/g, "").toUpperCase())
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onAddManual();
                          }
                        }}
                        placeholder={t("manual.labelPlaceholder")}
                        maxLength={20}
                        className="min-h-[40px] w-28 rounded-xl border border-hairline bg-white px-3 text-[14px] uppercase outline-none placeholder:normal-case placeholder:text-zinc-400"
                      />
                      <button
                        type="button"
                        onClick={onAddManual}
                        disabled={manualInput.trim().length === 0}
                        className="min-h-[40px] rounded-full bg-ink px-4 text-[14px] font-medium text-white transition hover:opacity-90 disabled:opacity-30"
                      >
                        {t("manual.submit")}
                      </button>
                    </div>
                    <p className="px-1 text-[11px] text-zinc-400">{t("manual.labelHint")}</p>
                  </div>
                )}
                {manualTerms.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {manualTerms.map((mt) => (
                      <span
                        key={mt.value}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-ink"
                      >
                        {mt.label ? `${mt.value} → [${mt.label}]` : mt.value}
                        <button
                          type="button"
                          onClick={() => onRemoveManual(mt.value)}
                          aria-label={t("manual.remove")}
                          className="text-zinc-400 transition hover:text-ink"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              dir="rtl"
              className="whitespace-pre-wrap break-words rounded-2xl border border-hairline bg-surface p-5 text-[17px] leading-loose"
            >
              {renderInteractive(
                result.anonymizedText,
                manualTokenToTerm,
                onPickWord,
                onRemoveManual,
                t("result.clickRedact"),
                t("result.clickUndo"),
              )}
            </div>
            <p className="mt-2 px-2 text-xs text-zinc-400">{t("result.clickHint")}</p>
            {manualOnly ? (
              <p className="mt-3 rounded-xl bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-zinc-600">
                {t("result.noteManual")}
              </p>
            ) : source?.kind === "file" && ner.status === "error" ? (
              // Names detection failed for a file — the authoritative message is the hard block, not
              // the ordinary "loading…" note (which would read as if a file is on its way).
              <p
                className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800"
                role="alert"
              >
                {t("result.downloadBlockedNoNames")}
              </p>
            ) : (
              <p className="mt-3 rounded-xl bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-zinc-600">
                {ner.status === "ready" ? t("result.noteNames") : t("result.note")}
              </p>
            )}

            {result.key.length > 0 && (
              <div className="mt-4 rounded-2xl border border-hairline bg-surface p-4">
                <div className="text-[13px] font-medium text-ink">{t("key.title")}</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t("key.explain")}</p>
                <label className="mt-3 flex items-center gap-2 text-[13px] text-zinc-700">
                  <input
                    type="checkbox"
                    checked={encryptKey}
                    onChange={(event) => setEncryptKey(event.target.checked)}
                    className="h-4 w-4 accent-ink"
                  />
                  {t("key.encrypt")}
                </label>
                {encryptKey && (
                  <input
                    type="password"
                    value={keyPassphrase}
                    onChange={(event) => setKeyPassphrase(event.target.value)}
                    placeholder={t("key.passphrase")}
                    className="mt-2 w-full rounded-xl border border-hairline bg-white px-3 py-2 text-[14px] outline-none placeholder:text-zinc-400"
                  />
                )}
                <button
                  type="button"
                  onClick={onDownloadKey}
                  disabled={encryptKey && keyPassphrase.length === 0}
                  className="mt-3 min-h-[40px] rounded-full border border-hairline px-5 text-[14px] font-medium text-ink transition hover:bg-white disabled:opacity-40"
                >
                  {t("key.download")}
                </button>
              </div>
            )}
          </section>
        )}

        <section className="mt-8">
          <details className="group rounded-2xl border border-hairline bg-white transition hover:border-zinc-300">
            <summary className="flex cursor-pointer list-none items-center justify-between p-5 text-sm font-medium text-ink">
              {t("restore.title")}
              <span className="text-zinc-300 transition group-open:rotate-180" aria-hidden="true">
                ⌄
              </span>
            </summary>
            <div className="px-5 pb-5">
              <textarea
                dir="rtl"
                lang="he"
                spellCheck={false}
                value={restoreInput}
                onChange={(event) => setRestoreInput(event.target.value)}
                className="min-h-[120px] w-full resize-none rounded-2xl border border-hairline bg-surface p-4 text-[15px] leading-relaxed outline-none placeholder:text-zinc-400"
                placeholder={t("restore.placeholder")}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onRestore}
                  disabled={restoreInput.trim().length === 0}
                  className="min-h-[44px] rounded-full border border-hairline px-5 text-[15px] font-medium text-ink transition hover:bg-surface disabled:opacity-30"
                >
                  {t("restore.submit")}
                </button>
                <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full px-3 text-[13px] font-medium text-zinc-600 transition hover:text-ink">
                  {uploadedKey ? t("key.loaded", { count: uploadedKey.length }) : t("key.upload")}
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(event) => {
                      void onUploadKey(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              {pendingEnc && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={unlockPassphrase}
                    onChange={(event) => setUnlockPassphrase(event.target.value)}
                    placeholder={t("key.passphrase")}
                    className="min-w-[200px] flex-1 rounded-xl border border-hairline bg-surface px-3 py-2 text-[14px] outline-none placeholder:text-zinc-400"
                  />
                  <button
                    type="button"
                    onClick={onUnlockKey}
                    className="min-h-[40px] rounded-full bg-ink px-5 text-[14px] font-medium text-white transition hover:opacity-90"
                  >
                    {t("key.unlock")}
                  </button>
                </div>
              )}
              {keyError && (
                <p className="mt-2 text-xs text-amber-600">
                  {keyError === "wrong" ? t("key.wrongPassphrase") : t("key.invalid")}
                </p>
              )}

              <div className="mt-4 border-t border-hairline pt-4">
                <div className="text-[13px] font-medium text-ink">{t("restoreFile.title")}</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t("restoreFile.explain")}</p>
                <label className="mt-3 inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-full border border-hairline bg-white px-5 text-[14px] font-medium text-ink transition hover:bg-surface">
                  {t("restoreFile.upload")}
                  <input
                    type="file"
                    accept=".docx,.txt"
                    className="hidden"
                    onChange={(event) => {
                      void onRestoreFile(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {restoreFileError && (
                  <p className="mt-2 text-xs text-amber-600">
                    {restoreFileError === "nokey"
                      ? t("restoreFile.noKey")
                      : restoreFileError === "unsupported"
                        ? t("restoreFile.unsupported")
                        : t("restoreFile.generic")}
                  </p>
                )}
                {restoreUnmatched > 0 && (
                  <p className="mt-2 text-xs text-amber-600">
                    {t("restore.unmatched", { count: restoreUnmatched })}
                  </p>
                )}
              </div>

              {restoreResult && (
                <>
                  <div
                    dir="rtl"
                    className="mt-4 whitespace-pre-wrap break-words rounded-2xl border border-hairline bg-surface p-5 text-[17px] leading-loose"
                  >
                    {highlight(restoreResult.restoredText)}
                  </div>
                  {restoreResult.unmatched.length > 0 && (
                    <p className="mt-2 text-xs text-amber-600">
                      {t("restore.unmatched", { count: restoreResult.unmatched.length })}
                    </p>
                  )}
                </>
              )}
            </div>
          </details>
        </section>

        <section className="mt-24">
          <h2 className="text-center text-xs font-semibold uppercase tracking-[0.15em] text-zinc-400">
            {t("flow.heading")}
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-4">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-hairline bg-white p-5 transition hover:border-zinc-300"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-semibold tabular-nums text-white">
                  {index + 1}
                </div>
                <div className="mt-3 text-[15px] font-semibold leading-snug">{step.title}</div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">{step.desc}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16 rounded-3xl bg-surface px-6 py-10 sm:px-10">
          <h2 className="text-center text-lg font-semibold tracking-tight">{t("trust.heading")}</h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {trustItems.map((item) => (
              <div key={item.key} className="text-center sm:text-right">
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-sm sm:mx-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d={item.d}
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="mt-3 text-[15px] font-semibold">
                  {t(`trust.items.${item.key}.title`)}
                </div>
                <div className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">
                  {t(`trust.items.${item.key}.text`)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-24 max-w-2xl px-6 pb-16 text-center text-xs leading-relaxed text-zinc-400">
        <p className="text-zinc-500">{t("trust.tagline")}</p>
        <p className="mx-auto mt-3 max-w-xl">{t("legal.noCollection")}</p>
        <p className="mt-4">
          {t("legal.brand")}{" "}
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="text-ink underline decoration-zinc-300 underline-offset-4 transition hover:decoration-ink"
          >
            {t("legal.sourceLink")}
          </a>
        </p>
      </footer>
    </div>
  );
}
