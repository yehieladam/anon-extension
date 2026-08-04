import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnonymizeResult } from "@engine/types";
import type { RestoreResult } from "@engine/restore";
import { getEngine } from "./worker/engineClient";

/** AGPL-3.0 §13: users interacting over a network must be offered the corresponding source. */
const SOURCE_URL = "https://github.com/yehieladam/anon-extension";
const COPIED_RESET_MS = 1500;

/**
 * Mechikon (P2W-02) — the working paste→detect→anonymize→restore flow. All engine work runs in a
 * Web Worker (P0I-01) so the UI never blocks; nothing leaves the browser. Deterministic detection
 * only for now (ID/phone/IBAN/email/…); Hebrew-name NER lands behind an explicit model-load step.
 * All strings via i18n; the "0 בקשות רשת" badge is still a placeholder until P2W-04 makes it real.
 */
export function App() {
  const { t } = useTranslation();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnonymizeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [restoreInput, setRestoreInput] = useState("");
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const steps = [
    t("flow.step1.title"),
    t("flow.step2.title"),
    t("flow.step3.title"),
    t("flow.step4.title"),
  ];

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

  return (
    <div dir="rtl" className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-navy">{t("app.name")}</span>
          <span className="hidden text-xs text-slate-500 sm:inline">{t("app.byline")}</span>
        </div>
        {/* Static placeholder — real observed state lands in P2W-04 (must never lie). */}
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          {t("trust.badge.zero")}
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <section className="text-center">
          <h1 className="text-2xl font-bold leading-snug text-navy sm:text-3xl">{t("hero.title")}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
            {t("hero.subtitle")}
          </p>
        </section>

        <ol className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {steps.map((title, index) => (
            <li key={title} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <span className="block text-sm font-bold text-gold">{index + 1}</span>
              <span className="mt-1 block text-sm font-medium text-slate-700">{title}</span>
            </li>
          ))}
        </ol>

        <section className="mt-8">
          <textarea
            dir="rtl"
            lang="he"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-[160px] w-full rounded-xl border border-slate-300 bg-white p-4 text-base leading-relaxed outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
            placeholder={t("input.paste.placeholder")}
          />
          <button
            type="button"
            onClick={onAnonymize}
            disabled={busy || input.trim().length === 0}
            className="mt-3 min-h-[44px] w-full rounded-full bg-navy px-6 font-semibold text-white transition hover:bg-navy/90 disabled:opacity-50 sm:w-auto"
          >
            {busy ? t("input.working") : t("input.submit")}
          </button>
        </section>

        {result && (
          <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-700">
              {result.key.length > 0
                ? t("result.found", { count: result.key.length })
                : t("result.none")}
            </p>
            {result.key.length > 0 && (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-500">
                  {t("result.anonymizedLabel")}
                </label>
                <div
                  dir="rtl"
                  className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-base leading-relaxed"
                >
                  {result.anonymizedText}
                </div>
                <button
                  type="button"
                  onClick={onCopy}
                  className="mt-3 min-h-[44px] rounded-full border border-navy px-5 text-sm font-semibold text-navy transition hover:bg-navy/5"
                >
                  {copied ? t("result.copied") : t("result.copy")}
                </button>
                <p className="mt-3 text-xs text-slate-500">{t("result.note")}</p>
              </>
            )}
          </section>
        )}

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700">{t("restore.title")}</h2>
          <textarea
            dir="rtl"
            lang="he"
            spellCheck={false}
            value={restoreInput}
            onChange={(event) => setRestoreInput(event.target.value)}
            className="mt-3 min-h-[120px] w-full rounded-xl border border-slate-300 bg-white p-4 text-base leading-relaxed outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
            placeholder={t("restore.placeholder")}
          />
          <button
            type="button"
            onClick={onRestore}
            disabled={restoreInput.trim().length === 0}
            className="mt-3 min-h-[44px] rounded-full border border-navy px-5 text-sm font-semibold text-navy transition hover:bg-navy/5 disabled:opacity-50"
          >
            {t("restore.submit")}
          </button>
          {restoreResult && (
            <>
              <label className="mt-4 block text-xs font-medium text-slate-500">
                {t("restore.restoredLabel")}
              </label>
              <div
                dir="rtl"
                className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-base leading-relaxed"
              >
                {restoreResult.restoredText}
              </div>
              {restoreResult.unmatched.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  {t("restore.unmatched", { count: restoreResult.unmatched.length })}
                </p>
              )}
            </>
          )}
        </section>

        <section className="mt-10 grid gap-3 sm:grid-cols-3">
          {[t("trust.strip.noSignup"), t("trust.strip.offline"), t("trust.strip.openSource")].map(
            (claim) => (
              <p
                key={claim}
                className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"
              >
                {claim}
              </p>
            ),
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 px-6 py-6 text-center text-xs leading-relaxed text-slate-500">
        <p className="font-medium text-slate-600">{t("trust.tagline")}</p>
        <p className="mx-auto mt-2 max-w-2xl">{t("legal.noCollection")}</p>
        <p className="mx-auto mt-2 max-w-2xl">{t("legal.notAdvice")}</p>
        <p className="mt-2">{t("legal.brand")}</p>
        <p className="mt-2">
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-navy underline underline-offset-2"
          >
            {t("legal.sourceLink")}
          </a>
        </p>
      </footer>
    </div>
  );
}
