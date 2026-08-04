/**
 * NER RECALL HARNESS — the real accuracy gate for the neural detector.
 *
 * Loads the LIVE dictabert-ner model (q8, ~185 MB, fetched once from HuggingFace and cached) and
 * runs the whole Hebrew testset (browser-poc/ner_testset.json) through createHebrewNer, then measures
 * recall + precision against the gold spans, overall and per entity type. This is the number that
 * tells us how good detection actually is on the ported TypeScript engine — Phase 0 only measured the
 * Python baseline (browser-poc/PHASE0_FINDINGS.md).
 *
 * It is GATED behind RUN_RECALL so CI never pulls the 185 MB model. Run locally on Windows:
 *
 *   $env:RUN_RECALL=1; npx vitest run engine/src/ner.recall.test.ts
 *
 * Match rule (redaction-oriented): a gold entity counts as recalled when a detected span of the same
 * type COVERS it — detected surface contains the gold surface, or vice versa, after normalizing away
 * gershayim/quotes and collapsing whitespace. Containment absorbs the leading Hebrew prepositions the
 * model keeps on the surface (ל/ב/מ/ה/ו/כ/ש), e.g. detected "בירושלים" covers gold "ירושלים": what
 * matters for a redactor is that the gold text ends up inside a redacted span.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createHebrewNer, type HebrewNer } from "./ner";
import type { NerEntityType, Span } from "./types";

interface GoldEntity {
  readonly text: string;
  readonly type: "PERSON" | "ORGANIZATION" | "LOCATION";
}
interface TestSample {
  readonly text: string;
  readonly gold: readonly GoldEntity[];
}

const NER_TYPES: readonly NerEntityType[] = ["PERSON", "ORGANIZATION", "LOCATION"];
/** Overall recall floor — Phase-0 target on the Python baseline was ~88.89%. */
const RECALL_FLOOR = 0.85;

const TESTSET_PATH = fileURLToPath(
  new URL("../../browser-poc/ner_testset.json", import.meta.url),
);

/** Normalize for containment: drop gershayim/quotes, collapse whitespace. */
function normalize(value: string): string {
  return value
    .replace(/["'׳״‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a detected surface covers a gold surface (either contains the other). */
function covers(detectedSurface: string, goldSurface: string): boolean {
  const detected = normalize(detectedSurface);
  const gold = normalize(goldSurface);
  if (gold.length === 0) {
    return false;
  }
  return detected.includes(gold) || gold.includes(detected);
}

interface Tally {
  goldTotal: number;
  goldMatched: number;
  detectedTotal: number;
  detectedMatched: number;
}
function emptyTally(): Tally {
  return { goldTotal: 0, goldMatched: 0, detectedTotal: 0, detectedMatched: 0 };
}
function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "n/a" : `${((100 * numerator) / denominator).toFixed(1)}%`;
}

const describeRecall = process.env.RUN_RECALL ? describe : describe.skip;

describeRecall("NER recall on the live model", () => {
  const samples = JSON.parse(readFileSync(TESTSET_PATH, "utf-8")) as TestSample[];
  const overall = emptyTally();
  const byType = new Map<NerEntityType, Tally>(NER_TYPES.map((type) => [type, emptyTally()]));
  let ner: HebrewNer;

  beforeAll(async () => {
    ner = await createHebrewNer();
    for (const sample of samples) {
      const detected = await ner.recognize(sample.text);
      scoreSample(sample, detected, overall, byType);
    }
    printReport(samples.length, overall, byType);
  }, 600_000); // first run downloads ~185 MB then runs inference on 21 sentences

  it(`recalls at least ${(RECALL_FLOOR * 100).toFixed(0)}% of gold entities`, () => {
    expect(overall.goldTotal).toBeGreaterThan(0);
    expect(overall.goldMatched / overall.goldTotal).toBeGreaterThanOrEqual(RECALL_FLOOR);
  });

  it("does not flood with spurious detections (precision > 60%)", () => {
    expect(overall.detectedMatched / overall.detectedTotal).toBeGreaterThan(0.6);
  });
});

/** Update the overall + per-type tallies for one sample. */
function scoreSample(
  sample: TestSample,
  detected: readonly Span[],
  overall: Tally,
  byType: Map<NerEntityType, Tally>,
): void {
  const detectedWithText = detected.map((span) => ({
    type: span.type as NerEntityType,
    surface: sample.text.slice(span.start, span.end),
  }));

  for (const gold of sample.gold) {
    overall.goldTotal += 1;
    byType.get(gold.type)!.goldTotal += 1;
    const hit = detectedWithText.some((d) => d.type === gold.type && covers(d.surface, gold.text));
    if (hit) {
      overall.goldMatched += 1;
      byType.get(gold.type)!.goldMatched += 1;
    }
  }

  for (const d of detectedWithText) {
    if (!NER_TYPES.includes(d.type)) {
      continue;
    }
    overall.detectedTotal += 1;
    byType.get(d.type)!.detectedTotal += 1;
    const matchesGold = sample.gold.some((g) => g.type === d.type && covers(d.surface, g.text));
    if (matchesGold) {
      overall.detectedMatched += 1;
      byType.get(d.type)!.detectedMatched += 1;
    }
  }
}

/** Print a human-readable recall/precision table (this harness exists to produce the number). */
function printReport(sampleCount: number, overall: Tally, byType: Map<NerEntityType, Tally>): void {
  const lines = [
    "",
    `NER recall harness — ${sampleCount} sentences, live dictabert-ner q8`,
    "type          recall            precision",
    "------------  ----------------  ----------------",
  ];
  for (const type of NER_TYPES) {
    const t = byType.get(type)!;
    lines.push(
      `${type.padEnd(12)}  ${`${pct(t.goldMatched, t.goldTotal)} (${t.goldMatched}/${t.goldTotal})`.padEnd(16)}  ${pct(t.detectedMatched, t.detectedTotal)} (${t.detectedMatched}/${t.detectedTotal})`,
    );
  }
  lines.push(
    `${"OVERALL".padEnd(12)}  ${`${pct(overall.goldMatched, overall.goldTotal)} (${overall.goldMatched}/${overall.goldTotal})`.padEnd(16)}  ${pct(overall.detectedMatched, overall.detectedTotal)} (${overall.detectedMatched}/${overall.detectedTotal})`,
  );
  // eslint-disable-next-line no-console -- harness output IS the deliverable; not shipped code
  console.log(lines.join("\n"));
}
