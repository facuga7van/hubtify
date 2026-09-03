/**
 * Identidad de la app frente al shell de Windows (AppUserModelID).
 *
 * Windows NO usa el `HICON` de la ventana para el botón agrupado de la barra de
 * tareas: resuelve `RelaunchIconResource` → ítem de AppsFolder asociado al AUMID
 * → ejecutable del proceso. O sea que la cadena del AUMID decide el ícono y el
 * nombre que ve el usuario, y también si un anclado sobrevive a una
 * actualización. Comprobado a nivel píxel en
 * `docs/superpowers/plans/2026-09-03-taskbar-icon.md`.
 *
 * De ahí sale el bug que este módulo evita: `electron/main.ts` llamaba a
 * `setAppUserModelId` con el AUMID de producción SIN mirar `app.isPackaged`. En
 * desarrollo el proceso es `node_modules/electron/dist/electron.exe`, así que
 * una corrida de `npm start` declaraba la identidad de la app instalada; bastó
 * anclar esa ventana una vez para que Windows escribiera un
 * `Start Menu\Programs\Electron.lnk` atando `com.squirrel.Hubtify.Hubtify` al
 * ejecutable de Electron. Desde entonces la app INSTALADA mostró el átomo de
 * Electron en la barra, y la atadura sobrevivió a reinstalar, regenerar accesos
 * directos y purgar las cachés de íconos del shell.
 *
 * Pura a propósito, como `install-location.ts` y `app-icon.ts`: recibe
 * `app.isPackaged` por parámetro para poder testear la decisión sin Electron.
 */

/**
 * El AUMID de PRODUCCIÓN. **No se toca ni un carácter.**
 *
 * Squirrel.Windows le pone `com.squirrel.<PACKAGE>.<EXE>` a todos los accesos
 * directos que crea — acá `PACKAGE` es el `name` de `MakerSquirrel` en
 * `forge.config.ts` y `EXE` es `Hubtify.exe` (`productName` de package.json),
 * los dos "Hubtify". Si esta cadena dejara de coincidir con la de los `.lnk`,
 * Windows trataría a la app corriendo como una aplicación distinta de la
 * anclada: se desanclaría de la barra de tareas de TODOS los usuarios ya
 * instalados y las notificaciones perderían su identidad. Cambiarla exige
 * cambiar también el maker y aceptar ese costo.
 */
export const PRODUCTION_APP_USER_MODEL_ID = 'com.squirrel.Hubtify.Hubtify';

/**
 * El AUMID de DESARROLLO. Tiene que ser distinto del de producción para que una
 * corrida de `npm start` no pueda reclamar la identidad de la app instalada.
 *
 * Se elige un AUMID propio en vez de no llamar a `setAppUserModelId`: sin AUMID,
 * las notificaciones toast de Windows en desarrollo pierden identidad y salen
 * como "electron.exe". Con uno separado siguen funcionando y nunca contaminan
 * la identidad de producción.
 */
export const DEVELOPMENT_APP_USER_MODEL_ID = `${PRODUCTION_APP_USER_MODEL_ID}.dev`;

/** El AUMID que le corresponde a esta corrida. `isPackaged` = `app.isPackaged`. */
export function appUserModelIdFor(isPackaged: boolean): string {
  return isPackaged ? PRODUCTION_APP_USER_MODEL_ID : DEVELOPMENT_APP_USER_MODEL_ID;
}
