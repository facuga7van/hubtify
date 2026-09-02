import { describe, it, expect, vi } from 'vitest';
import {
  createWorkerClient,
  type PlatformHostFns,
  type WorkerLike,
} from '../../src/mobile/worker-client';
import { MobileFatal, WorkerCrashed, type UiToWorker, type WorkerToUi } from '../../src/mobile/protocol';

const flush = () => new Promise((r) => setTimeout(r, 0));

class FakeWorker implements WorkerLike {
  sent: Array<{ msg: UiToWorker; transfer?: Transferable[] }> = [];
  terminate = vi.fn();
  private listeners = new Map<string, Array<(ev: unknown) => void>>();

  postMessage(msg: UiToWorker, transfer?: Transferable[]): void {
    this.sent.push({ msg, transfer });
  }
  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  emit(type: string, ev: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(ev);
  }
  receive(msg: WorkerToUi): void {
    this.emit('message', { data: msg });
  }
}

function makePlatform(overrides: Partial<PlatformHostFns> = {}): PlatformHostFns {
  return {
    notify: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    pickTextFile: vi.fn(async () => null),
    pickPdfText: vi.fn(async () => ({ unsupported: true })),
    pickBinaryFile: vi.fn(async () => null),
    saveTextFile: vi.fn(async () => false),
    saveBinaryFile: vi.fn(async () => false),
    ...overrides,
  };
}

function setup(overrides: Partial<PlatformHostFns> = {}) {
  const worker = new FakeWorker();
  const onCrash = vi.fn();
  const client = createWorkerClient(worker, makePlatform(overrides), { onCrash });
  return { worker, client, onCrash };
}

describe('worker-client: arranque', () => {
  it('ready resuelve con {type:ready}', async () => {
    const { worker, client } = setup();
    worker.receive({ type: 'ready' });
    await expect(client.ready).resolves.toBeUndefined();
  });

  it('fatal antes de ready rechaza con MobileFatal (reason, namespace, version)', async () => {
    const { worker, client } = setup();
    worker.receive({ type: 'fatal', reason: 'migration', message: 'ALTER falló', namespace: 'quests', version: 7 });
    await expect(client.ready).rejects.toMatchObject({
      name: 'MobileFatal', reason: 'migration', message: 'ALTER falló', namespace: 'quests', version: 7,
    });
    await expect(client.ready).rejects.toBeInstanceOf(MobileFatal);
  });

  it('init postea appVersion y osInfo', () => {
    const { worker, client } = setup();
    client.init({ appVersion: '0.8.2', osInfo: 'android 14' });
    expect(worker.sent[0].msg).toEqual({ type: 'init', appVersion: '0.8.2', osInfo: 'android 14' });
  });
});

describe('worker-client: invoke', () => {
  it('postea {id,type:invoke,channel,args} y resuelve con el result ok:true', async () => {
    const { worker, client } = setup();
    const p = client.transport.invoke('quests:getTasks', 'arg1', 2);
    expect(worker.sent[0].msg).toEqual({ id: 1, type: 'invoke', channel: 'quests:getTasks', args: ['arg1', 2] });
    worker.receive({ id: 1, type: 'result', ok: true, value: [{ id: 't1' }] });
    await expect(p).resolves.toEqual([{ id: 't1' }]);
  });

  it('rechaza con name/message del result ok:false (NoHandler incluido)', async () => {
    const { worker, client } = setup();
    const p = client.transport.invoke('backup:export');
    worker.receive({ id: 1, type: 'result', ok: false, error: { name: 'NoHandler', message: 'backup:export' } });
    await expect(p).rejects.toMatchObject({ name: 'NoHandler', message: 'backup:export' });
  });

  it('los ids son crecientes y cada result resuelve solo su invoke', async () => {
    const { worker, client } = setup();
    const a = client.transport.invoke('a');
    const b = client.transport.invoke('b');
    worker.receive({ id: 2, type: 'result', ok: true, value: 'B' });
    worker.receive({ id: 1, type: 'result', ok: true, value: 'A' });
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
  });

  it('un Uint8Array en los args viaja en la transfer list', () => {
    const { worker, client } = setup();
    const bytes = new Uint8Array([1]);
    void client.transport.invoke('backup:import', bytes);
    expect(worker.sent[0].transfer).toEqual([bytes.buffer]);
  });

  it('send es no-op en mobile', () => {
    const { worker, client } = setup();
    client.transport.send('window:minimize');
    expect(worker.sent).toHaveLength(0);
  });
});

describe('worker-client: eventos', () => {
  it('on recibe el payload del evento; off deja de recibir', () => {
    const { worker, client } = setup();
    const h = vi.fn();
    client.transport.on('cauldron:tick', h);
    worker.receive({ type: 'event', channel: 'cauldron:tick', payload: { remainingMs: 5 } });
    expect(h).toHaveBeenCalledWith({ remainingMs: 5 });
    client.transport.off('cauldron:tick', h);
    worker.receive({ type: 'event', channel: 'cauldron:tick', payload: { remainingMs: 4 } });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('un listener que lanza no frena a los demás', () => {
    const { worker, client } = setup();
    const bad = vi.fn(() => { throw new Error('ui'); });
    const good = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    client.transport.on('rpg:daySealed', bad);
    client.transport.on('rpg:daySealed', good);
    worker.receive({ type: 'event', channel: 'rpg:daySealed', payload: 1 });
    expect(good).toHaveBeenCalledWith(1);
    spy.mockRestore();
  });
});

describe('worker-client: proxy de plataforma', () => {
  it('platform → llama al host y responde platform-result con transfer list', async () => {
    const bytes = new Uint8Array([7, 7]);
    const pickBinaryFile = vi.fn(async () => ({ name: 'x.db', bytes }));
    const { worker } = setup({ pickBinaryFile });
    worker.receive({ id: 3, type: 'platform', method: 'pickBinaryFile', args: [[{ name: 'DB', extensions: ['db'] }]] });
    await flush();
    expect(pickBinaryFile).toHaveBeenCalledWith([{ name: 'DB', extensions: ['db'] }]);
    expect(worker.sent[0]).toEqual({
      msg: { id: 3, type: 'platform-result', ok: true, value: { name: 'x.db', bytes } },
      transfer: [bytes.buffer],
    });
  });

  it('si el host lanza responde ok:false con name/message', async () => {
    const { worker } = setup({ notify: vi.fn(async () => { throw new Error('denied'); }) });
    worker.receive({ id: 4, type: 'platform', method: 'notify', args: [{ title: 't', body: 'b' }] });
    await flush();
    expect(worker.sent[0].msg).toEqual({ id: 4, type: 'platform-result', ok: false, error: { name: 'Error', message: 'denied' } });
  });
});

describe('worker-client: suspend / resume', () => {
  it('suspend postea {type:suspend}; los invokes se encolan y salen tras resume, en orden', async () => {
    const { worker, client } = setup();
    client.suspend();
    expect(worker.sent.map((s) => s.msg)).toEqual([{ type: 'suspend' }]);
    expect(client.isSuspended()).toBe(true);

    const a = client.transport.invoke('a');
    const b = client.transport.invoke('b');
    expect(worker.sent).toHaveLength(1);

    client.resume();
    expect(worker.sent.map((s) => s.msg)).toEqual([
      { type: 'suspend' },
      { type: 'resume' },
      { id: 1, type: 'invoke', channel: 'a', args: [] },
      { id: 2, type: 'invoke', channel: 'b', args: [] },
    ]);
    worker.receive({ id: 1, type: 'result', ok: true, value: 'A' });
    worker.receive({ id: 2, type: 'result', ok: true, value: 'B' });
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
    expect(client.isSuspended()).toBe(false);
  });

  it('suspend/resume repetidos no duplican mensajes', () => {
    const { worker, client } = setup();
    client.resume();
    client.suspend();
    client.suspend();
    client.resume();
    client.resume();
    expect(worker.sent.map((s) => s.msg)).toEqual([{ type: 'suspend' }, { type: 'resume' }]);
  });
});

describe('worker-client: crash', () => {
  it('error del worker rechaza pendientes y encolados con WorkerCrashed, llama onCrash y rechaza invokes posteriores', async () => {
    const { worker, client, onCrash } = setup();
    worker.receive({ type: 'ready' });
    const pending = client.transport.invoke('a');
    client.suspend();
    const queued = client.transport.invoke('b');

    worker.emit('error', { message: 'Uncaught RangeError: boom' });

    await expect(pending).rejects.toBeInstanceOf(WorkerCrashed);
    await expect(queued).rejects.toBeInstanceOf(WorkerCrashed);
    expect(onCrash).toHaveBeenCalledTimes(1);
    expect(onCrash.mock.calls[0][0]).toMatchObject({ name: 'WorkerCrashed', message: 'Uncaught RangeError: boom' });
    await expect(client.transport.invoke('c')).rejects.toBeInstanceOf(WorkerCrashed);
    expect(client.isCrashed()).toBe(true);
  });

  it('un fatal DESPUÉS de ready se trata como crash', async () => {
    const { worker, client, onCrash } = setup();
    worker.receive({ type: 'ready' });
    await client.ready;
    const p = client.transport.invoke('a');
    worker.receive({ type: 'fatal', reason: 'open', message: 'unpause failed' });
    await expect(p).rejects.toBeInstanceOf(WorkerCrashed);
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it('un crash ANTES de ready rechaza ready con MobileFatal', async () => {
    const { worker, client } = setup();
    worker.emit('error', { message: 'boom' });
    await expect(client.ready).rejects.toMatchObject({ name: 'MobileFatal', reason: 'open', message: 'boom' });
  });
});
