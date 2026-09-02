import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `@capacitor/filesystem` mockeado entero: en node no hay bridge nativo. Lo
 * que se verifica acá es el CONTRATO que el downloader tiene con el plugin
 * (orden de llamadas, limpieza, verificación de tamaño), no el plugin.
 *
 * El caso que motivó este archivo: `downloadFile` NO crea el directorio padre
 * aunque se le pase `recursive: true` — en el emulador reventaba con ENOENT
 * el primer update de una instalación limpia, porque `updates/` todavía no
 * existía. El test del `mkdir` previo es la regresión de eso.
 */
const readdir = vi.fn();
const deleteFile = vi.fn();
const mkdir = vi.fn();
const downloadFile = vi.fn();
const stat = vi.fn();
const getUri = vi.fn();
const addListener = vi.fn();
const removeListener = vi.fn();

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    readdir: (...a: unknown[]) => readdir(...a),
    deleteFile: (...a: unknown[]) => deleteFile(...a),
    mkdir: (...a: unknown[]) => mkdir(...a),
    downloadFile: (...a: unknown[]) => downloadFile(...a),
    stat: (...a: unknown[]) => stat(...a),
    getUri: (...a: unknown[]) => getUri(...a),
    addListener: (...a: unknown[]) => addListener(...a),
  },
}));

import { clearOldApks, downloadApk, UPDATES_DIR } from '../../src/mobile/apk-downloader';

const URL = 'https://example.test/Hubtify-0.9.3.apk';
const APK_PATH = `${UPDATES_DIR}/Hubtify-0.9.3.apk`;

beforeEach(() => {
  readdir.mockReset().mockResolvedValue({ files: [] });
  deleteFile.mockReset().mockResolvedValue(undefined);
  mkdir.mockReset().mockResolvedValue(undefined);
  downloadFile.mockReset().mockResolvedValue({ path: APK_PATH });
  stat.mockReset().mockResolvedValue({ size: 1000 });
  getUri.mockReset().mockResolvedValue({ uri: `file:///cache/${APK_PATH}` });
  removeListener.mockReset().mockResolvedValue(undefined);
  addListener.mockReset().mockResolvedValue({ remove: removeListener });
});

describe('downloadApk', () => {
  it('crea `updates/` ANTES de descargar (downloadFile no lo crea solo)', async () => {
    await downloadApk(URL, '0.9.3', 1000, () => {}).result;

    expect(mkdir).toHaveBeenCalledWith({ path: UPDATES_DIR, directory: 'CACHE', recursive: true });
    // El orden importa: si downloadFile corre primero, es ENOENT.
    expect(mkdir.mock.invocationCallOrder[0]).toBeLessThan(downloadFile.mock.invocationCallOrder[0]);
  });

  it('un `updates/` que ya existe (mkdir rechaza) no rompe la descarga', async () => {
    mkdir.mockRejectedValue(new Error('Directory exists'));

    await expect(downloadApk(URL, '0.9.3', 1000, () => {}).result)
      .resolves.toBe(`file:///cache/${APK_PATH}`);
    expect(downloadFile).toHaveBeenCalled();
  });

  it('descarga al path versionado del cache y devuelve su file:// uri', async () => {
    await expect(downloadApk(URL, '0.9.3', 1000, () => {}).result)
      .resolves.toBe(`file:///cache/${APK_PATH}`);

    expect(downloadFile).toHaveBeenCalledWith({
      url: URL, path: APK_PATH, directory: 'CACHE', progress: true, recursive: true,
    });
  });

  it('reporta los bytes del listener `progress` y lo desengancha al terminar', async () => {
    const onProgress = vi.fn();
    addListener.mockImplementation(async (_name: string, cb: (s: { bytes: number }) => void) => {
      cb({ bytes: 450 });
      return { remove: removeListener };
    });

    await downloadApk(URL, '0.9.3', 1000, onProgress).result;

    expect(onProgress).toHaveBeenCalledWith(450);
    expect(removeListener).toHaveBeenCalled();
  });

  it('borra los APKs viejos antes de bajar el nuevo', async () => {
    readdir.mockResolvedValue({ files: [{ name: 'Hubtify-0.9.2.apk' }] });

    await downloadApk(URL, '0.9.3', 1000, () => {}).result;

    expect(deleteFile).toHaveBeenCalledWith({ path: `${UPDATES_DIR}/Hubtify-0.9.2.apk`, directory: 'CACHE' });
    expect(deleteFile.mock.invocationCallOrder[0]).toBeLessThan(downloadFile.mock.invocationCallOrder[0]);
  });

  it('tamaño final distinto al del asset → borra el archivo y falla con size_mismatch', async () => {
    stat.mockResolvedValue({ size: 900 });

    await expect(downloadApk(URL, '0.9.3', 1000, () => {}).result)
      .rejects.toThrow('size_mismatch:900:1000');
    expect(deleteFile).toHaveBeenCalledWith({ path: APK_PATH, directory: 'CACHE' });
    expect(getUri).not.toHaveBeenCalled();
  });

  it('cancel() inmediato corta antes de empezar a descargar', async () => {
    const handle = downloadApk(URL, '0.9.3', 1000, () => {});
    handle.cancel();

    await expect(handle.result).rejects.toThrow('cancelled');
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('cancel() con la descarga en curso borra el APK a medio bajar', async () => {
    let finishDownload: () => void = () => {};
    downloadFile.mockImplementation(() => new Promise<void>((resolve) => { finishDownload = resolve; }));

    const handle = downloadApk(URL, '0.9.3', 1000, () => {});
    // Deja correr clearOldApks + mkdir + addListener para llegar al downloadFile.
    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalled());

    handle.cancel();
    finishDownload(); // el fetch nativo sigue y termina: ver "límite conocido"

    await expect(handle.result).rejects.toThrow('cancelled');
    expect(deleteFile).toHaveBeenCalledWith({ path: APK_PATH, directory: 'CACHE' });
    expect(stat).not.toHaveBeenCalled(); // no se verifica el tamaño de algo cancelado
  });
});

describe('clearOldApks', () => {
  it('sin directorio `updates/` todavía → no hace nada ni lanza', async () => {
    readdir.mockRejectedValue(new Error('Folder does not exist'));

    await expect(clearOldApks()).resolves.toBeUndefined();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('un borrado que falla no impide borrar el resto', async () => {
    readdir.mockResolvedValue({ files: [{ name: 'a.apk' }, { name: 'b.apk' }] });
    deleteFile.mockRejectedValueOnce(new Error('EACCES'));

    await expect(clearOldApks()).resolves.toBeUndefined();
    expect(deleteFile).toHaveBeenCalledTimes(2);
  });
});
