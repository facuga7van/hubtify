# Windows: la barra de tareas muestra el átomo de Electron

**Fecha**: 2026-09-03 · **Versión bajo estudio**: 0.9.4 · **Estado**: causa raíz demostrada, fix propuesto sin implementar
**Método**: `superpowers:systematic-debugging` — reproducción aislada, variante única por experimento, evidencia en píxeles.
**Rama de trabajo**: `fix/taskbar-icon` (worktree `D:/tmp/wt-tb`). **No se tocó `master` ni el código de la app.**

---

## TL;DR

| | |
|---|---|
| **Síntoma** | El botón de Hubtify en la barra de tareas muestra el átomo de Electron. El HICON de la ventana, el `.ico`, el `.exe` y los accesos directos están **todos** bien. |
| **Variante que cambia el comportamiento** | Cambiar (o no setear) el **AppUserModelID**. Con `com.squirrel.Hubtify.Hubtify` → átomo. Sin AUMID o con otro AUMID → libro. Mismo binario, misma sesión, mismo `.ico`. |
| **Causa raíz** | En esta máquina el AUMID `com.squirrel.Hubtify.Hubtify` quedó **atado en la AppsFolder del shell a `Start Menu\Programs\Electron.lnk` → `D:\code\hubtify\node_modules\electron\dist\electron.exe`**, cuyo ícono ES el átomo. Ese `.lnk` lo generó Windows al anclar una corrida de **desarrollo**, porque `electron/main.ts:21-23` declara el AUMID de producción **también en dev**. |
| **¿Bug de la app para un usuario final?** | **No** (con la evidencia disponible). Es contaminación de identidad exclusiva de una máquina de desarrollo. |
| **¿Bug nuestro?** | **Sí, de higiene**: `setAppUserModelId` se llama incondicionalmente, así que cualquier dev que ancle el `npm start` se rompe el ícono de la app instalada, para siempre. |
| **Fix propuesto** | AUMID distinto en dev (`app.isPackaged ? … : '…​.dev'`). Diff al final. |

---

## 1. Reproducción aislada (sin instalador, sin Squirrel)

`npm run package` en el worktree y ejecutar `out/Hubtify-win32-x64/Hubtify.exe` con
`--user-data-dir=D:/tmp/tb-test` (para no tocar los datos del usuario).

**El bug se reproduce con el build pelado de `out/`**, sin Setup.exe, sin stub, sin accesos directos
del instalador de por medio. Eso descarta de entrada a Squirrel, `app.ico`, `iconUrl`, `setupIcon`,
el stub y el desinstalador.

![atómo en la barra](2026-09-03-taskbar-icon-atomo.png)

Verificación de que ese botón es nuestro: al matar el proceso, el botón desaparece; al relanzarlo,
vuelve.

---

## 2. Lo que la barra de tareas **no** usa: el HICON de la ventana

Con la app corriendo, sobre el `HWND` visible (`Chrome_WidgetWin_1`, título `Hubtify`) se consultó
`WM_GETICON` y se volcó el `HICON` devuelto a PNG (`Icon.FromHandle().ToBitmap()`):

| Consulta | HICON | Contenido real (píxeles) |
|---|---|---|
| `ICON_BIG` (32×32) | `0x1CCE0A25` | **el libro** |
| `ICON_SMALL` (16×16) | `0x1F801B3` | **el libro** |
| `ICON_SMALL2` | `0x1F801B3` | **el libro** |
| `GCLP_HICON` | `0x3FA04C5` | — |

![HICON de la ventana](2026-09-03-taskbar-icon-hicon-ventana.png)

O sea: **Electron aplica el ícono correcto y la barra lo ignora.** Esto coincide con la
documentación de Microsoft ([`System.AppUserModel.RelaunchIconResource`](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchiconresource)):
el orden real es

```
RelaunchIconResource  →  ítem de AppsFolder asociado al AUMID  →  ejecutable del proceso
```

El `HICON` de la ventana **no participa** en el botón agrupado de la barra.

Íconos verificados uno por uno con `PrivateExtractIconsW` (16/32/48/256), **todos el libro**:

| Archivo | Ícono |
|---|---|
| `out/Hubtify-win32-x64/Hubtify.exe` (build del worktree) | libro |
| `%LOCALAPPDATA%\Hubtify\app-0.9.4\Hubtify.exe` | libro |
| `%LOCALAPPDATA%\Hubtify\Hubtify.exe` (stub de Squirrel) | libro |
| `%LOCALAPPDATA%\Hubtify\Update.exe` | libro |
| `%LOCALAPPDATA%\Hubtify\app.ico` | libro (`a9531dd0…`, idéntico a `assets/icon.ico`) |

---

## 3. El experimento decisivo: una sola variable, el AUMID

Se agregó un selector temporal por variable de entorno en `electron/main.ts` (revertido después),
se empaquetó **una sola vez** y se corrió el mismo binario tres veces seguidas en la misma sesión de
Windows, cambiando únicamente el AUMID.

| Variante | Código | Barra de tareas |
|---|---|---|
| **A — default** | `app.setAppUserModelId('com.squirrel.Hubtify.Hubtify')` | **átomo** |
| **B — sin AUMID** | no se llama a `setAppUserModelId` | **libro** ✅ |
| **C — otro AUMID** | `app.setAppUserModelId('ai.dardo.HubtifyTest')` | **libro** ✅ |

![libro sin AUMID](2026-09-03-taskbar-icon-libro.png)

Variantes descartadas por innecesarias una vez aislada la variable (el HICON ya era correcto en
todas): pasar `icon` como `nativeImage` en vez de string, y `mainWindow.setIcon()` después de
`ready-to-show`. Ninguna puede ganar, porque la barra no mira el HICON (§2).

**Conclusión del experimento: la única variable que cambia el resultado es la cadena del AUMID.**

---

## 4. De dónde sale el átomo

### 4.1 Los accesos directos están bien

Leídos con `IShellLinkW` + `IPropertyStore` (property store completo, no `WScript.Shell`):

```
C:\Users\Facu\Desktop\Hubtify.lnk
  Target  = C:\Users\Facu\AppData\Local\Hubtify\Hubtify.exe      (ícono: libro)
  IconLoc = C:\Users\Facu\AppData\Local\Hubtify\Hubtify.exe , 0
  System.AppUserModel.ID           = com.squirrel.Hubtify.Hubtify   ← coincide EXACTO
  System.AppUserModel.RelaunchCommand      = (vacío)
  System.AppUserModel.RelaunchIconResource = (vacío)   ← no hay override
…\Start Menu\Programs\Hubtify\Hubtify.lnk  → idéntico
```

Así que las hipótesis 1 y 2 del planteo original quedan **descartadas**: el AUMID del `.lnk` es el
correcto y **no hay** `RelaunchIconResource` ni `RelaunchCommand` apuntando a nada raro.

### 4.2 Windows dice que ese AUMID es "Electron"

```powershell
PS> Get-StartApps | Where-Object AppID -like '*Hubtify*'

Name     AppID
----     -----
Electron com.squirrel.Hubtify.Hubtify
```

**El shell tiene registrado nuestro AUMID de producción bajo el nombre "Electron".**

### 4.3 El `.lnk` culpable

Escaneo binario de **todos** los `.lnk` (sin filtrar por nombre) buscando la cadena UTF-16
`com.squirrel.Hubtify.Hubtify`:

```
HIT: …\Start Menu\Programs\Electron.lnk        ← el intruso
HIT: …\Start Menu\Programs\Hubtify\Hubtify.lnk
HIT: C:\Users\Facu\Desktop\Hubtify.lnk
```

`Programs\Electron.lnk` (creado **2026-04-12 16:22:36**, 1170 bytes):

```
Target   = D:\code\hubtify\node_modules\electron\dist\electron.exe
WorkDir  = D:\code\hubtify\node_modules\electron\dist
IconLoc  = ''  (⇒ el ícono del target)
System.AppUserModel.ID = com.squirrel.Hubtify.Hubtify
Descripción            = Electron
```

Y el ícono embebido de `node_modules/electron/dist/electron.exe` es, píxel por píxel, **el átomo
que se ve en la barra** (círculo oscuro con órbitas blancas).

Rastro corroborante en el registro (única coincidencia de `com.squirrel.Hubtify` en todo HKCU):

```
HKCU\…\CurrentVersion\AppListBackup\ListOfEventDrivenBackedUpTiles_1685441500
  {"tileId":"W~com.squirrel.Hubtify.Hubtify", …,
   "displayName":"Electron", "sortName":"Electron",
   "targetPath":"D:\code\hubtify\node_modules\electron\dist\electron.exe"}
```

Es el respaldo del tile de Inicio: en algún momento se **ancló la ventana de desarrollo**, y como
esa ventana declaraba el AUMID de producción, Windows creó un ítem de aplicación llamado "Electron"
con el AUMID de Hubtify y el ícono de `electron.exe`.

### 4.4 Por qué pasó: `setAppUserModelId` no distingue dev de producción

`electron/main.ts:21-23` (master, hoy):

```ts
if (process.platform === 'win32') {
  app.setAppUserModelId('com.squirrel.Hubtify.Hubtify');
}
```

No hay guarda de `app.isPackaged`. Con `npm start` / `electron-forge start` el proceso es
`node_modules\electron\dist\electron.exe` y **declara la identidad de producción**. Basta anclar esa
ventana una vez (a Inicio o a la barra) para que Windows escriba un `.lnk` que ata para siempre
`com.squirrel.Hubtify.Hubtify` → `electron.exe` → átomo.

### 4.5 Verificación directa de la resolución del shell

Consultando el ítem de AppsFolder por AUMID (`SHCreateItemFromParsingName("shell:AppsFolder\<AUMID>")`
+ `IShellItemImageFactory::GetImage(48×48)`) — o sea, exactamente lo que resuelve la barra:

| Momento | `shell:AppsFolder\com.squirrel.Hubtify.Hubtify` |
|---|---|
| con `Electron.lnk` intacto | átomo (= lo que mostraba la barra) |
| tras borrar `Electron.lnk` | ícono genérico de documento (la entrada queda huérfana) |
| tras reapuntar `Electron.lnk` al stub de Hubtify | **libro** — y la barra pasó a mostrar el libro |

Nota lateral, coherente con la doc: para un AUMID **sin** ítem en AppsFolder
(`ai.dardo.HubtifyTest`), `SHCreateItemFromParsingName` devuelve `0x80070002` (no existe) y la barra
cae al **ícono del ejecutable del proceso** — que es el libro. Eso explica por qué las variantes B y C
salen bien.

### 4.6 Por qué las purgas de caché del usuario no servían

Se borraron `IconCache.db`, `Explorer\iconcache*.db` y `%LOCALAPPDATA%\Microsoft\Windows\Caches\*`
tres veces reiniciando el Explorador — **sin efecto, porque `Electron.lnk` seguía ahí** y el
AppResolver reconstruía la misma asociación envenenada en cuanto se regeneraba la caché
(`{3DA71D5A-20CC-432F-A115-DFE92379E91F}.*.db` vuelve a aparecer a los segundos).

---

## 5. ¿Le pasa a un usuario final?

**No, con la evidencia disponible.** El envenenamiento requiere que un proceso que NO es la app
instalada declare el AUMID de producción y sea anclado. Un usuario final:

1. instala → Squirrel crea `Programs\Hubtify\Hubtify.lnk` y `Desktop\Hubtify.lnk` con el AUMID
   correcto y el ícono del stub (libro);
2. corre la app → Windows resuelve el AUMID contra esos `.lnk` (o, si todavía no los indexó, cae al
   ícono del `.exe`, que también es el libro).

**No se pudo demostrar** en una máquina limpia (no hay uno disponible en esta sesión): la afirmación
descansa en la cadena causal de §3-§4, no en una prueba sobre un Windows recién instalado.

---

## 6. Diff propuesto (NO implementado — espera OK)

`electron/main.ts`, líneas 18-23:

```diff
-// Set a stable AppUserModelID matching the one Squirrel assigns to shortcuts
-// (com.squirrel.<PACKAGE>.<EXE>). Required so Windows keeps pinned taskbar items
-// associated with the app across updates instead of breaking the pin.
-if (process.platform === 'win32') {
-  app.setAppUserModelId('com.squirrel.Hubtify.Hubtify');
-}
+// AppUserModelID estable, igual al que Squirrel le pone a los accesos directos
+// (com.squirrel.<PACKAGE>.<EXE>). Windows usa el AUMID —no el HICON de la ventana—
+// para resolver el ícono y el nombre del botón de la barra de tareas, y para no
+// romper el anclado entre actualizaciones.
+//
+// En DESARROLLO hay que usar otro AUMID. El proceso de dev es
+// node_modules/electron/dist/electron.exe: si declara el AUMID de producción y esa
+// ventana se ancla alguna vez, Windows crea un acceso directo ("Electron.lnk") que
+// ata com.squirrel.Hubtify.Hubtify al ejecutable de Electron, y desde entonces la
+// app INSTALADA muestra el átomo en la barra de tareas. La atadura sobrevive a
+// reinstalar, regenerar accesos directos y purgar las cachés de íconos.
+// Ver docs/superpowers/plans/2026-09-03-taskbar-icon.md.
+if (process.platform === 'win32') {
+  app.setAppUserModelId(
+    app.isPackaged ? 'com.squirrel.Hubtify.Hubtify' : 'com.squirrel.Hubtify.Hubtify.dev'
+  );
+}
```

`app.isPackaged` es un getter sincrónico disponible antes de `app.whenReady()` (ya se usa así en
`getIconPath()`, línea 110), así que la guarda es segura en el ámbito de módulo.

**Por qué un AUMID `.dev` y no directamente no llamar a `setAppUserModelId`**: sin AUMID, las
notificaciones toast de Windows en desarrollo pierden identidad y se muestran como "electron.exe".
Con un AUMID separado siguen funcionando y nunca contaminan la identidad de producción.

**Alcance**: cero cambios de comportamiento en el build empaquetado. Solo evita que futuras corridas
de dev vuelvan a envenenar la identidad.

**Lo que el fix NO hace**: no repara máquinas ya contaminadas. Para eso hay que borrar el `.lnk`
intruso (§7).

---

## 7. Reparación de la máquina (ya aplicada, con backups)

Cambios hechos en la máquina del usuario durante la investigación — todos con respaldo en el
scratchpad de la sesión:

| Cambio | Backup |
|---|---|
| `Programs\Electron.lnk` reapuntado: ahora target `%LOCALAPPDATA%\Hubtify\Hubtify.exe`, descripción `Hubtify`, mismo AUMID | `scratchpad\Electron.lnk.BACKUP` (el original, apuntando a `node_modules`) |
| Borrada la subclave `HKCU\…\AppListBackup\ListOfEventDrivenBackedUpTiles_1685441500` | `scratchpad\AppListBackup.BACKUP.reg` |
| Purgadas `%LOCALAPPDATA%\Microsoft\Windows\Caches\*` e `Explorer\iconcache*.db` (se regeneran solas) | `scratchpad\caches-backup\` |
| Creados y borrados dos `.lnk` de experimento (`ZzTbTest.lnk`, `Programs\Hubtify.lnk`) | — |

Los accesos directos que administra Squirrel (`Programs\Hubtify\Hubtify.lnk` y `Desktop\Hubtify.lnk`)
**no se tocaron**.

**Estado final verificado**: la barra de tareas muestra el libro.

**Pendiente, opcional**: la entrada de AppsFolder todavía se llama "Electron" (`Get-StartApps`).
Después de **reiniciar la sesión de Windows**, el shell debería reindexar y atar el AUMID al
`Programs\Hubtify\Hubtify.lnk` legítimo; en ese momento `Programs\Electron.lnk` se puede borrar y
listo. Borrarlo *antes* del reinicio deja el botón con un ícono genérico de documento (probado).

---

## 8. Lo que NO se pudo demostrar

1. **Que un usuario final nunca vea el átomo.** No hubo Windows limpio para probarlo; la conclusión
   es inferencial (§5).
2. **Purgar la identidad "Electron" sin reiniciar.** Sobrevivió a: borrar el `.lnk`, borrar
   `AppListBackup`, purgar `Caches\*` e `iconcache*.db`, y matar/reiniciar `explorer.exe` y
   `StartMenuExperienceHost.exe` cinco veces. El store persistente exacto no se ubicó.
3. **Que un `.lnk` recién creado con un AUMID nuevo capture el ícono de la barra.** Se creó
   `ZzTbTest.lnk` → `mspaint.exe` con AUMID `ai.dardo.HubtifyTest` y la app siguió mostrando el libro
   (el ícono de su `.exe`): el shell no había indexado el `.lnk` todavía. La atadura se establece
   de forma perezosa/al anclar, no al instante.
4. **`System.AppUserModel.RelaunchIconResource` como blindaje.** Ganaría sobre todo lo demás según la
   doc de Microsoft, pero Electron no expone API para setearlo en la ventana; requeriría código
   nativo. Descartado por costo/beneficio, no probado.

---

## Anexo — scripts de evidencia

En el scratchpad de la sesión
`C:\Users\Facu\AppData\Local\Temp\claude\D--code-hubtify\b1df5ef8-6183-4e0c-bcaa-b054e3a06bdb\scratchpad\`:

| Script | Qué hace |
|---|---|
| `run-variant.ps1` | lanza una variante, vuelca `WM_GETICON` a PNG, lee el property store de la ventana, captura la franja de la barra y mata el proceso |
| `probe-lnk.ps1` / `probe-lnk-one.ps1` | `IShellLinkW` + `IPropertyStore` sobre `.lnk` (target, iconloc, AUMID, store completo) |
| `exe-icon.ps1` | `PrivateExtractIconsW` 16/32/48/256 de un `.exe` a PNG |
| `aumid-icon.ps1` | `shell:AppsFolder\<AUMID>` + `IShellItemImageFactory::GetImage` → PNG (lo que resuelve la barra) |
| `find-poison.ps1` | escaneo binario de todos los `.lnk` y cachés buscando el AUMID en UTF-16 |
| `make-test-lnk.ps1` | crea un `.lnk` con `System.AppUserModel.ID` arbitrario (PROPVARIANT armado a mano) |
| `shot3.ps1` / `zoom.ps1` | captura solo la franja inferior de cada monitor y amplía con nearest-neighbour |
