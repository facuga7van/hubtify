/**
 * The exact subset of better-sqlite3 the handlers use (verified in the spec's
 * Anexo A: prepare/run/get/all/exec/pragma/transaction/close — nothing else).
 * better-sqlite3 satisfies it structurally; the Android WASM shim implements it.
 *
 * `transaction` is typed with explicit (args, return) generics instead of a
 * single `<F>(fn: F): F`: better-sqlite3 returns `Transaction<F>` (F plus
 * `.immediate/.deferred/…`), which TypeScript refuses to assign back to a bare
 * `F`, so the spec's literal signature does not compile against the real type.
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement<Row = unknown> {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

export interface SqlDatabase {
  prepare<Row = unknown>(sql: string): SqlStatement<Row>;
  exec(sql: string): void;
  pragma(directive: string): unknown;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
}
