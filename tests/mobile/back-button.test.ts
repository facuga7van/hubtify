import { describe, it, expect, vi } from 'vitest';
import { handleBackButton, type BackContext } from '../../src/mobile/back-button';

function ctx(over: Partial<BackContext> = {}): BackContext {
  return {
    openPopover: false,
    closePopover: vi.fn(),
    openDialog: false,
    closeDialog: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
    minimize: vi.fn(),
    ...over,
  };
}

describe('handleBackButton (spec §7)', () => {
  it('con un popover abierto lo cierra antes que nada: ni diálogo ni historial', () => {
    const c = ctx({ openPopover: true, openDialog: true, canGoBack: true });
    expect(handleBackButton(c)).toBe('popover');
    expect(c.closePopover).toHaveBeenCalledTimes(1);
    expect(c.closeDialog).not.toHaveBeenCalled();
    expect(c.goBack).not.toHaveBeenCalled();
    expect(c.minimize).not.toHaveBeenCalled();
  });

  it('con un diálogo abierto lo cierra y no navega', () => {
    const c = ctx({ openDialog: true, canGoBack: true });
    expect(handleBackButton(c)).toBe('dialog');
    expect(c.closeDialog).toHaveBeenCalledTimes(1);
    expect(c.closePopover).not.toHaveBeenCalled();
    expect(c.goBack).not.toHaveBeenCalled();
    expect(c.minimize).not.toHaveBeenCalled();
  });

  it('sin diálogo y con historial vuelve atrás', () => {
    const c = ctx({ canGoBack: true });
    expect(handleBackButton(c)).toBe('history');
    expect(c.goBack).toHaveBeenCalledTimes(1);
    expect(c.minimize).not.toHaveBeenCalled();
  });

  it('en la raíz minimiza la app', () => {
    const c = ctx();
    expect(handleBackButton(c)).toBe('minimize');
    expect(c.minimize).toHaveBeenCalledTimes(1);
    expect(c.goBack).not.toHaveBeenCalled();
  });
});
