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
  export function readdirSync(path: string): string[];
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
}

/**
 * `node:sqlite` reached through the runtime rather than imported: the bundler
 * the tests run under does not treat it as a builtin and tries to resolve a
 * package called "sqlite". Only the two members the schema check uses are
 * declared.
 */
interface SqliteStatement { run(...params: unknown[]): unknown }
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
declare namespace NodeJS {
  interface Process {
    getBuiltinModule(id: 'node:sqlite'): { DatabaseSync: new (path: string) => SqliteDatabase };
  }
}
declare const process: NodeJS.Process;
