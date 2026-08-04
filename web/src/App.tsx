import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnonymizeResult } from "@engine/types";
import type { RestoreResult } from "@engine/restore";
import { getEngine } from "./worker/engineClient";

/** AGPL-3.0 §13: users interacting over a network must be offered the corresponding source. */
const SOURCE_URL = "https://github.com/yehieladam/anon-extension";
const COPIED_RESET_MS = 1500;

/**
 * Mechikon (P2W-02 + P2W-05) — the paste→anonymize→restore flow in an Apple-minimal, monochrome
 * layout: lots of whitespace, one clear action, near-black ink on white. All engine work runs in a
 * Web Worker (P0I-01); nothing leaves the browser. Deterministic detection for now (ID/phone/…);
 * Hebrew-name NER lands behind an explicit model-load step. Every string is via i18n.
 */
export function App() {
  const { t } = useTranslation();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnonymizeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [restoreInput, setRestoreInput] = useState("");
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const onAnonymize = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || busy) {
      return;
    }
    setBusy(true);
    try {
      const anonymized = await getEngine().anonymize(text);
      setResult(anonymized);
      setRestoreInput(anonymized.anonymizedText);
      setRestoreResult(null);
    } finally {
      setBusy(false);
    }
  }, [input, busy]);

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

  const steps = [
    t("flow.step1.title"),
    t("flow.step2.title"),
    t("flow.step3.title"),
    t("flow.step4.title"),
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-white text-ink">
      {/* Top bar */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-[17px] font-semibold tracking-tight">{t("app.name")}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-900" aria-hidden="true" />
          {t("trust.badge.zero")}
        </span>
      </header>

      <main className="mx-auto max-w-2xl px-6">
        {/* Hero */}
        <section className="pt-16 text-center sm:pt-24">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-zinc-500">
            {t("hero.subtitle")}
          </p>
        </section>

        {/* Input */}
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
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-xs text-zinc-400">{busy ? t("input.working") : " "}</span>
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
        </section>

        {/* Result */}
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

        {/* Restore */}
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

        {/* How it works */}
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

        {/* Trust */}
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

      {/* Footer */}
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
