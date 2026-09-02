import { describe, it, expect } from 'vitest';
import { shellKindFor, MOBILE_SHELL_MAX_WIDTH } from '../../src/hub/useShellKind';

describe('shellKindFor (spec §7: isNativeMobile() || viewport < 600)', () => {
  it('con bridge nativo es mobile sin importar el ancho', () => {
    expect(shellKindFor(true, 1920)).toBe('mobile');
  });

  it('en escritorio, de 600 para arriba es desktop', () => {
    expect(shellKindFor(false, 700)).toBe('desktop');
    expect(shellKindFor(false, MOBILE_SHELL_MAX_WIDTH)).toBe('desktop');
  });

  it('en escritorio, por debajo de 600 es mobile', () => {
    expect(shellKindFor(false, MOBILE_SHELL_MAX_WIDTH - 1)).toBe('mobile');
  });
});
