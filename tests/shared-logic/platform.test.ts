import { describe, it, expect, afterEach } from 'vitest';
import { platform, setPlatform, type PlatformPort } from '../../shared-logic/platform';

const fake: PlatformPort = {
  appVersion: () => '9.9.9',
  osInfo: () => 'test 0',
  notify: async () => undefined,
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
};

// The installed port is module-global, so a case that asserts on the
// "not installed" state would depend on running first. There is no public
// reset (and none should be added for tests), so uninstall through the same
// door: setPlatform(null) is exactly what `platform()` checks for — the same
// precedent as `setDbFactory(undefined as never)` in provider.test.ts.
afterEach(() => setPlatform(null as unknown as PlatformPort));

describe('platform()', () => {
  it('throws a clear error before setPlatform()', () => {
    expect(() => platform()).toThrow(/setPlatform/);
  });

  it('returns the injected port after setPlatform()', () => {
    setPlatform(fake);
    expect(platform().appVersion()).toBe('9.9.9');
  });
});
