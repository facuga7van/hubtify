/**
 * Everything the business logic needs from the host OS that is NOT the
 * database. Electron implements it with `dialog`/`fs`/`Notification`
 * (electron/platform.ts); Android proxies it to the UI thread (Fase 2/5).
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Un aviso que el SISTEMA OPERATIVO tiene que entregar por su cuenta, con la
 * app cerrada o congelada. Es lo contrario de `notify()`, que solo puede salir
 * mientras nuestro código corre.
 */
export interface ScheduledNotification {
  /** Identidad estable del aviso; de acá sale el id nativo (int32). */
  tag: string;
  title: string;
  body: string;
  /** Epoch ms de entrega. Ausente = se publica YA y se queda (ver `ongoing`). */
  at?: number;
  /** Persistente y silenciosa (canal de baja importancia, no se puede deslizar). */
  ongoing?: boolean;
  /** Identidad del juego de botones. El host registra el tipo la primera vez que lo ve. */
  actionTypeId?: string;
  /**
   * Los botones, CON su texto ya traducido. Viajan en el plan y no en una
   * constante del host porque el idioma lo decide el renderer (cauldron:setLabels)
   * y el host no tiene forma de esperarlo antes de registrar el tipo.
   */
  actions?: Array<{ id: string; title: string }>;
}

/**
 * El estado COMPLETO de un ámbito de avisos programados. No es un delta: el
 * host cancela todo lo de `owned` que no esté en `schedule`. Reconciliar entero
 * es más barato de razonar que llevar la cuenta de qué se agregó y qué se fue,
 * y es lo único que sobrevive a que el proceso muera entre dos cambios.
 */
export interface NotificationPlan {
  /** Espacio de nombres (`cauldron`, `habits`): dos planes nunca se pisan. */
  scope: string;
  /** TODOS los tags que este plan gobierna. Lo que no esté en `schedule`, se cancela. */
  owned: string[];
  /**
   * Subconjunto de `owned` que puede estar YA publicado en la bandeja (los
   * `ongoing`): cancelar la alarma no los baja, hay que retirarlos a mano.
   */
  ownedPersistent?: string[];
  schedule: ScheduledNotification[];
}

export interface PlatformPort {
  appVersion(): string;
  osInfo(): string;
  notify(n: { title: string; body: string; tag?: string }): Promise<void>;
  openExternal(url: string): Promise<void>;
  pickTextFile(filters: FileFilter[]): Promise<{ name: string; content: string } | null>;
  pickBinaryFile(filters: FileFilter[]): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveTextFile(defaultName: string, content: string): Promise<boolean>;
  saveBinaryFile(defaultName: string, bytes: Uint8Array): Promise<boolean>;

  /**
   * Reconcilia los avisos programados de un ámbito. **Opcional a propósito**:
   * su ausencia es la señal de "esta plataforma no programa nada". Electron no
   * lo implementa (la app de escritorio siempre está viva; sus notificaciones
   * salen por `notify()`), así que en desktop ni siquiera se calcula el plan.
   */
  applyNotificationPlan?(plan: NotificationPlan): Promise<void>;

  /** Solo Android: `'granted' | 'denied' | 'prompt'` para las alarmas exactas. */
  exactAlarmState?(): Promise<string>;
  /** Solo Android: abre «Alarmas y recordatorios» del sistema. Requiere gesto del usuario. */
  requestExactAlarms?(): Promise<string>;
}

let current: PlatformPort | null = null;

export function setPlatform(port: PlatformPort): void {
  current = port;
}

export function platform(): PlatformPort {
  if (!current) {
    throw new Error('PlatformPort not installed: call setPlatform() at startup');
  }
  return current;
}

/**
 * El port instalado, o null. `platform()` lanza si no hay ninguno, y el
 * programador de avisos corre desde timers y desde `register*IpcHandlers()`,
 * donde un throw no tiene arriba ningún frame que lo atrape.
 */
export function platformOrNull(): PlatformPort | null {
  return current;
}
