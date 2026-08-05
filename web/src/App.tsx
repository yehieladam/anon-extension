import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AnonymizeResult, EntityType, KeyRow } from "@engine/types";
import type { RestoreResult } from "@engine/restore";
import { toKeyFile, fromKeyFile } from "@engine/key";
import {
  encryptKeyRows,
  decryptKeyRows,
  isEncryptedKeyFile,
  type EncryptedKeyFile,
} from "@engine/keyCrypto";
import { getEngine } from "./worker/engineClient";
import { useNetworkCount } from "./lib/useNetworkCount";
import { loadNer, useNer } from "./worker/nerController";

/** What produced the current result — so we can re-run it with NER once the model is ready. */
type Source =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "file"; readonly name: string; readonly buffer: ArrayBuffer };

/** AGPL-3.0 §13: users interacting over a network must be offered the corresponding source. */
const SOURCE_URL = "https://github.com/yehieladam/anon-extension";
const COPIED_RESET_MS = 1500;

/** MIME per extension for the redacted-file download. */
const MIME_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  txt: "text/plain;charset=utf-8",
  csv: "text/csv;charset=utf-8",
};

/** Insert the "redacted" suffix before the extension: report.docx → report_מושחר.docx */
function redactedName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot === -1 ? fileName : fileName.slice(0, dot);
  const ext = dot === -1 ? "" : fileName.slice(dot);
  return `${base}_מושחר${ext}`;
}

function mimeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
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

export function App() {
  const { t } = useTranslation();
  const networkCount = useNetworkCount();
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
  const [redacted, setRedacted] = useState<{ bytes: Uint8Array; name: string; mime: string } | null>(
    null,
  );
  const [restoreInput, setRestoreInput] = useState("");
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  // Manual redaction — user-added terms the automatic detectors missed.
  const [manualTerms, setManualTerms] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
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
      // Instant deterministic (or full, if the model is already loaded), then load NER for names.
      showResult(await getEngine().anonymizeSmart(text, []));
      void loadNer();
    } finally {
      setStatus(null);
    }
  }, [input, busy, showResult]);

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
      setManualTerms([]);
      try {
        const buffer = await file.arrayBuffer();
        setSource({ kind: "file", name: file.name, buffer });
        const { result: anonymized, bytes } = await getEngine().redactFile(file.name, buffer, []);
        showResult(anonymized);
        if (bytes) {
          setRedacted({ bytes, name: redactedName(file.name), mime: mimeFor(file.name) });
        }
        void loadNer();
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
        } else if (error instanceof Error && error.message.includes("OFFICE_SELFVERIFY_FAILED")) {
          // A detected value still survived somewhere in the file — refuse rather than hand back a leak.
          setSource(null);
          setSelfVerifyNotice(true);
        } else {
          setFileError(true);
        }
      } finally {
        setStatus(null);
      }
    },
    [busy, showResult],
  );

  // When the model finishes loading, re-run whatever is on screen so names get redacted too.
  const previousNerStatus = useRef(ner.status);
  useEffect(() => {
    const wasReady = previousNerStatus.current === "ready";
    previousNerStatus.current = ner.status;
    if (ner.status !== "ready" || wasReady || source === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
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
        // The NER-pass redaction failed (e.g. the PDF self-verify refused a leaky result). Never leave
        // the earlier deterministic-only download in place — that would hand back a file the user
        // believes is fully redacted but whose names are not removed. Surface the error and pull it.
        if (!cancelled) {
          setFileError(true);
          setRedacted(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ner.status, source, showResult, manualTerms]);

  // Re-run the current source with a new set of manual terms (add/remove a hand-picked redaction).
  const reprocessManual = useCallback(
    async (terms: string[]) => {
      if (!source) {
        return;
      }
      setStatus(source.kind === "file" ? "reading" : "working");
      setFileError(false);
      try {
        if (source.kind === "text") {
          showResult(await getEngine().anonymizeSmart(source.text, terms));
        } else {
          const { result, bytes } = await getEngine().redactFile(source.name, source.buffer, terms);
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
    [source, showResult],
  );

  const onAddManual = useCallback(() => {
    const term = manualInput.trim();
    if (term.length === 0 || manualTerms.includes(term)) {
      setManualInput("");
      return;
    }
    const terms = [...manualTerms, term];
    setManualTerms(terms);
    setManualInput("");
    void reprocessManual(terms);
  }, [manualInput, manualTerms, reprocessManual]);

  const onRemoveManual = useCallback(
    (term: string) => {
      const terms = manualTerms.filter((t) => t !== term);
      setManualTerms(terms);
      void reprocessManual(terms);
    },
    [manualTerms, reprocessManual],
  );

  const onDownload = useCallback(() => {
    if (!redacted) {
      return;
    }
    // reason: Comlink returns a Uint8Array<ArrayBufferLike>, which TS 5.7 will not narrow to the
    // ArrayBuffer-backed view BlobPart wants; the bytes are a plain copy, so the cast is safe.
    const blob = new Blob([redacted.bytes as BlobPart], { type: redacted.mime });
    downloadBlob(blob, redacted.name);
  }, [redacted]);

  // A redacted PDF is a visual redaction with no tokens — offer a "Word for AI" export whose tokens an
  // LLM can work with and that restores through the docx path. Only meaningful for a PDF source (docx
  // and pasted text already carry tokens the user can use directly).
  const onDownloadTokenDocx = useCallback(async () => {
    if (!result || result.key.length === 0 || source?.kind !== "file") {
      return;
    }
    const bytes = await getEngine().buildTokenDocx(result.anonymizedText);
    const base = source.name.replace(/\.[^.]+$/, "");
    const blob = new Blob([bytes as BlobPart], { type: MIME_BY_EXT.docx });
    downloadBlob(blob, `${base}_לAI.docx`);
  }, [result, source]);

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
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400" aria-live="polite">
          <span
            className={`h-1.5 w-1.5 rounded-full ${networkCount === 0 ? "bg-emerald-500" : "bg-amber-500"}`}
            aria-hidden="true"
          />
          {t("trust.badge.count", { count: networkCount })}
          {ner.modelRequests > 0 && (
            <span className="text-zinc-300">· {t("trust.badge.model", { count: ner.modelRequests })}</span>
          )}
        </span>
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
          <p className={`mt-3 px-2 text-xs ${fileError ? "text-amber-600" : "text-zinc-400"}`}>
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
          {ner.status === "loading" && (
            <div className="mt-3 rounded-2xl border border-hairline bg-surface px-4 py-3" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-600">
                <span>{t("ner.loading")}</span>
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
                  // While the model is still loading for an uploaded file, the redacted file only has
                  // the deterministic PII removed — names are not in it yet. Block the download until
                  // NER has settled so nobody saves a half-redacted document (trust: no second chance).
                  (source?.kind === "file" && ner.status === "loading" ? (
                    <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-hairline px-4 text-[13px] font-medium text-zinc-400">
                      {t("result.downloadPending")}
                    </span>
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
                {redacted &&
                  source?.kind === "file" &&
                  source.name.toLowerCase().endsWith(".pdf") &&
                  ner.status !== "loading" && (
                    <button
                      type="button"
                      onClick={onDownloadTokenDocx}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-hairline px-4 text-[13px] font-medium text-ink transition hover:bg-surface"
                    >
                      {t("result.downloadTokenDocx")}
                    </button>
                  )}
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
                    <button
                      type="button"
                      onClick={onAddManual}
                      disabled={manualInput.trim().length === 0}
                      className="min-h-[40px] rounded-full bg-ink px-4 text-[14px] font-medium text-white transition hover:opacity-90 disabled:opacity-30"
                    >
                      {t("manual.submit")}
                    </button>
                  </div>
                )}
                {manualTerms.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {manualTerms.map((term) => (
                      <span
                        key={term}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs text-ink"
                      >
                        {term}
                        <button
                          type="button"
                          onClick={() => onRemoveManual(term)}
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

            {result.key.length > 0 && (
              <>
                <div
                  dir="rtl"
                  className="whitespace-pre-wrap break-words rounded-2xl border border-hairline bg-surface p-5 text-[17px] leading-loose"
                >
                  {highlight(result.anonymizedText)}
                </div>
                <p className="mt-3 rounded-xl bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-zinc-600">
                  {ner.status === "ready" ? t("result.noteNames") : t("result.note")}
                </p>

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
              </>
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
