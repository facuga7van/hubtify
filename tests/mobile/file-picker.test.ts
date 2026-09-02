import { describe, it, expect, vi } from 'vitest';
import { FOCUS_CANCEL_GRACE_MS, pickFile, type PickerEnv, type PickerInput } from '../../src/mobile/file-picker';

function makeEnv() {
  const listeners = new Map<string, () => void>();
  const input: PickerInput & { removed: boolean } = {
    type: '', accept: '', hidden: false, files: null, removed: false,
    click: vi.fn(),
    addEventListener: (type, l) => { listeners.set(type, l); },
    remove() { this.removed = true; },
  };
  let focusListener: (() => void) | null = null;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const env: PickerEnv = {
    createInput: () => input,
    mount: vi.fn(),
    onWindowFocus: (l) => { focusListener = l; return () => { focusListener = null; }; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  return { env, input, fire: (t: string) => listeners.get(t)?.(), focus: () => focusListener?.(), timers, hasFocusListener: () => focusListener !== null };
}

describe('pickFile', () => {
  it('configura y monta el input, hace click y devuelve el archivo elegido', async () => {
    const { env, input, fire } = makeEnv();
    const p = pickFile('.csv', env);
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.csv');
    expect(input.hidden).toBe(true);
    expect(env.mount).toHaveBeenCalledWith(input);
    expect(input.click).toHaveBeenCalledTimes(1);

    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' });
    input.files = [file];
    fire('change');
    await expect(p).resolves.toBe(file);
    expect(input.removed).toBe(true);
  });

  it('cancel → null', async () => {
    const { env, input, fire, hasFocusListener } = makeEnv();
    const p = pickFile('', env);
    fire('cancel');
    await expect(p).resolves.toBeNull();
    expect(input.removed).toBe(true);
    expect(hasFocusListener()).toBe(false);
  });

  it('foco recuperado sin change → null después del período de gracia', async () => {
    const { env, focus, timers } = makeEnv();
    const p = pickFile('', env);
    focus();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(FOCUS_CANCEL_GRACE_MS);
    timers[0].fn();
    await expect(p).resolves.toBeNull();
  });

  it('si change llega dentro del período de gracia gana el archivo', async () => {
    const { env, input, fire, focus, timers } = makeEnv();
    const p = pickFile('', env);
    focus();
    const file = new File(['x'], 'x.db');
    input.files = [file];
    fire('change');
    timers[0].fn(); // ya resuelto: no-op
    await expect(p).resolves.toBe(file);
  });
});
