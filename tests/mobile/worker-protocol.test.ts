import { describe, it, expect, vi } from 'vitest';
import { createWorkerProtocol, type WorkerHandler, type WorkerHost } from '../../src/mobile/worker-protocol';
import type { WorkerToUi } from '../../src/mobile/protocol';

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeHost() {
  const posted: Array<{ msg: WorkerToUi; transfer?: Transferable[] }> = [];
  const handlers = new Map<string, WorkerHandler>();
  const host: WorkerHost = {
    post: vi.fn((msg: WorkerToUi, transfer?: Transferable[]) => { posted.push({ msg, transfer }); }),
    getHandler: (ch) => handlers.get(ch),
    onInit: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(async () => {}),
    log: vi.fn(),
  };
  return { host, posted, handlers };
}

describe('worker-protocol: invoke', () => {
  it('llama al handler con ({}, ...args) y responde ok:true con el valor', async () => {
    const { host, posted, handlers } = makeHost();
    const fn = vi.fn((_e: unknown, a: string, b: number) => [a, b]);
    handlers.set('quests:getTasks', fn);
    const p = createWorkerProtocol(host);

    await p.onMessage({ id: 7, type: 'invoke', channel: 'quests:getTasks', args: ['x', 2] });

    expect(fn).toHaveBeenCalledWith({}, 'x', 2);
    expect(posted[0].msg).toEqual({ id: 7, type: 'result', ok: true, value: ['x', 2] });
  });

  it('espera handlers async', async () => {
    const { host, posted, handlers } = makeHost();
    handlers.set('dollar:get', async () => 1234);
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 1, type: 'invoke', channel: 'dollar:get', args: [] });
    expect(posted[0].msg).toMatchObject({ id: 1, ok: true, value: 1234 });
  });

  it('canal sin handler → NoHandler con el canal como message', async () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 2, type: 'invoke', channel: 'backup:export', args: [] });
    expect(posted[0].msg).toEqual({
      id: 2, type: 'result', ok: false, error: { name: 'NoHandler', message: 'backup:export' },
    });
  });

  it('handler que lanza → ok:false con name/message y log "[canal]"', async () => {
    const { host, posted, handlers } = makeHost();
    handlers.set('cauldron:start', () => { throw new Error('Timer already active'); });
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 3, type: 'invoke', channel: 'cauldron:start', args: ['p1'] });
    expect(posted[0].msg).toEqual({
      id: 3, type: 'result', ok: false, error: { name: 'Error', message: 'Timer already active' },
    });
    expect(host.log).toHaveBeenCalledWith('[cauldron:start]', expect.any(Error));
  });

  it('un Uint8Array en el resultado viaja en la transfer list', async () => {
    const { host, posted, handlers } = makeHost();
    const bytes = new Uint8Array([1, 2]);
    handlers.set('x:bytes', () => ({ name: 'f.db', bytes }));
    const p = createWorkerProtocol(host);
    await p.onMessage({ id: 4, type: 'invoke', channel: 'x:bytes', args: [] });
    expect(posted[0].transfer).toEqual([bytes.buffer]);
  });
});

describe('worker-protocol: suspend / resume', () => {
  it('suspend llama host.suspend; los invokes esperan hasta que resume termina', async () => {
    const { host, posted, handlers } = makeHost();
    const order: string[] = [];
    (host.resume as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('resume'); });
    handlers.set('a', () => { order.push('handler'); return 'ok'; });
    const p = createWorkerProtocol(host);

    await p.onMessage({ type: 'suspend' });
    expect(host.suspend).toHaveBeenCalledTimes(1);
    expect(p.isSuspended()).toBe(true);

    const pending = p.onMessage({ id: 1, type: 'invoke', channel: 'a', args: [] });
    await flush();
    expect(posted).toHaveLength(0);

    await p.onMessage({ type: 'resume' });
    await pending;
    expect(order).toEqual(['resume', 'handler']);
    expect(p.isSuspended()).toBe(false);
    expect(posted[0].msg).toMatchObject({ id: 1, ok: true, value: 'ok' });
  });

  it('suspend y resume repetidos son idempotentes', async () => {
    const { host } = makeHost();
    const p = createWorkerProtocol(host);
    await p.onMessage({ type: 'resume' });
    expect(host.resume).not.toHaveBeenCalled();
    await p.onMessage({ type: 'suspend' });
    await p.onMessage({ type: 'suspend' });
    expect(host.suspend).toHaveBeenCalledTimes(1);
    await p.onMessage({ type: 'resume' });
    await p.onMessage({ type: 'resume' });
    expect(host.resume).toHaveBeenCalledTimes(1);
  });

  it('si resume falla postea fatal y sigue suspendido', async () => {
    const { host, posted } = makeHost();
    (host.resume as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unpause failed'));
    const p = createWorkerProtocol(host);
    await p.onMessage({ type: 'suspend' });
    await p.onMessage({ type: 'resume' });
    expect(posted[0].msg).toEqual({ type: 'fatal', reason: 'open', message: 'unpause failed' });
    expect(p.isSuspended()).toBe(true);
  });

  it('si resume falla rechaza los platform en vuelo con el mismo error', async () => {
    const { host } = makeHost();
    (host.resume as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unpause failed'));
    const p = createWorkerProtocol(host);
    // La UI ya no va a contestar este platform-result: el worker quedó muerto.
    const call = p.callPlatform('notify', [{ title: 't', body: 'b' }]);
    await p.onMessage({ type: 'suspend' });
    await p.onMessage({ type: 'resume' });
    await expect(call).rejects.toMatchObject({ message: 'unpause failed' });
    // Un platform-result tardío del mismo id ya no encuentra pendiente.
    await p.onMessage({ id: 1, type: 'platform-result', ok: true, value: undefined });
  });
});

describe('worker-protocol: platform proxy e init', () => {
  it('callPlatform postea {type:platform,id} y resuelve con platform-result ok', async () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    const call = p.callPlatform('pickPdfText', []);
    const msg = posted[0].msg as { id: number; type: string; method: string; args: unknown[] };
    expect(msg).toEqual({ id: 1, type: 'platform', method: 'pickPdfText', args: [] });
    await p.onMessage({ id: 1, type: 'platform-result', ok: true, value: { unsupported: true } });
    await expect(call).resolves.toEqual({ unsupported: true });
  });

  it('platform-result ok:false rechaza conservando name', async () => {
    const { host } = makeHost();
    const p = createWorkerProtocol(host);
    const call = p.callPlatform('notify', [{ title: 't', body: 'b' }]);
    await p.onMessage({ id: 1, type: 'platform-result', ok: false, error: { name: 'Denied', message: 'no' } });
    await expect(call).rejects.toMatchObject({ name: 'Denied', message: 'no' });
  });

  it('callPlatform transfiere los Uint8Array de los args', () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    const bytes = new Uint8Array([5]);
    void p.callPlatform('saveBinaryFile', ['x.db', bytes]);
    expect(posted[0].transfer).toEqual([bytes.buffer]);
  });

  it('ids de platform son crecientes y un result desconocido se ignora', async () => {
    const { host, posted } = makeHost();
    const p = createWorkerProtocol(host);
    void p.callPlatform('notify', []);
    void p.callPlatform('notify', []);
    expect((posted[1].msg as { id: number }).id).toBe(2);
    await expect(p.onMessage({ id: 99, type: 'platform-result', ok: true, value: null })).resolves.toBeUndefined();
  });

  it('init pasa appVersion y osInfo al host', async () => {
    const { host } = makeHost();
    const p = createWorkerProtocol(host);
    await p.onMessage({ type: 'init', appVersion: '0.8.2', osInfo: 'android 14' });
    expect(host.onInit).toHaveBeenCalledWith({ appVersion: '0.8.2', osInfo: 'android 14' });
  });
});
