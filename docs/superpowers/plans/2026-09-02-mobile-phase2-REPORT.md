# Mobile Fase 2 — Reporte de ejecución

Plan: `2026-09-01-mobile-phase2-capacitor-worker.md` · Spec: `../specs/2026-09-01-mobile-android-design.md`
Rama: `feature/mobile` · Base: `4b83d64` (fin de Fase 1) · HEAD: `2e6efc5` · Sin push.

## Estado por chunk

| Chunk | Tasks | Estado | Revisión |
|---|---|---|---|
| 1 Deps, configs, protocolo | 1–4 | DONE | Issues Found, 0 bloqueantes (junto con 2–3) |
| 2 Shim WASM + protocolo del worker | 5–6 | DONE | idem |
| 3 UI: transport, `window.api`, FatalScreen | 7–9 | DONE | idem → 4 menores corregidos en `4440c7b` |
| 4 Lifecycle cauldron + notifications | 10–11 | DONE | Approved (junto con 5) |
| 5 Worker, build Android, APK, smoke | 12–15 | DONE | Approved → 3 menores corregidos en `2e6efc5` |

## Verificación final (HEAD `2e6efc5`)

- `npx tsc --noEmit` → exit 0 · `npm run typecheck:shared-logic` → exit 0
- `npm test` → **106 files / 1357 tests**, 0 failed (baseline Fase 1: 99 / 1285)
- `npm run lint` → 0 errores, 14 warnings preexistentes
- Bundle desktop limpio: `vite build -c vite.renderer.config.ts` → 0 coincidencias de
  `sqlite3|capacitor|opfs|install-api|worker-` (el guard `__HUBTIFY_PLATFORM__` se pliega y
  Rollup elimina los `import()` dinámicos). Verificado por los dos revisores.
- `git status` limpio (scaffold `android/` commiteado; `android/app/build`, `android/.gradle`,
  `android/local.properties` ignorados)

## Smoke en el emulador (`emulator-5554`, Pixel 7 / Android 15 / WebView 124)

- `npm run mobile:build` → `dist/mobile/assets/sqlite3-BVKGSWc-.wasm` + `assets/worker-DYJV6n3B.js`
- `npm run mobile:apk` → `android/app/build/outputs/apk/debug/app-debug.apk` (15.3 MB, BUILD SUCCESSFUL)
- `adb install -r` → `Success`

Logcat (líneas exactas):

```
[worker] vfs: opfs-sahpool name=hubtify files=[]                 (1er arranque)
[worker] ready
[worker] vfs: opfs-sahpool name=hubtify files=["/hubtify.db"]    (tras force-stop + reabrir)
[worker] ready
[worker] suspended   /   [worker] resumed                        (HOME y vuelta)
```

Sin `fatal`, sin `DbSuspended`, sin `WorkerCrashed`. Persistencia probada end-to-end vía CDP sin
login: `questsGetTasks` → 0; `questsUpsertTask({name:'smoke fase 2'})` → 1; force-stop + reabrir →
`after restart: 1 -> smoke fase 2`. Es el criterio de §11 fila 2 cumplido de verdad, no por inferencia.

Screenshot: `2026-09-02-mobile-phase2-smoke.png` (commiteado) — login RPG renderizado, **no** FatalScreen.

**MIME `.wasm`**: 0 ocurrencias de `falling back to ArrayBuffer instantiation` y de
`wasm streaming compile failed` → `instantiateStreaming` OK; no hace falta tocar el MIME.

## Commits (`4b83d64..2e6efc5`, 15)

```
b4a543b chore(mobile): dependencias de capacitor 8.5 y sqlite-wasm 3.53
b10ae34 feat(mobile): configuración de capacitor y build vite para android
40a680a feat(mobile): tipos del protocolo ui-worker, errores y transfer list
ef8c729 feat(mobile): shim SqlDatabase sobre sqlite-wasm con cache LRU y savepoints
8e89f16 feat(mobile): protocolo del worker con gate de suspend y proxy de plataforma
8e6e816 feat(mobile): transport del worker con cola en suspend y WorkerCrashed
67671c4 feat(mobile): install-api arma window.api desde api-channels sobre el worker
825ca6d feat(mobile): arranque con installMobileApi y FatalScreen ante fallos del worker
cd9e8e3 fix(cauldron): completed_at es la hora del target y los intervals sobreviven a suspend/resume
343f411 test(notifications): el polling se detiene en suspend y se rearma en resume
2db5d4d feat(mobile): worker con sqlite-wasm sobre opfs-sahpool, suspend/resume y proxy de plataforma
54a2c12 feat(mobile): scaffold android, scripts mobile:* y versionado desde package.json
91659ef docs(mobile): resultado del MIME .wasm y smoke de persistencia en el emulador
4440c7b fix(mobile): menores de la revisión de chunks 1-3
2e6efc5 fix(mobile): menores de la revisión del chunk 5
```

## Desvíos respecto del plan

Los deliberados (APK debug, `scripts/android-version.mjs`, `appVersion`/`osInfo` fuera del proxy,
`pragma()` con filas-objeto, worker partido en dos, `fatal` post-`ready`) están declarados en el plan.
De ejecución:

1. `shared/build-api.ts:21` — la firma real de Fase 1 es `buildApi(transport, target)` con **dos**
   argumentos y ya filtra los canales `platforms:'desktop'`. `install-api.ts:32` usa
   `buildApi(client.transport, 'mobile')` y se eliminó el bucle de `delete` que proponía el plan.
2. `src/shared/platform-detect.ts` **no lo creó la Fase 1**; lo creó la Task 3 con el contenido del plan.
3. `vite.renderer.config.ts` no tenía `define: __HUBTIFY_PLATFORM__`; se agregó (`'"desktop"'`), sin
   él el guard de `main.tsx` tiraba `ReferenceError` en desktop.
4. `src/mobile/worker.ts:20` — `registerAllHandlers` sale de `@logic/register-all` (no de `registry`).
5. `src/mobile/worker.ts:69,74` — se usan `suspendDb()`/`resumeDb()` del provider (2ª rama de la nota
   del plan) y se borró la clase `DbSuspended` local: la lanza el provider.
6. Tasks 10–11: el `registerLifecycle` del cauldron y el guard de doble `startNotificationEngine` **ya
   venían de Fase 1** (`c599849`). No se duplicaron: al `resume` del cauldron se le agregó el `tick()`
   inmediato y el guard `!autoStartInterval`; la Task 11 quedó como test, sin cambio de producción.
7. `main.tsx:11` — alias tipado `const root: HTMLElement` porque TS pierde el estrechamiento dentro de
   las closures de `bootstrap()`.
8. `collectTransferablesFrom()` (`protocol.ts:104`) agregado en el fix-up: el dedupe por llamada no
   alcanzaba cuando el mismo `Uint8Array` viajaba en dos args distintos.

## Menores de revisión ya corregidos

`4440c7b`: dedupe de transferables (+ helper multi-arg), timeout de 2 s en `readOsInfo()` para que un
`Device.getInfo()` colgado no deje pantalla en blanco, rechazo de `pendingPlatform` cuando falla
`resume()`, guard de `version !== undefined` en `FatalScreen`.
`2e6efc5`: `.gitignore` cubre `android/**/*.jks|*.keystore|keystore.properties` (Fase 4 pone el
keystore en `android/app/`), `scripts/gradle.mjs` con la ruta entre comillas y `result.error` visible,
y `worker.ts` cierra la DB al final de `boot()` si llegó un `suspend` durante el arranque.

## Pendientes / lo que debe saber quien siga

- **La barra de título de escritorio (minimizar/maximizar/cerrar) se renderiza dentro del WebView
  Android** (visible en el screenshot). Es chrome de Electron colándose en móvil: trabajo de Fase 3
  (shell móvil), no se tocó acá.
- Ruido no bloqueante en logcat: `Error injecting safe area CSS: TypeError: Cannot read properties of
  null (reading 'style')` (×2, plugin nativo de Capacitor antes de que exista el `<body>`).
- `capacitor.config.ts` y `vite.mobile.config.ts` quedan fuera del `include` de `tsconfig.json`, así
  que `npx tsc --noEmit` no los valida; un error de tipo ahí aparece recién en `cap sync`.
- Transferir un `ArrayBuffer` lo **detacha del emisor** (diverge de `ipcRenderer.invoke`, que clona).
  Hoy inocuo; Fase 5 (`backup.ts` con `poolUtil.exportFile`) es el caso donde puede morder.
- **Fase 4 (CI/release)**: `release.yml` y `ci.yml` DEBEN correr `node scripts/android-version.mjs`
  antes de `cap sync` (o usar `npm run mobile:sync`), si no el APK sale con la versión del último
  `mobile:sync` local commiteado. `mobile:apk` es **debug**; el release firmado es Fase 4.
- Sin tests unitarios de `install-api.ts` (cableado con Worker real + Capacitor, como preveía el plan).
- `feature/mobile` no está pusheada.
