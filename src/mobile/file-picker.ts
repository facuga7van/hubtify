/**
 * Selector de archivos para Android: un <input type="file"> oculto que se
 * clickea por código. El WebView de Capacitor abre el chooser del sistema.
 *
 * Cancelación: evento `cancel` (Chromium ≥ 113). Red de seguridad para
 * WebViews viejos: si la ventana recupera el foco y en FOCUS_CANCEL_GRACE_MS
 * no llegó `change`, se resuelve null. Si tampoco llega `focus`, la promesa
 * queda pendiente — igual que un diálogo de Electron que nunca se cierra.
 *
 * El entorno DOM se inyecta (`PickerEnv`) para testear sin jsdom.
 */
export interface PickerInput {
  type: string;
  accept: string;
  hidden: boolean;
  files: ArrayLike<File> | null;
  click(): void;
  addEventListener(type: 'change' | 'cancel', listener: () => void): void;
  remove(): void;
}

export interface PickerEnv {
  createInput(): PickerInput;
  mount(input: PickerInput): void;
  /** Registra un listener de `focus` en window; devuelve el unsubscribe. */
  onWindowFocus(listener: () => void): () => void;
  setTimeout(fn: () => void, ms: number): unknown;
}

export const FOCUS_CANCEL_GRACE_MS = 1500;

export function domPickerEnv(): PickerEnv {
  return {
    createInput: () => document.createElement('input'),
    mount: (input) => document.body.appendChild(input as unknown as HTMLInputElement),
    onWindowFocus: (listener) => {
      window.addEventListener('focus', listener);
      return () => window.removeEventListener('focus', listener);
    },
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  };
}

export function pickFile(accept: string, env: PickerEnv = domPickerEnv()): Promise<File | null> {
  return new Promise((resolve) => {
    const input = env.createInput();
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;

    let settled = false;
    let offFocus = () => {};
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      offFocus();
      input.remove();
      resolve(file);
    };
    const chosen = () => input.files?.[0] ?? null;

    input.addEventListener('change', () => finish(chosen()));
    input.addEventListener('cancel', () => finish(null));
    offFocus = env.onWindowFocus(() => {
      env.setTimeout(() => finish(chosen()), FOCUS_CANCEL_GRACE_MS);
      // El primer `focus` ya decide: sin esto, volver al chooser y salir otra
      // vez agendaba un timer más por cada ida y vuelta.
      offFocus();
    });

    env.mount(input);
    input.click();
  });
}
