import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The dashboard's empty state asks a widget to open its form. If the bus loses
 * a message the button looks broken, so the routing (only the addressed widget
 * reacts) and the unsubscribe are worth a test.
 */

let requestQuickCreate: typeof import('../../src/hub/widgets/quick-create')['requestQuickCreate'];
let subscribeQuickCreate: typeof import('../../src/hub/widgets/quick-create')['subscribeQuickCreate'];
let revealWidget: typeof import('../../src/hub/widgets/quick-create')['revealWidget'];

const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = new EventTarget();
  vi.resetModules();
  const mod = await import('../../src/hub/widgets/quick-create');
  requestQuickCreate = mod.requestQuickCreate;
  subscribeQuickCreate = mod.subscribeQuickCreate;
  revealWidget = mod.revealWidget;
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe('quick-create bus', () => {
  it('only the addressed widget reacts', () => {
    const quest = vi.fn();
    const habit = vi.fn();
    subscribeQuickCreate('quest', quest);
    subscribeQuickCreate('habit', habit);

    requestQuickCreate('quest');

    expect(quest).toHaveBeenCalledTimes(1);
    expect(habit).not.toHaveBeenCalled();
  });

  it('stops listening after unsubscribing', () => {
    const seen = vi.fn();
    const off = subscribeQuickCreate('meal', seen);
    requestQuickCreate('meal');
    off();
    requestQuickCreate('meal');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('ignores a request with no target', () => {
    const seen = vi.fn();
    subscribeQuickCreate('expense', seen);
    (globalThis.window as EventTarget).dispatchEvent(new CustomEvent('hub:quickCreate'));
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('revealWidget', () => {
  it('does nothing without a node', () => {
    expect(() => revealWidget(null)).not.toThrow();
  });

  it('falls back to the argument-less scrollIntoView', () => {
    const calls: unknown[] = [];
    const node = {
      scrollIntoView: (opts?: unknown) => {
        calls.push(opts);
        if (opts) throw new TypeError('no options here');
      },
    } as unknown as HTMLElement;
    revealWidget(node);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBeUndefined();
  });
});
