/**
 * El shim corre sqlite-wasm EN NODE (condición `node` del paquete → dist/node.mjs,
 * que carga el .wasm con fs). Sin OPFS: DB en memoria. Lo que se prueba es la
 * semántica better-sqlite3 que los ~600 `prepare` de shared-logic dan por hecha.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { WasmDatabase } from '../../src/mobile/db/wasm-database';

type InitModule = (opts?: {
  print?: (...a: unknown[]) => void;
  printErr?: (...a: unknown[]) => void;
}) => Promise<Sqlite3Static>;

// El build de Node avisa por printErr que no hay OPFS; no es parte del test.
const sqlite3 = await (sqlite3InitModule as unknown as InitModule)({
  print: () => {},
  printErr: () => {},
});

function openMemory(): WasmDatabase {
  return new WasmDatabase(sqlite3, new sqlite3.oo1.DB(':memory:'));
}

const SCHEMA = `
  CREATE TABLE t (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    done INTEGER NOT NULL DEFAULT 0,
    blob BLOB
  )`;

describe('WasmDatabase (shim better-sqlite3 sobre sqlite3.oo1.DB)', () => {
  let db: WasmDatabase;

  beforeEach(() => {
    db = openMemory();
    db.exec(SCHEMA);
  });

  afterEach(() => {
    db.close();
  });

  it('run devuelve changes y lastInsertRowid como numbers', () => {
    const r = db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    expect(r).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(db.prepare('INSERT INTO t (name) VALUES (?)').run('b').lastInsertRowid).toBe(2);
    expect(db.prepare('UPDATE t SET done = 1').run().changes).toBe(2);
  });

  it('get devuelve un objeto por nombre de columna (alias incluidos) o undefined', () => {
    db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    expect(db.prepare('SELECT id, name AS taskName FROM t WHERE name = ?').get('a'))
      .toEqual({ id: 1, taskName: 'a' });
    expect(db.prepare('SELECT id FROM t WHERE name = ?').get('zzz')).toBeUndefined();
  });

  it('all devuelve todas las filas en orden y [] si no hay', () => {
    expect(db.prepare('SELECT name FROM t').all()).toEqual([]);
    db.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    db.prepare('INSERT INTO t (name) VALUES (?)').run('b');
    expect(db.prepare('SELECT name FROM t ORDER BY id').all()).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('los enteros vuelven como number, no bigint', () => {
    const row = db.prepare('SELECT 1 AS n, 9007199254740991 AS big').get() as { n: unknown; big: unknown };
    expect(typeof row.n).toBe('number');
    expect(typeof row.big).toBe('number');
  });

  it('booleanos → 0/1, undefined → NULL, bigint → number', () => {
    db.prepare('INSERT INTO t (name, done, blob) VALUES (?, ?, ?)').run('a', true, undefined);
    db.prepare('INSERT INTO t (name, done) VALUES (?, ?)').run('b', false);
    expect(db.prepare('SELECT done, blob FROM t WHERE name = ?').get('a')).toEqual({ done: 1, blob: null });
    expect(db.prepare('SELECT done FROM t WHERE name = ?').get('b')).toEqual({ done: 0 });
    expect(db.prepare('SELECT ? AS big').get(42n)).toEqual({ big: 42 });
  });

  it('blobs entran y salen como Uint8Array', () => {
    db.prepare('INSERT INTO t (name, blob) VALUES (?, ?)').run('a', new Uint8Array([1, 2, 3]));
    const row = db.prepare('SELECT blob FROM t WHERE name = ?').get('a') as { blob: Uint8Array };
    expect(row.blob).toBeInstanceOf(Uint8Array);
    expect(Array.from(row.blob)).toEqual([1, 2, 3]);
  });

  it('objetos no bindeables lanzan TypeError', () => {
    expect(() => db.prepare('SELECT ? AS x').get(new Date())).toThrow(TypeError);
  });

  it('cantidad de parámetros incorrecta lanza como better-sqlite3', () => {
    expect(() => db.prepare('SELECT ? AS a, ? AS b').get(1)).toThrow(/Too few parameter/);
    expect(() => db.prepare('SELECT ? AS a').get(1, 2)).toThrow(/Too many parameter/);
  });

  it('un error de step deja el statement cacheado reutilizable', () => {
    const ins = db.prepare('INSERT INTO t (name) VALUES (?)');
    ins.run('a');
    expect(() => ins.run('a')).toThrow(/UNIQUE/);
    expect(ins.run('b').changes).toBe(1);
  });

  it('el mismo SQL reutiliza el statement cacheado', () => {
    db.prepare('SELECT 1 AS x').get();
    db.prepare('SELECT 1 AS x').get();
    expect(db.statementCacheSize).toBe(1);
  });

  it('LRU 256: evicta y finaliza el más viejo; un statement en mano se re-prepara', () => {
    const held = db.prepare('SELECT 0 AS held');
    held.get();
    const raw = db.peekStatement('SELECT 0 AS held');
    expect(raw?.pointer).toBeDefined();

    for (let i = 1; i <= 256; i++) db.prepare(`SELECT ${i} AS n`).get();

    expect(db.statementCacheSize).toBe(256);
    expect(raw?.pointer).toBeUndefined(); // finalizado al evictar
    expect(db.peekStatement('SELECT 0 AS held')).toBeUndefined();

    expect(held.get()).toEqual({ held: 0 }); // se volvió a preparar
    expect(db.peekStatement('SELECT 0 AS held')).toBeDefined();
    expect(db.statementCacheSize).toBe(256);
  });

  it('transaction devuelve una función: COMMIT al retornar, ROLLBACK al lanzar', () => {
    const insert = db.transaction((names: string[]) => {
      for (const n of names) db.prepare('INSERT INTO t (name) VALUES (?)').run(n);
      return names.length;
    });
    expect(insert(['a', 'b'])).toBe(2);
    expect(() => insert(['c', 'a'])).toThrow(/UNIQUE/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 }); // 'c' revertido
    expect(db.inTransaction()).toBe(false);
  });

  it('transacción anidada usa SAVEPOINT: el fallo interno no tira la externa', () => {
    const inner = db.transaction((name: string) => {
      db.prepare('INSERT INTO t (name) VALUES (?)').run(name);
      if (name === 'bad') throw new Error('inner');
    });
    const outer = db.transaction(() => {
      inner('ok');
      expect(db.inTransaction()).toBe(true);
      try { inner('bad'); } catch { /* absorbido: la externa sigue */ }
      inner('ok2');
    });
    outer();
    expect(db.prepare('SELECT name FROM t ORDER BY id').all()).toEqual([{ name: 'ok' }, { name: 'ok2' }]);
  });

  it('pragma: lectura devuelve filas-objeto, escritura devuelve [], journal_mode se ignora', () => {
    expect(db.pragma('journal_mode = WAL')).toEqual([]);
    expect(db.pragma('foreign_keys = ON')).toEqual([]);
    expect(db.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    const cols = (db.pragma('table_info(t)') as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(['id', 'name', 'done', 'blob']);
  });

  it('exec acepta varias sentencias', () => {
    db.exec(`INSERT INTO t (name) VALUES ('x'); INSERT INTO t (name) VALUES ('y');`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 });
  });

  it('close cierra la conexión y todo uso posterior lanza', () => {
    db.close();
    expect(() => db.prepare('SELECT 1').get()).toThrow(/not open/);
    expect(() => db.exec('SELECT 1')).toThrow(/not open/);
    db.close(); // idempotente
    db = openMemory(); // para el afterEach
  });
});
