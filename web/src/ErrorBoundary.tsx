import { Component, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * App-wide error boundary. Hard rule 2: NO remote error monitoring (no Sentry) — a crash must never
 * phone home. Instead we surface the error locally and offer an OPT-IN "copy error report" the user
 * chooses to share; nothing is ever sent automatically. Catches render/lifecycle errors; async and
 * worker errors are handled where they occur (see App).
 */
interface ErrorBoundaryState {
  readonly error: Error | null;
}

/** Build the shareable report text (opt-in copy only — never transmitted). */
function reportText(error: Error): string {
  return [
    `Mechikon error report`,
    `time: ${new Date().toISOString()}`,
    `ua: ${navigator.userAgent}`,
    `message: ${error.message}`,
    `stack:\n${error.stack ?? "(no stack)"}`,
  ].join("\n");
}

function ErrorFallback({ error }: { error: Error }): ReactNode {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(error));
      setCopied(true);
    } catch {
      // Clipboard denied — the user can still reload; nothing to escalate, and nothing is sent.
    }
  };

  return (
    <div dir="rtl" lang="he" className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-lg font-semibold text-ink">{t("error.title")}</h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t("error.body")}</p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[44px] rounded-full bg-ink px-5 text-[14px] font-medium text-white transition hover:opacity-90"
        >
          {t("error.reload")}
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="min-h-[44px] rounded-full border border-hairline px-5 text-[14px] font-medium text-ink transition hover:bg-surface"
        >
          {copied ? t("error.copied") : t("error.copy")}
        </button>
      </div>
      <p className="mt-4 text-xs text-zinc-400">{t("error.noSend")}</p>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
