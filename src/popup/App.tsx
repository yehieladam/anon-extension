import { useState } from "react";
import { runNer, type NerRun } from "./nerParity";

// P2-01 scaffold: a React port of the frozen extension/ spike, kept intentionally close to
// it so the two can be diffed span-for-span (the task's Definition of Done). The element
// ids below are the spike's, so the S-01 verification harness drives this build unchanged.
//
// P2-02 replaces this with the real flow (detect -> highlight -> anonymized copy -> key
// download) and P2-03 applies the Organic design tokens. Strings stay untranslated until
// then: the translation layer arrives with the real UI, not with this parity shell.

const SAMPLE_TEXT = [
  "ביום שלישי נפגש דוד לוי עם נציגי בנק הפועלים בתל אביב.",
  "רונית כהן, מנכ\"לית חברת טבע, הודיעה על מינוי חדש בסניף ירושלים.",
  "עורכת הדין יעל שפירא ייצגה את חברת אלביט מערכות בבית המשפט המחוזי בחיפה.",
  "משה בן דוד עובד במשרד האוצר מאז שנת 2019.",
  "אבי מזרחי טס מנתב\"ג לניו יורק לפגישה עם נציגי גוגל.",
].join("\n");

const MB = 1e6;

export function App() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [status, setStatus] = useState("Idle.");
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [run, setRun] = useState<NerRun | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRun() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setStatus("Loading model…");
    try {
      const result = await runNer(trimmed, ({ loadedBytes, totalBytes }) => {
        setProgressPct(Math.min(100, (loadedBytes / totalBytes) * 100));
        setStatus(
          `Downloading model (one-time)… ${(loadedBytes / MB).toFixed(0)} / ` +
            `${(totalBytes / MB).toFixed(0)} MB — keep this page open`,
        );
      });
      setProgressPct(null);
      setRun(result);
      setStatus(`Done (${result.backend}).`);
    } catch (error) {
      // Surfaced in the UI rather than the console — CLAUDE.md: never swallow silently.
      setProgressPct(null);
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-[200px] w-[560px] bg-[#F7F4EF] p-6 text-[#2C1608]">
      {/* The page is RTL for the Hebrew content, but this build's chrome is still English:
          mark those runs LTR so punctuation does not jump to the wrong side. P2-03 replaces
          all of it with Hebrew via the translation layer. */}
      <h1 dir="ltr" className="text-lg font-bold">
        Anon — Hebrew NER (P2-01 parity build)
      </h1>
      <p dir="ltr" className="mt-1 text-xs opacity-70">
        dictabert-ner (ONNX q8) via transformers.js, fully client-side. First run downloads
        ~185 MB once.
      </p>

      <textarea
        id="input"
        dir="rtl"
        lang="he"
        spellCheck={false}
        className="mt-3 min-h-[120px] w-full rounded-md border border-[#2C1608]/20 p-2 text-sm"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Hebrew text to analyze"
      />

      <button
        id="run-btn"
        type="button"
        disabled={busy}
        onClick={() => void handleRun()}
        className="mt-2 rounded-full bg-[#2C1608] px-6 py-2 text-sm text-[#F7F4EF] disabled:opacity-50"
      >
        Anonymize (detect entities)
      </button>

      <p id="status" dir="ltr" className="mt-3 text-sm">
        {status}
      </p>

      {progressPct !== null && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#2C1608]/10">
          <div className="h-full bg-[#C86B3C]" style={{ width: `${progressPct.toFixed(1)}%` }} />
        </div>
      )}

      {run && (
        <>
          <p id="meta" dir="ltr" className="mt-3 flex items-center gap-2 text-xs">
            <span
              id="backend-badge"
              className="rounded-full bg-[#F0DFA0] px-2 py-0.5 font-bold uppercase"
            >
              {run.backend}
            </span>
            <span id="timing">
              Model load: {run.loadMs} ms (one-time) · Inference: {run.inferMs} ms ·{" "}
              {run.spans.length} spans
            </span>
          </p>

          <div id="results" className="mt-2">
            {run.spans.length === 0 ? (
              <p className="empty text-sm">No entities detected.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#2C1608]/5">
                    <th className="p-1 text-start">entity_group</th>
                    <th className="p-1 text-start">word</th>
                    <th className="p-1 text-end">score</th>
                  </tr>
                </thead>
                <tbody>
                  {run.spans.map((span, index) => (
                    <tr key={`${span.entityGroup}-${span.word}-${index}`}>
                      <td className="p-1">
                        <span className="rounded-full bg-[#F0DFA0] px-2 py-0.5 text-xs">
                          {span.entityGroup}
                        </span>
                      </td>
                      <td className="p-1">{span.word}</td>
                      <td className="p-1 text-end">{span.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </main>
  );
}
