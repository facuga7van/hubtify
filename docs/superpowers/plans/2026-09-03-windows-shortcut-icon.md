# Windows: ícono ausente, acceso directo huérfano y doble instalación

**Fecha**: 2026-09-03 · **Versión bajo estudio**: 0.9.3 · **Estado**: diagnóstico cerrado, fix propuesto sin implementar
**Método**: `superpowers:systematic-debugging` — Fase 1 (causa raíz con evidencia) y Fase 2 (comparación con
referencia). NO se tocó código de la app.

---

## TL;DR

| # | Hallazgo | ¿Bug nuestro? |
|---|----------|---------------|
| 1 | `Programs\Hubtify.lnk` suelto apuntando a `app-0.7.5` | **No** — creado a mano el 2026-07-06, Squirrel nunca escribe ahí |
| 2 | Doble instalación (`%LOCALAPPDATA%\Hubtify` + `C:\ProgramData\Facu\Hubtify`) | **No** — es de la máquina; le pasa igual a FathomVideo (app de terceros) |
| 3 | `app.ico` = logo de Electron (átomo) en Agregar/quitar programas | **SÍ** — falta `iconUrl` en `forge.config.ts:81` |
| 4 | Carpeta `Programs\Hubtify\` | **No** — es el comportamiento normal de Squirrel; `shortcutFolderName` no existe |
| 5 | `setupExe` | **No** — el maker de Forge ya lo define |

---

## 1. ¿Por qué quedó un `.lnk` apuntando a `app-0.7.5`?

### Lo que dicen los logs

`%LOCALAPPDATA%\Hubtify\Squirrel-Shortcut.log` (instalación de 0.9.3):

```
[02/09/26 21:13:04] info: Program: Starting Squirrel Updater: --createShortcut=Hubtify.exe
[02/09/26 21:13:04] info: ApplyReleasesImpl: Creating shortcut for Hubtify.exe => C:\Users\Facu\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Hubtify\Hubtify.lnk
[02/09/26 21:13:04] info: ApplyReleasesImpl: About to save shortcut: ...\Programs\Hubtify\Hubtify.lnk (target C:\Users\Facu\AppData\Local\Hubtify\Hubtify.exe, workingDir C:\Users\Facu\AppData\Local\Hubtify\app-0.9.3, ...)
[02/09/26 21:13:04] info: ApplyReleasesImpl: Creating shortcut for Hubtify.exe => C:\Users\Facu\Desktop\Hubtify.lnk
[02/09/26 21:13:04] info: Program: Finished Squirrel Updater
```

Squirrel creó **exactamente dos** accesos directos, ambos apuntando al **stub**
(`%LOCALAPPDATA%\Hubtify\Hubtify.exe`), nunca al exe versionado. **Jamás tocó
`Programs\Hubtify.lnk`** (el suelto).

### Fechas de los `.lnk` (WScript.Shell + `Get-Item`)

| Archivo | Creado | Target original |
|---------|--------|-----------------|
| `Programs\Hubtify\Hubtify.lnk` | **2026-09-02 21:13:04** | stub (correcto) |
| `Desktop\Hubtify.lnk` | **2026-09-02 21:13:04** | stub (correcto) |
| `Programs\Hubtify.lnk` (suelto) | **2026-07-06 20:07:46** | `...\Hubtify\app-0.7.5\Hubtify.exe` |

### Cronología de Squirrel en esta máquina (`%LOCALAPPDATA%\SquirrelTemp\Squirrel-Install.log`)

```
[26/06/26 10:26:34] ApplyReleasesImpl: Writing files to app directory: ...\Hubtify\app-0.7.5
   ← (sin actividad entre el 26/06 y el 02/09)
[02/09/26 21:13:00] Program: Starting Squirrel Updater: --install .
[02/09/26 21:13:00] warn: Program: Install path C:\Users\Facu\AppData\Local\Hubtify already exists, burning it to the ground
[02/09/26 21:13:01] ApplyReleasesImpl: Writing files to app directory: ...\Hubtify\app-0.9.3
```

### Conclusión

1. **No hay rastro de 0.9.2 en ningún log de Squirrel.** La última versión que Squirrel
   administró en `%LOCALAPPDATA%` fue **0.7.5** (26/06/26). El salto siguiente es 0.9.3.
2. El `.lnk` suelto se creó el **6 de julio**, diez días *después* de instalar 0.7.5 y en un
   momento sin ninguna actividad de Squirrel. Apuntaba al **exe versionado**, cosa que Squirrel
   nunca hace (siempre apunta al stub). → **lo creó una acción manual del usuario / Explorer**
   ("Crear acceso directo", "Anclar a Inicio", arrastre), no nuestro instalador.
3. Squirrel solo borra en el desinstalador los accesos directos que él mismo creó. Un `.lnk`
   hecho a mano en la raíz de `Programs` le es invisible → sobrevive para siempre y se rompe en
   cuanto muere la carpeta `app-X.Y.Z`.
4. `warn: Install path ... already exists, burning it to the ground` confirma además que el árbol
   anterior **no había sido borrado por un desinstalador** antes de instalar 0.9.3.

**Veredicto Q1: residuo de la máquina del usuario. No es bug nuestro.**

---

## 2. Doble instalación: `%LOCALAPPDATA%\Hubtify` y `C:\ProgramData\Facu\Hubtify`

### El hecho

Hay **dos árboles completos e independientes**, cada uno con su propio
`SquirrelTemp\Squirrel-Install.log`:

| Log | Tamaño | Contenido |
|-----|--------|-----------|
| `%LOCALAPPDATA%\SquirrelTemp\Squirrel-Install.log` | 96 384 B | GitHubDesktop, Postman, hostd, walletd, Hubtify 0.1.0→0.7.5, 0.9.3 |
| `C:\ProgramData\Facu\SquirrelTemp\Squirrel-Install.log` | 7 770 B | FathomVideo 1.42.2, Hubtify 0.3.3, 0.5.2, 0.5.4, 0.5.5, 0.9.3 |

Son archivos distintos (no es un junction): `fsutil reparsepoint query C:\ProgramData\Facu` →
`Error 4390: no es un punto de análisis repetido`. Atributos: `Directory, NotContentIndexed`,
`LinkType` vacío. Owner: `DESKTOP-CN7FRDH\Facu`, ACLs heredadas de `C:\ProgramData`.

### Los dos instaladores corren **en el mismo segundo**

```
LOCALAPPDATA : [02/09/26 21:13:00] --install .  →  app-0.9.3  →  [21:13:06] Finished
PROGRAMDATA  : [02/09/26 21:13:00] --install .  →  app-0.9.3  →  [21:13:06] Finished
```

Y lo mismo, segundo a segundo, para 0.3.3 (28/03 02:35), 0.5.2 (31/03 15:54),
0.5.4 (02/04 00:33) y 0.5.5 (02/04 01:01). Es decir: **cada corrida de `Setup.exe` produjo
dos instalaciones concurrentes**, una por cada resolución distinta de `LocalApplicationData`.

Los dos `Squirrel-Shortcut.log` (uno por raíz) escriben los **mismos** destinos
(`Programs\Hubtify\Hubtify.lnk` y `Desktop\Hubtify.lnk`) — se pisan entre sí. Gana el último.

### Una sola clave de desinstalación, disputada

Solo existe `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Hubtify` (no hay entradas
en HKLM ni en WOW6432Node). Al momento de la primera medición:

```
DisplayName     : Hubtify
DisplayVersion  : 0.9.3
InstallLocation : C:\ProgramData\Facu\Hubtify
UninstallString : "C:\ProgramData\Facu\Hubtify\Update.exe" --uninstall
DisplayIcon     : C:\ProgramData\Facu\Hubtify\app.ico
Publisher       : facuga7van
InstallDate     : 20260902
```

…mientras el usuario ejecutaba la copia de `%LOCALAPPDATA%`. Las dos instalaciones escriben la
**misma** clave; la que termina última se queda con ella. Por eso "Agregar o quitar programas"
apuntaba a una copia y el acceso directo a la otra, y por eso desinstalar deja la otra huérfana
y sin entrada.

### ¿Es culpa de nuestra config?

**No.** Evidencia:

1. **Le pasa a una app de terceros que nosotros no compilamos.** `FathomVideo` (Squirrel, dic-2025)
   existe simultáneamente en `C:\ProgramData\Facu\FathomVideo` **y** en
   `C:\Users\Facu\AppData\Local\FathomVideo`. Mismo patrón, misma máquina, otro fabricante.
2. **La ruta lleva el nombre de usuario de Windows, no el `authors` del nuspec.** `Facu` es el
   usuario de Windows; `authors` de Hubtify es `facuga7van` (de `package.json.author.name`, se ve
   en `Publisher`). Fathom tampoco tiene "Facu" como autor. → la ruta la construye Windows/​.NET,
   no nuestro paquete.
3. **Squirrel.Windows no tiene ninguna opción de directorio de instalación.** Las peticiones
   siguen abiertas/no implementadas: [#1282](https://github.com/Squirrel/Squirrel.Windows/issues/1282),
   [#1518](https://github.com/Squirrel/Squirrel.Windows/issues/1518),
   [#989](https://github.com/Squirrel/Squirrel.Windows/issues/989),
   [#65](https://github.com/Squirrel/OldSquirrelForWindows/issues/65).
   La doc oficial ([How your app is deployed](https://github.com/Squirrel/OldSquirrelForWindows/wiki/How-your-app-is-deployed))
   dice que instala en `%LOCALAPPDATA%` justamente para no requerir admin.
4. **Este síntoma exacto ya está reportado upstream.**
   [#1192 "Where does squirrel actually install to?"](https://github.com/Squirrel/Squirrel.Windows/issues/1192)
   describe copias en `C:\Users\<user>\AppData\Local\<App>` **y** `C:\ProgramData\<user>\<App>`.
   [#1497 "Location of SquirrelTemp"](https://github.com/Squirrel/Squirrel.Windows/issues/1497)
   reporta `SquirrelTemp` apareciendo en `C:\ProgramData` en vez de LocalAppData, "más común en
   sistemas limpios o donde se purgó todo rastro de la app, y con el usuario instalador siendo
   Administrador". El patrón `ProgramData\<username>\` es la firma de
   `Environment.GetFolderPath(SpecialFolder.LocalApplicationData)` resolviéndose bajo un token
   cuyo perfil de usuario no está cargado (elevación / servicio / lanzador que despoja el token).
5. **No es la vía MSI.** El release 0.9.3 no publica `.msi`; los assets son
   `Hubtify-0.9.3-full.nupkg`, `Hubtify-0.9.3.apk`, `Hubtify-0.9.3.Setup.exe`,
   `Hubtify-win32-x64-0.9.3.zip` y `RELEASES`.
6. **No hay redirección de shell folders.** `HKCU\...\User Shell Folders\Local AppData` =
   `C:\Users\Facu\AppData\Local`; `[Environment]::GetFolderPath('LocalApplicationData')` desde una
   sesión normal devuelve lo correcto. El desvío ocurre solo en el contexto del proceso instalador.
7. **No hay virtualización UAC**: `%LOCALAPPDATA%\VirtualStore` está vacío.

**Veredicto Q2: entorno de la máquina, no configuración nuestra. No hay una línea de
`forge.config.ts` que lo arregle** — Squirrel.Windows no expone el directorio de instalación, y
`requestedExecutionLevel` / `noMsi` no cambian cómo .NET resuelve `LocalApplicationData`.

**Lo que SÍ podemos hacer (propuesta separada, requiere OK):** un guard en runtime en
`electron/main.ts` que, al arrancar empaquetado en Windows, compare la raíz de `process.execPath`
contra `app.getPath('localAppData')` y, si no coincide, muestre un aviso ("Hubtify está instalado
en una ubicación inesperada; desinstalá y reinstalá") en vez de fallar en silencio. Detecta el
problema, no lo previene. La prevención real requeriría cambiar de instalador (Velopack /
Clowd.Squirrel exponen `--installTo`), que es un cambio grande y fuera del alcance de este parche.

---

## 3. La carpeta `Programs\Hubtify\`

Es comportamiento **normal y deseado** de Squirrel: `ShortcutLocation.StartMenu` crea
`Programs\<carpeta>\<exe>.lnk`. Está en el log (`Creating shortcut for Hubtify.exe =>
...\Programs\Hubtify\Hubtify.lnk`) y se ve idéntico en Postman en el mismo log compartido
(`...\Programs\Postman\Postman.lnk`).

`shortcutFolderName` **no existe** como opción: no aparece en el README ni en
`src/options.ts` de `electron/windows-installer`, ni en el `v5.4.0` instalado en
`node_modules/electron-winstaller`. La doc de Forge dice que el maker
"inherits all of its config options from the `electron-winstaller` module, *except* for
`appDirectory` and `outputDirectory`".

**Veredicto Q3: nada que cambiar.** La carpeta está bien; la anomalía era el `.lnk` suelto (§1).

---

## 4. `iconUrl` ausente → átomo de Electron en Agregar/quitar programas — **BUG NUESTRO**

### Prueba de hash

| Archivo | Bytes | SHA-256 |
|---------|-------|---------|
| `%LOCALAPPDATA%\Hubtify\app.ico` (el instalado) | 37 073 | `b5d81c93892f9cceb990beb5088afafd87e3d808197f67d4c5347e5e6299cbec` |
| `raw.githubusercontent.com/electron/electron/main/shell/browser/resources/win/electron.ico` | 37 073 | `b5d81c93892f9cceb990beb5088afafd87e3d808197f67d4c5347e5e6299cbec` |

**Byte por byte idéntico.** Y `HKCU\...\Uninstall\Hubtify\DisplayIcon` apunta a ese `app.ico`.

### Origen en el código del maker

`node_modules/electron-winstaller/lib/index.js:162` (v5.4.0 instalada):

```js
iconUrl: 'https://raw.githubusercontent.com/electron/electron/main/shell/browser/resources/win/electron.ico'
```

Doc oficial (`electron/windows-installer`, `src/options.ts`):

> **iconUrl**: "A publicly accessible, fully qualified HTTP(S) URL to an ICO file, used as the
> application icon displayed in Control Panel ➡ Programs and Features."

README del mismo repo: **"Defaults to the Atom icon."**

`setupIcon` es otra cosa y sí lo tenemos bien: *"The ICO file to use as the icon for the generated
Setup.exe"* — por eso el `Setup.exe`, el stub y `app-0.9.3\Hubtify.exe` sí tienen el libro
embebido. `iconUrl` es el ícono **remoto** que Squirrel descarga a `app.ico` para el panel de
control; al no definirlo, cae al default de Electron.

### URL candidata verificada

```
GET https://facuga7van.github.io/hubtify-landing/assets/favicon.ico
→ HTTP 200 · Content-Type: image/vnd.microsoft.icon · 62 457 bytes
→ SHA-256 a9531dd03307f154021d928b70596840a14bebeb2b9537cb733c85a590d8bcfe
→ magic 00 00 01 00 | 04 00 (ICO válido, 4 imágenes: 16/32/48/256)
```

`D:\code\hubtify\assets\icon.ico`: 62 457 bytes, SHA-256 `a9531dd0…` → **idéntico**. La URL de la
landing sirve exactamente nuestro `.ico`. Es estable (GitHub Pages, ya publicada) y pública.

**Veredicto Q4: bug de configuración nuestro, de una línea, y le pasa a TODO usuario nuevo.**

---

## 5. `setupExe`

Ya lo define el maker de Forge — `node_modules/@electron-forge/maker-squirrel/dist/MakerSquirrel.js:35`:

```js
setupExe: `${appName}-${packageJSON.version} Setup.exe`,
```

Coincide con el asset publicado `Hubtify-0.9.3.Setup.exe`. **Nada que cambiar.**

---

## Diff propuesto (NO implementado — espera OK)

`D:\code\hubtify\forge.config.ts`, línea 81:

```diff
   makers: [
-    new MakerSquirrel({ name: 'Hubtify', setupIcon: './assets/icon.ico' }),
+    new MakerSquirrel({
+      name: 'Hubtify',
+      setupIcon: './assets/icon.ico',
+      // iconUrl: ícono remoto que Squirrel descarga como app.ico y usa como
+      // DisplayIcon en Agregar/quitar programas. Sin esto, electron-winstaller
+      // cae al default (electron.ico, el átomo) — ver lib/index.js:162.
+      iconUrl: 'https://facuga7van.github.io/hubtify-landing/assets/favicon.ico',
+    }),
     new MakerZIP({}),
   ],
```

**Alcance del cambio**: solo el ícono del panel de control. No toca accesos directos, ni el
`Setup.exe`, ni el ejecutable. Un usuario existente lo ve recién en la próxima instalación /
actualización (Squirrel reescribe `app.ico` en cada `--install`).

**No se cambia** `shortcutFolderName` (no existe), ni `setupExe` (ya definido), ni nada para la
doble instalación (Squirrel no lo expone).

---

## Respuesta a "¿le pasaría a un usuario nuevo?"

| Síntoma | Usuario nuevo |
|---------|---------------|
| `.lnk` suelto roto apuntando a `app-0.7.5` | **No.** Es un acceso directo hecho a mano el 06/07/2026 en esta máquina. |
| Doble instalación en `ProgramData\<user>` | **Improbable / no determinista.** Depende del contexto del proceso que lanza `Setup.exe`; le pasa también a apps de terceros en esta máquina. Sin knob en Squirrel. |
| Ícono de átomo en Agregar/quitar programas | **SÍ, al 100%.** Es determinista y afecta a todos. Es el único bug de config confirmado. |
| Carpeta `Programs\Hubtify\` | Sí, y está bien: es el comportamiento estándar de Squirrel. |

## Anexo — comandos de evidencia

Scripts en el scratchpad de la sesión:
`C:\Users\Facu\AppData\Local\Temp\claude\D--code-hubtify\b1df5ef8-6183-4e0c-bcaa-b054e3a06bdb\scratchpad\{probe,probe2,probe3}.ps1`
(shortcuts vía `WScript.Shell`, ACL/owner, `fsutil reparsepoint`, User Shell Folders, registro de
desinstalación, hashes de `.ico`, VirtualStore).
