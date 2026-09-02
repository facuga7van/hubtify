/**
 * Helpers puros del lado UI del PlatformPort (platform-host.ts) y del backup
 * `.db` (backup.ts). Sin DOM ni Capacitor: se testean en Node.
 */
import type { FileFilter } from '@logic/platform';

/** `Filesystem.writeFile` sin `encoding` exige base64 (doc del plugin). */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // String.fromCharCode con más argumentos revienta la pila
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Lista `accept` de `<input type="file">` a partir de los FileFilter de Electron. `*` → sin filtro. */
export function acceptFor(filters: FileFilter[]): string {
  const exts = new Set<string>();
  for (const filter of filters) {
    for (const ext of filter.extensions) {
      const clean = ext.replace(/^\*?\.?/, '').trim().toLowerCase();
      if (clean && clean !== '*') exts.add(`.${clean}`);
    }
  }
  return [...exts].join(',');
}

const SQLITE_HEADER = 'SQLite format 3\0';

/** Los primeros 16 bytes de todo archivo SQLite 3 (https://sqlite.org/fileformat.html). */
export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false; // la cabecera completa ocupa 100 bytes
  for (let i = 0; i < SQLITE_HEADER.length; i++) {
    if (bytes[i] !== SQLITE_HEADER.charCodeAt(i)) return false;
  }
  return true;
}

/** Android exige `id` int32. Con tag: hash estable (FNV-1a) en [2^30, 2^31). Sin tag: secuencia en [1, 2^30). */
const TAGGED_BASE = 0x40000000;
let untaggedSeq = Date.now() % 1_000_000;

export function notificationIdFor(tag?: string): number {
  if (tag) {
    let h = 0x811c9dc5;
    for (let i = 0; i < tag.length; i++) {
      h ^= tag.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return TAGGED_BASE + (h % TAGGED_BASE);
  }
  untaggedSeq = (untaggedSeq + 1) % TAGGED_BASE;
  return untaggedSeq || 1;
}
