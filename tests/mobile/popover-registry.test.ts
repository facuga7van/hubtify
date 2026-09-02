import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerOpenPopover,
  hasOpenPopover,
  closeTopPopover,
  resetPopoverRegistry,
} from '../../src/shared/popover-registry';
import { handleBackButton, type BackContext } from '../../src/mobile/back-button';

beforeEach(() => resetPopoverRegistry());

describe('popover-registry', () => {
  it('vacío: no hay popover y cerrar no hace nada', () => {
    expect(hasOpenPopover()).toBe(false);
    expect(closeTopPopover()).toBe(false);
  });

  it('cierra el más reciente primero (pila) y lo desanota; desanotar saca solo el suyo', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerOpenPopover(a);
    registerOpenPopover(b);
    expect(hasOpenPopover()).toBe(true);

    expect(closeTopPopover()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    // b ya no está: un callback que no cerrara nada no traba el botón atrás.
    expect(hasOpenPopover()).toBe(true);
    offA();
    expect(hasOpenPopover()).toBe(false);
  });

  it('desanotar dos veces es inocuo', () => {
    const off = registerOpenPopover(vi.fn());
    off();
    off();
    expect(hasOpenPopover()).toBe(false);
  });
});

/* Lo que cablea native-shell.ts: el contexto del botón atrás se arma desde la
   pila de popovers y el DOM. Acá el «menú» es un estado que su callback de
   cierre apaga, como setOpen(false) en un menú de fila. */
describe('botón atrás con un menú de fila abierto (GEN-01)', () => {
  function makeMenu() {
    let open = true;
    registerOpenPopover(() => { open = false; });
    return { isOpen: () => open };
  }

  function ctx(over: Partial<BackContext> = {}): BackContext {
    return {
      openPopover: hasOpenPopover(),
      closePopover: () => { closeTopPopover(); },
      openDialog: false,
      closeDialog: vi.fn(),
      canGoBack: true,
      goBack: vi.fn(),
      minimize: vi.fn(),
      ...over,
    };
  }

  it('el primer Atrás cierra el menú y NO navega; el segundo navega', () => {
    const menu = makeMenu();
    const first = ctx();
    expect(handleBackButton(first)).toBe('popover');
    expect(menu.isOpen()).toBe(false);
    expect(first.goBack).not.toHaveBeenCalled();

    const second = ctx();
    expect(second.openPopover).toBe(false);
    expect(handleBackButton(second)).toBe('history');
    expect(second.goBack).toHaveBeenCalledTimes(1);
  });

  it('menú abierto DENTRO de un modal: Atrás cierra el menú y deja el modal', () => {
    const menu = makeMenu();
    const c = ctx({ openDialog: true });
    expect(handleBackButton(c)).toBe('popover');
    expect(menu.isOpen()).toBe(false);
    expect(c.closeDialog).not.toHaveBeenCalled();
    expect(c.goBack).not.toHaveBeenCalled();
  });
});
