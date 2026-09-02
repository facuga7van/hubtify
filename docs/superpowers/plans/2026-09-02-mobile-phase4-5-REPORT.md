# Fases 4 y 5 — reporte de ejecución (2026-09-02)

Plan: `2026-09-02-mobile-phase4-5-release-platform.md` (17 tareas / 5 chunks). Rama `feature/mobile`, sin push ni tags.

| Chunk | Estado | Commits |
|---|---|---|
| 1 — keystore, firma Gradle, `mobile:apk:release`, `docs/mobile-release.md` | DONE | `6f5fb59`, `38971ef`, `ee6c314` |
| 2 — `ci.yml` job `android-build`, `release.yml` en 3 jobs | DONE + revisor **Approved** | `a815342`, `e6282e8`, `718b948` (endurecimiento) |
| 3 — plugins Capacitor, `host-utils`, `file-picker`, `platform-host`, toast PDF | DONE | `ea9ace0`, `0b1fa86`, `ec868ca`, `20b5e35`, `6ebd82b` |
| 4 — canales `mobile:exportDb`/`importDb`, `backup.ts`, botones de Ajustes, `FatalScreen` | DONE | `a566189`, `c6517c7`, `45b947a` |
| 5 — `semver.ts`, updater mobile, criterios en emulador | DONE + revisor (1 bloqueante + 5 menores, **corregidos**) | `392b6a1`, `0349bf7`, `884e929`, `e08a0d3`, `b7fa47b` |

**Gates finales:** `tsc --noEmit` 0 · `typecheck:shared-logic` 0 · `npm test` **115 files / 1416 tests** (baseline 108/1363) · `test:visual` 209 sin cambios · `test:visual:mobile` 29 (28 + layout de `FatalScreen`) · `git status` limpio · `git check-ignore` positivo para `android/keystore/release.jks` y `keystore.properties` · bundle desktop sin `@capacitor/*`, sin `SAHPool` y sin chunk `worker-*.js`.

**Emulador (Pixel 7 / Android 15, app 0.8.2 / versionCode 802), screenshots en `2026-09-02-mobile-phase5-*.png`:** APK release firmado (`CN=Hubtify`) e `install -r` OK; notificación local visible en el shade; export `.db` abre el share sheet con `hubtify-2026-09-02.db`; import `.db` restaura la tarea de prueba y rechaza un no-SQLite; export CSV OK; toast «Importar resúmenes PDF no está disponible en Android»; banner de updater con stub (`v0.9.9`) que abre el `.apk` por `Browser.open`. Con red real no hay banner falso.

**Bugs reales encontrados y arreglados (no estaban en el plan):**
- `0349bf7` — `@capacitor/local-notifications` asume `isExactNotification: true`: en Android 12+ sin `SCHEDULE_EXACT_ALARM` la notificación **no salía** (abría «Alarmas y recordatorios» y dejaba la promesa colgada). Sin esto, el criterio de notificaciones de la spec §11 no se cumplía en ningún Android moderno.
- `e08a0d3` — un `importDb` fallido dejaba la DB suspendida y la UI solo mostraba un toast: la app quedaba inservible hasta forzar el cierre.
- Chunk 4 — un const intermedio (`IS_ANDROID_BUILD`) **no** poda los `import()`: Vite emitía un chunk huérfano de 561 KB con sqlite-wasm en el bundle desktop. La condición va literal (`__HUBTIFY_PLATFORM__ === 'android'`) en cada sitio.
- `718b948` — el release ahora falla si el APK va firmado con la clave debug o si falta un artefacto (`fail_on_unmatched_files`).

**Desvíos:** los 17 del plan más dos documentados en él (18: flag de notificación exacta; 19: guard literal). En CI se usa `grep` en vez de `rg` (ripgrep no está garantizado en `ubuntu-latest`). Adaptador de tipos para `SAHPoolUtil.exportFile/importDb`, cuyos `.d.mts` declaran `Promise` donde la implementación es síncrona.

**Pendientes:** menor 3 del revisor (`Layout.tsx`) quedó sin test — no hay harness de componentes (jsdom no instalado); el `FatalScreen` con export real no se probó contra un fallo de migración genuino, solo su layout.

## Qué tenés que hacer vos

1. **CARGAR LOS 4 SECRETS ANTES DE MERGEAR O TAGGEAR.** Hasta que existan `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`, **el próximo tag `v*` no publica NADA — tampoco el instalador de Windows**, porque `publish` tiene `needs: [build-windows, build-android]` y `build-android` falla a propósito sin keystore.
2. El keystore usado es **de prueba**. En `D:/hubtify-android-keystore/` te dejé `release.jks`, `password.txt` y `SECRETS-README.txt` con los `gh secret set` listos para pegar (leen la contraseña del archivo, no inline). Si lo adoptás como definitivo, guardalo YA en el gestor de contraseñas: perderlo obliga a los usuarios a desinstalar y reinstalar. Si preferís uno nuevo, `docs/mobile-release.md` §1.
3. Orden de merge: `feature/mobile` → `master` **después** de cargar los secrets; el primer tag posterior publica `.exe` + `Hubtify-X.Y.Z.apk` en el mismo release.
