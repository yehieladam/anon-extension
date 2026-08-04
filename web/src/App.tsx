import { useTranslation } from "react-i18next";

/**
 * Mechikon shell (P2W-01) — professional/legal identity, RTL, all strings via i18n. This is the
 * layout + trust framing only; the paste→detect→anonymize→restore flow and the live network badge
 * are wired in P2W-02+/P2W-04 (the engine runs in a Web Worker — P0I-01). No hardcoded strings.
 */
export function App() {
  const { t } = useTranslation();

  const steps = [
    t("flow.step1.title"),
    t("flow.step2.title"),
    t("flow.step3.title"),
    t("flow.step4.title"),
  ];

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
          <h1 className="text-2xl font-bold leading-snug text-navy sm:text-3xl">
            {t("hero.title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
            {t("hero.subtitle")}
          </p>
        </section>

        <ol className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {steps.map((title, index) => (
            <li
              key={title}
              className="rounded-xl border border-slate-200 bg-white p-3 text-center"
            >
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
            className="min-h-[160px] w-full rounded-xl border border-slate-300 bg-white p-4 text-base leading-relaxed outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
            placeholder={t("input.paste.placeholder")}
          />
          <button
            type="button"
            className="mt-3 min-h-[44px] w-full rounded-full bg-navy px-6 font-semibold text-white transition hover:bg-navy/90 disabled:opacity-50 sm:w-auto"
          >
            {t("input.submit")}
          </button>
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
      </footer>
    </div>
  );
}
