# Hubtify — Project Instructions

Gamified life hub: Electron 41 + React 19 + TypeScript + better-sqlite3 + Firebase Firestore.
Four modules: **Questify** (tasks), **Coinify** (finance), **Nutrify** (nutrition), **Character** (avatar).

## Architecture

```
shared-logic/      Business logic shared by desktop and Android. Pure TS, sync, NO electron/node/dom
  registry.ts      registerHandler (alias `ipcHandle`) · getHandler · lifecycle hooks
  register-all.ts  registerAllHandlers() — the 13 platform-neutral register*IpcHandlers
  db/              SqlDatabase interface, getDb()/setDbFactory(), core + module migrations
  modules/         All IPC handlers (finance.ipc.ts, quests.ipc.ts, rpg-handlers.ts, …)
  platform.ts      PlatformPort (dialogs, files, notifications, app/os info) — injected
  events.ts        emit(channel, payload) main → renderer — sink injected
  ids.ts           genId()
electron/          Desktop binding only
  main.ts          Windows, tray, startup order: setDbFactory → setPlatform → setEventSink → registerAllIpcHandlers → getDb → runAllModuleMigrations
  platform.ts      PlatformPort with dialog/fs/Notification
  ipc/db.ts        openDesktopDb() (better-sqlite3 + WAL)
  ipc/registry.ts  registerAllIpcHandlers(): shared handlers + backup, then bind to ipcMain
  modules/         backup.ipc.ts, updater.ts (desktop-only)
  preload.ts       Generated from shared/api-channels.ts via shared/build-api.ts
src/               Renderer: React + Vite
  modules/         Feature modules (finance/, quests/, nutrition/, character/)
  shared/          Shared components, hooks, animations
  hub/             Shell: Layout, Sidebar, PlayerCard, Auth
  i18n/            es.json, en.json
  core/            `ModuleDefinition` type only (module contract — no runtime registry)
shared/            Types + the window.api channel table (types.ts, api-channels.ts, build-api.ts)
```

## Critical Conventions

### Multi-Account Sync (MANDATORY for any data-related feature)

Every table with user data MUST be in `USER_DATA_TABLES` array in `shared-logic/modules/sync.ipc.ts`. If you create a new table:

1. Add it to `USER_DATA_TABLES`
2. Include it in the appropriate `sync:getAll*Data` handler
3. Include it in the appropriate `sync:merge*Data` handler
4. Finance data goes through `sync:getAllFinanceData` / `sync:mergeFinanceData`
5. Finance is stored in Firestore subcollection `hubtify_users/{uid}/finance/data`

### account:switched Event (MANDATORY for any component displaying data)

Every component that loads data from the backend MUST listen for `account:switched` and reload:

```typescript
useEffect(() => {
  const handler = () => loadData();
  window.addEventListener('account:switched', handler);
  return () => window.removeEventListener('account:switched', handler);
}, [loadData]);
```

This event fires on: account switch, add account, logout (auto-switch to next account).

### IPC Pattern

- **Channels**: `module:action` (e.g., `finance:addTransaction`, `quests:getTasks`)
- **Handler**: `ipcHandle(channel, (_e, ...args) => …)` imported as `import { registerHandler as ipcHandle } from '../registry'` inside `shared-logic/modules/`. Handlers live in `shared-logic/modules/*.ipc.ts` and MUST NOT import `electron`, `fs`, `path`, `os`, `crypto` or `better-sqlite3` (`npm run typecheck:shared-logic` enforces it)
- **IDs**: `genId()` from `shared-logic/ids.ts`
- **DB**: `getDb()` from `shared-logic/db` (type `SqlDatabase`, never `better-sqlite3`'s `Database`)
- **OS access** (dialogs, files, native notifications, app version): `platform()` from `shared-logic/platform.ts`. Implement new methods in `electron/platform.ts` (and later `src/mobile/platform-host.ts`)
- **main → renderer events**: `emit(channel, payload)` from `shared-logic/events.ts`
- **DB naming**: snake_case in SQL, camelCase in JS via aliases (`created_at AS createdAt`)
- **Exposing to the renderer**: add ONE entry to `shared/api-channels.ts` + its type in `shared/types.ts` `HubtifyApi`. `preload.ts` is generated — never edit it by hand. Desktop-only methods get `platforms: 'desktop'` and are optional (`?:`) in `HubtifyApi`
- **Complex params**: Use `Record<string, unknown>` in `HubtifyApi`, typed in the handler
- **Tests**: register the module's handlers, then `getHandler(channel)!({}, ...args)` from `shared-logic/registry`; `clearHandlers()` in `beforeEach` if you re-register; mock the DB with `vi.mock('.../shared-logic/db', () => ({ getDb: () => db }))`

### Database

- SQLite with WAL, foreign_keys ON
- Migrations: `{ namespace, version, up }` in `module.schema.ts`, wired in `shared-logic/db/all-migrations.ts` (`runAllModuleMigrations()`)
- Use `INSERT OR IGNORE` for any data that could come from sync
- Soft deletes: Use `deleted_at` column (quests module pattern) for sync support

### React Components

- **Data loading**: `useCallback` for loader + `useEffect` with deps to trigger
- **Events**: `window.addEventListener` in useEffect with cleanup return
- **Forms**: `rpg-card coin-quick-add-form` wrapper, `rpg-input`, `rpg-select`, `rpg-button` classes
- **Toast**: `const { toast } = useToast()` — types: xp, coin, nutri, success, warning, info
- **Animations**: GSAP with `useGSAP` hook, timelines in `src/shared/animations/`
- **Shared components**: `src/shared/components/` (global), `src/modules/*/components/shared/` (module)

### CSS

**Full reference: `DESIGN_SYSTEM.md`** — read it before writing any new CSS.

- **Theme vars** (canonical names, defined in `src/hub/styles/theme.css`):
  - Ink / text: `--ink`, `--ink-soft`, `--ink-faded`
  - Parchment surfaces: `--parch-0`, `--parch-1`, `--parch-2`, `--parch-3`
  - Gold accents: `--gold`, `--gold-light`, `--gold-dark`
  - Leather / frames: `--leather`, `--leather-light`, `--leather-dark`
  - Red (rubric / HP / danger): `--rubric`, `--rubric-light`
  - Green (moss / XP / success): `--moss`, `--moss-light`, `--moss-dark`
  - Type scale: `--fs-timer`, `--fs-display`, `--fs-hero`, `--fs-stat`, `--fs-accent`,
    `--fs-heading`, `--fs-nav`, `--fs-sub`, `--fs-body`, `--fs-quote`, `--fs-label`
  - Z-index scale: `--z-base`, `--z-dropdown`, `--z-floating`, `--z-sidebar`, `--z-overlay`,
    `--z-drawer`, `--z-modal`, `--z-toast`, `--z-dropdown-top`, `--z-tour`, `--z-system-toast`
- **`--rpg-*` names are legacy aliases only.** `--rpg-gold`, `--rpg-parchment`, `--rpg-wood`,
  `--rpg-hp-red` and `--rpg-xp-green` exist in `theme.css` purely as `var()` aliases of the real
  tokens above, kept so older module CSS keeps rendering. **Use the canonical names in new code.**
  Any other `--rpg-*` name you invent is undefined, and an undefined `var()` without a fallback
  silently drops the whole declaration — the #1 source of "why is this style not applying".
- **Module prefixes**: Finance `.coin-*`, Quests `.quest-*`, Nutrition `.nutri-*`, Cauldron `.cauldron-*`
- **Base components**: `.rpg-card`, `.rpg-button`, `.rpg-input`, `.rpg-select`, `.rpg-bar`
- **Fonts** (loaded via the Google Fonts `@import` at the top of `theme.css`):
  - `UnifrakturCook` — display / page titles (`--ff-display`)
  - `IM Fell English` — body (`--ff-body`)
  - `IM Fell English SC` — small-caps accents, labels (`--ff-accent`)
  - `Cormorant Garamond` — quotes and epigraphs (`--ff-quote`)
  - `Fira Code` — numeric / monospace
  Prefer the `--ff-*` aliases over literal family names.

### i18n

- Files: `src/i18n/es.json`, `src/i18n/en.json` (nested by module: coinify.*, questify.*, etc.)
- Always use fallback: `t('coinify.myKey', 'Texto por defecto')`
- Add keys to BOTH language files, alphabetically within their section
- Spanish is primary language (fallbackLng)

### RPG System

Modules emit events via `window.api.processRpgEvent()`. Each module defines `rpgEventHandlers` in its module definition. Events give XP/HP with combo multiplier (1.0-2.0x) and random bonus.

### Commits

Format: `type(scope): description`
- Types: feat, fix, docs, chore, refactor
- Scopes: finance, quests, nutrition, character, sync, db, auth, updater
- No AI attribution lines

### Testing

- Vitest with node environment, better-sqlite3 in-memory (`:memory:`)
- Tests in `tests/` directory mirroring source structure
- Path aliases: `@core`, `@modules`, `@shared`

## Module Wiring (there is NO runtime registry)

`src/modules/{quests,nutrition,finance,cauldron}/index.ts` each export a `ModuleDefinition`
(id, name, icon, routes, dashboardWidget, migrations, rpgEventHandlers). **That object is a
descriptor only — nothing dispatches through it.** The `ModuleRegistry` class was removed; only
the type survives in `src/core/module-registry.ts`.

Where wiring actually happens — change these when you add a module:

| Concern           | Real location                                                        |
| ----------------- | -------------------------------------------------------------------- |
| Migrations        | `shared-logic/db/all-migrations.ts` (`runAllModuleMigrations()`)      |
| IPC handlers      | `shared-logic/register-all.ts` (`registerAllHandlers()`)              |
| Dashboard widgets | imported directly in `src/hub/widgets/widget-registry.ts`             |
| Routes            | hardcoded JSX `<Route>` elements in `src/App.tsx`                     |
| RPG events        | `shared-logic/modules/rpg-handlers.ts`                                |
| `window.api`      | `shared/api-channels.ts` (+ `HubtifyApi` in `shared/types.ts`)        |

## Don't

- Don't build after changes (user handles this)
- Don't use cat/grep/find/sed/ls — use bat/rg/fd/sd/eza
- Don't add Co-Authored-By or AI attribution to commits
- Don't add features beyond what's asked
- Don't skip the `account:switched` listener on new data components
- Don't forget to add new tables to `USER_DATA_TABLES` and sync handlers
- Don't use `window.confirm()` or `window.alert()` — use `useConfirm()` from `shared/components/ConfirmDialog` for in-app RPG-themed dialogs
- Don't use emojis/Unicode emoji characters in the UI — use inline SVG icons from `src/shared/components/icons/` instead. Medieval RPG theme requires hand-crafted vector icons, not emojis
- Don't import `electron`, `fs`, `path`, `os`, `crypto`, `better-sqlite3` or anything under `electron/` from `shared-logic/` — that code also runs inside the Android worker
- Don't edit `electron/preload.ts` by hand — add the entry to `shared/api-channels.ts`
