# Mobile Fase 1 — Reporte de ejecución

Plan: `2026-09-01-mobile-phase1-shared-logic.md` · Spec: `../specs/2026-09-01-mobile-android-design.md`
Rama: `feature/mobile` · Base: `2201eec` · HEAD: `135dbce` · Sin push.

## Estado por chunk

| Chunk | Tasks | Estado | Revisión |
|---|---|---|---|
| 1 Fundaciones (`shared-logic` ctx, registry, DB) | 1–3 | DONE | Approved (junto con 2) |
| 2 Binding Electron sobre el registry | 4–5 | DONE | Approved, 5 menores |
| 3 Mover módulos I (hojas, rpg, chicos, quests, nutrition, finance) | 6–11 | DONE | Approved (junto con 4) |
| 4 Mover módulos II (notifications, cauldron, sync, cierre) | 12–14 | DONE | Approved, 6 menores |
| 5 Tabla de canales, preload generado, config, docs | 15–19 | DONE | Approved, 3 menores |
| Limpieza de menores (commit extra) | — | DONE | — |

## Verificación final (HEAD `135dbce`)

- `npx tsc --noEmit` → exit 0 · `npm run typecheck:shared-logic` → exit 0
- `npm test` → **99 files / 1285 tests**, 0 failed (baseline 91 / 1247; objetivo del plan 99 / 1285)
- `rg "from 'electron'" shared-logic` → 0 · `git ls-files electron` = 9 · `git ls-files shared-logic` = 30
- `npm run lint` → 0 errores, 14 warnings preexistentes (7 `no-explicit-any` heredados en `sync.ipc.ts`, 7 en `src/`)
- `git status` limpio

## Commits (2201eec..HEAD)

```
3b80565 feat(shared-logic): scaffold with ids, events and PlatformPort
5a59771 feat(shared-logic): handler registry with lifecycle hooks
5204b80 refactor(db): shared-logic db provider with injectable factory; electron keeps openDesktopDb()
3b1726e refactor(ipc): route ipcHandle through shared-logic registry; bind to ipcMain once
46a79a2 feat(electron): PlatformPort and event sink for the desktop binding
a7ea1d8 refactor(shared-logic): move pure helpers (rpg-stats, habits, balance, notifications schema/engine, syl snapshot)
6b555df refactor(shared-logic): move rpg-handlers; broadcast() becomes emit()
7e00c43 refactor(shared-logic): move character, crypto, dollar, feedback and syl handlers
d436f13 refactor(shared-logic): move quests handlers
57e5ca0 refactor(shared-logic): move nutrition handlers
afeac5e refactor(shared-logic): move finance handlers; CSV export and PDF import go through PlatformPort
c599849 refactor(shared-logic): move notifications and cauldron; native notifications via PlatformPort, timers register a lifecycle
9ef8ac0 refactor(shared-logic): move sync handlers
f50d10f refactor(electron): main binds registerAllHandlers() and runAllModuleMigrations(); db.ts is openDesktopDb() only
85649e0 feat(api): single channel table for window.api, checked against HubtifyApi
c7f97b8 feat(api): buildApi() generates window.api from the channel table over a Transport
7bbc319 refactor(preload): generate window.api from the channel table; desktop-only methods become optional
d090602 chore(mobile): @logic alias, shared-logic typecheck in CI, CLAUDE.md points at shared-logic
135dbce chore(shared-logic): tidy leftovers flagged in review
```

## Desvíos respecto del plan / spec

Los deliberados de la spec (`SqlDatabase.transaction<A,R>`, `registerAllHandlers` en `register-all.ts`) están en el plan mismo. Desvíos de ejecución, todos menores y sin cambio de intención:

1. Task 3: el final de `db.ts` tenía `runModuleMigrations` → `export { applyMigrations }` → `closeDb` (no los dos bloques contiguos del plan); se borraron respetando el orden real.
2. Task 3: dos comentarios fuera del `git add` del plan reapuntados a `shared-logic/db/migrate.ts` (`shared/rpg-engine.ts:224`, `sync.ipc.ts:928`).
3. Task 4: el check `rg -L` del plan es incorrecto (`-L` = follow symlinks); se verificó con `rg -n`.
4. Números de línea del plan corridos en Tasks 4, 7, 12, 13; siempre ubicado por texto exacto.
5. Task 11 (documentado en el plan): `finance:exportCsv` muestra el diálogo DESPUÉS de armar el CSV y ya no devuelve `path` (nadie en `src/` lo leía); `importSelectAndParsePDF` puede devolver `{ ok:false, reason:'unsupported_platform' }`.
6. Task 17: `preload.ts` quedó en 27 líneas (el plan decía 33; mismo código).
7. Commit extra `135dbce` fuera del plan: limpieza de restos señalados por los revisores (harness muerto en 3 tests del cauldron, docblocks, comentario de `ipc-handle.ts`, `afterEach` de aislamiento en `platform.test.ts`/`provider.test.ts`).

## Issues menores pendientes (no bloquean)

- ~20 tests de finance/nutrition conservan un `vi.mock('electron')` ahora inerte (el plan mandó dejarlos).
- Sin test directo de `finance:exportCsv` ni `finance:importSelectAndParsePDF` (los dos handlers reescritos) ni del `Transport` de `electron/preload.ts` (WeakMap on/off).
- `shared/api-channels.ts` exporta `ApiKey` sin consumidor aún (preparación Fase 2, pedido por el plan).
- `vite.renderer.config.ts` gana el alias `@logic` aunque el renderer no debería importar `shared-logic`.
- `cauldron.ipc` llama `platform().notify` dentro de `setInterval` sin try/catch; en desktop `setPlatform` siempre corre antes (teórico).
- Cambio de UX no documentado: el click en notificaciones del Cauldron ahora enfoca la ventana (antes solo las del motor de notificaciones).

## Para mañana

- **Smoke manual en desktop pendiente (Task 19, Step 2)**: `npm start` y recorrer login/dashboard, export CSV, import PDF, notificación nativa, ventana flotante del Cauldron (`cauldron:tick` + unsubscribe), backup ZIP export+import, tray, sellar día. No se corrió Electron en esta sesión.
- `feature/mobile` no está pusheada.
- El gate `typecheck:shared-logic` ya está en CI (`.github/workflows/ci.yml`).
