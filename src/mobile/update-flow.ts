/**
 * Máquina de estados PURA del in-app update de Android (sin Capacitor/DOM,
 * testeable en Node). AndroidUpdateBanner.tsx es la única que la conecta con
 * el mundo real (updater.ts para el chequeo, apk-downloader.ts para la
 * descarga, apk-installer.ts para el intent de instalación).
 *
 *   idle → available(version,size,url) → downloading(pct) → downloaded(path)
 *        → installing
 *   downloading puede cancelarse (vuelve a idle) o fallar (→ error).
 *   error retiene version/size/url cuando los tiene, para que RETRY reintente
 *   sin depender de un nuevo chequeo a GitHub.
 *
 * El discriminante de los eventos se llama `kind` (no `type`) a propósito:
 * `tests/ipc/rpg-event-labels.test.ts` escanea src/ y electron/ buscando
 * líneas con `type:` seguidas de un literal MAYÚSCULA_CON_GUIONES y exige
 * traducción en `src/i18n/*.json` — son eventos de otro sistema (la Crónica
 * del RPG), sin relación con esta máquina de estados.
 */

export type UpdateFlowState =
  | { status: 'idle' }
  | { status: 'available'; version: string; size: number; url: string }
  | { status: 'downloading'; version: string; size: number; url: string; pct: number }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'installing'; version: string; path: string }
  | { status: 'error'; reason: string; version?: string; size?: number; url?: string };

export type UpdateFlowEvent =
  | { kind: 'AVAILABLE'; version: string; size: number; url: string }
  | { kind: 'START_DOWNLOAD' }
  | { kind: 'PROGRESS'; bytes: number }
  | { kind: 'DOWNLOADED'; path: string; actualSize: number }
  | { kind: 'CANCEL' }
  | { kind: 'INSTALL' }
  | { kind: 'INSTALL_CANCELLED' }
  | { kind: 'INSTALL_FAILED'; reason: string }
  | { kind: 'ERROR'; reason: string }
  | { kind: 'RETRY' }
  | { kind: 'DISMISS' };

export const initialUpdateFlowState: UpdateFlowState = { status: 'idle' };

/** `bytes`/`size` → 0-100, saturado a los bordes; sin dividir por cero. */
export function progressPercent(bytes: number, size: number): number {
  if (!(size > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((bytes / size) * 100)));
}

export function updateFlowReducer(state: UpdateFlowState, event: UpdateFlowEvent): UpdateFlowState {
  switch (event.kind) {
    case 'AVAILABLE':
      // Ya hay uno en curso (o error de uno) — no lo pisa.
      if (state.status !== 'idle') return state;
      return { status: 'available', version: event.version, size: event.size, url: event.url };

    case 'START_DOWNLOAD':
      if (state.status !== 'available') return state;
      return { status: 'downloading', version: state.version, size: state.size, url: state.url, pct: 0 };

    case 'PROGRESS':
      if (state.status !== 'downloading') return state;
      return { ...state, pct: progressPercent(event.bytes, state.size) };

    case 'DOWNLOADED':
      if (state.status !== 'downloading') return state;
      if (event.actualSize !== state.size) {
        return {
          status: 'error', reason: 'size_mismatch',
          version: state.version, size: state.size, url: state.url,
        };
      }
      return { status: 'downloaded', version: state.version, path: event.path };

    case 'CANCEL':
      if (state.status !== 'downloading') return state;
      return { status: 'idle' };

    case 'INSTALL':
      if (state.status !== 'downloaded') return state;
      return { status: 'installing', version: state.version, path: state.path };

    case 'INSTALL_CANCELLED':
      // La app volvió a foreground mientras estaba en 'installing' — el
      // usuario cerró la hoja del instalador del sistema sin confirmar (o
      // Android simplemente nos pausó). El APK sigue ahí: se puede reintentar
      // sin volver a descargar.
      if (state.status !== 'installing') return state;
      return { status: 'downloaded', version: state.version, path: state.path };

    case 'INSTALL_FAILED':
      if (state.status !== 'installing') return state;
      return { status: 'error', reason: event.reason };

    case 'ERROR':
      // Puede llegar desde cualquier estado (fallo de red al descargar, etc.)
      // — retiene version/size/url si el estado previo los tenía, para RETRY.
      if (state.status === 'downloading' || state.status === 'error') {
        return { status: 'error', reason: event.reason, version: state.version, size: state.size, url: state.url };
      }
      return { status: 'error', reason: event.reason };

    case 'RETRY':
      if (state.status !== 'error' || !state.version || !state.size || !state.url) return { status: 'idle' };
      return { status: 'available', version: state.version, size: state.size, url: state.url };

    case 'DISMISS':
      return { status: 'idle' };

    default:
      return state;
  }
}
