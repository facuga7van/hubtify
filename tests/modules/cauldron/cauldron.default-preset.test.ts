/**
 * De qué receta arranca el caldero, visto desde el renderer.
 *
 * `cauldron:getPresets` ordena `is_default DESC, name ASC`, así que el `p[0]`
 * que usaban `CauldronPage` y `CauldronDashboardWidget` era SIEMPRE «Classic».
 * En la base real del usuario eso convertía al default en el valor menos
 * frecuente: 30 de sus 41 sesiones son de una receta propia (16 de las últimas
 * 20) y el caldero abría igual en la clásica todas las veces.
 *
 * `rememberLastPreset` ya guardaba la elección desde hacía tiempo — nadie la
 * leía en estas dos superficies.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// El módulo importa `react-i18next` para los hooks de nombres; nada de eso hace
// falta acá y en `node` no hay React DOM que montar.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d: string) => d, i18n: { language: 'es' } }) }));

const store = new Map<string, string>();

function stubEnv(lastUsed?: { presetId: string | null; sampleSize: number } | Error) {
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const api: Record<string, unknown> = {};
  if (lastUsed !== undefined) {
    api.cauldronGetLastUsedPreset = () =>
      lastUsed instanceof Error ? Promise.reject(lastUsed) : Promise.resolve(lastUsed);
  }
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', { api, localStorage });
}

const PRESETS = [
  // Tal como los devuelve el handler: los `is_default` primero, alfabéticos.
  { id: 'preset-classic' },
  { id: 'preset-long-focus' },
  { id: 'propia' },
];

beforeEach(() => { store.clear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('resolveDefaultPresetId', () => {
  it('sin recetas no devuelve nada', async () => {
    stubEnv({ presetId: 'propia', sampleSize: 5 });
    const { resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    expect(await resolveDefaultPresetId([])).toBeNull();
  });

  it('la recordada en este dispositivo gana sobre la primera de la lista', async () => {
    stubEnv();
    const { rememberLastPreset, resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    rememberLastPreset('propia');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('propia');
  });

  it('la recordada gana incluso sobre lo que dice el historial', async () => {
    stubEnv({ presetId: 'preset-long-focus', sampleSize: 40 });
    const { rememberLastPreset, resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    rememberLastPreset('propia');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('propia');
  });

  it('sin nada local usa el historial, que sí cruza al teléfono', async () => {
    stubEnv({ presetId: 'propia', sampleSize: 41 });
    const { resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('propia');
  });

  it('descarta lo recordado si esa receta ya no existe', async () => {
    stubEnv({ presetId: 'propia', sampleSize: 41 });
    const { rememberLastPreset, resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    rememberLastPreset('borrada-por-sync');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('propia');
  });

  it('descarta lo que dice el historial si esa receta ya no existe', async () => {
    stubEnv({ presetId: 'fantasma', sampleSize: 3 });
    const { resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('preset-classic');
  });

  it('sin historial cae en la primera de la lista, como antes', async () => {
    stubEnv({ presetId: null, sampleSize: 0 });
    const { resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('preset-classic');
  });

  it('en un binding viejo, sin el canal, se comporta como antes', async () => {
    stubEnv(); // sin `cauldronGetLastUsedPreset`
    const { resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('preset-classic');
  });

  it('un handler que revienta no rompe el arranque', async () => {
    stubEnv(new Error('boom'));
    const { resolveDefaultPresetId } = await import('../../../src/modules/cauldron/hooks');
    expect(await resolveDefaultPresetId(PRESETS)).toBe('preset-classic');
  });
});

describe('quickStartPresetId sigue siendo síncrono y no cambió', () => {
  it('devuelve la recordada, o la primera', async () => {
    stubEnv();
    const { rememberLastPreset, quickStartPresetId } = await import('../../../src/modules/cauldron/hooks');
    expect(quickStartPresetId(PRESETS)).toBe('preset-classic');
    rememberLastPreset('propia');
    expect(quickStartPresetId(PRESETS)).toBe('propia');
    expect(quickStartPresetId([])).toBeNull();
  });
});
