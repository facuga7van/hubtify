import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerHandler, getHandler, listChannels, clearHandlers,
  registerLifecycle, runSuspend, runResume,
} from '../../shared-logic/registry';

beforeEach(() => clearHandlers());

describe('registry — handlers', () => {
  it('registers and retrieves a handler by channel', async () => {
    registerHandler('quests:getTasks', (_e, projectId: string | null) => ({ projectId }));
    const fn = getHandler('quests:getTasks')!;
    expect(await fn({}, 'p1')).toEqual({ projectId: 'p1' });
  });

  it('returns undefined for an unknown channel', () => {
    expect(getHandler('nope:nothing')).toBeUndefined();
  });

  it('throws on a duplicate channel', () => {
    registerHandler('rpg:getStats', () => 1);
    expect(() => registerHandler('rpg:getStats', () => 2)).toThrow(/already registered.*rpg:getStats/);
  });

  it('lists channels in registration order', () => {
    registerHandler('b:two', () => 2);
    registerHandler('a:one', () => 1);
    expect(listChannels()).toEqual(['b:two', 'a:one']);
  });

  it('clearHandlers empties handlers and lifecycles', () => {
    registerHandler('x:y', () => 0);
    registerLifecycle({ suspend: () => undefined, resume: () => undefined });
    clearHandlers();
    expect(listChannels()).toEqual([]);
    expect(() => runSuspend()).not.toThrow();
  });
});

describe('registry — lifecycle', () => {
  it('runs suspend/resume hooks in registration order', () => {
    const calls: string[] = [];
    registerLifecycle({ suspend: () => calls.push('s1'), resume: () => calls.push('r1') });
    registerLifecycle({ suspend: () => calls.push('s2'), resume: () => calls.push('r2') });
    runSuspend();
    runResume();
    expect(calls).toEqual(['s1', 's2', 'r1', 'r2']);
  });
});
