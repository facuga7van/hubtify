import { describe, it, expect, vi } from 'vitest';
import { buildApi, type Transport, type EventHandler } from '../../shared/build-api';
import { API_CHANNELS } from '../../shared/api-channels';

function fakeTransport() {
  const listeners = new Map<string, Set<EventHandler>>();
  const t: Transport & { fire(channel: string, payload?: unknown): void; invoke: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } = {
    invoke: vi.fn(async (_channel: string, ...args: unknown[]) => ({ echoed: args })),
    send: vi.fn(),
    on: (channel, h) => { (listeners.get(channel) ?? listeners.set(channel, new Set()).get(channel)!).add(h); },
    off: (channel, h) => { listeners.get(channel)?.delete(h); },
    fire: (channel, payload) => { for (const h of listeners.get(channel) ?? []) h(payload); },
  };
  return t;
}

describe('buildApi', () => {
  it('desktop exposes every key of the table', () => {
    const api = buildApi(fakeTransport(), 'desktop') as unknown as Record<string, unknown>;
    for (const key of Object.keys(API_CHANNELS)) expect(typeof api[key]).toBe('function');
  });

  it('invoke forwards channel and args and resolves with the transport result', async () => {
    const t = fakeTransport();
    const api = buildApi(t, 'desktop');
    await expect(api.questsSetTaskStatus('t1', true)).resolves.toEqual({ echoed: ['t1', true] });
    expect(t.invoke).toHaveBeenCalledWith('quests:setTaskStatus', 't1', true);
  });

  it('send forwards on desktop and is a no-op on mobile', () => {
    const d = fakeTransport();
    buildApi(d, 'desktop').windowMinimize();
    expect(d.send).toHaveBeenCalledWith('window:minimize');

    const m = fakeTransport();
    buildApi(m, 'mobile').windowMinimize();
    expect(m.send).not.toHaveBeenCalled();
  });

  it('on subscribes, unwraps the legacy payloads, and the returned function unsubscribes', () => {
    const t = fakeTransport();
    const api = buildApi(t, 'desktop');

    const ids: string[] = [];
    const off = api.onRpgAchievementUnlocked((id) => ids.push(id));
    t.fire('rpg:achievementUnlocked', { id: 'first_seal' });
    expect(ids).toEqual(['first_seal']);
    off();
    t.fire('rpg:achievementUnlocked', { id: 'ignored' });
    expect(ids).toEqual(['first_seal']);

    const ticks: unknown[] = [];
    api.onCauldronTick((s) => ticks.push(s));
    t.fire('cauldron:tick', { status: 'work' });
    expect(ticks).toEqual([{ status: 'work' }]); // no unwrap: payload as-is

    const downloaded = vi.fn();
    api.onUpdateDownloaded(downloaded);
    t.fire('updater:update-downloaded', { raw: 'event' });
    expect(downloaded).toHaveBeenCalledWith(undefined);
  });

  it('mobile omits the 9 desktop-only methods and keeps everything else', () => {
    const api = buildApi(fakeTransport(), 'mobile') as unknown as Record<string, unknown>;
    for (const key of ['backupExport', 'backupPickImportFile', 'backupImport', 'cauldronOpenWindow', 'cauldronCloseWindow', 'updaterCheck', 'updaterDownload', 'updaterRestart', 'getInstallWarning']) {
      expect(api[key]).toBeUndefined();
    }
    expect(Object.keys(api)).toHaveLength(264 - 9);
    expect(typeof api.onUpdateAvailable).toBe('function'); // NOT desktop-only (spec §3.1)
  });
});
