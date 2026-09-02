import { describe, it, expect } from 'vitest';
import { platform, setPlatform, type PlatformPort } from '../../shared-logic/platform';

const fake: PlatformPort = {
  appVersion: () => '9.9.9',
  osInfo: () => 'test 0',
  notify: async () => undefined,
  openExternal: async () => undefined,
  pickTextFile: async () => null,
  pickPdfText: async () => ({ unsupported: true }),
  pickBinaryFile: async () => null,
  saveTextFile: async () => false,
  saveBinaryFile: async () => false,
};

describe('platform()', () => {
  it('throws a clear error before setPlatform()', () => {
    expect(() => platform()).toThrow(/setPlatform/);
  });

  it('returns the injected port after setPlatform()', () => {
    setPlatform(fake);
    expect(platform().appVersion()).toBe('9.9.9');
  });
});
