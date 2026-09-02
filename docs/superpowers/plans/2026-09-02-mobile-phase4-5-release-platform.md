# Hubtify Mobile — Fases 4 y 5: release Android firmado y puertos de plataforma — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el mismo tag `v*` publique en `facuga7van/hubtify-releases` el instalador Windows **y** un `Hubtify-<version>.apk` firmado (Fase 4), y que en Android funcionen de verdad las notificaciones, el export CSV, el backup `.db` (export/import), el toast de «PDF no soportado» y un aviso de nueva versión que abre el APK del release (Fase 5).

**Architecture:** Fase 4 no toca código de la app: agrega `signingConfigs.release` a `android/app/build.gradle` (lee `android/keystore/keystore.properties` en local o variables de entorno en CI, y cae a la clave debug si no hay keystore), reestructura `release.yml` en tres jobs (`build-windows` → artifact, `build-android` → artifact, `publish` → un solo release con todo) y suma un job `android-build` a `ci.yml`. Fase 5 completa `src/mobile/platform-host.ts` (lado UI del `PlatformPort`, spec §6) con `@capacitor/local-notifications`, `@capacitor/filesystem` + `@capacitor/share`, `@capacitor/browser` y un `<input type="file">`; el backup `.db` viaja por dos canales nuevos del worker (`mobile:exportDb` / `mobile:importDb`) que usan `poolUtil.exportFile` / `poolUtil.importDb`; el updater mobile consulta la API pública de GitHub y abre el `.apk` con el navegador.

**Tech Stack:** Gradle 8.14 / AGP del template de Capacitor 8, JDK 21 Temurin, Android SDK 36 (build-tools 36.0.0, `apksigner`), GitHub Actions (`actions/checkout@v4`, `setup-node@v4`, `setup-java@v4`, `upload-artifact@v4`, `download-artifact@v4`, `softprops/action-gh-release@v2`), Capacitor 8.5 + plugins `local-notifications` 8.3.1, `filesystem` 8.1.3, `share` 8.0.1, `browser` 8.0.4, sqlite-wasm 3.53 (`SAHPoolUtil.exportFile/importDb`), Vitest 4 (project `unit`, Node).

**Spec (fuente de verdad):** `docs/superpowers/specs/2026-09-01-mobile-android-design.md` §5, §6, §8, §9, §11 (filas 4 y 5), §12.

**Rama:** `feature/mobile`. Cada tarea termina en un commit `type(scope): descripción` sin líneas de atribución. Nunca `git add -A` ni `git add .`: la Fase 2 puede estar trabajando en el mismo árbol.

---

## Supuestos sobre las Fases 1 y 2 (ya mergeadas en `feature/mobile`)

Este plan **asume** la Fase 1 tal como quedó (`docs/superpowers/plans/2026-09-01-mobile-phase1-REPORT.md`) y la Fase 2 tal como la describe su plan (`docs/superpowers/plans/2026-09-01-mobile-phase2-capacitor-worker.md`). La Tarea 1 verifica cada símbolo con `rg`; si algo difiere, se adapta el import en el archivo de este plan que lo usa, nunca la fase anterior.

| Símbolo / archivo | De dónde viene | Qué asume este plan |
|---|---|---|
| `shared-logic/platform.ts` | Fase 1 | `PlatformPort` con `appVersion, osInfo, notify({title, body, tag?}), openExternal, pickTextFile(filters), pickPdfText(), pickBinaryFile(filters), saveTextFile(name, content), saveBinaryFile(name, bytes)`; `FileFilter { name, extensions }` |
| `shared-logic/registry.ts` | Fase 1 | `registerHandler(channel, fn)`, `getHandler`, `clearHandlers`, `runSuspend`, `runResume` |
| `shared-logic/db/index.ts` | Fase 1 | re-exporta `getDb`, `closeDb`, `suspendDb`, `resumeDb`, `DbSuspended` (están en `db/provider.ts`) |
| `shared/build-api.ts` | Fase 1 | `buildApi(transport, 'mobile')`, `Transport { invoke, send, on, off }` |
| `src/mobile/protocol.ts` | Fase 2 | `PlatformMethod` (los 7 métodos async), `collectTransferables`, `FatalReason` |
| `src/mobile/worker-client.ts` | Fase 2 | `createWorkerClient(worker, platformHostFns, opts)` → `WorkerClient { transport, ready, init, suspend, resume, isSuspended, isCrashed }`; `PlatformHostFns = Record<PlatformMethod, (...args) => Promise<unknown>>` |
| `src/mobile/platform-host.ts` | Fase 2 | `createPlatformHost(): PlatformHostFns` (stubs), `readOsInfo()` con `@capacitor/device` y `OS_INFO_FALLBACK` (lo importa `install-api.ts`). **Se reescribe entero en la Tarea 11** conservando esas TRES exportaciones |
| `src/mobile/install-api.ts` | Fase 2 | `installMobileApi()` crea el `Worker`, `createWorkerClient(...)`, `client.init`, `await client.ready`, `window.api = buildApi(client.transport, 'mobile')`. Se le agrega `getWorkerClient()` (Tarea 15) |
| `src/mobile/worker.ts` | Fase 2 | módulo con `poolUtil: SAHPoolUtil`, `DB_FILE = '/hubtify.db'`, `booted`, log `[worker] vfs: opfs-sahpool name=…`. Se le agrega una llamada (Tarea 14) |
| `src/mobile/FatalScreen.tsx` | Fase 2 | `default function FatalScreen({ reason, message, namespace?, version? })`, CSS `mobile-fatal__*`; i18n `mobile.fatal.*` |
| `scripts/android-version.mjs`, `scripts/gradle.mjs` | Fase 2 | `mobile:sync` = `mobile:build` + versión + `cap sync android`; `mobile:apk` = `mobile:sync` + `node scripts/gradle.mjs assembleDebug` |
| `android/` | Fase 2 | scaffold commiteado; `android/app/build.gradle` con el `defaultConfig`/`buildTypes` del template de Capacitor 8 |
| `.gitignore` | Fase 2 | ya tiene `android/**/keystore.properties`, `android/**/*.jks`, `android/**/*.keystore`, `android/app/build/`, `dist/mobile/` (las reglas `**` ya cubren `android/keystore/`; la Tarea 2 suma el directorio entero igual, y también ignoran el `android/keystore.off/` temporal de la Tarea 3 Step 7) |

## Desvíos respecto de la spec / del pedido (y por qué)

1. **Keystore en `android/keystore/`** (`release.jks` + `keystore.properties`), no en `android/release.jks` + `android/keystore.properties` (spec §8): un solo directorio gitignored es más difícil de commitear por accidente y CI lo borra con un `rm -rf`. `.gitignore` gana `android/keystore/`.
2. **Sin keystore, `assembleRelease` firma con la clave debug** en vez de fallar o dar `app-release-unsigned.apk`. Así `npm run mobile:apk:release` y el job `android-build` de CI compilan en cualquier máquina; el APK firmado con debug se distingue por la línea `[hubtify] release signing: DEBUG key` del log de Gradle. En `release.yml` el keystore es **obligatorio**: el step `Decode release keystore` falla con `::error::` si falta el secret.
3. **CI usa `npm run mobile:sync`** (build + `android-version.mjs` + `cap sync`) en lugar de los pasos sueltos de la spec §8: es exactamente lo que pide el desvío 2 del plan de Fase 2 (sin `android-version.mjs` el APK saldría con la versión del último sync commiteado).
4. **SDK del runner, sin `android-actions/setup-android`**: `ubuntu-latest` ya trae el SDK en `$ANDROID_HOME` con `cmdline-tools/latest`; un step llama a `sdkmanager` para asegurar `platforms;android-36` y `build-tools;36.0.0` (los de `android/variables.gradle`). Menos dependencias de terceros en la cadena de firma.
5. **Versiones de actions**: se mantienen las majors ya probadas en este repo (`checkout@v4`, `setup-node@v4`, `action-gh-release@v2`) y se usan `setup-java@v4`, `upload-artifact@v4`, `download-artifact@v4`. Hay majors más nuevas (v6–v8) pero no aportan nada a este flujo y cambiarían inputs.
6. **Clave i18n `coinify.importPdfUnsupportedMobile`** (plana), no `coinify.import.pdfUnsupportedMobile`: en `es.json`/`en.json` `coinify.import` **ya es un string** (`"import": "Importar"`), así que no puede ser también un objeto. Sigue la convención de las otras `coinify.import*`.
7. **`pickTextFile`/`pickBinaryFile` usan `File.text()` / `File.arrayBuffer()`** en vez de `FileReader`: mismo resultado, promesas nativas, y `File` existe en Node ≥ 20, lo que permite testear el picker sin jsdom (no está instalado).
8. **`appVersion`/`osInfo` siguen llegando por `init`** (desvío 3 de Fase 2); este plan no los toca.
9. **El export `.db` cierra la DB antes de leer** (`runSuspend` → `closeDb` → `exportFile` → `getDb` → `runResume`): la doc de sqlite-wasm dice que `importDb` es indefinido sobre una DB abierta y no dice nada de `exportFile`; cerrar cuesta milisegundos y garantiza un archivo consistente. Tras `importDb` la DB queda **suspendida** (`suspendDb`) y la UI hace `location.reload()` de inmediato (ver desvío 17 para el matiz).
10. **Updater mobile en esta rama** aunque la spec §11 lo pone en Fase 6: el pedido explícito lo trae a Fase 5. Consulta `https://api.github.com/repos/facuga7van/hubtify-releases/releases/latest` (público, 60 req/h sin token: una al montar + una cada 6 h) y reutiliza el banner/estado de `Layout.tsx`; «Descargar» abre `browser_download_url` con `@capacitor/browser`. No hay descarga in-app ni instalación silenciosa.
11. **Comparador semver compartido**: `isNewerVersion` sale de `Layout.tsx` a `src/shared/semver.ts` (mismo código, con test) para que `src/mobile/updater.ts` no lo duplique.
12. **Keystore definitivo y secrets: PENDIENTES del usuario (spec §11 fila 4 pide «keystore generado»).** Este plan firma con el keystore de prueba del scratchpad y NO carga secrets (Tarea 7 Step 3). Consecuencia operativa que hay que tener clara: `publish` tiene `needs: [build-windows, build-android]` y `build-android` falla sin `ANDROID_KEYSTORE_BASE64` → **hasta que existan los 4 secrets, el próximo tag `v*` no publica NADA, tampoco el instalador de Windows.** Antes de mergear `feature/mobile` a `master` (o antes del próximo tag) hay que generar el keystore definitivo y correr los `gh secret set` de `docs/mobile-release.md` §3. El reporte de ejecución lo repite en mayúsculas.
13. **CI no escribe `android/keystore.properties`** (spec §8 dice que CI SÍ lo escribe): las tres variables van directo a Gradle por entorno, que las lee cuando el `.properties` no existe. Un archivo menos con contraseñas en el runner.
14. **`build-windows` suma el gate `typecheck:shared-logic`** (el `release.yml` actual no lo tiene; `ci.yml` sí desde la Fase 1). Y el artifact `windows` lista los 4 globs de siempre en vez de `out/make/**` (§8), para no subir basura de Forge.
15. **Export desde `FatalScreen` solo con `reason === 'migration'`** (spec §12 lo acota a ese caso): en `vfs`/`open` no hay archivo o los canales `mobile:*` todavía no se registraron, y en `crash` no hay worker.
16. **El log de Gradle imprime solo el nombre del `.jks`**, no el alias: en CI el alias es un secret y GitHub enmascararía cada aparición de esa palabra en el log entero.
17. **`importDb` deja la DB suspendida «hasta el `reload()`» con un matiz**: si el usuario manda la app a segundo plano y vuelve antes de que el WebView recargue, el `resume` del worker (Fase 2) hace `resumeDb()` + `getDb()` sobre el archivo recién importado (reabre y corre migraciones). Es inocuo — es exactamente lo que el reload va a hacer — pero no es «nada funciona hasta recargar» en sentido estricto.

**Revisión:** dos rondas. Ronda 1: 2 bloqueantes + 10 menores, todos aplicados. Ronda 2: 1 bloqueante (`OS_INFO_FALLBACK`, que `install-api.ts` importa y la reescritura de `platform-host.ts` borraba) + 8 menores, todos aplicados sin tercera ronda (tope de 2). Verificado localmente además: el `eval` de Task 3 Step 8 exporta la contraseña correcta, el snippet de `keystore.properties` de Task 2 Step 3 escribe las 4 claves, el YAML embebido parsea con js-yaml y el `rg` anti-fugas de Task 6 Step 3 da vacío contra ese YAML.

**Menores señalados por el revisor y aceptados tal cual:** en `tests/mobile/platform-host.test.ts` se usa `r?.name` / `r!.bytes` sobre el `unknown` que devuelve `PlatformHostFns`; no rompe porque `tests/` está fuera del `include` del `tsconfig` y `no-non-null-assertion` está en `off`. No «arreglar» el tipo en `worker-client.ts` por esto.

## Entorno (exportar en CADA shell nueva antes de Gradle/adb/keytool)

```bash
export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.5.11-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="D:/android-sdk"
export ADB="D:/android-sdk/platform-tools/adb.exe"
export APKSIGNER="D:/android-sdk/build-tools/36.0.0/apksigner.bat"
export TEST_KEYSTORE_DIR="C:/Users/Facu/AppData/Local/Temp/claude/D--code-hubtify/53b860af-bd6a-438b-aad3-d62b0bf2bbb3/scratchpad/keystore"
java -version 2>&1 | head -1     # esperado: openjdk version "21.0.5" ...
```

`$TEST_KEYSTORE_DIR` contiene `hubtify-release.jks` (PKCS12, alias `hubtify`) y `password.txt` (la contraseña, una línea). **Nunca** imprimir `password.txt` ni `keystore.properties` en un log, un commit o un mensaje: los comandos de abajo los leen con Node y los escriben directo a archivo.

## File structure

**Nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `android/keystore/` (gitignored) | `release.jks` + `keystore.properties` locales |
| `docs/mobile-release.md` | cómo firmar, cargar secrets, sideloadear, qué es `versionCode` |
| `src/mobile/host-utils.ts` | helpers puros del host: `bytesToBase64`, `acceptFor(filters)`, `isSqliteFile`, `notificationIdFor(tag)` |
| `src/mobile/file-picker.ts` | `pickFile(accept, env)`: `<input type="file">` programático → `File \| null` |
| `src/mobile/db-backup-handlers.ts` | `registerMobileDbHandlers()`: canales `mobile:exportDb` / `mobile:importDb` en el worker |
| `src/mobile/backup.ts` | lado UI del backup `.db`: `exportDb`, `pickDbFile`, `importDb`, `canExportDb` |
| `src/mobile/MobileBackupButtons.tsx` | los dos botones de respaldo de Ajustes en Android (`useConfirm` + `useToast`) |
| `src/mobile/updater.ts` | `findApkUpdate`, `checkMobileUpdate(fetch)`, `openApkDownload(url)` |
| `src/shared/semver.ts` | `isNewerVersion(a, b)` (movido desde `Layout.tsx`) |
| `tests/mobile/host-utils.test.ts`, `file-picker.test.ts`, `platform-host.test.ts`, `db-backup-handlers.test.ts`, `backup.test.ts`, `updater.test.ts`, `tests/shared/semver.test.ts` | tests unitarios (project `unit`) |

**Modificados:**

| Archivo | Cambio |
|---|---|
| `.gitignore` | `android/keystore/` |
| `android/app/build.gradle` | bloque de firma + `signingConfigs.release` + `signingConfig` en `buildTypes.release` |
| `package.json` | script `mobile:apk:release`; deps `@capacitor/local-notifications`, `filesystem`, `share`, `browser` |
| `.github/workflows/release.yml` | tres jobs |
| `.github/workflows/ci.yml` | job `android-build` |
| `src/mobile/platform-host.ts` | implementación completa (Fase 2 dejó stubs) |
| `src/mobile/install-api.ts` | `getWorkerClient()` |
| `src/mobile/worker.ts` | llama `registerMobileDbHandlers` |
| `src/mobile/FatalScreen.tsx` | botón «Exportar base de datos» |
| `shared/types.ts` | `financeImportSelectAndParsePDF` puede devolver `{ ok:false, reason:'unsupported_platform' }` |
| `src/modules/finance/components/Import.tsx` | toast para `unsupported_platform` |
| `src/hub/SettingsPage.tsx` | en Android, `MobileBackupButtons` |
| `src/hub/Layout.tsx` | `isNewerVersion` importado; updater mobile |
| `src/i18n/es.json`, `src/i18n/en.json` | `coinify.importPdfUnsupportedMobile`, `settings.backupDescMobile/exportDb/importDb/importDbConfirm/importDbNotSqlite`, `mobile.fatal.exportDb/exportDbDone/exportDbFailed` |

---

## Chunk 1: Fase 4 — keystore local, firma en Gradle, script y documentación

### Task 1: Verificar los supuestos de las Fases 1 y 2

**Files:** ninguno (solo lectura).

- [ ] **Step 1: Rama, estado y Fase 2 presente**

Run: `git branch --show-current && git log --oneline -1 && git status --short | head -5`
Expected: `feature/mobile`; si hay líneas de status son de la Fase 2 en curso — **no tocarlas**. Si `src/mobile/worker.ts` o `android/app/build.gradle` no existen todavía, **parar** y avisar: este plan necesita la Fase 2 completa.

- [ ] **Step 2: Símbolos que usa este plan**

Run:
```bash
rg -n "export function (registerHandler|getHandler|clearHandlers|runSuspend|runResume)\b" shared-logic/registry.ts
rg -n "suspendDb|resumeDb|closeDb|DbSuspended" shared-logic/db/index.ts shared-logic/db/provider.ts
rg -n "export function buildApi|export type ApiTarget" shared/build-api.ts
rg -n "export type PlatformMethod|export function collectTransferables|export type FatalReason" src/mobile/protocol.ts
rg -n "export (function createWorkerClient|type PlatformHostFns|interface WorkerClient)" src/mobile/worker-client.ts
rg -n "export (const OS_INFO_FALLBACK|function createPlatformHost|async function readOsInfo)" src/mobile/platform-host.ts
rg -n "OS_INFO_FALLBACK" src/mobile/install-api.ts   # la Tarea 11 DEBE conservar esa exportación
rg -n "createWorkerClient\(|await client.ready|export async function installMobileApi" src/mobile/install-api.ts
rg -n "poolUtil|DB_FILE|let booted|\[worker\] vfs" src/mobile/worker.ts
rg -n "export default function FatalScreen|mobile-fatal__button" src/mobile/FatalScreen.tsx
rg -n "\"mobile:(build|sync|run|apk)\"" package.json
rg -n "versionCode|versionName|buildTypes|signingConfigs" android/app/build.gradle
rg -n "compileSdkVersion|targetSdkVersion" android/variables.gradle
rg -n "android/\*\*/(keystore\.properties|\*\.jks)" .gitignore
```
Expected: cada comando imprime al menos una línea. `android/app/build.gradle` NO debe tener `signingConfigs` todavía. `compileSdkVersion = 36` (si es otro número, reemplazar `android-36`/`36.0.0` en las Tareas 3, 6 y 7 por el que corresponda). Anotar cualquier nombre distinto: son los únicos imports a adaptar.

- [ ] **Step 3: Suite base verde y conteo**

Run: `npm test 2>&1 | tail -4`
Expected: `Test Files  N passed (N)`, `Tests  M passed (M)`. Anotar N y M: al cerrar este plan deben ser N+7 y M+47.

- [ ] **Step 4: Keystore de prueba**

Run (con el Entorno exportado):
```bash
keytool -list -keystore "$TEST_KEYSTORE_DIR/hubtify-release.jks" -storepass "$(node -p "require('fs').readFileSync(process.env.TEST_KEYSTORE_DIR + '/password.txt', 'utf8').trim()")" 2>&1 | rg -n "Keystore type|PrivateKeyEntry"
```
Expected: `Keystore type: PKCS12` y una línea `hubtify, …, PrivateKeyEntry,`. (La contraseña se pasa por argumento sin imprimirse; no usar `keytool -v`, que vuelca la cadena entera.)

No hay commit en esta tarea.

### Task 2: `android/keystore/` local y `.gitignore`

**Files:**
- Modify: `.gitignore`
- Create (gitignored): `android/keystore/release.jks`, `android/keystore/keystore.properties`

- [ ] **Step 1: Ignorar el directorio entero**

Agregar al final de `.gitignore`, debajo del bloque `# Android (Capacitor)` que dejó la Fase 2:

```gitignore
android/keystore/
```

Run: `git check-ignore -v android/keystore/release.jks android/keystore/keystore.properties`
Expected: dos líneas, ambas apuntando a `.gitignore:…:android/keystore/`.

- [ ] **Step 2: Copiar el keystore de prueba**

Run:
```bash
mkdir -p android/keystore
cp "$TEST_KEYSTORE_DIR/hubtify-release.jks" android/keystore/release.jks
```

- [ ] **Step 3: Generar `keystore.properties` sin pasar la contraseña por la consola**

Run:
```bash
node -e "
const fs = require('fs');
// .properties: en el valor solo hace falta escapar la barra invertida.
const pw = fs.readFileSync(process.env.TEST_KEYSTORE_DIR + '/password.txt', 'utf8').trim().replace(/\\\\/g, '\\\\\\\\');
fs.writeFileSync('android/keystore/keystore.properties',
  ['storeFile=release.jks', 'storePassword=' + pw, 'keyAlias=hubtify', 'keyPassword=' + pw, ''].join('\n'));
console.log('keystore.properties: ' + fs.statSync('android/keystore/keystore.properties').size + ' bytes');
"
```
Expected: `keystore.properties: NN bytes` (NN > 60). En PKCS12 la clave y el almacén comparten contraseña: por eso `keyPassword` = `storePassword`.

- [ ] **Step 4: Confirmar que git no ve nada del keystore**

Run: `git status --short | rg "keystore" ; echo "(vacío = ok)"`
Expected: solo `(vacío = ok)`. Si aparece alguna ruta, el Step 1 no quedó bien; no seguir hasta arreglarlo.

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore(mobile): ignorar android/keystore"
```

### Task 3: Firma release en `android/app/build.gradle` y script `mobile:apk:release`

**Files:**
- Modify: `android/app/build.gradle`
- Modify: `package.json` (scripts)

Orden de resolución del keystore (desvío 2): `android/keystore/keystore.properties` → variables de entorno `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` (+ `android/keystore/release.jks`) → clave debug. Gradle nunca imprime contraseñas ni el alias (en CI es un secret); el único log es el nombre del archivo.

- [ ] **Step 1: Bloque de resolución del keystore**

Insertar en `android/app/build.gradle` **entre** `apply plugin: 'com.android.application'` y `android {`:

```groovy

// ── Firma release (Fase 4; docs/mobile-release.md) ──────────────────────────
// 1) android/keystore/keystore.properties (local, gitignored)
// 2) variables de entorno ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS /
//    ANDROID_KEY_PASSWORD + android/keystore/release.jks (CI decodifica el .jks)
// 3) nada de lo anterior → assembleRelease firma con la clave debug para que el
//    build no rompa; ese APK NO sirve para publicar (el log lo dice).
def keystoreDir = rootProject.file('keystore')
def keystoreProps = new Properties()
def keystorePropsFile = new File(keystoreDir, 'keystore.properties')
if (keystorePropsFile.exists()) {
    // Reader UTF-8: Properties.load(InputStream) asume ISO-8859-1 y rompería
    // una contraseña con caracteres fuera de Latin-1.
    keystorePropsFile.withReader('UTF-8') { keystoreProps.load(it) }
} else if (System.getenv('ANDROID_KEYSTORE_PASSWORD') != null) {
    // `?: ''`: Properties.put(k, null) lanza NullPointerException y taparía el
    // mensaje legible de abajo cuando falta una de las tres variables.
    keystoreProps['storeFile'] = 'release.jks'
    keystoreProps['storePassword'] = System.getenv('ANDROID_KEYSTORE_PASSWORD') ?: ''
    keystoreProps['keyAlias'] = System.getenv('ANDROID_KEY_ALIAS') ?: ''
    keystoreProps['keyPassword'] = System.getenv('ANDROID_KEY_PASSWORD') ?: ''
}
def releaseKeystoreFile = keystoreProps['storeFile'] ? new File(keystoreDir, keystoreProps['storeFile']) : null
def hasReleaseKeystore = releaseKeystoreFile != null && releaseKeystoreFile.exists()
if (hasReleaseKeystore) {
    if (!keystoreProps['keyAlias'] || !keystoreProps['storePassword'] || !keystoreProps['keyPassword']) {
        throw new GradleException('[hubtify] release signing: keystore found but keyAlias/storePassword/keyPassword missing')
    }
    // Solo el nombre del archivo: el alias es un secret en CI y GitHub
    // enmascararía cada aparición de esa palabra en el log.
    logger.lifecycle("[hubtify] release signing: ${releaseKeystoreFile.name}")
} else {
    logger.lifecycle('[hubtify] release signing: DEBUG key (no keystore found)')
}
```

- [ ] **Step 2: `signingConfigs` y `buildTypes.release`**

Dentro de `android { … }`, reemplazar el bloque `buildTypes { … }` del template:

```groovy
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
```

por (`signingConfigs` va ANTES de `buildTypes` porque éste lo referencia):

```groovy
    signingConfigs {
        release {
            if (hasReleaseKeystore) {
                storeFile releaseKeystoreFile
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
```

Run: `rg -n "signingConfigs|signingConfig |hasReleaseKeystore" android/app/build.gradle | head -12`
Expected: el `def hasReleaseKeystore`, el bloque `signingConfigs {` y la línea `signingConfig hasReleaseKeystore ? …`.

- [ ] **Step 3: Script `mobile:apk:release`**

En `package.json`, después de `"mobile:apk"`:

```json
    "mobile:apk": "npm run mobile:sync && node scripts/gradle.mjs assembleDebug",
    "mobile:apk:release": "npm run mobile:sync && node scripts/gradle.mjs assembleRelease"
```

- [ ] **Step 4: `gradlew` con bit de ejecución en git (CI corre en Linux)**

Run: `git ls-files -s android/gradlew`
Expected: `100755 … android/gradlew`. Si dice `100644`:
```bash
git update-index --chmod=+x android/gradlew
git ls-files -s android/gradlew
```
Expected ahora `100755`. (El `chmod +x` de CI cubre el caso igual, pero el modo correcto en git evita depender de eso.)

- [ ] **Step 5: `assembleRelease` firmado con el keystore local**

Run (Entorno exportado):
```bash
npm run mobile:apk:release 2>&1 | rg -n "\[hubtify\] release signing|BUILD (SUCCESSFUL|FAILED)|error:" | head
```
Expected:
```
[hubtify] release signing: release.jks
BUILD SUCCESSFUL in Xm Ys
```
Errores esperables: `Keystore was tampered with, or password was incorrect` → el `password.txt` no corresponde a ese `.jks`; `SDK location not found` → falta `ANDROID_HOME`; `Unsupported class file major version` → `JAVA_HOME` no es el 21.

- [ ] **Step 6: Verificar la firma con `apksigner`**

Run:
```bash
"$APKSIGNER" verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk | rg -n "Verifies|Verified using v2|Signer #1 certificate DN"
```
Expected:
```
Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Signer #1 certificate DN: CN=…
```
(`--print-certs` imprime el DN y los hashes del certificado: es información pública del firmante, no del keystore.)

- [ ] **Step 7: Verificar el fallback a debug (sin keystore)**

Run:
```bash
mv android/keystore android/keystore.off
node scripts/gradle.mjs assembleRelease 2>&1 | rg -n "\[hubtify\] release signing|BUILD (SUCCESSFUL|FAILED)"
mv android/keystore.off android/keystore
```
Expected: `[hubtify] release signing: DEBUG key (no keystore found)` y `BUILD SUCCESSFUL`. (Si el `mv` de vuelta falla, restaurar a mano ANTES de seguir: sin `android/keystore/` el Step 5 de la Tarea 8 no puede correr.)

- [ ] **Step 8: Verificar la ruta por variables de entorno (la que usa CI)**

Run:
```bash
mv android/keystore/keystore.properties android/keystore/keystore.properties.off
eval "$(node -e "
const pw = require('fs').readFileSync(process.env.TEST_KEYSTORE_DIR + '/password.txt', 'utf8').trim();
const q = (s) => \"'\" + s.replace(/'/g, \"'\\\\''\") + \"'\"; // comillas simples: la shell no expande \$, \\\` ni \\\\
console.log('export ANDROID_KEYSTORE_PASSWORD=' + q(pw) + '; export ANDROID_KEY_ALIAS=hubtify; export ANDROID_KEY_PASSWORD=' + q(pw));
")"
node scripts/gradle.mjs assembleRelease 2>&1 | rg -n "\[hubtify\] release signing|BUILD (SUCCESSFUL|FAILED)"
unset ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD
mv android/keystore/keystore.properties.off android/keystore/keystore.properties
"$APKSIGNER" verify android/app/build/outputs/apk/release/app-release.apk && echo "apksigner: OK"
```
Expected: `[hubtify] release signing: release.jks`, `BUILD SUCCESSFUL`, `apksigner: OK`. (El `eval` exporta las variables en la shell actual sin imprimirlas.)

- [ ] **Step 9: Commit**

El cambio de modo de `android/gradlew` (Step 4, `100644` → `100755`) ya está en el índice por el `git update-index --chmod=+x`: entra en este commit a propósito.

```bash
git add android/app/build.gradle package.json
git status --short --staged
git commit -m "feat(mobile): firma release desde keystore.properties o variables de entorno, con fallback a debug"
```
Expected del `git status`: `M android/app/build.gradle`, `M package.json` y `M android/gradlew` (solo modo). Nada más.

### Task 4: `docs/mobile-release.md`

**Files:**
- Create: `docs/mobile-release.md`

- [ ] **Step 1: Escribir el documento**

````markdown
# Hubtify Android — release, firma y distribución

Complementa `docs/superpowers/specs/2026-09-01-mobile-android-design.md` (§5, §8) y
la skill `~/.claude/skills/release` del usuario (el flujo de versión es el mismo:
bump + tag `v*`).

> **Sin los 4 secrets de §3, el próximo tag no publica NADA**: `publish` espera a
> `build-android`, y ese job falla a propósito si falta el keystore. Cargarlos
> antes del primer tag posterior al merge de `feature/mobile`.

## 1. El keystore

Un APK solo puede actualizar a otro **firmado con la misma clave**. Perder el
keystore = los usuarios tienen que desinstalar y volver a instalar (y pierden la
base local si no exportaron). Por eso:

- El `.jks` y sus contraseñas viven en el gestor de contraseñas **y** como secrets
  del repo. Nunca en git: `android/keystore/` está en `.gitignore`.
- Generar uno nuevo (solo la primera vez, o si se decide rotar la clave y
  aceptar la reinstalación):

  ```bash
  export JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.5.11-hotspot"
  mkdir -p android/keystore        # keytool no crea el directorio
  "$JAVA_HOME/bin/keytool" -genkeypair -v -storetype PKCS12 \
    -keystore android/keystore/release.jks -alias hubtify \
    -keyalg RSA -keysize 2048 -validity 10000
  ```

  PKCS12 usa **una** contraseña para el almacén y la clave.

## 2. Firma local: `android/keystore/keystore.properties`

```properties
storeFile=release.jks
storePassword=<contraseña>
keyAlias=hubtify
keyPassword=<contraseña>
```

`android/app/build.gradle` lo lee si existe. Si no existe pero están las variables
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (y
`android/keystore/release.jks`), usa eso (es lo que hace CI). Sin nada de lo
anterior, `assembleRelease` firma con la clave **debug** y el log de Gradle avisa
`[hubtify] release signing: DEBUG key`: ese APK sirve para probar, no para publicar.

```bash
npm run mobile:apk:release      # dist/mobile → cap sync → assembleRelease
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

## 3. Secrets del repo (`facuga7van/hubtify`)

Cuatro secrets, cargados con `gh` desde una shell con el keystore local ya armado.
Los tres de texto se toman de `keystore.properties` sin pasar por la pantalla. En
`.properties` la barra invertida va escapada (`\\`); Gradle lee las variables de
entorno crudas, así que el `node -p` la des-escapa (`.replace(/\\\\/g, '\\')`).
Lo más simple es elegir una contraseña ASCII sin `\`.

```bash
base64 -w0 android/keystore/release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --repo facuga7van/hubtify
prop() { node -p "require('fs').readFileSync('android/keystore/keystore.properties','utf8').match(/^$1=(.*)$/m)[1].replace(/\\\\\\\\/g, '\\\\')"; }
prop storePassword | gh secret set ANDROID_KEYSTORE_PASSWORD --repo facuga7van/hubtify
prop keyAlias      | gh secret set ANDROID_KEY_ALIAS --repo facuga7van/hubtify
prop keyPassword   | gh secret set ANDROID_KEY_PASSWORD --repo facuga7van/hubtify
gh secret list --repo facuga7van/hubtify | rg ANDROID
```

`release.yml` decodifica `ANDROID_KEYSTORE_BASE64` a `android/keystore/release.jks`,
compila con las variables de entorno, verifica con `apksigner`, renombra a
`Hubtify-<version>.apk`, borra el keystore del runner (`if: always()`) y sube el
APK como artifact. El job `publish` lo adjunta al mismo release de
`facuga7van/hubtify-releases` que el instalador de Windows. Si falta el secret del
keystore el job falla con `::error::` — un release sin APK firmado no se publica a
medias.

## 4. `versionCode` y `versionName`

`scripts/android-version.mjs` (corre en `npm run mobile:sync`, también en CI)
escribe en `android/app/build.gradle`:

- `versionName` = `version` de `package.json` (lo que ve el usuario).
- `versionCode` = `major*10000 + minor*100 + patch` (0.8.2 → 802). Android exige
  que **suba** en cada actualización; con esta fórmula sube solo con la versión de
  `package.json`, así que **cada APK publicado necesita un bump de versión**. Un
  `adb install -r` con un `versionCode` menor falla con
  `INSTALL_FAILED_VERSION_DOWNGRADE` (desinstalar primero). Minor o patch > 99
  rompen el orden: el script lo rechaza.

## 5. Instalar el APK (sideload)

- Con cable/emulador: `adb install -r Hubtify-<version>.apk` (`-r` = reemplazar
  conservando datos). `INSTALL_FAILED_UPDATE_INCOMPATIBLE` significa que el APK
  instalado está firmado con otra clave (típicamente el debug de `mobile:apk`):
  `adb uninstall com.hubtify.app` y volver a instalar.
- Sin cable: bajar `Hubtify-<version>.apk` desde el release en el teléfono, abrirlo
  y permitir «instalar apps desconocidas» para el navegador. La app avisa cuando
  hay una versión nueva y abre esa descarga (updater mobile, Fase 5).

## 6. Checklist de un release con Android

1. `package.json` con la versión nueva, changelog en `src/shared/changelog.ts`.
2. Tag `vX.Y.Z` (skill `release`). `release.yml` corre `build-windows` y
   `build-android` en paralelo y `publish` al final.
3. Verificar en el release: `.exe`, `.nupkg`, `RELEASES`, `.zip` y
   `Hubtify-X.Y.Z.apk`.
4. En un teléfono con la versión anterior: bajar el APK y actualizar sobre la
   instalada (misma firma + `versionCode` mayor). Si algo falla, ver §4/§5.
````

- [ ] **Step 2: Commit**

```bash
git add docs/mobile-release.md
git commit -m "docs(mobile): firma, secrets, sideload y versionCode del release android"
```



## Chunk 2: Fase 4 — CI (`ci.yml`) y release en tres jobs (`release.yml`)

### Task 5: `ci.yml` — job `android-build` (APK debug, sin secrets)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Agregar el job al final del archivo** (después del job `verify`, mismo nivel de indentación)

```yaml

  android-build:
    name: Android debug APK
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
          cache: gradle

      # The runner ships an SDK in $ANDROID_HOME; make sure the exact platform
      # and build-tools from android/variables.gradle are there.
      - name: Install Android SDK packages
        run: |
          SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
          yes | "$SDKMANAGER" --licenses > /dev/null || true
          "$SDKMANAGER" "platforms;android-36" "build-tools;36.0.0" > /dev/null

      - name: Install dependencies
        run: npm ci

      # mobile:sync = vite build (dist/mobile) + versionName/versionCode from
      # package.json + `cap sync android`. No signing here: debug key.
      - name: Build web and sync android
        run: npm run mobile:sync

      - name: Assemble debug APK
        run: |
          chmod +x android/gradlew
          cd android && ./gradlew assembleDebug --no-daemon

      - uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: android/app/build/outputs/apk/debug/app-debug.apk
          if-no-files-found: error
          retention-days: 7
```

- [ ] **Step 2: Validar el YAML**

Run:
```bash
node -e "
const yaml = require('js-yaml'); const fs = require('fs');
const d = yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
console.log('jobs:', Object.keys(d.jobs).join(', '));
console.log('android steps:', d.jobs['android-build'].steps.map(s => s.name || s.uses).join(' | '));
"
```
Expected:
```
jobs: verify, android-build
android steps: actions/checkout@v4 | actions/setup-node@v4 | actions/setup-java@v4 | Install Android SDK packages | Install dependencies | Build web and sync android | Assemble debug APK | actions/upload-artifact@v4
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): job android-build con el apk debug"
```

### Task 6: `release.yml` — `build-windows`, `build-android`, `publish`

**Files:**
- Modify: `.github/workflows/release.yml` (reescritura completa)

Qué se conserva del archivo actual, sin cambios: los gates (tsc, test, lint) y `npm run make` en Windows; el step `Extract changelog` con `node --experimental-strip-types` (byte a byte); `softprops/action-gh-release@v2` al repo `facuga7van/hubtify-releases` con `RELEASES_TOKEN`; el deploy de Functions con `continue-on-error`. Qué cambia: los artefactos viajan entre jobs con `upload-artifact`/`download-artifact` (v4: el path raíz que se conserva es el ancestro común de los globs, `out/make`, así que al bajar quedan en `artifacts/windows/squirrel.windows/x64/…` y `artifacts/windows/zip/win32/x64/…`).

- [ ] **Step 1: Reemplazar el contenido completo de `.github/workflows/release.yml`**

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  # ── Windows installer (unchanged pipeline, now uploads an artifact) ──────
  build-windows:
    runs-on: windows-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules
        run: npm run rebuild

      # ── Quality gates: nothing gets published if any of these fail ──
      - name: Typecheck
        run: npx tsc --noEmit

      - name: Typecheck shared-logic (no electron/node/dom)
        run: npm run typecheck:shared-logic

      - name: Test
        run: npm test

      - name: Lint
        run: npm run lint

      - name: Build installers
        run: npm run make

      - uses: actions/upload-artifact@v4
        with:
          name: windows
          if-no-files-found: error
          retention-days: 3
          path: |
            out/make/squirrel.windows/x64/*.exe
            out/make/squirrel.windows/x64/*.nupkg
            out/make/squirrel.windows/x64/RELEASES
            out/make/zip/win32/x64/*.zip

  # ── Signed Android APK ───────────────────────────────────────────────────
  build-android:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
          cache: gradle

      - name: Install Android SDK packages
        run: |
          SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
          yes | "$SDKMANAGER" --licenses > /dev/null || true
          "$SDKMANAGER" "platforms;android-36" "build-tools;36.0.0" > /dev/null

      - name: Install dependencies
        run: npm ci

      - name: Typecheck shared-logic (no electron/node/dom)
        run: npm run typecheck:shared-logic

      - name: Get version from tag
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/v}" >> "$GITHUB_OUTPUT"

      # versionName comes from package.json (scripts/android-version.mjs), the
      # release name from the tag. They should agree; warn loudly if not.
      - name: Check package.json version against the tag
        run: |
          PKG="$(node -p "require('./package.json').version")"
          if [ "$PKG" != "${{ steps.version.outputs.version }}" ]; then
            echo "::warning::package.json is $PKG but the tag is v${{ steps.version.outputs.version }}; the APK ships versionName $PKG"
          fi

      # mobile:sync = vite build (dist/mobile) + versionName/versionCode from
      # package.json + `cap sync android`.
      - name: Build web and sync android
        run: npm run mobile:sync

      # The keystore only ever exists on disk inside this job; it is removed in
      # the `always()` step below. Nothing here echoes the secret.
      - name: Decode release keystore
        env:
          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          if [ -z "$ANDROID_KEYSTORE_BASE64" ]; then
            echo "::error::ANDROID_KEYSTORE_BASE64 secret is missing (see docs/mobile-release.md)"
            exit 1
          fi
          mkdir -p android/keystore
          printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 -d > android/keystore/release.jks

      # android/app/build.gradle reads these env vars when keystore.properties
      # is absent. Gradle prints only the keystore file name, never the alias
      # or the passwords; do not add --info/--debug here.
      - name: Build signed release APK
        env:
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          chmod +x android/gradlew
          cd android && ./gradlew assembleRelease --no-daemon

      - name: Verify signature and rename
        run: |
          APK=android/app/build/outputs/apk/release/app-release.apk
          "$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs "$APK"
          mv "$APK" "Hubtify-${{ steps.version.outputs.version }}.apk"

      - name: Remove keystore from the runner
        if: always()
        run: rm -rf android/keystore

      - uses: actions/upload-artifact@v4
        with:
          name: android
          if-no-files-found: error
          retention-days: 3
          path: Hubtify-*.apk

  # ── One release with everything ──────────────────────────────────────────
  publish:
    needs: [build-windows, build-android]
    runs-on: ubuntu-latest

    steps:
      # The changelog step imports src/shared/changelog.ts: needs the repo + node.
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Get version from tag
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/v}" >> "$GITHUB_OUTPUT"

      - uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: List artifacts
        run: find artifacts -type f | sort

      # `require()` cannot load a .ts file, so this step used to throw, get
      # swallowed by `|| true`, never write RELEASE_NOTES.md, and every release
      # silently fell back to GitHub's auto-generated commit list. Node's type
      # stripping loads the module for real; and `text` is `{ es, en }`, so
      # printing it raw rendered "[object Object]".
      - name: Extract changelog
        id: changelog
        shell: bash
        run: |
          node --experimental-strip-types -e "
            import('./src/shared/changelog.ts').then(({ changelog }) => {
              const version = '${{ steps.version.outputs.version }}';
              const entry = changelog.find(e => e.version === version);
              if (!entry) { console.log('No changelog entry for ' + version); return; }
              const cats = { feat: ['Novedades', 'New Features'], fix: ['Arreglos', 'Bug Fixes'], refactor: ['Mejoras', 'Refactoring'], chore: ['Mantenimiento', 'Maintenance'] };
              const order = ['feat', 'fix', 'refactor', 'chore'];
              const grouped = {};
              entry.changes.forEach(c => { (grouped[c.category] = grouped[c.category] || []).push(c); });
              const render = (langIndex, key) => {
                let md = '';
                for (const cat of order) {
                  const items = grouped[cat];
                  if (!items) continue;
                  md += '### ' + (cats[cat] ? cats[cat][langIndex] : cat) + String.fromCharCode(10);
                  items.forEach(c => { md += '- ' + (c.scope ? '**' + c.scope + ':** ' : '') + c.text[key] + String.fromCharCode(10); });
                  md += String.fromCharCode(10);
                }
                return md.trim();
              };
              const md = '## Espanol' + String.fromCharCode(10, 10) + render(0, 'es')
                + String.fromCharCode(10, 10) + '## English' + String.fromCharCode(10, 10) + render(1, 'en');
              require('fs').writeFileSync('RELEASE_NOTES.md', md);
              console.log('Wrote RELEASE_NOTES.md for ' + version);
            }).catch(err => { console.log('Changelog extraction failed: ' + err.message); });
          "

      - name: Check release notes
        id: notes
        shell: bash
        run: |
          if [ -f RELEASE_NOTES.md ]; then
            echo "has_notes=true" >> $GITHUB_OUTPUT
          else
            echo "has_notes=false" >> $GITHUB_OUTPUT
          fi

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          repository: facuga7van/hubtify-releases
          token: ${{ secrets.RELEASES_TOKEN }}
          target_commitish: main
          name: Hubtify v${{ steps.version.outputs.version }}
          tag_name: v${{ steps.version.outputs.version }}
          draft: false
          prerelease: false
          generate_release_notes: ${{ steps.notes.outputs.has_notes != 'true' }}
          body_path: ${{ steps.notes.outputs.has_notes == 'true' && 'RELEASE_NOTES.md' || '' }}
          files: |
            artifacts/windows/squirrel.windows/x64/*.exe
            artifacts/windows/squirrel.windows/x64/*.nupkg
            artifacts/windows/squirrel.windows/x64/RELEASES
            artifacts/windows/zip/win32/x64/*.zip
            artifacts/android/Hubtify-*.apk

      # Best-effort: deploying Functions must NOT block the app release. Runs
      # after the release is published and won't fail the workflow if the
      # FIREBASE_TOKEN is stale (regenerate with `firebase login:ci`).
      - name: Deploy Cloud Functions
        continue-on-error: true
        shell: bash
        run: cd functions && npm ci && npm run build && npx firebase deploy --only functions --force --token "$FIREBASE_TOKEN"
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```

- [ ] **Step 2: Validar estructura y secrets del YAML**

Run:
```bash
node -e "
const yaml = require('js-yaml'); const fs = require('fs');
const src = fs.readFileSync('.github/workflows/release.yml', 'utf8');
const d = yaml.load(src);
console.log('jobs:', Object.keys(d.jobs).join(', '));
console.log('publish needs:', JSON.stringify(d.jobs.publish.needs));
const secrets = [...src.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m => m[1]);
console.log('secrets:', [...new Set(secrets)].sort().join(', '));
const files = d.jobs.publish.steps.find(s => s.uses && s.uses.startsWith('softprops/action-gh-release')).with.files.trim().split('\n').length;
console.log('release files:', files);
const changelogNow = src.split('Extract changelog')[1].split('Check release notes')[0];
const changelogOld = require('child_process').execSync('git show HEAD:.github/workflows/release.yml', { encoding: 'utf8' }).split('Extract changelog')[1].split('Check release notes')[0];
console.log('changelog step unchanged:', changelogNow === changelogOld);
"
```
Expected (exacto):
```
jobs: build-windows, build-android, publish
publish needs: ["build-windows","build-android"]
secrets: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, FIREBASE_TOKEN, RELEASES_TOKEN
release files: 5
changelog step unchanged: true
```

- [ ] **Step 3: Revisión de fugas del keystore en el YAML**

Run: `rg -v '^\s*#' .github/workflows/release.yml | rg -n '(^\s*|[;|&]\s*|run: )cat |echo .*\$\{?ANDROID_|--info|--debug|keystore\.properties' ; echo "(vacío = ok)"`
Expected: solo `(vacío = ok)`. (Se filtran los comentarios, que mencionan `--info`/`keystore.properties` a propósito; `cat` solo cuenta en posición de comando — el `for (const cat of order)` del changelog no matchea; el `echo "::error::ANDROID_KEYSTORE_BASE64 …"` no expande ninguna variable y por eso tampoco.) Ningún step imprime variables de firma ni lee el keystore por pantalla; el `.jks` se borra con `if: always()`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "chore(ci): release en tres jobs con el apk android firmado en el mismo release"
```

### Task 7: Ensayo local del job `build-android` y cierre de la Fase 4

**Files:** ninguno nuevo. Reproduce en la máquina local, paso a paso, lo que hace `build-android` (menos el runner). Requiere `android/keystore/` de la Tarea 2.

- [ ] **Step 1: Mismo pipeline que CI, con la ruta de variables de entorno**

Run (Entorno exportado; en una shell nueva para no arrastrar variables):
```bash
npm run typecheck:shared-logic && echo "typecheck: OK"
npm run mobile:sync 2>&1 | rg -n "android-version|Sync finished|error" 
mv android/keystore/keystore.properties android/keystore/keystore.properties.off
eval "$(node -e "
const pw = require('fs').readFileSync(process.env.TEST_KEYSTORE_DIR + '/password.txt', 'utf8').trim();
const q = (s) => \"'\" + s.replace(/'/g, \"'\\\\''\") + \"'\"; // comillas simples: la shell no expande \$, \\\` ni \\\\
console.log('export ANDROID_KEYSTORE_PASSWORD=' + q(pw) + '; export ANDROID_KEY_ALIAS=hubtify; export ANDROID_KEY_PASSWORD=' + q(pw));
")"
node scripts/gradle.mjs assembleRelease 2>&1 | rg -n "\[hubtify\] release signing|BUILD (SUCCESSFUL|FAILED)"
unset ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD
mv android/keystore/keystore.properties.off android/keystore/keystore.properties
VERSION="$(node -p "require('./package.json').version")"
"$APKSIGNER" verify --print-certs android/app/build/outputs/apk/release/app-release.apk | rg -n "Signer #1 certificate DN"
cp android/app/build/outputs/apk/release/app-release.apk "Hubtify-$VERSION.apk" && node -e "console.log('Hubtify-$VERSION.apk', (require('fs').statSync('Hubtify-$VERSION.apk').size/1e6).toFixed(1), 'MB')"
rm "Hubtify-$VERSION.apk"
```
Expected: `typecheck: OK`; `[android-version] versionName 0.8.x versionCode 80x`; `[success] Sync finished`; `[hubtify] release signing: release.jks`; `BUILD SUCCESSFUL`; `Signer #1 certificate DN: CN=…`; `Hubtify-0.8.x.apk N.N MB` (N > 3).

- [ ] **Step 2: El APK firmado instala en el emulador**

Con el AVD `hubtify` corriendo (`"$ADB" devices` → `emulator-5554 device`). Si hay un build debug instalado, la firma no coincide y hay que desinstalar primero:
```bash
"$ADB" uninstall com.hubtify.app || true
"$ADB" install android/app/build/outputs/apk/release/app-release.apk
"$ADB" shell dumpsys package com.hubtify.app | rg -n "versionName|versionCode"
```
Expected: `Success` y `versionCode=80x … versionName=0.8.x`.

- [ ] **Step 3: Secrets — NO se cargan en esta tarea (desvío 12)**

Los comandos `gh secret set` están en `docs/mobile-release.md` §3. Cargarlos es una decisión del usuario (keystore definitivo vs. el de prueba). Dejar constancia en el reporte, EN MAYÚSCULAS: los 4 secrets están pendientes; `build-android` falla en `Decode release keystore` hasta que existan; y como `publish` depende de los dos builds, **EL PRÓXIMO TAG `v*` NO PUBLICA NI EL INSTALADOR DE WINDOWS hasta que se carguen**. Hay que hacerlo antes de mergear `feature/mobile` a `master`.

- [ ] **Step 4: Checklist de aceptación (spec §11, fila 4)**

- [ ] `release.yml` en 3 jobs, YAML válido, secrets con los nombres de la spec
- [ ] `ci.yml` con `android-build` (debug, sin secrets)
- [ ] `.gitignore` ignora `android/keystore/`
- [ ] `assembleRelease` firmado local + `apksigner verify` OK (Tarea 3 y Tarea 7)
- [ ] fallback a debug verificado (Tarea 3 Step 7)
- [ ] `docs/mobile-release.md` escrito

Run: `git status --short | rg -v "^\?\? " ; echo "(vacío = ok)"`
Expected: solo `(vacío = ok)` (los untracked que haya son de la Fase 2; `android/keystore/` no aparece por el `.gitignore`).

No hay commit en esta tarea.



## Chunk 3: Fase 5 — `platform-host.ts` completo (notificaciones, archivos, navegador) y el toast del PDF

### Task 8: Dependencias de Capacitor para el host

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify (por `cap sync`): `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`

- [ ] **Step 1: Instalar los cuatro plugins con versión exacta**

Run:
```bash
npm install --save-exact @capacitor/local-notifications@8.3.1 @capacitor/filesystem@8.1.3 @capacitor/share@8.0.1 @capacitor/browser@8.0.4
```
Expected: `added K packages` sin `ERR!`. (Versiones verificadas con `npm view` el 2026-09-02.)

- [ ] **Step 2: Registrar los plugins en el proyecto Android**

Run: `npx cap sync android 2>&1 | rg -n "Capacitor plugins|@capacitor/|Sync finished"`
Expected: `Found 7 Capacitor plugins for android:` seguido de `app`, `browser`, `device`, `filesystem`, `local-notifications`, `share`, `status-bar` (con sus versiones) y `[success] Sync finished`.

Run: `git status --short android | rg -v "assets/public|build/"`
Expected: `M android/app/capacitor.build.gradle` y `M android/capacitor.settings.gradle` (la lista de plugins). Nada más.

- [ ] **Step 3: Suite sigue verde**

Run: `npm test 2>&1 | tail -3`
Expected: mismos N/M de la Tarea 1.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json android/app/capacitor.build.gradle android/capacitor.settings.gradle
git commit -m "chore(mobile): plugins local-notifications, filesystem, share y browser"
```

### Task 9: `src/mobile/host-utils.ts` — helpers puros del host

**Files:**
- Create: `src/mobile/host-utils.ts`
- Test: `tests/mobile/host-utils.test.ts`

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/host-utils.test.ts
import { describe, it, expect } from 'vitest';
import { acceptFor, bytesToBase64, isSqliteFile, notificationIdFor } from '../../src/mobile/host-utils';

describe('bytesToBase64', () => {
  it('codifica como Buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('vacío → cadena vacía', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });

  it('un buffer más grande que el chunk (32 KiB) se codifica entero', () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});

describe('acceptFor', () => {
  it('convierte extensiones a la lista de accept del input', () => {
    expect(acceptFor([{ name: 'CSV', extensions: ['csv', '.txt'] }, { name: 'X', extensions: ['CSV'] }])).toBe('.csv,.txt');
  });

  it('comodín o sin filtros → cualquier archivo', () => {
    expect(acceptFor([{ name: 'Todos', extensions: ['*'] }])).toBe('');
    expect(acceptFor([])).toBe('');
  });
});

describe('isSqliteFile', () => {
  it('reconoce la cabecera "SQLite format 3\\0"', () => {
    const bytes = new Uint8Array(4096);
    bytes.set(new TextEncoder().encode('SQLite format 3\0'));
    expect(isSqliteFile(bytes)).toBe(true);
  });

  it('rechaza archivos cortos o con otra cabecera', () => {
    expect(isSqliteFile(new Uint8Array(10))).toBe(false);
    const zip = new Uint8Array(4096);
    zip.set([0x50, 0x4b, 0x03, 0x04]);
    expect(isSqliteFile(zip)).toBe(false);
  });
});

describe('notificationIdFor', () => {
  it('mismo tag → mismo id (reemplaza la notificación anterior)', () => {
    expect(notificationIdFor('streak')).toBe(notificationIdFor('streak'));
    expect(notificationIdFor('streak')).not.toBe(notificationIdFor('cauldron'));
  });

  it('los ids con tag viven en [2^30, 2^31) — int32 positivo de Android', () => {
    const id = notificationIdFor('cualquier cosa');
    expect(id).toBeGreaterThanOrEqual(0x40000000);
    expect(id).toBeLessThan(0x80000000);
  });

  it('sin tag → ids distintos, crecientes y por debajo de 2^30', () => {
    const a = notificationIdFor();
    const b = notificationIdFor();
    expect(b).toBe(a + 1);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(0x40000000);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/host-utils.test.ts 2>&1 | tail -4`
Expected: `Failed to resolve import "../../src/mobile/host-utils"`.

- [ ] **Step 3: Crear `src/mobile/host-utils.ts`**

```ts
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
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/host-utils.test.ts 2>&1 | tail -4`
Expected: `Tests  10 passed (10)`.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/host-utils.ts tests/mobile/host-utils.test.ts
git commit -m "feat(mobile): helpers del host (base64, accept, cabecera sqlite, ids de notificación)"
```

### Task 10: `src/mobile/file-picker.ts` — `<input type="file">` programático

**Files:**
- Create: `src/mobile/file-picker.ts`
- Test: `tests/mobile/file-picker.test.ts`

En el WebView de Capacitor un `input.click()` abre el selector de archivos del sistema (`onShowFileChooser`). Cancelar dispara `cancel` (Chromium ≥ 113; el WebView del emulador es 124). Como red de seguridad para WebViews viejos: cuando la ventana recupera el foco sin `change`, se resuelve `null` tras `FOCUS_CANCEL_GRACE_MS`. El entorno DOM se inyecta para poder testear en Node (desvío 7).

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/file-picker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FOCUS_CANCEL_GRACE_MS, pickFile, type PickerEnv, type PickerInput } from '../../src/mobile/file-picker';

function makeEnv() {
  const listeners = new Map<string, () => void>();
  const input: PickerInput & { removed: boolean } = {
    type: '', accept: '', hidden: false, files: null, removed: false,
    click: vi.fn(),
    addEventListener: (type, l) => { listeners.set(type, l); },
    remove() { this.removed = true; },
  };
  let focusListener: (() => void) | null = null;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const env: PickerEnv = {
    createInput: () => input,
    mount: vi.fn(),
    onWindowFocus: (l) => { focusListener = l; return () => { focusListener = null; }; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  };
  return { env, input, fire: (t: string) => listeners.get(t)?.(), focus: () => focusListener?.(), timers, hasFocusListener: () => focusListener !== null };
}

describe('pickFile', () => {
  it('configura y monta el input, hace click y devuelve el archivo elegido', async () => {
    const { env, input, fire } = makeEnv();
    const p = pickFile('.csv', env);
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.csv');
    expect(input.hidden).toBe(true);
    expect(env.mount).toHaveBeenCalledWith(input);
    expect(input.click).toHaveBeenCalledTimes(1);

    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' });
    input.files = [file];
    fire('change');
    await expect(p).resolves.toBe(file);
    expect(input.removed).toBe(true);
  });

  it('cancel → null', async () => {
    const { env, input, fire, hasFocusListener } = makeEnv();
    const p = pickFile('', env);
    fire('cancel');
    await expect(p).resolves.toBeNull();
    expect(input.removed).toBe(true);
    expect(hasFocusListener()).toBe(false);
  });

  it('foco recuperado sin change → null después del período de gracia', async () => {
    const { env, focus, timers } = makeEnv();
    const p = pickFile('', env);
    focus();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(FOCUS_CANCEL_GRACE_MS);
    timers[0].fn();
    await expect(p).resolves.toBeNull();
  });

  it('si change llega dentro del período de gracia gana el archivo', async () => {
    const { env, input, fire, focus, timers } = makeEnv();
    const p = pickFile('', env);
    focus();
    const file = new File(['x'], 'x.db');
    input.files = [file];
    fire('change');
    timers[0].fn(); // ya resuelto: no-op
    await expect(p).resolves.toBe(file);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/file-picker.test.ts 2>&1 | tail -4`
Expected: `Failed to resolve import "../../src/mobile/file-picker"`.

- [ ] **Step 3: Crear `src/mobile/file-picker.ts`**

```ts
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
    });

    env.mount(input);
    input.click();
  });
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/file-picker.test.ts 2>&1 | tail -4`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/file-picker.ts tests/mobile/file-picker.test.ts
git commit -m "feat(mobile): selector de archivos con input programático y cancelación"
```

### Task 11: `src/mobile/platform-host.ts` — implementación completa

**Files:**
- Modify (reescritura completa): `src/mobile/platform-host.ts`
- Test: `tests/mobile/platform-host.test.ts`

APIs reales (doc capacitorjs.com/docs/apis/*, verificadas 2026-09-02):
- `LocalNotifications.checkPermissions()/requestPermissions(): Promise<{ display: 'prompt'|'prompt-with-rationale'|'granted'|'denied' }>`; `createChannel({ id, name, description?, importance? })`; `schedule({ notifications: [{ id: number, title, body, channelId? }] })` — **sin `schedule:` se muestra al instante**. Android 13+ exige el `requestPermissions`; no hace falta `SCHEDULE_EXACT_ALARM` (no se programan alarmas exactas).
- `Filesystem.writeFile({ path, data, directory: Directory.Cache, encoding?, recursive })` → `{ uri }`; sin `encoding`, `data` **debe ser base64**. `Directory.Cache` es el `cacheDir` de la app, cubierto por el `<cache-path>` del `file_paths.xml` del template de Capacitor: se puede compartir sin configuración extra.
- `Share.share({ title, files: [uri], dialogTitle })` → `{ activityType }`; si el usuario cancela, **rechaza con `"Share canceled"`** (`SharePlugin.java`).
- `Browser.open({ url })` abre Custom Tabs.

- [ ] **Step 1: Escribir el test**

```ts
// tests/mobile/platform-host.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    createChannel: vi.fn(async () => undefined),
    schedule: vi.fn(async () => ({ notifications: [] })),
  },
}));
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: vi.fn(async () => ({ uri: 'file:///cache/share/x' })) },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));
vi.mock('@capacitor/share', () => ({ Share: { share: vi.fn(async () => ({ activityType: 'com.x' })) } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => undefined) } }));
vi.mock('@capacitor/device', () => ({ Device: { getInfo: vi.fn(async () => ({ platform: 'android', osVersion: '14' })) } }));

import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';
import { createPlatformHost, NOTIFICATION_CHANNEL_ID, readOsInfo } from '../../src/mobile/platform-host';

const m = vi.mocked;

function host(file: File | null = null) {
  return createPlatformHost({ pickFile: vi.fn(async () => file) });
}

beforeEach(() => {
  vi.clearAllMocks();
  m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'prompt' });
  m(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' });
});

describe('notify', () => {
  it('pide permiso la primera vez, crea el canal una sola vez y programa al instante', async () => {
    const h = host();
    await h.notify({ title: 'T', body: 'B', tag: 'streak' });
    await h.notify({ title: 'T2', body: 'B2', tag: 'streak' });
    expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(LocalNotifications.createChannel).toHaveBeenCalledTimes(1);
    expect(LocalNotifications.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: NOTIFICATION_CHANNEL_ID, name: 'Hubtify' }));
    const calls = m(LocalNotifications.schedule).mock.calls;
    expect(calls).toHaveLength(2);
    const [first, second] = calls.map((c) => c[0].notifications[0]);
    expect(first).toEqual({ id: expect.any(Number), title: 'T', body: 'B', channelId: NOTIFICATION_CHANNEL_ID });
    expect(first.id).toBe(second.id); // mismo tag → reemplaza
    expect(first).not.toHaveProperty('schedule');
  });

  it('con permiso ya concedido no vuelve a pedirlo', async () => {
    m(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    await host().notify({ title: 'T', body: 'B' });
    expect(LocalNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(LocalNotifications.schedule).toHaveBeenCalledTimes(1);
  });

  it('permiso denegado: no programa y no insiste en la misma sesión', async () => {
    m(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'denied' });
    const h = host();
    await h.notify({ title: 'T', body: 'B' });
    await h.notify({ title: 'T', body: 'B' });
    expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
  });
});

describe('archivos', () => {
  it('saveTextFile escribe UTF-8 en Cache/share y comparte el uri', async () => {
    await expect(host().saveTextFile('coinify-2026-09.csv', 'a,b')).resolves.toBe(true);
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: 'share/coinify-2026-09.csv', data: 'a,b', directory: 'CACHE', encoding: 'utf8', recursive: true,
    });
    expect(Share.share).toHaveBeenCalledWith({ title: 'coinify-2026-09.csv', files: ['file:///cache/share/x'], dialogTitle: 'coinify-2026-09.csv' });
  });

  it('saveBinaryFile escribe base64 sin encoding', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    await expect(host().saveBinaryFile('hubtify.db', bytes)).resolves.toBe(true);
    const opts = m(Filesystem.writeFile).mock.calls[0][0];
    expect(opts).toMatchObject({ path: 'share/hubtify.db', data: Buffer.from(bytes).toString('base64'), directory: 'CACHE' });
    expect(opts).not.toHaveProperty('encoding');
  });

  it('share cancelado → false; otro error → lanza', async () => {
    m(Share.share).mockRejectedValueOnce(new Error('Share canceled'));
    await expect(host().saveTextFile('x.csv', '')).resolves.toBe(false);
    m(Share.share).mockRejectedValueOnce(new Error('No activity found'));
    await expect(host().saveTextFile('x.csv', '')).rejects.toThrow('No activity found');
  });

  it('pickTextFile → { name, content } con el accept de los filtros; null si cancela', async () => {
    const file = new File(['a,b\n1,2'], 'mov.csv', { type: 'text/csv' });
    const pick = vi.fn(async () => file);
    const h = createPlatformHost({ pickFile: pick });
    await expect(h.pickTextFile([{ name: 'CSV', extensions: ['csv'] }])).resolves.toEqual({ name: 'mov.csv', content: 'a,b\n1,2' });
    expect(pick).toHaveBeenCalledWith('.csv');
    await expect(host(null).pickTextFile([])).resolves.toBeNull();
  });

  it('pickBinaryFile → bytes como Uint8Array', async () => {
    const file = new File([new Uint8Array([9, 8, 7])], 'x.db');
    const r = await host(file).pickBinaryFile([{ name: 'DB', extensions: ['*'] }]);
    expect(r?.name).toBe('x.db');
    expect(Array.from(r!.bytes)).toEqual([9, 8, 7]);
  });

  it('pickPdfText → unsupported (sin pdf-parse en Android)', async () => {
    await expect(host().pickPdfText()).resolves.toEqual({ unsupported: true });
  });
});

describe('otros', () => {
  it('openExternal abre el navegador del sistema', async () => {
    await host().openExternal('https://example.com');
    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://example.com' });
  });

  it('readOsInfo', async () => {
    await expect(readOsInfo()).resolves.toBe('android 14');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/platform-host.test.ts 2>&1 | tail -6`
Expected: fallos del tipo `createPlatformHost is not a function with 1 argument` / `NOTIFICATION_CHANNEL_ID` undefined / `expected true, received false` (los stubs de Fase 2 devuelven `false`/`null`). Si en cambio aparece `Failed to resolve import "@capacitor/local-notifications"`, la Task 8 no corrió.

- [ ] **Step 3: Reescribir `src/mobile/platform-host.ts`** (contenido completo)

```ts
/**
 * Lado UI del `PlatformPort` (spec §6, columna «Mobile»). El worker manda
 * `{ type:'platform', method, args }` (worker-client.ts lo despacha acá) y
 * esto lo resuelve con plugins de Capacitor:
 *
 *   notify          → @capacitor/local-notifications (schedule inmediato)
 *   openExternal    → @capacitor/browser
 *   saveTextFile /
 *   saveBinaryFile  → @capacitor/filesystem (Directory.Cache) + @capacitor/share
 *   pickTextFile /
 *   pickBinaryFile  → <input type="file"> (file-picker.ts)
 *   pickPdfText     → { unsupported: true } (sin pdf-parse; spec §1)
 *
 * `appVersion()` y `osInfo()` son síncronos en la interfaz y no pueden hacer
 * round-trip: la UI los manda una vez con `{ type:'init' }` (install-api.ts).
 */
import { Browser } from '@capacitor/browser';
import { Device } from '@capacitor/device';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';
import type { FileFilter } from '@logic/platform';
import { pickFile } from './file-picker';
import { acceptFor, bytesToBase64, notificationIdFor } from './host-utils';
import type { PlatformHostFns } from './worker-client';

export const NOTIFICATION_CHANNEL_ID = 'hubtify';
/** Subcarpeta de Directory.Cache; el FileProvider del template permite todo el cache. */
const SHARE_DIR = 'share';

/** Lo importa install-api.ts (Fase 2) para el timeout de `readOsInfo`. */
export const OS_INFO_FALLBACK = 'android';

export async function readOsInfo(): Promise<string> {
  try {
    const info = await Device.getInfo();
    return `${info.platform} ${info.osVersion}`;
  } catch (err) {
    console.warn('[mobile] Device.getInfo falló:', err);
    return OS_INFO_FALLBACK;
  }
}

/** El plugin rechaza con "Share canceled" cuando el usuario cierra el share sheet. */
export function isShareCanceled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(message);
}

export interface PlatformHostDeps {
  pickFile: (accept: string) => Promise<File | null>;
}

export function createPlatformHost(deps: PlatformHostDeps = { pickFile }): PlatformHostFns {
  // Android 13+ pide POST_NOTIFICATIONS en runtime. Se pregunta una vez por
  // sesión; si el usuario dice que no, no se insiste hasta el próximo arranque.
  let permission: 'unknown' | 'granted' | 'denied' = 'unknown';
  let channelReady = false;

  async function notificationsReady(): Promise<boolean> {
    if (permission === 'unknown') {
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') status = await LocalNotifications.requestPermissions();
      permission = status.display === 'granted' ? 'granted' : 'denied';
    }
    if (permission !== 'granted') return false;
    if (!channelReady) {
      await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'Hubtify',
        description: 'Recordatorios, rachas y Cauldron',
        importance: 4,
      });
      channelReady = true;
    }
    return true;
  }

  async function writeAndShare(name: string, data: string, encoding?: Encoding): Promise<boolean> {
    const { uri } = await Filesystem.writeFile({
      path: `${SHARE_DIR}/${name}`,
      data,
      directory: Directory.Cache,
      recursive: true,
      ...(encoding ? { encoding } : {}),
    });
    try {
      await Share.share({ title: name, files: [uri], dialogTitle: name });
      return true;
    } catch (err) {
      if (isShareCanceled(err)) return false;
      throw err;
    }
  }

  return {
    async notify(n: { title: string; body: string; tag?: string }) {
      if (!(await notificationsReady())) return;
      await LocalNotifications.schedule({
        notifications: [{ id: notificationIdFor(n.tag), title: n.title, body: n.body, channelId: NOTIFICATION_CHANNEL_ID }],
      });
    },

    async openExternal(url: string) {
      await Browser.open({ url });
    },

    async pickTextFile(filters: FileFilter[]) {
      const file = await deps.pickFile(acceptFor(filters));
      if (!file) return null;
      return { name: file.name, content: await file.text() };
    },

    // Import de resúmenes PDF: fuera de alcance en mobile (spec §1). El handler
    // de finance-import responde { ok:false, reason:'unsupported_platform' }.
    async pickPdfText() {
      return { unsupported: true as const };
    },

    async pickBinaryFile(filters: FileFilter[]) {
      const file = await deps.pickFile(acceptFor(filters));
      if (!file) return null;
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },

    async saveTextFile(name: string, content: string) {
      return writeAndShare(name, content, Encoding.UTF8);
    },

    async saveBinaryFile(name: string, bytes: Uint8Array) {
      return writeAndShare(name, bytesToBase64(bytes));
    },
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/platform-host.test.ts 2>&1 | tail -4`
Expected: `Tests  11 passed (11)`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: sin salida. Errores esperables:
- `Type '{ notify(...): ... }' is not assignable to 'PlatformHostFns'` → `PlatformHostFns` de la Fase 2 tipa cada método como `(...args: any[]) => Promise<unknown>`; las firmas de arriba son más estrictas y deben ser asignables. Si no lo son, revisar que el objeto devuelto no tenga claves de más ni de menos que `PlatformMethod`.
- `importance: 4` no asignable → el tipo `Importance` del plugin es `1|2|3|4|5`; escribir `importance: 4 as const`.

- [ ] **Step 6: Commit**

```bash
git add src/mobile/platform-host.ts tests/mobile/platform-host.test.ts
git commit -m "feat(mobile): platform-host con notificaciones locales, share de archivos, picker y navegador"
```

### Task 12: Toast «PDF no soportado» en Coinify + tipo del handler

**Files:**
- Modify: `shared/types.ts` (línea de `financeImportSelectAndParsePDF`)
- Modify: `src/modules/finance/components/Import.tsx` (`handleSelectFile`)
- Modify: `src/i18n/es.json`, `src/i18n/en.json` (`coinify.importPdfUnsupportedMobile`)

La Fase 1 dejó el handler devolviendo `{ ok:false, reason:'unsupported_platform' }` cuando `pickPdfText()` da `{ unsupported:true }`, pero `HubtifyApi` no lo declara y `Import.tsx` haría `result.rows.map` sobre `undefined` (cae al `catch` y muestra «No se pudo procesar el PDF», que es mentira).

- [ ] **Step 1: Tipo en `shared/types.ts`**

Reemplazar la línea

```ts
  financeImportSelectAndParsePDF: () => Promise<{ rows: ParsedRow[]; fileName: string; skippedLines: string[] } | null>;
```

por

```ts
  financeImportSelectAndParsePDF: () => Promise<
    | { rows: ParsedRow[]; fileName: string; skippedLines: string[] }
    | { ok: false; reason: 'unsupported_platform' }
    | null
  >;
```

- [ ] **Step 2: i18n**

`src/i18n/es.json`, sección `coinify`, entre `"importParsing"` y `"importPreview"` (orden alfabético):

```json
    "importPdfUnsupportedMobile": "Importar resúmenes PDF no está disponible en Android. Usalo desde la app de escritorio.",
```

`src/i18n/en.json`, misma posición:

```json
    "importPdfUnsupportedMobile": "Importing PDF statements is not available on Android. Use the desktop app.",
```

Run: `node -e "for (const l of ['es','en']) { const c = require('./src/i18n/'+l+'.json').coinify; const k = Object.keys(c); const i = k.indexOf('importPdfUnsupportedMobile'); console.log(l, k[i-1], '<', k[i], '<', k[i+1]) }"`
Expected: `es importParsing < importPdfUnsupportedMobile < importPreview` y lo mismo para `en`.

- [ ] **Step 3: `Import.tsx` — manejar el caso**

En `handleSelectFile`, reemplazar

```ts
      const result = await window.api.financeImportSelectAndParsePDF();
      if (!result) {
        setParsing(false);
        return; // user cancelled dialog
      }
```

por

```ts
      const result = await window.api.financeImportSelectAndParsePDF();
      if (!result) {
        setParsing(false);
        return; // user cancelled dialog
      }
      if ('ok' in result) {
        // Android: no hay pdf-parse (spec §1). El handler lo dice; acá se explica.
        toast({
          type: 'info',
          message: t('coinify.importPdfUnsupportedMobile', 'Importar resúmenes PDF no está disponible en Android. Usalo desde la app de escritorio.'),
        });
        return; // el finally apaga `parsing`
      }
```

- [ ] **Step 4: Typecheck, lint, suite**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: tsc sin salida; lint sin errores; `Test Files  N+3 passed`.

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts src/modules/finance/components/Import.tsx src/i18n/es.json src/i18n/en.json
git commit -m "feat(finance): toast cuando importar PDF no está disponible en la plataforma"
```



## Chunk 4: Fase 5 — backup `.db` y `FatalScreen`

### Task 13: `src/mobile/db-backup-handlers.ts` — canales `mobile:exportDb` / `mobile:importDb` en el worker

**Files:**
- Create: `src/mobile/backup-channels.ts`
- Create: `src/mobile/db-backup-handlers.ts`
- Modify: `src/mobile/worker.ts`
- Test: `tests/mobile/db-backup-handlers.test.ts`

Los dos canales se registran en el **registry de shared-logic** (`registerHandler`), así viajan por el mismo `invoke` que todo lo demás y el `Uint8Array` del export sale con transfer list gracias a `collectTransferables` (worker-protocol, Fase 2). Contrato:
- `mobile:exportDb` → `Uint8Array` con el archivo. Cierra la DB antes de leer (desvío 9) y la reabre si el worker ya estaba `ready`.
- `mobile:importDb(bytes)` → `{ ok:true, bytes }`. Valida la cabecera, `runSuspend()` + `suspendDb()` (queda suspendida hasta el `location.reload()` de la UI) y `poolUtil.importDb`.

- [ ] **Step 1: Crear `src/mobile/backup-channels.ts`** (lo importan UI y worker; sin dependencias)

```ts
/** Canales del backup `.db` crudo (Fase 5). No están en api-channels: no son parte de `window.api`. */
export const EXPORT_DB_CHANNEL = 'mobile:exportDb';
export const IMPORT_DB_CHANNEL = 'mobile:importDb';
```

- [ ] **Step 2: Escribir el test**

```ts
// tests/mobile/db-backup-handlers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../shared-logic/db', () => ({
  getDb: vi.fn(),
  closeDb: vi.fn(),
  suspendDb: vi.fn(),
}));
vi.mock('../../shared-logic/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared-logic/registry')>();
  return { ...actual, runSuspend: vi.fn(), runResume: vi.fn() };
});

import { closeDb, getDb, suspendDb } from '../../shared-logic/db';
import { clearHandlers, getHandler, runResume, runSuspend } from '../../shared-logic/registry';
import { registerMobileDbHandlers, type DbPool } from '../../src/mobile/db-backup-handlers';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from '../../src/mobile/backup-channels';

function sqliteBytes(): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set(new TextEncoder().encode('SQLite format 3\0'));
  return bytes;
}

function setup(booted = true) {
  const order: string[] = [];
  const track = (name: string, fn: ReturnType<typeof vi.fn>) => fn.mockImplementation(() => { order.push(name); });
  track('runSuspend', vi.mocked(runSuspend));
  track('runResume', vi.mocked(runResume));
  track('closeDb', vi.mocked(closeDb));
  track('getDb', vi.mocked(getDb));
  track('suspendDb', vi.mocked(suspendDb));
  const exported = sqliteBytes();
  const pool: DbPool = {
    exportFile: vi.fn(() => { order.push('exportFile'); return exported; }),
    importDb: vi.fn((_name: string, bytes: Uint8Array | ArrayBuffer) => { order.push('importDb'); return (bytes as Uint8Array).byteLength; }),
  };
  registerMobileDbHandlers({ pool, dbFile: '/hubtify.db', isBooted: () => booted });
  return { order, pool, exported };
}

beforeEach(() => {
  clearHandlers();
  vi.clearAllMocks();
});

describe('registerMobileDbHandlers', () => {
  it('registra los dos canales', () => {
    setup();
    expect(getHandler(EXPORT_DB_CHANNEL)).toBeDefined();
    expect(getHandler(IMPORT_DB_CHANNEL)).toBeDefined();
  });

  it('exportDb con el worker ready: suspende, cierra, lee, reabre y reanuda — en ese orden', () => {
    const { order, pool, exported } = setup(true);
    const bytes = getHandler(EXPORT_DB_CHANNEL)!({}) as Uint8Array;
    expect(order).toEqual(['runSuspend', 'closeDb', 'exportFile', 'getDb', 'runResume']);
    expect(pool.exportFile).toHaveBeenCalledWith('/hubtify.db');
    expect(Array.from(bytes)).toEqual(Array.from(exported));
    expect(bytes.buffer).not.toBe(exported.buffer); // copia propia: el buffer se transfiere
  });

  it('exportDb antes de ready (fatal de migración): solo cierra y lee', () => {
    const { order } = setup(false);
    getHandler(EXPORT_DB_CHANNEL)!({});
    expect(order).toEqual(['closeDb', 'exportFile']);
  });

  it('importDb rechaza lo que no es SQLite sin tocar la DB', () => {
    const { order, pool } = setup();
    expect(() => getHandler(IMPORT_DB_CHANNEL)!({}, new Uint8Array(200))).toThrow('not_sqlite');
    expect(() => getHandler(IMPORT_DB_CHANNEL)!({}, 'texto')).toThrow('not_sqlite');
    expect(order).toEqual([]);
    expect(pool.importDb).not.toHaveBeenCalled();
  });

  it('importDb válido: suspende lifecycles y DB, importa y devuelve el tamaño', () => {
    const { order, pool } = setup();
    const bytes = sqliteBytes();
    const r = getHandler(IMPORT_DB_CHANNEL)!({}, bytes);
    expect(order).toEqual(['runSuspend', 'suspendDb', 'importDb']);
    expect(pool.importDb).toHaveBeenCalledWith('/hubtify.db', bytes);
    expect(r).toEqual({ ok: true, bytes: 4096 });
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/db-backup-handlers.test.ts 2>&1 | tail -4`
Expected: `Failed to resolve import "../../src/mobile/db-backup-handlers"`.

- [ ] **Step 4: Crear `src/mobile/db-backup-handlers.ts`**

```ts
/**
 * Backup `.db` crudo en Android (spec §6, fila backup; Fase 5). El worker
 * registra dos canales en el registry de shared-logic; la UI (backup.ts) los
 * invoca por el transporte normal y comparte / elige el archivo con el host.
 *
 * Doc sqlite-wasm (persistence.md): `importDb` es indefinido sobre una DB
 * abierta y `exportFile` no lo aclara → se cierra siempre antes de tocar el
 * archivo. Tras importar, la DB queda suspendida (getDb lanza DbSuspended)
 * hasta que la UI recarga el WebView.
 */
import { registerHandler, runResume, runSuspend } from '@logic/registry';
import { closeDb, getDb, suspendDb } from '@logic/db';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from './backup-channels';
import { isSqliteFile } from './host-utils';

/** Subconjunto de `SAHPoolUtil` que se usa (inyectable en tests). */
export interface DbPool {
  exportFile(name: string): Uint8Array;
  importDb(name: string, bytes: Uint8Array | ArrayBuffer): number;
}

export interface MobileDbHandlerDeps {
  pool: DbPool;
  dbFile: string;
  /** `true` después de `ready`: ahí hay lifecycles que suspender y una DB que reabrir. */
  isBooted(): boolean;
}

export function registerMobileDbHandlers(deps: MobileDbHandlerDeps): void {
  registerHandler(EXPORT_DB_CHANNEL, () => {
    const booted = deps.isBooted();
    if (booted) runSuspend();
    closeDb();
    try {
      // Copia propia: el buffer viaja con transfer list y no debe ser una vista del heap WASM.
      return new Uint8Array(deps.pool.exportFile(deps.dbFile));
    } finally {
      if (booted) {
        getDb();
        runResume();
      }
    }
  });

  registerHandler(IMPORT_DB_CHANNEL, (_e, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array) || !isSqliteFile(bytes)) throw new Error('not_sqlite');
    if (deps.isBooted()) runSuspend();
    suspendDb();
    const written = deps.pool.importDb(deps.dbFile, bytes);
    return { ok: true as const, bytes: written };
  });
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/db-backup-handlers.test.ts 2>&1 | tail -4`
Expected: `Tests  5 passed (5)`.

- [ ] **Step 6: Conectar en `src/mobile/worker.ts`**

(a) Import, junto a los otros de `./`:

```ts
import { registerMobileDbHandlers } from './db-backup-handlers';
```

(b) Inmediatamente ANTES de la línea `registerAllHandlers();` (ubicar por texto; en el plan de Fase 2 está en el paso «4. Handlers, DB y migraciones»):

```ts
  // Backup .db crudo (Fase 5): canales mobile:exportDb / mobile:importDb.
  registerMobileDbHandlers({ pool, dbFile: DB_FILE, isBooted: () => booted });
```

`pool` es la constante local no-nula que el worker de Fase 2 crea con `const pool = poolUtil;` justo antes de `setDbFactory`. Si el archivo real no la tiene, usar `poolUtil!` con un comentario, o mover la llamada a después de la asignación de `poolUtil`. `booted` es el `let booted = false` del módulo.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: sin salida. Si `SAHPoolUtil` no es asignable a `DbPool` por la sobrecarga async de `importDb`, pasar `pool: { exportFile: (n) => pool.exportFile(n), importDb: (n, b) => pool.importDb(n, b) }`.

- [ ] **Step 8: Commit**

```bash
git add src/mobile/backup-channels.ts src/mobile/db-backup-handlers.ts src/mobile/worker.ts tests/mobile/db-backup-handlers.test.ts
git commit -m "feat(mobile): canales mobile:exportDb e importDb sobre opfs-sahpool en el worker"
```

### Task 14: `src/mobile/backup.ts` (lado UI) y `getWorkerClient()`

**Files:**
- Modify: `src/mobile/install-api.ts`
- Create: `src/mobile/backup.ts`
- Test: `tests/mobile/backup.test.ts`

- [ ] **Step 1: `getWorkerClient()` en `install-api.ts`**

(a) Import de tipo (junto al import de `createWorkerClient`):

```ts
import { createWorkerClient, type WorkerClient } from './worker-client';
```

(b) A nivel de módulo, antes de `export async function installMobileApi`:

```ts
let currentClient: WorkerClient | null = null;

/**
 * El cliente del worker desde que se crea — también si `ready` falló (fatal de
 * migración): FatalScreen lo usa para exportar el .db antes de reiniciar.
 */
export function getWorkerClient(): WorkerClient | null {
  return currentClient;
}
```

(c) Justo después de `const client = createWorkerClient(worker, createPlatformHost(), { … });`:

```ts
  currentClient = client;
```

- [ ] **Step 2: Escribir el test**

```ts
// tests/mobile/backup.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/mobile/install-api', () => ({ getWorkerClient: vi.fn(() => null) }));
vi.mock('../../src/mobile/platform-host', () => ({ createPlatformHost: vi.fn() }));

import { canExportDb, createMobileBackup, type BackupDeps } from '../../src/mobile/backup';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from '../../src/mobile/backup-channels';

function sqliteBytes(): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set(new TextEncoder().encode('SQLite format 3\0'));
  return bytes;
}

function deps(overrides: Partial<BackupDeps> = {}): BackupDeps {
  return {
    invoke: vi.fn(async () => sqliteBytes()),
    saveBinaryFile: vi.fn(async () => true),
    pickBinaryFile: vi.fn(async () => null),
    today: () => '2026-09-02',
    ...overrides,
  };
}

describe('exportDb', () => {
  it('pide el .db al worker y lo comparte con nombre fechado', async () => {
    const d = deps();
    await expect(createMobileBackup(d).exportDb()).resolves.toEqual({ success: true });
    expect(d.invoke).toHaveBeenCalledWith(EXPORT_DB_CHANNEL);
    expect(d.saveBinaryFile).toHaveBeenCalledWith('hubtify-2026-09-02.db', expect.any(Uint8Array));
  });

  it('share cancelado → canceled', async () => {
    const d = deps({ saveBinaryFile: vi.fn(async () => false) });
    await expect(createMobileBackup(d).exportDb()).resolves.toEqual({ success: false, canceled: true });
  });

  it('error del worker → error con el mensaje', async () => {
    const d = deps({ invoke: vi.fn(async () => { throw new Error('NoHandler'); }) });
    await expect(createMobileBackup(d).exportDb()).resolves.toEqual({ success: false, error: 'NoHandler' });
  });
});

describe('pickDbFile / importDb', () => {
  it('pickDbFile acepta cualquier archivo (la validación es por cabecera)', async () => {
    const d = deps();
    await createMobileBackup(d).pickDbFile();
    expect(d.pickBinaryFile).toHaveBeenCalledWith([{ name: 'SQLite', extensions: ['*'] }]);
  });

  it('importDb rechaza lo que no es SQLite sin invocar al worker', async () => {
    const d = deps();
    await expect(createMobileBackup(d).importDb(new Uint8Array(500))).resolves.toEqual({ success: false, error: 'not_sqlite' });
    expect(d.invoke).not.toHaveBeenCalled();
  });

  it('importDb válido → invoke con los bytes y tamaño escrito', async () => {
    const d = deps({ invoke: vi.fn(async () => ({ ok: true, bytes: 4096 })) });
    const bytes = sqliteBytes();
    await expect(createMobileBackup(d).importDb(bytes)).resolves.toEqual({ success: true, bytes: 4096 });
    expect(d.invoke).toHaveBeenCalledWith(IMPORT_DB_CHANNEL, bytes);
  });
});

describe('canExportDb', () => {
  it('false sin cliente o con el worker muerto; true si vive', () => {
    expect(canExportDb(null)).toBe(false);
    expect(canExportDb({ isCrashed: () => true } as never)).toBe(false);
    expect(canExportDb({ isCrashed: () => false } as never)).toBe(true);
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test -- tests/mobile/backup.test.ts 2>&1 | tail -4`
Expected: `Failed to resolve import "../../src/mobile/backup"`.

- [ ] **Step 4: Crear `src/mobile/backup.ts`**

```ts
/**
 * Backup `.db` crudo en Android (spec §6): exportar = pedir los bytes al worker
 * (mobile:exportDb) y compartirlos con el share sheet; importar = elegir un
 * archivo, validar la cabecera, mandarlo al worker (mobile:importDb) y recargar.
 * Sustituye al backup ZIP de Electron (backup.ipc.ts), que no viaja a mobile.
 *
 * La lógica está en `createMobileBackup(deps)` (testeable); `mobileBackup()`
 * la cablea con el worker real y el platform-host.
 */
import { todayDateString } from '../../shared/date-utils';
import type { FileFilter } from '@logic/platform';
import { EXPORT_DB_CHANNEL, IMPORT_DB_CHANNEL } from './backup-channels';
import { isSqliteFile } from './host-utils';
import { getWorkerClient } from './install-api';
import { createPlatformHost } from './platform-host';
import type { WorkerClient } from './worker-client';

export interface BackupDeps {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  saveBinaryFile: (name: string, bytes: Uint8Array) => Promise<boolean>;
  pickBinaryFile: (filters: FileFilter[]) => Promise<{ name: string; bytes: Uint8Array } | null>;
  /** YYYY-MM-DD para el nombre del archivo. */
  today: () => string;
}

export type ExportResult =
  | { success: true }
  | { success: false; canceled: true }
  | { success: false; canceled?: false; error: string };

export type ImportResult = { success: true; bytes: number } | { success: false; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createMobileBackup(deps: BackupDeps) {
  return {
    async exportDb(): Promise<ExportResult> {
      try {
        const bytes = (await deps.invoke(EXPORT_DB_CHANNEL)) as Uint8Array;
        const shared = await deps.saveBinaryFile(`hubtify-${deps.today()}.db`, bytes);
        return shared ? { success: true } : { success: false, canceled: true };
      } catch (err) {
        return { success: false, error: message(err) };
      }
    },

    /** Sin filtro de extensión: el chooser de Android filtra por MIME y `.db` no tiene uno fiable. */
    pickDbFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
      return deps.pickBinaryFile([{ name: 'SQLite', extensions: ['*'] }]);
    },

    async importDb(bytes: Uint8Array): Promise<ImportResult> {
      if (!isSqliteFile(bytes)) return { success: false, error: 'not_sqlite' };
      try {
        const r = (await deps.invoke(IMPORT_DB_CHANNEL, bytes)) as { ok: true; bytes: number };
        return { success: true, bytes: r.bytes };
      } catch (err) {
        return { success: false, error: message(err) };
      }
    },
  };
}

export type MobileBackup = ReturnType<typeof createMobileBackup>;

/** Hay worker y no murió: se puede pedir el .db (también tras un fatal de migración). */
export function canExportDb(client: WorkerClient | null = getWorkerClient()): boolean {
  return client !== null && !client.isCrashed();
}

let instance: MobileBackup | null = null;

export function mobileBackup(): MobileBackup {
  if (!instance) {
    const client = getWorkerClient();
    if (!client) throw new Error('mobileBackup(): el worker todavía no fue creado');
    const host = createPlatformHost();
    instance = createMobileBackup({
      invoke: (channel, ...args) => client.transport.invoke(channel, ...args),
      saveBinaryFile: (name, bytes) => host.saveBinaryFile(name, bytes) as Promise<boolean>,
      pickBinaryFile: (filters) => host.pickBinaryFile(filters) as Promise<{ name: string; bytes: Uint8Array } | null>,
      today: todayDateString,
    });
  }
  return instance;
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -- tests/mobile/backup.test.ts 2>&1 | tail -4`
Expected: `Tests  7 passed (7)`.

- [ ] **Step 6: Typecheck y commit**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: sin salida.

```bash
git add src/mobile/install-api.ts src/mobile/backup.ts tests/mobile/backup.test.ts
git commit -m "feat(mobile): backup .db desde la ui (exportar por share, importar y recargar)"
```

### Task 15: Botones de respaldo en Ajustes (Android) y export desde `FatalScreen`

**Files:**
- Create: `src/mobile/MobileBackupButtons.tsx`
- Modify: `src/hub/SettingsPage.tsx`
- Modify: `src/mobile/FatalScreen.tsx`, `src/mobile/fatal-screen.css`
- Modify: `src/i18n/es.json`, `src/i18n/en.json`

El bundle desktop no debe arrastrar Capacitor: todo lo que importa `backup.ts` entra por `import()` dinámico detrás de `IS_ANDROID_BUILD` (constante de `define`, plegada a `false` en el renderer de Electron — mismo mecanismo que `main.tsx` en Fase 2).

- [ ] **Step 1: i18n — `settings.*`**

`src/i18n/es.json`, sección `settings`: después de `"backupDesc"`:

```json
    "backupDescMobile": "Exportar comparte un archivo .db con toda tu base local (guardalo en Drive, Telegram, donde quieras). Importar la reemplaza por la del archivo.",
```

después de `"exportBackup"`:

```json
    "exportDb": "Exportar base de datos",
```

después de `"importConfirmFile"`:

```json
    "importDb": "Importar base de datos",
    "importDbConfirm": "Importar «{{name}}» REEMPLAZA todos los datos de este teléfono y reinicia la app. Esta acción no se puede deshacer.",
    "importDbNotSqlite": "Ese archivo no es una base de datos de Hubtify (.db).",
```

`src/i18n/en.json`, mismas posiciones:

```json
    "backupDescMobile": "Export shares a .db file with your whole local database (save it to Drive, Telegram, wherever). Import replaces it with the one in the file.",
```
```json
    "exportDb": "Export database",
```
```json
    "importDb": "Import database",
    "importDbConfirm": "Importing \"{{name}}\" REPLACES all data on this phone and restarts the app. This cannot be undone.",
    "importDbNotSqlite": "That file is not a Hubtify database (.db).",
```

- [ ] **Step 2: i18n — `mobile.fatal.*`** (sección `mobile` creada por la Fase 2), después de `"crash"` en ambos idiomas:

es:
```json
      "exportDb": "Exportar base de datos",
      "exportDbDone": "Base de datos exportada. Guardala antes de reiniciar.",
      "exportDbFailed": "No se pudo exportar la base de datos.",
```
en:
```json
      "exportDb": "Export database",
      "exportDbDone": "Database exported. Save it before restarting.",
      "exportDbFailed": "The database could not be exported.",
```

Run:
```bash
node -e "
for (const l of ['es','en']) {
  const j = require('./src/i18n/'+l+'.json');
  const s = Object.keys(j.settings), f = Object.keys(j.mobile.fatal);
  // Orden por code unit (el de los JSON del repo: `downloadUpdate` < `downloading`), no localeCompare.
  const sorted = (a) => JSON.stringify(a) === JSON.stringify([...a].sort());
  console.log(l, 'settings keys sorted:', sorted(s), '| fatal:', f.join(','));
}"
```
Expected: `settings keys sorted: true` y `fatal: crash,exportDb,exportDbDone,exportDbFailed,migration,migrationDetail,open,restart,title,vfs` en los dos idiomas.

- [ ] **Step 3: Crear `src/mobile/MobileBackupButtons.tsx`**

```tsx
/**
 * Los dos botones de «Respaldo» de Ajustes en Android (spec §6, fila backup).
 * Mismo flujo que los de Electron (SettingsPage): primero el archivo, después
 * la confirmación, así el usuario ve QUÉ va a pisar sus datos.
 */
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/useToast';
import { mobileBackup } from './backup';

export default function MobileBackupButtons() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();

  const handleExport = async () => {
    const result = await mobileBackup().exportDb();
    if (result.success) toast({ message: t('settings.exportSuccess', 'Respaldo exportado correctamente'), type: 'success' });
    else if (!result.canceled) toast({ message: `${t('settings.exportFailed', 'Error al exportar')}: ${result.error}`, type: 'warning' });
  };

  const handleImport = async () => {
    const picked = await mobileBackup().pickDbFile();
    if (!picked) return;
    const ok = await confirm({
      title: t('settings.importDb', 'Importar base de datos'),
      message: t('settings.importDbConfirm', 'Importar «{{name}}» REEMPLAZA todos los datos de este teléfono y reinicia la app. Esta acción no se puede deshacer.', { name: picked.name }),
      confirmText: t('settings.importDb', 'Importar base de datos'),
      danger: true,
    });
    if (!ok) return;
    const result = await mobileBackup().importDb(picked.bytes);
    if (result.success) {
      // La DB quedó suspendida en el worker: nada funciona hasta recargar.
      window.location.reload();
      return;
    }
    toast({
      type: 'warning',
      message: result.error === 'not_sqlite'
        ? t('settings.importDbNotSqlite', 'Ese archivo no es una base de datos de Hubtify (.db).')
        : `${t('settings.importFailed', 'Error al importar')}: ${result.error}`,
    });
  };

  return (
    <div className="settings-row__buttons">
      <button className="rpg-button" onClick={handleExport} style={{ flex: 1 }}>
        {t('settings.exportDb', 'Exportar base de datos')}
      </button>
      <button className="rpg-button" onClick={handleImport} style={{ flex: 1 }}>
        {t('settings.importDb', 'Importar base de datos')}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `SettingsPage.tsx`**

(a) Import de React (línea 1): agregar `lazy` y `Suspense`:

```ts
import { useState, useMemo, useRef, useEffect, lazy, Suspense, type ReactNode } from 'react';
```

(b) Después de los imports, a nivel de módulo:

```ts
/** Plegado a `false` por `define` en el renderer de Electron: el chunk mobile no entra al bundle desktop. */
const IS_ANDROID_BUILD = typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android';
const MobileBackupButtons = IS_ANDROID_BUILD ? lazy(() => import('../mobile/MobileBackupButtons')) : null;
```

(c) En la `SettingsCard` de respaldo, reemplazar la descripción

```tsx
              {t('settings.backupDesc', 'Exportar guarda un archivo con toda tu base local. Importar la reemplaza por la del archivo.')}
```

por

```tsx
              {MobileBackupButtons
                ? t('settings.backupDescMobile', 'Exportar comparte un archivo .db con toda tu base local (guardalo en Drive, Telegram, donde quieras). Importar la reemplaza por la del archivo.')
                : t('settings.backupDesc', 'Exportar guarda un archivo con toda tu base local. Importar la reemplaza por la del archivo.')}
```

y envolver el `<div className="settings-row__buttons">…</div>` existente (los dos botones de `backupExport`/`backupImport`) así:

```tsx
            {MobileBackupButtons ? (
              <Suspense fallback={null}>
                <MobileBackupButtons />
              </Suspense>
            ) : (
              <div className="settings-row__buttons">
                {/* … los dos botones actuales, sin cambios … */}
              </div>
            )}
```

- [ ] **Step 5: `FatalScreen.tsx` — botón «Exportar base de datos»**

(a) Imports:

```tsx
import { useEffect, useState } from 'react';
```

(b) Antes del componente:

```tsx
const IS_ANDROID_BUILD = typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android';
type ExportState = 'idle' | 'busy' | 'done' | 'failed';
```

(c) Dentro de `FatalScreen`, después de `const { t } = useTranslation();`:

```tsx
  // Un fatal de migración deja el archivo intacto en OPFS: se puede rescatar
  // antes de reiniciar. Con el VFS caído no hay nada que leer; con el worker
  // muerto (crash) no hay quien lo lea — canExportDb() lo sabe.
  // Solo `migration` (spec §12): el VFS y el archivo existen, los canales
  // mobile:* ya están registrados y el worker sigue vivo. En `vfs`/`open` no
  // hay archivo o no hay handler; en `crash` no hay worker.
  //
  // Los dos `import()` van en bloque `if (IS_ANDROID_BUILD)` (misma forma que
  // main.tsx): App.tsx carga FatalScreen con lazy() también en desktop, y sin
  // el guard Rollup emitiría backup/platform-host/Capacitor en ese bundle.
  const [canExport, setCanExport] = useState(false);
  const [exportState, setExportState] = useState<ExportState>('idle');
  useEffect(() => {
    let alive = true;
    if (IS_ANDROID_BUILD && reason === 'migration') {
      import('./backup')
        .then(({ canExportDb }) => { if (alive) setCanExport(canExportDb()); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [reason]);

  const handleExport = async () => {
    if (IS_ANDROID_BUILD) {
      setExportState('busy');
      try {
        const { mobileBackup } = await import('./backup');
        const result = await mobileBackup().exportDb();
        setExportState(result.success ? 'done' : result.canceled ? 'idle' : 'failed');
      } catch {
        setExportState('failed');
      }
    }
  };
```

(d) Reemplazar el `<button … mobile-fatal__button …>` de «Reiniciar» por:

```tsx
        {exportState === 'done' && (
          <p className="mobile-fatal__detail">{t('mobile.fatal.exportDbDone', 'Base de datos exportada. Guardala antes de reiniciar.')}</p>
        )}
        {exportState === 'failed' && (
          <p className="mobile-fatal__detail">{t('mobile.fatal.exportDbFailed', 'No se pudo exportar la base de datos.')}</p>
        )}
        <div className="mobile-fatal__actions">
          {canExport && (
            <button type="button" className="mobile-fatal__button" onClick={handleExport} disabled={exportState === 'busy'}>
              {t('mobile.fatal.exportDb', 'Exportar base de datos')}
            </button>
          )}
          <button type="button" className="mobile-fatal__button" onClick={() => window.location.reload()}>
            {t('mobile.fatal.restart', 'Reiniciar')}
          </button>
        </div>
```

(e) `src/mobile/fatal-screen.css`, al final:

```css
.mobile-fatal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.mobile-fatal__button:disabled {
  opacity: 0.6;
  cursor: default;
}
```

- [ ] **Step 6: Typecheck, lint, suite y bundle desktop limpio**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: sin errores; `Test Files  N+5 passed`.

Run: `npx vite build -c vite.renderer.config.ts --outDir dist/renderer-check 2>&1 | tail -2 && rg --files --no-ignore dist/renderer-check | rg -i "capacitor|MobileBackup|platform-host|backup-" ; echo "(sin líneas arriba = ok)" ; node -e "require('fs').rmSync('dist/renderer-check', { recursive: true, force: true })"`
Expected: `✓ built in Xs` y solo `(sin líneas arriba = ok)`. Si aparece un chunk con Capacitor, algún `import('../mobile/…')` quedó fuera del guard `IS_ANDROID_BUILD`.

- [ ] **Step 7: Commit**

```bash
git add src/mobile/MobileBackupButtons.tsx src/hub/SettingsPage.tsx src/mobile/FatalScreen.tsx src/mobile/fatal-screen.css src/i18n/es.json src/i18n/en.json
git commit -m "feat(mobile): exportar e importar la base de datos desde ajustes y desde la pantalla de fallo"
```

## Chunk 5: Fase 5 — updater mobile y cierre

### Task 16: Updater mobile — `src/shared/semver.ts`, `src/mobile/updater.ts`, `Layout.tsx`

**Files:**
- Create: `src/shared/semver.ts`
- Create: `src/mobile/updater.ts`
- Modify: `src/hub/Layout.tsx`
- Test: `tests/shared/semver.test.ts`, `tests/mobile/updater.test.ts`

- [ ] **Step 1: Test del comparador**

```ts
// tests/shared/semver.test.ts
import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../../src/shared/semver';

describe('isNewerVersion(a, b): a > b', () => {
  it('compara por componente numérico, no lexicográficamente', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.8.2', '0.8.10')).toBe(false);
  });

  it('igual no es más nueva', () => {
    expect(isNewerVersion('0.8.2', '0.8.2')).toBe(false);
  });

  it('componentes faltantes cuentan como 0', () => {
    expect(isNewerVersion('1.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1', '1.0.0')).toBe(false);
  });
});
```

- [ ] **Step 2: Crear `src/shared/semver.ts`** (es el `isNewerVersion` de `Layout.tsx`, sin cambios)

```ts
/** `a` es estrictamente más nueva que `b` (X.Y.Z numérico; componentes faltantes = 0). */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}
```

Run: `npm test -- tests/shared/semver.test.ts 2>&1 | tail -4`
Expected: `Tests  3 passed (3)`.

- [ ] **Step 3: Test del updater**

```ts
// tests/mobile/updater.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(async () => undefined) } }));

import { Browser } from '@capacitor/browser';
import { checkMobileUpdate, findApkUpdate, LATEST_RELEASE_URL, openApkDownload } from '../../src/mobile/updater';

const release = (tag: string, assets: string[]) => ({
  tag_name: tag,
  assets: assets.map((name) => ({ name, browser_download_url: `https://github.com/facuga7van/hubtify-releases/releases/download/${tag}/${name}` })),
});

describe('findApkUpdate', () => {
  it('versión más nueva con su APK → url de descarga', () => {
    const r = release('v0.9.0', ['Hubtify-0.9.0.apk', 'Hubtify-0.9.0 Setup.exe', 'RELEASES']);
    expect(findApkUpdate(r, '0.8.2')).toEqual({
      version: '0.9.0',
      apkUrl: 'https://github.com/facuga7van/hubtify-releases/releases/download/v0.9.0/Hubtify-0.9.0.apk',
    });
  });

  it('más nueva pero sin APK (release solo Windows) → null', () => {
    expect(findApkUpdate(release('v0.9.0', ['Hubtify-0.9.0 Setup.exe']), '0.8.2')).toBeNull();
  });

  it('igual o más vieja → null', () => {
    expect(findApkUpdate(release('v0.8.2', ['Hubtify-0.8.2.apk']), '0.8.2')).toBeNull();
    expect(findApkUpdate(release('v0.8.1', ['Hubtify-0.8.1.apk']), '0.8.2')).toBeNull();
  });

  it('tag que no es X.Y.Z (pre-release) → null', () => {
    expect(findApkUpdate(release('v1.0.0-beta.1', ['Hubtify-1.0.0-beta.1.apk']), '0.8.2')).toBeNull();
  });
});

describe('checkMobileUpdate', () => {
  it('consulta el último release y devuelve el APK más nuevo', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(release('v0.9.0', ['Hubtify-0.9.0.apk'])), { status: 200 }));
    await expect(checkMobileUpdate(fetchFn as unknown as typeof fetch, '0.8.2')).resolves.toMatchObject({ version: '0.9.0' });
    expect(fetchFn).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.objectContaining({ headers: expect.any(Object) }));
  });

  it('respuesta no-2xx (rate limit) o red caída → null, sin lanzar', async () => {
    await expect(checkMobileUpdate((async () => new Response('', { status: 403 })) as unknown as typeof fetch, '0.8.2')).resolves.toBeNull();
    await expect(checkMobileUpdate((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, '0.8.2')).resolves.toBeNull();
  });
});

describe('openApkDownload', () => {
  it('abre el navegador del sistema con la url del APK', async () => {
    await openApkDownload('https://x/y.apk');
    expect(Browser.open).toHaveBeenCalledWith({ url: 'https://x/y.apk' });
  });
});
```

Run: `npm test -- tests/mobile/updater.test.ts 2>&1 | tail -4`
Expected: `Failed to resolve import "../../src/mobile/updater"`.

- [ ] **Step 4: Crear `src/mobile/updater.ts`**

```ts
/**
 * Updater de Android (spec §6, fila updater; §11 lo listaba en Fase 6). No hay
 * Squirrel: se consulta el último release público de hubtify-releases, se
 * compara con APP_VERSION y, si hay `Hubtify-<version>.apk`, Layout muestra el
 * banner de siempre; «Descargar» abre la URL en el navegador del sistema y el
 * usuario instala el APK (misma firma + versionCode mayor → actualiza en el lugar).
 *
 * API pública de GitHub: 60 req/h sin token; Layout consulta al montar y cada
 * 6 h. Ante 403/red caída se devuelve null en silencio.
 */
import { Browser } from '@capacitor/browser';
import { isNewerVersion } from '../shared/semver';

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/facuga7van/hubtify-releases/releases/latest';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface LatestRelease {
  tag_name: string;
  assets?: ReleaseAsset[];
}

export interface ApkUpdate {
  version: string;
  apkUrl: string;
}

export function findApkUpdate(release: LatestRelease, currentVersion: string): ApkUpdate | null {
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewerVersion(version, currentVersion)) return null;
  const apk = (release.assets ?? []).find((a) => a.name === `Hubtify-${version}.apk`);
  return apk ? { version, apkUrl: apk.browser_download_url } : null;
}

export async function checkMobileUpdate(
  fetchFn: typeof fetch = fetch,
  currentVersion: string = APP_VERSION,
): Promise<ApkUpdate | null> {
  try {
    const res = await fetchFn(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    return findApkUpdate((await res.json()) as LatestRelease, currentVersion);
  } catch {
    return null;
  }
}

export async function openApkDownload(url: string): Promise<void> {
  await Browser.open({ url });
}
```

Run: `npm test -- tests/mobile/updater.test.ts 2>&1 | tail -4`
Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: `Layout.tsx`**

(a) Borrar la función local `isNewerVersion` (líneas ~46-54) e importarla:

```ts
import { isNewerVersion } from '../shared/semver';
```

(b) Junto a las otras constantes del módulo (`AUTO_COLLAPSE_WIDTH`, …):

```ts
/** Plegado a `false` por `define` en el renderer de Electron. */
const IS_ANDROID_BUILD = typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android';
```

(c) En el bloque `// Auto-updater`, después de `const [showUpdateDetails, setShowUpdateDetails] = useState(false);`:

```ts
  // Android: URL del APK del último release (src/mobile/updater.ts). Sin
  // descarga in-app: «Descargar» abre el navegador. Es un ref y no un state a
  // propósito: como state, `handleUpdate` → `considerUpdate` → el `useEffect`
  // del updater se re-ejecutarían y harían un segundo `check()` al montar.
  const apkUrlRef = useRef<string | null>(null);
```

(d) Reemplazar `handleUpdate` (deps vacías, como hoy):

```ts
  const handleUpdate = useCallback(async () => {
    const apkUrl = apkUrlRef.current;
    if (IS_ANDROID_BUILD && apkUrl) {
      const { openApkDownload } = await import('../mobile/updater');
      await openApkDownload(apkUrl).catch((err: unknown) => setUpdateError(err instanceof Error ? err.message : String(err)));
      return;
    }
    setUpdateState('downloading');
    setUpdateError(null);
    try {
      await window.api.updaterDownload?.();
      setUpdateState('ready'); // staged — user chooses when to restart
    } catch { setUpdateState('idle'); }
  }, []);
```

(e) En `considerUpdate`, el modo `auto` no debe abrir el navegador solo:

```ts
    if (mode === 'auto' && !IS_ANDROID_BUILD) handleUpdate();
```

(f) En el `useEffect` del updater, reemplazar `const check = () => { … };`:

```ts
    const check = () => {
      if (IS_ANDROID_BUILD) {
        import('../mobile/updater')
          .then((m) => m.checkMobileUpdate())
          .then((update) => {
            if (!update) return;
            apkUrlRef.current = update.apkUrl;
            considerUpdate(update.version);
          })
          .catch(() => { /* sin red o rate limit: silencio, igual que en dev */ });
        return;
      }
      window.api.updaterCheck?.().then((res: { available?: boolean; version?: string }) => {
        if (res?.available && res.version) considerUpdate(res.version);
      }).catch(() => { /* not available in dev */ });
    };
```

Los listeners `onUpdateAvailable/onDownloadProgress/onUpdateError/onUpdateDownloaded` quedan como están: en mobile son `on` sobre canales que nadie emite (spec §3.1).

- [ ] **Step 6: Typecheck, lint, suite, bundle desktop**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npm run lint 2>&1 | tail -3 && npm test 2>&1 | tail -3`
Expected: sin errores; `Test Files  N+7 passed`, `Tests  M+47 passed`.

Run: `npx vite build -c vite.renderer.config.ts --outDir dist/renderer-check 2>&1 | tail -2 && rg --files --no-ignore dist/renderer-check | rg -i "capacitor|updater-|platform-host|backup-" ; echo "(sin líneas arriba = ok)" ; node -e "require('fs').rmSync('dist/renderer-check', { recursive: true, force: true })"`
Expected: `✓ built in Xs` y solo `(sin líneas arriba = ok)`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/semver.ts src/mobile/updater.ts src/hub/Layout.tsx tests/shared/semver.test.ts tests/mobile/updater.test.ts
git commit -m "feat(mobile): aviso de nueva versión desde el último release de github y descarga del apk"
```

### Task 17: Criterios en el emulador y cierre de la Fase 5

**Files:** ninguno (verificación manual; anotar resultados en el reporte).

Entorno exportado; AVD `hubtify` booteado. DevTools: `chrome://inspect` en Chrome de escritorio → WebView de `com.hubtify.app` (el build debug lo habilita).

- [ ] **Step 1: Instalar el build debug con la Fase 5**

```bash
"$ADB" uninstall com.hubtify.app || true      # si quedó el release de la Tarea 7 (otra firma)
npm run mobile:apk 2>&1 | rg -n "BUILD (SUCCESSFUL|FAILED)"
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk
"$ADB" logcat -c
"$ADB" shell am start -n com.hubtify.app/.MainActivity
```
Expected: `BUILD SUCCESSFUL`, `Success`, la app abre y el log muestra `[worker] ready`.

- [ ] **Step 2: Notificación local**

En la consola de DevTools del WebView:
```js
await window.api.notificationsSend('Prueba Hubtify', 'Notificación local desde el worker')
```
Expected: primera vez, Android pide permiso de notificaciones → Aceptar; aparece la notificación con título «Prueba Hubtify» en el canal «Hubtify». Confirmar:
```bash
"$ADB" shell dumpsys notification --noredact | rg -n "com.hubtify.app|Prueba Hubtify" | head -3
```
Expected: al menos una línea con `pkg=com.hubtify.app` y el título.

- [ ] **Step 3: Exportar `.db`**

Ajustes → Respaldo → «Exportar base de datos». Expected: se abre el share sheet de Android con `hubtify-<fecha>.db`. Elegir «Files»/«Drive» y guardar. Cancelar el sheet una segunda vez: no hay toast (canceled).

- [ ] **Step 4: Importar el mismo `.db`**

Antes: crear una tarea `smoke fase 5` en Questify y **volver a exportar** (para que el archivo la incluya). Borrar la tarea. Ajustes → «Importar base de datos» → elegir el `.db` guardado → confirmar el diálogo rojo. Expected: la app recarga y la tarea `smoke fase 5` está de vuelta. Elegir un archivo que no sea SQLite (una imagen): toast «Ese archivo no es una base de datos de Hubtify (.db).».

- [ ] **Step 5: Export CSV comparte**

Coinify → Exportar CSV (con el mes con movimientos). Expected: share sheet con `coinify-YYYY-MM.csv`; al guardarlo y abrirlo tiene la cabecera y las filas.

- [ ] **Step 6: Import PDF muestra el toast**

Coinify → Importar → «Seleccionar PDF». Expected: toast «Importar resúmenes PDF no está disponible en Android…», sin spinner colgado ni «No se pudo procesar el PDF».

- [ ] **Step 7: `FatalScreen` con export**

No hay forma no invasiva de provocar un fatal de migración en el emulador y no se va a romper una migración a propósito. Cobertura aceptada: `db-backup-handlers.test.ts` (camino `isBooted() === false`) y `backup.test.ts` (`canExportDb`). Anotar en el reporte: «FatalScreen export: cubierto por unit tests; no reproducido en emulador». Si el arnés visual `browser-mobile` de la Fase 3 ya existe, renderizar `<FatalScreen reason="migration" message="x" namespace="quests" version={7} />` en un test de screenshot para ver el layout de `.mobile-fatal__actions` (el botón de export no aparece ahí porque no hay worker: es solo el layout). Si no existe, saltar.

- [ ] **Step 8: Release firmado instala sobre sí mismo**

```bash
"$ADB" uninstall com.hubtify.app
npm run mobile:apk:release 2>&1 | rg -n "release signing|BUILD (SUCCESSFUL|FAILED)"
"$ADB" install android/app/build/outputs/apk/release/app-release.apk
"$ADB" install -r android/app/build/outputs/apk/release/app-release.apk
```
Expected: `release signing: release.jks`, `BUILD SUCCESSFUL`, `Success` dos veces (la segunda es la actualización en el lugar con la misma firma y mismo `versionCode`: Android la acepta con `-r`).

- [ ] **Step 9: Updater**

Cubierto por `tests/mobile/updater.test.ts` con `fetch` falso (spec: «updater simulado con release fake»). En el emulador, con red: abrir la app y en Network de DevTools debe verse un GET a `api.github.com/repos/facuga7van/hubtify-releases/releases/latest` con 200; como el último release publicado no tiene `.apk`, no aparece banner. (Cuando exista un release con APK más nuevo que `APP_VERSION`, el banner aparece y «Ver novedades» → «Descargar» abre Chrome con el `.apk`.)

- [ ] **Step 10: Verificación final y checklist (spec §11, fila 5)**

Run: `npx tsc --noEmit && npm run typecheck:shared-logic && npm run lint && npm test 2>&1 | tail -4`
Expected: sin errores; `Test Files  N+7 passed`, `Tests  M+47 passed` (host-utils 10, file-picker 4, platform-host 11, db-backup-handlers 5, backup 7, semver 3, updater 7).

- [ ] `notify` real (notificación visible en el emulador)
- [ ] export CSV y `.db` comparten por Share
- [ ] import `.db` restaura y recarga
- [ ] import PDF muestra el toast y no rompe nada
- [ ] `FatalScreen` tiene «Exportar base de datos» (cuando el worker vive y el VFS existe)
- [ ] release firmado instala y actualiza en el lugar
- [ ] updater: test con release fake verde; sin banner falso en el emulador
- [ ] bundle desktop sin chunks de Capacitor

Run: `git log --oneline master..feature/mobile | head -30 && git status --short`
Expected: los commits de este plan encima de los de Fases 1–2 y working tree limpio (salvo untracked ajenos).

---

## Resultados en el emulador (se completa en la Tarea 17)

_pendiente_

Formato: fecha — WebView `<versionName>` — por cada Step 2–9: OK / FALLÓ + una línea.
