import { describe, it, expect } from 'vitest';
import { API_CHANNELS, type ChannelSpec } from '../../shared/api-channels';

const entries = Object.entries(API_CHANNELS) as Array<[string, ChannelSpec]>;

const DESKTOP_ONLY = [
  'backupExport', 'backupPickImportFile', 'backupImport',
  'cauldronOpenWindow', 'cauldronCloseWindow',
  'getInstallWarning',
  'updaterCheck', 'updaterDownload', 'updaterRestart',
].sort();

describe('API_CHANNELS', () => {
  it('covers the 265 methods of HubtifyApi (249 invoke, 3 send, 13 on)', () => {
    expect(entries).toHaveLength(265);
    const byKind = { invoke: 0, send: 0, on: 0 };
    for (const [, s] of entries) byKind[s.kind]++;
    expect(byKind).toEqual({ invoke: 249, send: 3, on: 13 });
  });

  it('never reuses a channel', () => {
    const channels = entries.map(([, s]) => s.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('every channel is module:action', () => {
    for (const [, s] of entries) expect(s.channel).toMatch(/^[a-z]+:[a-zA-Z-]+$/);
  });

  it('kind "on" is exactly the on* methods', () => {
    for (const [key, s] of entries) expect(key.startsWith('on')).toBe(s.kind === 'on');
  });

  it('kind "send" is exactly the three window controls', () => {
    expect(entries.filter(([, s]) => s.kind === 'send').map(([k]) => k))
      .toEqual(['windowMinimize', 'windowMaximize', 'windowClose']);
  });

  it('marks exactly the 9 desktop-only methods', () => {
    expect(entries.filter(([, s]) => s.platforms === 'desktop').map(([k]) => k).sort()).toEqual(DESKTOP_ONLY);
  });

  it('unwrap exists only on the 3 legacy "on" wrappers and reshapes as preload did', () => {
    const withUnwrap = entries.filter(([, s]) => s.unwrap);
    expect(withUnwrap.map(([k]) => k).sort())
      .toEqual(['onRpgAchievementUnlocked', 'onRpgAchievementsBackfilled', 'onUpdateDownloaded']);
    for (const [, s] of withUnwrap) expect(s.kind).toBe('on');
    expect(API_CHANNELS.onRpgAchievementUnlocked.unwrap({ id: 'a1' })).toBe('a1');
    expect(API_CHANNELS.onRpgAchievementsBackfilled.unwrap({ ids: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(API_CHANNELS.onRpgAchievementsBackfilled.unwrap(undefined)).toEqual([]);
    expect(API_CHANNELS.onUpdateDownloaded.unwrap({ anything: true })).toBeUndefined();
  });
});
