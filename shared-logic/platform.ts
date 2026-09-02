/**
 * Everything the business logic needs from the host OS that is NOT the
 * database. Electron implements it with `dialog`/`fs`/`Notification`
 * (electron/platform.ts); Android proxies it to the UI thread (Fase 2/5).
 */
export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface PlatformPort {
  appVersion(): string;
  osInfo(): string;
  notify(n: { title: string; body: string; tag?: string }): Promise<void>;
  openExternal(url: string): Promise<void>;
  pickTextFile(filters: FileFilter[]): Promise<{ name: string; content: string } | null>;
  pickPdfText(): Promise<{ name: string; text: string } | { unsupported: true } | null>;
  pickBinaryFile(filters: FileFilter[]): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveTextFile(defaultName: string, content: string): Promise<boolean>;
  saveBinaryFile(defaultName: string, bytes: Uint8Array): Promise<boolean>;
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
