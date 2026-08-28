/**
 * Test-only ambient types.
 *
 * The stylesheet lives in public/, which Vite serves as a static asset rather
 * than as a module, so the theme test reads it from disk. The project does not
 * depend on @types/node — the Worker must never see Node globals — so the one
 * function the test needs is declared here instead.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
