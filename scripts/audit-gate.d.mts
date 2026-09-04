/**
 * Types for the audit gate, which is plain JavaScript because CI runs it
 * directly with no build step in front of it. Declared here so the test suite
 * typechecks against the same shape the script relies on.
 */

export declare const BLOCKING_LEVELS: readonly ['high', 'critical'];

export type AuditVerdict =
  | { kind: 'clean'; summary: string }
  | { kind: 'blocked'; summary: string; blocking: number; names: string[] }
  | { kind: 'unreachable'; detail: string };

export declare function readAudit(raw: string, stderr?: string): AuditVerdict;
