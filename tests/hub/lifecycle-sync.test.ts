import { describe, it, expect, vi } from 'vitest';
import { bindLifecycleSync } from '../../src/hub/lifecycle-sync';
import { APP_BACKGROUND_EVENT, APP_FOREGROUND_EVENT } from '../../src/shared/app-lifecycle-events';

function setup() {
  const target = new EventTarget();
  const onEnterBackground = vi.fn();
  const onEnterForeground = vi.fn();
  const dispose = bindLifecycleSync(target, { onEnterBackground, onEnterForeground });
  return { target, onEnterBackground, onEnterForeground, dispose };
}

describe('bindLifecycleSync', () => {
  it('blur = irse de la app en escritorio', () => {
    const { target, onEnterBackground } = setup();
    target.dispatchEvent(new Event('blur'));
    expect(onEnterBackground).toHaveBeenCalledTimes(1);
  });

  it('focus = volver a la app en escritorio', () => {
    const { target, onEnterForeground } = setup();
    target.dispatchEvent(new Event('focus'));
    expect(onEnterForeground).toHaveBeenCalledTimes(1);
  });

  /* El motivo de existir de este módulo: en el WebView de Android, tapar la app
     con otra Activity NO dispara blur/focus (ni visibilitychange). El único
     evento fiable es appStateChange de @capacitor/app, que native-shell.ts
     traduce a estos dos eventos de window. */
  it('appBackground también cuenta como irse: en Android blur no llega', () => {
    const { target, onEnterBackground } = setup();
    target.dispatchEvent(new Event(APP_BACKGROUND_EVENT));
    expect(onEnterBackground).toHaveBeenCalledTimes(1);
  });

  it('appForeground también cuenta como volver: en Android focus no llega', () => {
    const { target, onEnterForeground } = setup();
    target.dispatchEvent(new Event(APP_FOREGROUND_EVENT));
    expect(onEnterForeground).toHaveBeenCalledTimes(1);
  });

  it('usa el MISMO handler para las dos vías: nada se duplica ni se bifurca', () => {
    const { target, onEnterBackground, onEnterForeground } = setup();
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(new Event(APP_BACKGROUND_EVENT));
    target.dispatchEvent(new Event('focus'));
    target.dispatchEvent(new Event(APP_FOREGROUND_EVENT));
    expect(onEnterBackground).toHaveBeenCalledTimes(2);
    expect(onEnterForeground).toHaveBeenCalledTimes(2);
  });

  it('el disposer suelta las cuatro escuchas', () => {
    const { target, onEnterBackground, onEnterForeground, dispose } = setup();
    dispose();
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(new Event('focus'));
    target.dispatchEvent(new Event(APP_BACKGROUND_EVENT));
    target.dispatchEvent(new Event(APP_FOREGROUND_EVENT));
    expect(onEnterBackground).not.toHaveBeenCalled();
    expect(onEnterForeground).not.toHaveBeenCalled();
  });
});
