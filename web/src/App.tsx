import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnonymizeResult } from "@engine/types";
import type { RestoreResult } from "@engine/restore";
import { getEngine } from "./worker/engineClient";

/** AGPL-3.0 §13: users interacting over a network must be offered the corresponding source. */
const SOURCE_URL = "https://github.com/yehieladam/anon-extension";
const COPIED_RESET_MS = 1500;

/**
 * Mechikon (P2W-02 + P2W-05) — paste OR upload a file → anonymize → restore, in an Apple-minimal
 * monochrome layout. All engine work (incl. docx/xlsx/pdf text extraction) runs in a Web Worker
 * (P0I-01); nothing leaves the browser. Deterministic detection for now; Hebrew-name NER lands
 * behind an explicit model-load step. Every string is via i18n.
 */
export function App() {
  const { t } = useTranslation();

  const [input, setInput] = useState("");
  const [status, setStatus] = useState<null | "working" | "reading">(null);
  const [result, setResult] = useState<AnonymizeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [restoreInput, setRestoreInput] = useState("");
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const busy = status !== null;

  const showResult = useCallback((anonymized: AnonymizeResult) => {
    setResult(anonymized);
    setRestoreInput(anonymized.anonymizedText);
    setRestoreResult(null);
  }, []);

  const onAnonymize = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || busy) {
      return;
    }
    setStatus("working");
    setFileError(false);
    try {
      showResult(await getEngine().anonymize(text));
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
      try {
        const buffer = await file.arrayBuffer();
        showResult(await getEngine().anonymizeFile(file.name, buffer));
      } catch {
        setFileError(true);
      } finally {
        setStatus(null);
      }
    },
    [busy, showResult],
  );

  const onCopy = useCallback(async () => {
    if (!result) {
      return;
    }
    await navigator.clipboard.writeText(result.anonymizedText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [result]);

  const onRestore = useCallback(async () => {
    const restored = await getEngine().restore(restoreInput, result?.key ?? []);
    setRestoreResult(restored);
  }, [restoreInput, result]);

  const statusLine =
    status === "reading"
      ? t("input.reading")
      : status === "working"
        ? t("input.working")
        : fileError
          ? t("input.fileError")
          : t("input.uploadHint");

  const steps = [
    t("flow.step1.title"),
    t("flow.step2.title"),
    t("flow.step3.title"),
    t("flow.step4.title"),
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-white text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-[17px] font-semibold tracking-tight">{t("app.name")}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-900" aria-hidden="true" />
          {t("trust.badge.zero")}
        </span>
      </header>

      <main className="mx-auto max-w-2xl px-6">
        <section className="pt-16 text-center sm:pt-24">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-zinc-500">
            {t("hero.subtitle")}
          </p>
        </section>

        <section className="mt-12">
          <div className="rounded-3xl border border-hairline bg-white p-2 shadow-card">
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
              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-hairline px-4 text-[14px] font-medium text-zinc-600 transition hover:bg-surface">
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
                className="min-h-[44px] rounded-full bg-ink px-6 text-[15px] font-medium text-white transition hover:opacity-90 disabled:opacity-30"
              >
                {t("input.submit")}
              </button>
            </div>
          </div>
          <p className={`mt-3 px-2 text-xs ${fileError ? "text-amber-600" : "text-zinc-400"}`}>
            {statusLine}
          </p>
        </section>

        {result && (
          <section className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-500">
                {result.key.length > 0
                  ? t("result.found", { count: result.key.length })
                  : t("result.none")}
              </span>
              {result.key.length > 0 && (
                <button
                  type="button"
                  onClick={onCopy}
                  className="min-h-[36px] rounded-full border border-hairline px-4 text-[13px] font-medium text-ink transition hover:bg-surface"
                >
                  {copied ? t("result.copied") : t("result.copy")}
                </button>
              )}
            </div>
            {result.key.length > 0 && (
              <>
                <div
                  dir="rtl"
                  className="whitespace-pre-wrap break-words rounded-2xl border border-hairline bg-surface p-5 text-[17px] leading-relaxed"
                >
                  {result.anonymizedText}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">{t("result.note")}</p>
              </>
            )}
          </section>
        )}

        <section className="mt-8">
          <details className="group rounded-2xl border border-hairline bg-white">
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
              <button
                type="button"
                onClick={onRestore}
                disabled={restoreInput.trim().length === 0}
                className="mt-3 min-h-[44px] rounded-full border border-hairline px-5 text-[15px] font-medium text-ink transition hover:bg-surface disabled:opacity-30"
              >
                {t("restore.submit")}
              </button>
              {restoreResult && (
                <>
                  <div
                    dir="rtl"
                    className="mt-4 whitespace-pre-wrap break-words rounded-2xl border border-hairline bg-surface p-5 text-[17px] leading-relaxed"
                  >
                    {restoreResult.restoredText}
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

        <section className="mt-20 border-t border-hairline pt-10">
          <ol className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
            {steps.map((title, index) => (
              <li key={title}>
                <div className="text-xs tabular-nums text-zinc-300">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="mt-1.5 text-[15px] font-medium leading-snug">{title}</div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16 grid gap-6 sm:grid-cols-3">
          {[t("trust.strip.noSignup"), t("trust.strip.offline"), t("trust.strip.openSource")].map(
            (claim) => (
              <p key={claim} className="text-[13px] leading-relaxed text-zinc-500">
                {claim}
              </p>
            ),
          )}
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
