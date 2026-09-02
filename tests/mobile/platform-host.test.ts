import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    createChannel: vi.fn(async () => undefined),
    schedule: vi.fn(async () => ({ notifications: [] })),
  },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: vi.fn(async () => ({ uri: 'file:///cache/share/x' })) },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => ({ activityType: 'com.x' })) } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => undefined) } }));
vi.mock('@capacitor/device', () => ({ Device: { getInfo: vi.fn(async () => ({ platform: 'android', osVersion: '14' })) } }));

import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';
import { createPlatformHost, NOTIFICATION_CHANNEL_ID, readOsInfo } from '../../src/mobile/platform-host';

const m = vi.mocked;

function host(file: File | null = null) {
  return createPlatformHost({ pickFile: vi.fn(async () => file) });
}

beforeEach(() => {
  vi.clearAllMocks();
  m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'prompt' });
  m(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' });
});

describe('notify', () => {
  it('pide permiso la primera vez, crea el canal una sola vez y programa al instante', async () => {
    const h = host();
    await h.notify({ title: 'T', body: 'B', tag: 'streak' });
    await h.notify({ title: 'T2', body: 'B2', tag: 'streak' });
    expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(LocalNotifications.createChannel).toHaveBeenCalledTimes(1);
    expect(LocalNotifications.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: NOTIFICATION_CHANNEL_ID, name: 'Hubtify' }));
    const calls = m(LocalNotifications.schedule).mock.calls;
    expect(calls).toHaveLength(2);
    const [first, second] = calls.map((c) => c[0].notifications[0]);
    // `isExactNotification: false` es obligatorio: es `true` por defecto y el
    // plugin, en Android 12+ y sin SCHEDULE_EXACT_ALARM, abre la pantalla de
    // sistema «Alarmas y recordatorios» en vez de notificar. Ninguna
    // notificación de Hubtify usa alarma: todas son inmediatas.
    expect(first).toEqual({ id: expect.any(Number), title: 'T', body: 'B', channelId: NOTIFICATION_CHANNEL_ID, isExactNotification: false });
    expect(first.id).toBe(second.id); // mismo tag → reemplaza
    expect(first).not.toHaveProperty('schedule');
  });

  it('con permiso ya concedido no vuelve a pedirlo', async () => {
    m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    await host().notify({ title: 'T', body: 'B' });
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1);
  });

  it('permiso denegado: no programa y no insiste en la misma sesión', async () => {
    m(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'denied' });
    const h = host();
    await h.notify({ title: 'T', body: 'B' });
    await h.notify({ title: 'T', body: 'B' });
    expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });
});

describe('archivos', () => {
  it('saveTextFile escribe UTF-8 en Cache/share y comparte el uri', async () => {
    await expect(host().saveTextFile('coinify-2026-09.csv', 'a,b')).resolves.toBe(true);
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: 'share/coinify-2026-09.csv', data: 'a,b', directory: 'CACHE', encoding: 'utf8', recursive: true,
    });
    expect(Share.share).toHaveBeenCalledWith({ title: 'coinify-2026-09.csv', files: ['file:///cache/share/x'], dialogTitle: 'coinify-2026-09.csv' });
  });

  it('saveBinaryFile escribe base64 sin encoding', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    await expect(host().saveBinaryFile('hubtify.db', bytes)).resolves.toBe(true);
    const opts = m(Filesystem.writeFile).mock.calls[0][0];
    expect(opts).toMatchObject({ path: 'share/hubtify.db', data: Buffer.from(bytes).toString('base64'), directory: 'CACHE' });
    expect(opts).not.toHaveProperty('encoding');
  });

  it('share cancelado → false; otro error → lanza', async () => {
    m(Share.share).mockRejectedValueOnce(new Error('Share canceled'));
    await expect(host().saveTextFile('x.csv', '')).resolves.toBe(false);
    m(Share.share).mockRejectedValueOnce(new Error('No activity found'));
    await expect(host().saveTextFile('x.csv', '')).rejects.toThrow('No activity found');
  });

  it('pickTextFile → { name, content } con el accept de los filtros; null si cancela', async () => {
    const file = new File(['a,b\n1,2'], 'mov.csv', { type: 'text/csv' });
    const pick = vi.fn(async () => file);
    const h = createPlatformHost({ pickFile: pick });
    await expect(h.pickTextFile([{ name: 'CSV', extensions: ['csv'] }])).resolves.toEqual({ name: 'mov.csv', content: 'a,b\n1,2' });
    expect(pick).toHaveBeenCalledWith('.csv');
    await expect(host(null).pickTextFile([])).resolves.toBeNull();
  });

  it('pickBinaryFile → bytes como Uint8Array', async () => {
    const file = new File([new Uint8Array([9, 8, 7])], 'x.db');
    const r = await host(file).pickBinaryFile([{ name: 'DB', extensions: ['*'] }]);
    expect(r?.name).toBe('x.db');
    expect(Array.from(r!.bytes)).toEqual([9, 8, 7]);
  });

  it('pickPdfText → unsupported (sin pdf-parse en Android)', async () => {
    await expect(host().pickPdfText()).resolves.toEqual({ unsupported: true });
  });
});

describe('otros', () => {
  it('openExternal abre el navegador del sistema', async () => {
    await host().openExternal('https://example.com');
    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://example.com' });
  });

  it('readOsInfo', async () => {
    await expect(readOsInfo()).resolves.toBe('android 14');
  });
});
