import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    createChannel: vi.fn(async () => undefined),
    schedule: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(async () => undefined),
    removeDeliveredNotificationsById: vi.fn(async () => undefined),
    checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: 'denied' })),
    changeExactNotificationSetting: vi.fn(async () => ({ exact_alarm: 'granted' })),
  },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn(async () => ({ uri: 'file:///cache/share/x' })),
    deleteFile: vi.fn(async () => undefined),
  },
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
import { createPlatformHost, NOTIFICATION_CHANNEL_ID, ONGOING_CHANNEL_ID, readOsInfo } from '../../src/mobile/platform-host';
import { notificationIdFor } from '../../src/mobile/host-utils';
import type { NotificationPlan } from '../../shared-logic/platform';

const m = vi.mocked;

function host(file: File | null = null) {
  return createPlatformHost({ pickFile: vi.fn(async () => file) });
}

beforeEach(() => {
  vi.clearAllMocks();
  m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'prompt' });
  m(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' });
  m(LocalNotifications.checkExactNotificationSetting).mockResolvedValue({ exact_alarm: 'denied' });
});

describe('notify', () => {
  it('pide permiso la primera vez, crea el canal una sola vez y programa al instante', async () => {
    const h = host();
    await h.notify({ title: 'T', body: 'B', tag: 'streak' });
    await h.notify({ title: 'T2', body: 'B2', tag: 'streak' });
    expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    // Dos canales, una sola vez: el normal (importancia 4) y el del aviso
    // persistente del Caldero (importancia 2, sin sonido ni heads-up).
    expect(LocalNotifications.createChannel).toHaveBeenCalledTimes(2);
    expect(LocalNotifications.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: NOTIFICATION_CHANNEL_ID, name: 'Hubtify' }));
    expect(LocalNotifications.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: ONGOING_CHANNEL_ID, importance: 2 }));
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

  // Los callers son fire-and-forget (`void platform().notify(...)` en
  // notifications.ipc.ts y cauldron.ipc.ts): un reject acá sería un unhandled
  // rejection que tumba el worker, y una notificación no vale eso.
  it('nunca rechaza: un plugin que lanza queda en un warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m(LocalNotifications.schedule).mockRejectedValueOnce(new Error('no channel'));
    await expect(host().notify({ title: 'T', body: 'B' })).resolves.toBeUndefined();
    m(LocalNotifications.checkPermissions).mockRejectedValueOnce(new Error('bridge down'));
    await expect(host().notify({ title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
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

  // Cache/share es el staging del share sheet: una vez que el destino copió el
  // archivo, dejarlo ahí sería un .db entero (o un CSV) acumulándose en disco.
  it('borra el archivo de staging después de compartir, también si se cancela o falla', async () => {
    const del = { path: 'share/x.csv', directory: 'CACHE' };
    await host().saveTextFile('x.csv', '');
    expect(Filesystem.deleteFile).toHaveBeenCalledWith(del);

    m(Share.share).mockRejectedValueOnce(new Error('Share canceled'));
    await expect(host().saveTextFile('x.csv', '')).resolves.toBe(false);
    expect(Filesystem.deleteFile).toHaveBeenCalledTimes(2);

    m(Share.share).mockRejectedValueOnce(new Error('No activity found'));
    await expect(host().saveTextFile('x.csv', '')).rejects.toThrow('No activity found');
    expect(Filesystem.deleteFile).toHaveBeenCalledTimes(3);
  });

  it('si el borrado del staging falla, el share igual cuenta como hecho', async () => {
    m(Filesystem.deleteFile).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(host().saveTextFile('x.csv', '')).resolves.toBe(true);
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

  // Android SÍ lee PDF: `pdfjs-dist` corre en el WebView y `getTextContent()`
  // no necesita canvas. La extracción real se prueba en `tests/mobile/pdf-text`
  // (`joinTextItems`, que es la parte que puede romper el parser line-based);
  // acá se fija el CONTRATO del host, que es lo que ve `finance-import`.
  it('pickPdfText → null si se cancela el selector', async () => {
    await expect(host(null).pickPdfText()).resolves.toBeNull();
  });

  it('pickPdfText → unsupported si el PDF no tiene capa de texto o pdfjs falla', async () => {
    // Un escaneo o una foto: no es un error, pero no hay nada que parsear. Y
    // cualquier falla de pdfjs (worker que no resuelve, CSP) cae en la misma
    // rama: el peor caso es exactamente el comportamiento anterior.
    const file = new File([new Uint8Array([1, 2, 3])], 'escaneo.pdf', { type: 'application/pdf' });
    await expect(host(file).pickPdfText()).resolves.toEqual({ unsupported: true });
  });

  it('pickPdfText pide el accept de PDF al selector', async () => {
    const pick = vi.fn(async () => null);
    const h = createPlatformHost({ pickFile: pick });
    await h.pickPdfText();
    expect(pick).toHaveBeenCalledWith('application/pdf,.pdf');
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

/**
 * Avisos con la app cerrada (spec §12 Fase 6). Acá se prueba la EJECUCIÓN del
 * plan contra el plugin; qué entra en el plan se prueba en
 * tests/shared-logic/notification-schedule.test.ts.
 */
describe('applyNotificationPlan', () => {
  const plan = (over: Partial<NotificationPlan> = {}): NotificationPlan => ({
    scope: 'cauldron',
    owned: ['cauldron:end', 'cauldron:ongoing'],
    ownedPersistent: ['cauldron:ongoing'],
    schedule: [],
    ...over,
  });

  it('programa la alarma de fin: con `at`, allowWhileIdle e inexacta si no hay permiso', async () => {
    m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    const at = Date.UTC(2026, 8, 2, 15, 25);
    await host().applyNotificationPlan(plan({
      schedule: [{ tag: 'cauldron:end', title: 'Poción', body: 'Ciclo 2/4', at }],
    }));

    const sent = m(LocalNotifications.schedule).mock.calls[0][0].notifications[0];
    expect(sent).toMatchObject({
      id: notificationIdFor('cauldron:end'),
      title: 'Poción',
      channelId: NOTIFICATION_CHANNEL_ID,
      // `allowWhileIdle` no es opcional: sin él el plugin usa AlarmManager.set(RTC),
      // que no despierta el equipo y en Doze puede esperar horas.
      schedule: { at: new Date(at), allowWhileIdle: true },
      // Inexacta a propósito: pedir la exacta implícitamente ABRE la pantalla de
      // sistema y deja esta promesa colgada.
      isExactNotification: false,
    });
    expect(LocalNotifications.changeExactNotificationSetting).not.toHaveBeenCalled();
  });

  it('si SCHEDULE_EXACT_ALARM ya está concedido, la alarma va exacta', async () => {
    m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    m(LocalNotifications.checkExactNotificationSetting).mockResolvedValue({ exact_alarm: 'granted' });
    await host().applyNotificationPlan(plan({
      schedule: [{ tag: 'cauldron:end', title: 'T', body: 'B', at: Date.now() + 60_000 }],
    }));
    expect(m(LocalNotifications.schedule).mock.calls[0][0].notifications[0].isExactNotification).toBe(true);
  });

  it('el aviso persistente va al canal silencioso, sin alarma y sin autoCancel', async () => {
    m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    await host().applyNotificationPlan(plan({
      schedule: [{ tag: 'cauldron:ongoing', title: 'Enfoque', body: 'Termina a las 15:25', ongoing: true }],
    }));
    const sent = m(LocalNotifications.schedule).mock.calls[0][0].notifications[0];
    expect(sent).toMatchObject({ channelId: ONGOING_CHANNEL_ID, ongoing: true, autoCancel: false, isExactNotification: false });
    expect(sent).not.toHaveProperty('schedule');
    // Sin `at` no hay alarma que pueda ser exacta: ni se consulta el permiso.
    expect(LocalNotifications.checkExactNotificationSetting).not.toHaveBeenCalled();
  });

  it('lo gobernado que no está en el plan se cancela; el persistente además se baja de la bandeja', async () => {
    await host().applyNotificationPlan(plan()); // plan vacío = detener/pausar
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: notificationIdFor('cauldron:end') }, { id: notificationIdFor('cauldron:ongoing') }],
    });
    // `cancel()` no baja una notificación YA publicada (solo la marca en su
    // storage): el `ongoing` hay que retirarlo aparte.
    expect(LocalNotifications.removeDeliveredNotificationsById).toHaveBeenCalledWith({
      ids: [notificationIdFor('cauldron:ongoing')],
    });
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });

  it('un plan que solo cancela NO dispara el diálogo de permisos', async () => {
    await host().applyNotificationPlan(plan());
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(LocalNotifications.createChannel).not.toHaveBeenCalled();
  });

  it('no cancela lo que sigue vivo: el diff es por id, no por ámbito', async () => {
    m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    await host().applyNotificationPlan(plan({
      schedule: [{ tag: 'cauldron:end', title: 'T', body: 'B', at: Date.now() + 60_000 }],
    }));
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: notificationIdFor('cauldron:ongoing') }],
    });
  });

  it('sin permiso de notificaciones no programa, pero igual cancela', async () => {
    m(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'denied' });
    await host().applyNotificationPlan(plan({
      schedule: [{ tag: 'cauldron:end', title: 'T', body: 'B', at: Date.now() + 60_000 }],
    }));
    expect(LocalNotifications.cancel).toHaveBeenCalled();
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });

  it('nunca rechaza: un plugin que lanza queda en un warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m(LocalNotifications.cancel).mockRejectedValueOnce(new Error('bridge down'));
    await expect(host().applyNotificationPlan(plan())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('exactAlarmState lee el ajuste; requestExactAlarms abre la pantalla de sistema', async () => {
    const h = host();
    await expect(h.exactAlarmState()).resolves.toBe('denied');
    await expect(h.requestExactAlarms()).resolves.toBe('granted');
    expect(LocalNotifications.changeExactNotificationSetting).toHaveBeenCalledTimes(1);
  });
});
