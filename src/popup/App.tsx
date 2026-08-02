import { useState } from "react";
import { isValidIsraeliId } from "@engine/index";

// TODO(P2): this placeholder popup becomes the real paste/upload flow
// (detect -> highlight -> anonymized copy -> key download) per docs/tasks.md P2-01..P2-05.
// For now it only proves the build wiring: React renders and @engine/* imports resolve.
// The genuine Luhn validator below is REAL engine code, not a mock (CLAUDE.md hard rule 1).
export function App() {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const verdict = trimmed.length === 0 ? null : isValidIsraeliId(trimmed) ? "valid" : "invalid";

  return (
    <main dir="rtl" className="min-h-[200px] w-[360px] bg-[#F7F4EF] p-6 text-[#2C1608]">
      <h1 className="text-lg font-bold">Anon - scaffold build</h1>
      <p className="mt-2 text-sm">
        זהו שלד ה-build החדש (P2 יחליף אותו בזרימה המלאה). בדיקת חיווט מנוע: הקלד ת&quot;ז לבדיקת
        סכום ביקורת אמיתית.
      </p>
      <input
        dir="ltr"
        className="mt-3 w-full rounded-md border border-[#2C1608]/20 p-2 text-sm"
        placeholder="123456709"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Israeli ID checksum check"
      />
      {verdict !== null && (
        <p className="mt-2 text-sm">
          {verdict === "valid" ? "תקין (סכום ביקורת עובר)" : "לא תקין"}
        </p>
      )}
    </main>
  );
}
