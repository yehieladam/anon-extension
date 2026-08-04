/**
 * Core engine types — framework-free (no DOM, no React, no extension APIs).
 * Entity names mirror the server pipeline (pii-anonymizer-spike/src/analyze.py) exactly,
 * so recall comparisons and the key format stay 1:1 with the proven Python tool.
 */

/** Neural (NER) entity types — detected by dictabert-ner, never authoritative for numbers. */
export type NerEntityType = "PERSON" | "ORGANIZATION" | "LOCATION";

/** Deterministic entity types — regex + checksum ONLY, never the NER model (hard rule 1). */
export type DeterministicEntityType =
  | "ISRAELI_ID" // teudat zehut, Luhn checksum
  | "IL_COMPANY" // ח"פ company number
  | "IL_PHONE"
  | "IL_IBAN"
  | "IL_CASE" // court/case file number (תיק)
  | "IL_LAND" // gush/chelka (גוש/חלקה)
  | "IL_POLICY" // insurance policy number
  | "IL_INSURED" // insured-person number (מבוטח)
  | "EMAIL_ADDRESS";

/** User-added terms to redact (things the automatic detectors missed). Highest priority — an
 * explicit human choice always wins. */
export type ManualEntityType = "MANUAL";

export type EntityType = NerEntityType | DeterministicEntityType | ManualEntityType;

/**
 * Overlap-resolution priority (port of the server's analyze.py PRIORITY map).
 * Deterministic entities outrank NER; higher wins. resolve.ts (P1-12) greedily keeps
 * the strongest span by (priority, score, length).
 */
export const PRIORITY: Readonly<Record<EntityType, number>> = {
  MANUAL: 4, // explicit user choice wins over every automatic detection
  ISRAELI_ID: 3,
  IL_COMPANY: 3,
  IL_IBAN: 3,
  IL_PHONE: 3,
  IL_CASE: 3,
  IL_LAND: 3,
  IL_POLICY: 3,
  IL_INSURED: 3,
  EMAIL_ADDRESS: 3,
  PERSON: 2,
  ORGANIZATION: 1,
  LOCATION: 1,
};

/** A detected PII span in the analyzed text. `end` is exclusive; offsets are UTF-16 code units. */
export interface Span {
  readonly start: number;
  readonly end: number;
  readonly type: EntityType;
  /** 0..1 confidence. Checksum-validated deterministic matches report 1. */
  readonly score: number;
}

/**
 * A detection source. Deterministic recognizers implement this synchronously;
 * the NER wrapper (P1-11) will expose the same shape behind an async facade.
 */
export interface Recognizer {
  readonly name: string;
  readonly entity: EntityType;
  /** Return every match in `text` as spans. Pure: no state, no side effects. */
  recognize(text: string): readonly Span[];
}

/** One row of the reversible key (CSV) — same value maps to the same placeholder per document. */
export interface KeyRow {
  readonly placeholder: string; // e.g. [ת"ז_1]
  readonly original: string; // the surface value that was replaced
  readonly type: EntityType;
}

/** Result of anonymizing a text: the rewritten text plus everything needed to restore it. */
export interface AnonymizeResult {
  readonly anonymizedText: string;
  /** The resolved, non-overlapping spans (reading order) the placeholders replaced. */
  readonly spans: readonly Span[];
  /** Reversible mapping rows, restore-compatible (restore IS in the MVP — docs/tasks.md P1-15). */
  readonly key: readonly KeyRow[];
}
