import { describe, it, expect } from 'vitest';
import {
  initialUpdateFlowState, progressPercent, updateFlowReducer,
  type UpdateFlowState,
} from '../../src/mobile/update-flow';

const AVAILABLE = { kind: 'AVAILABLE', version: '0.9.3', size: 1000, url: 'https://x/Hubtify-0.9.3.apk' } as const;

describe('progressPercent', () => {
  it('bytes/size a 0-100 redondeado', () => {
    expect(progressPercent(0, 1000)).toBe(0);
    expect(progressPercent(500, 1000)).toBe(50);
    expect(progressPercent(1000, 1000)).toBe(100);
  });

  it('size 0 o negativo → 0, sin dividir por cero', () => {
    expect(progressPercent(500, 0)).toBe(0);
    expect(progressPercent(500, -1)).toBe(0);
  });

  it('satura a los bordes', () => {
    expect(progressPercent(-10, 1000)).toBe(0);
    expect(progressPercent(1200, 1000)).toBe(100);
  });
});

describe('updateFlowReducer', () => {
  it('idle -[AVAILABLE]-> available', () => {
    const s = updateFlowReducer(initialUpdateFlowState, AVAILABLE);
    expect(s).toEqual({ status: 'available', version: '0.9.3', size: 1000, url: 'https://x/Hubtify-0.9.3.apk' });
  });

  it('un AVAILABLE mientras ya hay uno en curso no lo pisa', () => {
    const downloading: UpdateFlowState = { status: 'downloading', version: '0.9.2', size: 500, url: 'u', pct: 10 };
    const s = updateFlowReducer(downloading, { kind: 'AVAILABLE', version: '0.9.4', size: 2000, url: 'v' });
    expect(s).toBe(downloading);
  });

  it('available -[START_DOWNLOAD]-> downloading en 0%', () => {
    const available = updateFlowReducer(initialUpdateFlowState, AVAILABLE);
    const s = updateFlowReducer(available, { kind: 'START_DOWNLOAD' });
    expect(s).toEqual({ status: 'downloading', version: '0.9.3', size: 1000, url: AVAILABLE.url, pct: 0 });
  });

  it('START_DOWNLOAD fuera de available es un no-op', () => {
    expect(updateFlowReducer(initialUpdateFlowState, { kind: 'START_DOWNLOAD' })).toEqual(initialUpdateFlowState);
  });

  it('downloading -[PROGRESS]-> actualiza pct', () => {
    const downloading: UpdateFlowState = { status: 'downloading', version: '0.9.3', size: 1000, url: 'u', pct: 0 };
    const s = updateFlowReducer(downloading, { kind: 'PROGRESS', bytes: 300 });
    expect(s).toEqual({ ...downloading, pct: 30 });
  });

  it('PROGRESS fuera de downloading es un no-op', () => {
    expect(updateFlowReducer(initialUpdateFlowState, { kind: 'PROGRESS', bytes: 10 })).toEqual(initialUpdateFlowState);
  });

  it('downloading -[DOWNLOADED con tamaño correcto]-> downloaded', () => {
    const downloading: UpdateFlowState = { status: 'downloading', version: '0.9.3', size: 1000, url: 'u', pct: 100 };
    const s = updateFlowReducer(downloading, { kind: 'DOWNLOADED', path: 'file:///cache/x.apk', actualSize: 1000 });
    expect(s).toEqual({ status: 'downloaded', version: '0.9.3', path: 'file:///cache/x.apk' });
  });

  it('downloading -[DOWNLOADED con tamaño distinto]-> error size_mismatch, retiene version/size/url', () => {
    const downloading: UpdateFlowState = { status: 'downloading', version: '0.9.3', size: 1000, url: 'u', pct: 100 };
    const s = updateFlowReducer(downloading, { kind: 'DOWNLOADED', path: 'file:///cache/x.apk', actualSize: 900 });
    expect(s).toEqual({ status: 'error', reason: 'size_mismatch', version: '0.9.3', size: 1000, url: 'u' });
  });

  it('cancela la descarga en curso: downloading -[CANCEL]-> idle', () => {
    const downloading: UpdateFlowState = { status: 'downloading', version: '0.9.3', size: 1000, url: 'u', pct: 40 };
    expect(updateFlowReducer(downloading, { kind: 'CANCEL' })).toEqual({ status: 'idle' });
  });

  it('CANCEL fuera de downloading es un no-op (no cancela nada ya instalado)', () => {
    const downloaded: UpdateFlowState = { status: 'downloaded', version: '0.9.3', path: 'p' };
    expect(updateFlowReducer(downloaded, { kind: 'CANCEL' })).toBe(downloaded);
  });

  it('downloaded -[INSTALL]-> installing', () => {
    const downloaded: UpdateFlowState = { status: 'downloaded', version: '0.9.3', path: 'file:///cache/x.apk' };
    expect(updateFlowReducer(downloaded, { kind: 'INSTALL' })).toEqual({ status: 'installing', version: '0.9.3', path: 'file:///cache/x.apk' });
  });

  it('installing -[INSTALL_CANCELLED]-> downloaded (el usuario volvió a la app sin confirmar la instalación)', () => {
    const installing: UpdateFlowState = { status: 'installing', version: '0.9.3', path: 'file:///cache/x.apk' };
    expect(updateFlowReducer(installing, { kind: 'INSTALL_CANCELLED' }))
      .toEqual({ status: 'downloaded', version: '0.9.3', path: 'file:///cache/x.apk' });
  });

  it('INSTALL_CANCELLED fuera de installing es un no-op', () => {
    expect(updateFlowReducer(initialUpdateFlowState, { kind: 'INSTALL_CANCELLED' })).toEqual(initialUpdateFlowState);
  });

  it('installing -[INSTALL_FAILED]-> error (sin version/size/url: no hay retry automático a available)', () => {
    const installing: UpdateFlowState = { status: 'installing', version: '0.9.3', path: 'p' };
    expect(updateFlowReducer(installing, { kind: 'INSTALL_FAILED', reason: 'plugin_unavailable' }))
      .toEqual({ status: 'error', reason: 'plugin_unavailable' });
  });

  it('ERROR durante la descarga retiene version/size/url para el retry', () => {
    const downloading: UpdateFlowState = { status: 'downloading', version: '0.9.3', size: 1000, url: 'u', pct: 40 };
    expect(updateFlowReducer(downloading, { kind: 'ERROR', reason: 'network' }))
      .toEqual({ status: 'error', reason: 'network', version: '0.9.3', size: 1000, url: 'u' });
  });

  it('error -[RETRY]-> vuelve a available con los mismos datos', () => {
    const error: UpdateFlowState = { status: 'error', reason: 'network', version: '0.9.3', size: 1000, url: 'u' };
    expect(updateFlowReducer(error, { kind: 'RETRY' })).toEqual({ status: 'available', version: '0.9.3', size: 1000, url: 'u' });
  });

  it('error sin version/size/url -[RETRY]-> idle (no hay con qué reintentar)', () => {
    const error: UpdateFlowState = { status: 'error', reason: 'plugin_unavailable' };
    expect(updateFlowReducer(error, { kind: 'RETRY' })).toEqual({ status: 'idle' });
  });

  it('DISMISS vuelve a idle desde cualquier estado', () => {
    const downloaded: UpdateFlowState = { status: 'downloaded', version: '0.9.3', path: 'p' };
    expect(updateFlowReducer(downloaded, { kind: 'DISMISS' })).toEqual({ status: 'idle' });
  });
});
