/**
 * Public engine API surface. Framework-free — reused unchanged by the extension popup
 * and the future web app. Import via the `@engine/*` path alias.
 *
 * Build-out is tracked in docs/tasks.md (P1). Nothing here is stubbed or faked:
 * only genuinely implemented pieces are exported (CLAUDE.md hard rule 1).
 */

export type {
  AnonymizeResult,
  DeterministicEntityType,
  EntityType,
  KeyRow,
  NerEntityType,
  Recognizer,
  Span,
} from "./types";
export { PRIORITY } from "./types";

export { isValidIsraeliId, israeliIdRecognizer } from "./recognizers/israeliId";
export { isValidIsraeliPhone, israeliPhoneRecognizer } from "./recognizers/israeliPhone";

// TODO(P1-04): export israeliCompanyRecognizer from "./recognizers/israeliCompany"
// TODO(P1-05): export israeliIbanRecognizer from "./recognizers/israeliIban"
// TODO(P1-06): export israeliCaseRecognizer from "./recognizers/israeliCase"
// TODO(P1-07): export israeliLandRecognizer from "./recognizers/israeliLand"
// TODO(P1-08): export israeliPolicyRecognizer from "./recognizers/israeliPolicy"
// TODO(P1-09): export israeliInsuredRecognizer from "./recognizers/israeliInsured"
// TODO(P1-10): export emailRecognizer from "./recognizers/email"
// TODO(P1-11): export the NER wrapper from "./ner" (tokenizer /u shim + offset/## fixes —
//              see browser-poc/PHASE0_FINDINGS.md; mandatory, not optional)
// TODO(P1-12): export resolveOverlaps from "./resolve" (uses PRIORITY above)
// TODO(P1-13): export anonymize from "./anonymize"
// TODO(P1-14): export key CSV serialization from "./key"
// TODO(P1-15): export restore from "./restore" (restore IS in the MVP — docs/tasks.md)
