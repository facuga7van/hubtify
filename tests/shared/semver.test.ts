import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../../src/shared/semver';

describe('isNewerVersion(a, b): a > b', () => {
  it('compara por componente numérico, no lexicográficamente', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.8.2', '0.8.10')).toBe(false);
  });

  it('igual no es más nueva', () => {
    expect(isNewerVersion('0.8.2', '0.8.2')).toBe(false);
  });

  it('componentes faltantes cuentan como 0', () => {
    expect(isNewerVersion('1.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1', '1.0.0')).toBe(false);
  });
});
