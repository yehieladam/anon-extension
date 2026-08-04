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
export { isValidIsraeliCompany, israeliCompanyRecognizer } from "./recognizers/israeliCompany";
export { isValidIsraeliIban, israeliIbanRecognizer } from "./recognizers/israeliIban";
export { israeliCaseRecognizer } from "./recognizers/israeliCase";
export { israeliLandRecognizer } from "./recognizers/israeliLand";
export { israeliPolicyRecognizer } from "./recognizers/israeliPolicy";
export { israeliInsuredRecognizer } from "./recognizers/israeliInsured";
export { emailRecognizer } from "./recognizers/email";
export { resolveOverlaps } from "./resolve";
// TODO(P1-11): export the NER wrapper from "./ner" (tokenizer /u shim + offset/## fixes —
//              see browser-poc/PHASE0_FINDINGS.md; mandatory, not optional)
// TODO(P1-13): export anonymize from "./anonymize"
// TODO(P1-14): export key CSV serialization from "./key"
// TODO(P1-15): export restore from "./restore" (restore IS in the MVP — docs/tasks.md)
