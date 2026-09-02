/**
 * `SqlDatabase` (shared-logic/db/sql-database.ts, spec §3.4) implementado sobre
 * `sqlite3.oo1.DB` de @sqlite.org/sqlite-wasm.
 *
 * Reproduce la parte de better-sqlite3 que usa shared-logic — prepare/run/get/
 * all/exec/pragma/transaction/close, parámetros posicionales — y NADA más.
 * No importa de `@logic` a propósito: el chequeo estructural contra
 * `SqlDatabase` lo hace `worker.ts` al pasar la factory a `setDbFactory()`.
 *
 * Statements: los ~600 `prepare()` del código están inline en funciones, así
 * que cada llamada volvería a compilar el SQL. Se cachea por string con LRU de
 * 256 y `finalize()` al evictar. Un `WasmStatement` no guarda el statement
 * nativo: lo pide al cache en cada uso, y si fue evictado se vuelve a preparar.
 */
import type {
  Sqlite3Static,
  Database as OoDatabase,
  PreparedStatement,
  SqlValue,
} from '@sqlite.org/sqlite-wasm';

const STATEMENT_CACHE_MAX = 256;

export interface WasmRunResult {
  changes: number;
  lastInsertRowid: number;
}

function normalizeParam(value: unknown, index: number): SqlValue {
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case 'number':
    case 'string':
      return value;
    case 'boolean':
      return value ? 1 : 0;
    case 'bigint':
      return Number(value);
    default:
      if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
      throw new TypeError(
        `SQLite3 can only bind numbers, strings, bigints, buffers, and null (parameter ${index + 1})`,
      );
  }
}

/** `reset()` re-lanza el error del último `step()`; ese error ya se propagó. */
function safeReset(stmt: PreparedStatement): void {
  try {
    stmt.reset();
  } catch {
    /* ya reportado por step() */
  }
}

export class WasmStatement<Row = unknown> {
  constructor(
    private readonly owner: WasmDatabase,
    private readonly sql: string,
  ) {}

  run(...params: unknown[]): WasmRunResult {
    const stmt = this.bind(params);
    try {
      stmt.step();
    } finally {
      safeReset(stmt);
    }
    return { changes: this.owner.changes(), lastInsertRowid: this.owner.lastInsertRowid() };
  }

  get(...params: unknown[]): Row | undefined {
    const stmt = this.bind(params);
    try {
      return stmt.step() ? (stmt.get({}) as Row) : undefined;
    } finally {
      safeReset(stmt);
    }
  }

  all(...params: unknown[]): Row[] {
    const stmt = this.bind(params);
    const rows: Row[] = [];
    try {
      while (stmt.step()) rows.push(stmt.get({}) as Row);
    } finally {
      safeReset(stmt);
    }
    return rows;
  }

  private bind(params: unknown[]): PreparedStatement {
    const stmt = this.owner.acquire(this.sql);
    const expected = stmt.parameterCount;
    if (params.length !== expected) {
      throw new RangeError(
        params.length < expected
          ? 'Too few parameter values were provided'
          : 'Too many parameter values were provided',
      );
    }
    stmt.clearBindings();
    // `bind([])` lanza «This statement has no bindable parameters».
    if (expected > 0) stmt.bind(params.map(normalizeParam));
    return stmt;
  }
}

export class WasmDatabase {
  private readonly cache = new Map<string, PreparedStatement>();
  private savepointSeq = 0;
  private open = true;

  constructor(
    private readonly sqlite3: Sqlite3Static,
    private readonly db: OoDatabase,
  ) {}

  // ── SqlDatabase ─────────────────────────────────────────────────────────

  prepare<Row = unknown>(sql: string): WasmStatement<Row> {
    this.assertOpen();
    return new WasmStatement<Row>(this, sql);
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  /**
   * Devuelve las filas como better-sqlite3 (`Array<Record<col, valor>>`): una
   * escritura (`foreign_keys = ON`) da `[]`, una lectura (`table_info(x)`) da
   * una fila por columna. `journal_mode` se ignora: opfs-sahpool no usa WAL.
   */
  pragma(directive: string): unknown {
    this.assertOpen();
    if (/^\s*journal_mode\b/i.test(directive)) return [];
    const resultRows: Record<string, SqlValue>[] = [];
    this.db.exec({ sql: `PRAGMA ${directive}`, rowMode: 'object', resultRows });
    return resultRows;
  }

  /**
   * Como better-sqlite3: devuelve una función que corre `fn` dentro de
   * BEGIN/COMMIT (ROLLBACK si lanza). Si ya hay una transacción abierta usa
   * SAVEPOINT/RELEASE/ROLLBACK TO, así una transacción interna que falla no
   * tira la externa.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<F extends (...args: any[]) => any>(fn: F): F {
    const wrapped = (...args: unknown[]): unknown => {
      this.assertOpen();
      if (!this.inTransaction()) {
        this.db.exec('BEGIN');
        try {
          const result = fn(...args);
          this.db.exec('COMMIT');
          return result;
        } catch (err) {
          // Algunos errores ya revierten solos; ROLLBACK sin transacción lanzaría.
          if (this.inTransaction()) this.db.exec('ROLLBACK');
          throw err;
        }
      }
      const sp = `sp_${++this.savepointSeq}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      try {
        const result = fn(...args);
        this.db.exec(`RELEASE ${sp}`);
        return result;
      } catch (err) {
        // Un error que aborta la transacción entera (SQLITE_FULL/IOERR/BUSY/
        // NOMEM/INTERRUPT) se lleva el savepoint consigo: `ROLLBACK TO` lanzaría
        // «no such savepoint» y taparía el error real. Mismo guard que
        // better-sqlite3 (`if (db.inTransaction)`).
        if (this.inTransaction()) {
          this.db.exec(`ROLLBACK TO ${sp}`);
          this.db.exec(`RELEASE ${sp}`);
        }
        throw err;
      }
    };
    return wrapped as unknown as F;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    for (const stmt of this.cache.values()) stmt.finalize();
    this.cache.clear();
    this.db.close();
  }

  // ── Soporte ─────────────────────────────────────────────────────────────

  changes(): number {
    return this.db.changes();
  }

  lastInsertRowid(): number {
    return Number(this.sqlite3.capi.sqlite3_last_insert_rowid(this.pointer()));
  }

  inTransaction(): boolean {
    return this.sqlite3.capi.sqlite3_get_autocommit(this.pointer()) === 0;
  }

  get statementCacheSize(): number {
    return this.cache.size;
  }

  /** @internal Solo tests: el statement nativo cacheado para ese SQL, si existe. */
  peekStatement(sql: string): PreparedStatement | undefined {
    return this.cache.get(sql);
  }

  /** @internal Usado por WasmStatement: statement nativo vivo para `sql`, tocando el LRU. */
  acquire(sql: string): PreparedStatement {
    this.assertOpen();
    const cached = this.cache.get(sql);
    if (cached && cached.pointer !== undefined) {
      this.cache.delete(sql);
      this.cache.set(sql, cached); // el más reciente va al final
      return cached;
    }
    const stmt = this.db.prepare(sql);
    this.cache.set(sql, stmt);
    if (this.cache.size > STATEMENT_CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string;
      const victim = this.cache.get(oldest);
      this.cache.delete(oldest);
      victim?.finalize();
    }
    return stmt;
  }

  private pointer(): NonNullable<OoDatabase['pointer']> {
    const p = this.db.pointer;
    if (p === undefined) throw new TypeError('The database connection is not open');
    return p;
  }

  private assertOpen(): void {
    if (!this.open) throw new TypeError('The database connection is not open');
  }
}
