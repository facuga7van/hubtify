# Hubtify — Project Instructions

Gamified life hub: Electron 41 + React 19 + TypeScript + better-sqlite3 + Firebase Firestore.
Four modules: **Questify** (tasks), **Coinify** (finance), **Nutrify** (nutrition), **Character** (avatar).

## Architecture

```
electron/          Main process: IPC handlers, SQLite, RPG engine
  modules/         Module-specific IPC (finance.ipc.ts, quests.ipc.ts, etc.)
  ipc/             Core: db.ts, rpg-handlers.ts, registry.ts
  preload.ts       Context bridge (~180 methods)
src/               Renderer: React + Vite
  modules/         Feature modules (finance/, quests/, nutrition/, character/)
  shared/          Shared components, hooks, animations
  hub/             Shell: Layout, Sidebar, PlayerCard, Auth
  i18n/            es.json, en.json
  core/            ModuleRegistry
shared/            Types shared between main & renderer (types.ts)
```

## Critical Conventions

### Multi-Account Sync (MANDATORY for any data-related feature)

Every table with user data MUST be in `USER_DATA_TABLES` array in `electron/modules/sync.ipc.ts`. If you create a new table:

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
- **Handler**: Use `ipcHandle()` wrapper from `electron/ipc/ipc-handle.ts`
- **IDs**: `crypto.randomUUID()` via `genId()` helper
- **DB naming**: snake_case in SQL, camelCase in JS via aliases (`created_at AS createdAt`)
- **Preload**: Expose in `electron/preload.ts`, type in `shared/types.ts` HubtifyApi interface
- **Complex params**: Use `Record<string, unknown>` in preload, typed in IPC handler

### Database

- SQLite with WAL, foreign_keys ON
- Migrations: `{ namespace, version, up }` in `module.schema.ts`, run via `runModuleMigrations()`
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

- **Theme vars**: `--rpg-parchment`, `--rpg-gold`, `--rpg-wood`, `--rpg-hp-red`, `--rpg-xp-green` (see `hub/styles/theme.css`)
- **Module prefixes**: Finance `.coin-*`, Quests `.quest-*`, Nutrition `.nutri-*`
- **Base components**: `.rpg-card`, `.rpg-button`, `.rpg-input`, `.rpg-select`, `.rpg-bar`
- **Font**: Cinzel (headers), Crimson Text (body)

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

## Module Registry

Each module exports a `ModuleDefinition` with: id, name, routes, dashboardWidget, migrations, rpgEventHandlers. Registered in `src/App.tsx`.

## Don't

- Don't build after changes (user handles this)
- Don't use cat/grep/find/sed/ls — use bat/rg/fd/sd/eza
- Don't add Co-Authored-By or AI attribution to commits
- Don't add features beyond what's asked
- Don't skip the `account:switched` listener on new data components
- Don't forget to add new tables to `USER_DATA_TABLES` and sync handlers
- Don't use `window.confirm()` or `window.alert()` — use `useConfirm()` from `shared/components/ConfirmDialog` for in-app RPG-themed dialogs
