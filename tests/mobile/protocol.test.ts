import { describe, it, expect } from 'vitest';
import {
  collectTransferables,
  serializeError,
  MobileFatal,
  WorkerCrashed,
} from '../../src/mobile/protocol';

describe('collectTransferables', () => {
  it('devuelve el buffer de un Uint8Array suelto', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(collectTransferables(bytes)).toEqual([bytes.buffer]);
  });

  it('encuentra Uint8Array anidados hasta 2 niveles (pickBinaryFile → { name, bytes })', () => {
    const bytes = new Uint8Array([9]);
    expect(collectTransferables({ name: 'x.db', bytes })).toEqual([bytes.buffer]);
    expect(collectTransferables({ ok: true, file: { name: 'x.db', bytes } })).toEqual([bytes.buffer]);
  });

  it('no baja más de 2 niveles ni entra en arrays', () => {
    const bytes = new Uint8Array([9]);
    expect(collectTransferables({ a: { b: { bytes } } })).toEqual([]);
    expect(collectTransferables([bytes])).toEqual([]);
  });

  it('devuelve [] para primitivas, null y objetos sin binarios', () => {
    expect(collectTransferables(null)).toEqual([]);
    expect(collectTransferables(42)).toEqual([]);
    expect(collectTransferables({ tasks: [{ id: '1' }] })).toEqual([]);
  });
});

describe('serializeError', () => {
  it('conserva name y message de un Error', () => {
    class Custom extends Error { name = 'Custom'; }
    expect(serializeError(new Custom('boom'))).toEqual({ name: 'Custom', message: 'boom' });
  });

  it('convierte no-Errors a Error genérico', () => {
    expect(serializeError('texto')).toEqual({ name: 'Error', message: 'texto' });
    expect(serializeError(undefined)).toEqual({ name: 'Error', message: 'undefined' });
  });
});

describe('errores', () => {
  it('MobileFatal lleva reason, namespace y version', () => {
    const e = new MobileFatal('migration', 'ALTER falló', { namespace: 'quests', version: 7 });
    expect(e.reason).toBe('migration');
    expect(e.namespace).toBe('quests');
    expect(e.version).toBe(7);
    expect(e.name).toBe('MobileFatal');
    expect(e).toBeInstanceOf(Error);
  });

  it('WorkerCrashed tiene name estable', () => {
    expect(new WorkerCrashed('x').name).toBe('WorkerCrashed');
  });
});
