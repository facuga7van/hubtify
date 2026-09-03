import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  shown: [] as Array<{ title: string; body: string }>,
  clickHandlers: [] as Array<() => void>,
  focused: 0,
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  written: [] as Array<{ path: string; data: unknown }>,
  sent: [] as Array<{ channel: string; args: unknown[] }>,
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.8.2' },
  shell: { openExternal: vi.fn(async () => undefined) },
  dialog: { showSaveDialog: h.saveDialog, showOpenDialog: h.openDialog },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [{
      isMinimized: () => false,
      restore: () => undefined,
      show: () => { h.focused++; },
      focus: () => undefined,
      webContents: { send: (channel: string, ...args: unknown[]) => h.sent.push({ channel, args }) },
    }],
  },
  Notification: Object.assign(
    class {
      constructor(private opts: { title: string; body: string }) {}
      on(_ev: string, cb: () => void) { h.clickHandlers.push(cb); }
      show() { h.shown.push(this.opts); }
    },
    { isSupported: () => true },
  ),
}));

vi.mock('fs', () => ({
  default: {
    writeFileSync: (path: string, data: unknown) => { h.written.push({ path, data }); },
    // Mirrors fs: a string encoding returns a string, no encoding returns a Buffer.
    readFileSync: (_p: string, enc?: string) => (enc ? 'hello' : Buffer.from('hello')),
  },
}));

const { electronPlatform, webContentsSink } = await import('../../electron/platform');

beforeEach(() => {
  h.shown.length = 0; h.clickHandlers.length = 0; h.focused = 0;
  h.written.length = 0; h.sent.length = 0;
  h.saveDialog.mockReset(); h.openDialog.mockReset();
});

describe('electronPlatform', () => {
  it('reports app version and OS', () => {
    expect(electronPlatform.appVersion()).toBe('0.8.2');
    expect(electronPlatform.osInfo()).toMatch(new RegExp(`^${process.platform} `));
  });

  it('notify shows a native notification whose click focuses the main window', async () => {
    await electronPlatform.notify({ title: 'T', body: 'B' });
    expect(h.shown).toEqual([{ title: 'T', body: 'B' }]);
    h.clickHandlers[0]();
    expect(h.focused).toBe(1);
  });

  it('saveTextFile writes when the user picks a path and returns false on cancel', async () => {
    h.saveDialog.mockResolvedValueOnce({ canceled: false, filePath: 'C:/tmp/coinify-2026-09.csv' });
    expect(await electronPlatform.saveTextFile('coinify-2026-09.csv', 'a,b')).toBe(true);
    expect(h.written).toEqual([{ path: 'C:/tmp/coinify-2026-09.csv', data: 'a,b' }]);

    h.saveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    expect(await electronPlatform.saveTextFile('x.csv', '')).toBe(false);
  });

  it('pickPdfText returns null when the dialog is cancelled', async () => {
    h.openDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await electronPlatform.pickPdfText()).toBeNull();
  });

  it('pickTextFile returns name + content', async () => {
    h.openDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:/tmp/notes.txt'] });
    expect(await electronPlatform.pickTextFile([{ name: 'Text', extensions: ['txt'] }]))
      .toEqual({ name: 'notes.txt', content: 'hello' });
  });
});

describe('webContentsSink', () => {
  it('sends to every window, omitting the payload argument when undefined', () => {
    webContentsSink('rpg:pardonUsed');
    webContentsSink('cauldron:tick', { status: 'work' });
    expect(h.sent).toEqual([
      { channel: 'rpg:pardonUsed', args: [] },
      { channel: 'cauldron:tick', args: [{ status: 'work' }] },
    ]);
  });
});

describe('avisos programados', () => {
  // El escritorio no programa NADA para el sistema: el proceso principal no se
  // congela y sus notificaciones salen por `notify()` en el momento. La ausencia
  // del método es la señal — `schedulingSupported()` la lee y ni calcula el plan.
  it('el port de escritorio NO implementa applyNotificationPlan', () => {
    expect(electronPlatform.applyNotificationPlan).toBeUndefined();
    expect(electronPlatform.exactAlarmState).toBeUndefined();
    expect(electronPlatform.requestExactAlarms).toBeUndefined();
  });
});
