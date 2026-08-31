# Orphaned i18n keys

**Regenerated from scratch 2026-08-31 (second pass).**
**114 orphans out of 1133 keys in `src/i18n/es.json` (10%).**
**72 residue keys were deleted in this pass, from *both* `es.json` and `en.json`.**

> The previous edition of this file (151 orphans / 1076 keys) was stale: since it was
> written, roughly 150 keys were added and several keys it listed as orphaned had been
> wired up (`coinify.deleteCardConfirm` and `coinify.deleteCategoryConfirm`, among
> others). Everything below comes from a fresh run, not from editing the old tables.

## How this was produced

1. Every leaf of `src/i18n/es.json` was flattened to a dotted path (arrays count as one
   leaf — e.g. `cauldron.ingredientNames` was a 12-element array).
2. Each path was searched literally across every `.ts` / `.tsx` under **`src/`,
   `electron/` and the root `shared/`**, excluding `src/i18n/` itself.
   *`shared/` matters:* `shared/types.ts` and `shared/rpg-engine.ts` hold the
   `rpg.titles.*` ladder. Scanning only `src/` + `electron/` reports 7 false orphans.
3. Matching is **boundary-aware**, not plain substring: `coinify.pendingCC` is contained
   in `coinify.pendingCCToday`, and `settings.reset` in `settings.resetAllConfirmFull`.
   A key counts as used only when the next character cannot continue the key.
4. Keys reached through a **dynamically built** path were then excluded — a literal
   search cannot see them.

### Dynamic key prefixes in the code today

| Prefix / pattern | Built at |
|---|---|
| `events.` | `src/hub/Dashboard.tsx:448`, `src/hub/CharacterPage.tsx:353` |
| `datePicker.months.` | `RpgDatePicker.tsx:21`, `RpgDateTimePicker.tsx:36` — string concat, not a template literal |
| `nutrify.status.` | `src/modules/nutrition/components/Today.tsx:42` |
| `nutrify.weekdays.` | `NutritionSettings.tsx:364` |
| `cauldron.flavor.` (incl. `.idle.`, `.paused.`) | `CauldronPage.tsx:260-264` |
| `nutrify.goal_` | `Onboarding.tsx:320`, `NutritionOnboarding.tsx:180`, `NutritionSettings.tsx:296` |
| `nutrify.goalDesc_` | `NutritionSettings.tsx:300` |
| `nutrify.meal` + Capitalized | `FoodLogItem.tsx:41` → `mealBreakfast` / `mealLunch` / `mealDinner` / `mealSnack` |
| `toast.` | `Toast.tsx:73` — resolves only to `toast.good` / `critical` / `legendary` |
| `coinify.reason_` | `src/modules/finance/utils/api-ext.ts:58` |

The last five did **not** appear in the previous edition and are the main reason its
orphan list was too aggressive.

`cauldron.ingredientNames.${i}` used to belong on this list; its call site was deleted in
`bb1e120`, which is why the key is now residue rather than dynamic.

Keys referenced **indirectly but still literally** — `tourSteps.ts` (`titleKey` /
`descKey`), `widget-registry.ts` (`titleKey`), `shortcuts.ts` (`i18nKey`),
`quests/utils.tsx` `TIER_LABEL`, `cauldron/hooks.ts` `DEFAULT_PRESET_KEYS`,
`Onboarding.tsx` `FONT_OPTIONS` — are found by step 2 and are **not** orphans.

## What was deleted (72 keys, both languages)

Only unequivocal residue: keys belonging to a flow that no longer exists (each verified
against the commit that removed it) or exact duplicates of a key that *is* in use.

| Cluster | Keys | Why it is residue |
|---|---|---|
| `onboarding.login*` / `register*` / `noAccount` / `hasAccount` / `passwordMin` / `connectionError` / `syncDesc` | 9 | The auth step left onboarding in `25e8e57`. `src/hub/AuthPage.tsx` owns login/register under `auth.*`; four of the nine were byte-identical to an `auth.*` key already in use. |
| `onboarding.yourModules` / `questifyDesc` / `nutriftyDesc` / `coinifyDesc` | 4 | The module-picker step is gone — `Onboarding.tsx` has `TOTAL_STEPS = 4` (preferences / character / nutri / ready). |
| `cauldron.ingredients*` / `ingredientNote` / `ingredientNames` / `reward` / `questReward` | 6 | The ingredients card and reward rows were deleted wholesale in `bb1e120`. |
| `cauldron.ticker.*` (4) + `cauldron.weeklyFocusHelp` | 5 | The ticker was removed in `d87d23b`; `weeklyFocusHelp` was superseded by `weeklyFocusHelp2`, which is in use. |
| `character.*` old page vocabulary | 19 | CharacterPage was rewritten in `d87d23b` around `statX` / `virtue*` / `chronicle` / `titleTrail`. Each deleted key maps to a live replacement (`coinifyTracked` → `statExpenses`, `xpToLevel` → `xpToNextLevel`, …). Includes two typo keys, `nutrifylLogged` and `nutriftyDesc`. |
| `dashboard.eyebrow`, `salutation1..5`, `moduleQuests` | 7 | The prose greeting block was deleted in `723b064`; `eyebrow` was split into the live `eyebrowText` + `eyebrowSub`; `moduleQuests` duplicates `moduleTasks`, which `widget-registry.ts` uses. |
| `settings.*` superseded confirms and rows | 11 | Each has a live successor (`reset` → `resetAll`, `importConfirm*` → `importConfirmFile`, `sound` → `soundEffects` + `soundDesc`, …). `installAndRestart` died with the manual update step in `6236da1`; the "Repetir onboarding" row was deleted in `723b064`. |
| `questify.quick` / `normal` / `epic` | 3 | Byte-identical duplicates of `questify.tier.*`. `TaskList.tsx:31` says so outright: *"Labels come from `questify.tier.*` via TIER_LABEL — one vocabulary"*. |
| `rpg.loading`, `hub.character`, `hub.dashboard`, `coinify.transactionsSection`, `coinify.recurringSection`, `auth.logout`, `app.version` | 7 | Exact duplicates of a live key (`common.loading`, `character.title`, `dashboard.title`, `coinify.transactions`, `coinify.recurringLabel`) or removed flows (logout moved to `AccountDropdown` under `account.signOut`; the version is read from `package.json` since `6aeed6d`). |
| `coinify.pendingCC` | 1 | Orphaned in this same pass: the dashboard's cryptic "a hoy" rune was replaced by explicit copy under `coinify.pendingCCToday`. |

Every one of the 72 was checked before deletion to be: present in **both** files, a leaf
(or, for `ingredientNames`, a fully dead array), and referenced **nowhere** in `src/`,
`electron/` or `shared/`.

## What was kept (114 orphans)

Nothing below was deleted. Two reasons dominate: the string is better copy than what the
UI shows today, or it belongs to a feature nobody has decided about.

| Section | Count |
|---|---|
| `nutrify` | 46 |
| `coinify` | 22 |
| `questify` | 14 |
| `dashboard` | 11 |
| `common` | 6 |
| `cauldron` | 5 |
| `nav` | 3 |
| `app` | 2 |
| `account`, `auth`, `character`, `hub`, `rpg` | 1 each |

Worth flagging individually:

- **`cauldron.eyebrow` is an i18n bug, not an orphan.** `CauldronPage.tsx:458` hardcodes
  `eyebrow="CALDERO"` instead of calling the key. Wire it up; don't delete it.
- **`questify.tiers.*`** (Communis / Rara / Epica / Legendaria / Delata) is a *distinct*
  Latin rarity vocabulary, not a duplicate of `questify.tier.*`. Two of the five never
  reached code at all.
- **The `*.widgetHelp` family** (`cauldron`, `coinify`, `nutrify`, `questify`) — four
  parallel keys, none ever wired. A help-bubble pass that was written and never applied.
- **`dashboard.cart*`** (9 keys) — cartouches dropped when the dashboard narrowed to four
  widgets. The `Cartouche` component still exists, so these are re-wirable.
- **`nav.achievements` / `nav.village` / `common.comingSoon`** — `comingSoon: true` nav
  placeholders removed in `723b064`; they belong to planned features.
- **`toast.streakBonus`** — sits under the `toast.` dynamic prefix but the only values
  `Toast.tsx:73` can produce are `good` / `critical` / `legendary`, so it is unreachable
  in practice. Kept because the tier vocabulary may still grow.

## Parity and coverage checks (run after the deletion)

- `es.json` and `en.json` hold **exactly the same 1133 keys**. Zero keys in one and not
  the other.
- **No key referenced in code is undefined *without a fallback*.** 59 keys are called that
  `es.json` does not define — but every one of them passes an inline Spanish fallback to
  `t()`, so nothing renders as a raw key path. They are concentrated in Coinify (31) and
  Questify (20), the two most recently refactored modules. The real consequence is that
  those strings **never translate to English**, since they are missing from `en.json` too.
  Promoting them into both files is a worthwhile follow-up; it is a separate job from this
  cleanup and was deliberately not done here.

## Suggested next steps

1. Fix `cauldron.eyebrow` — one hardcoded string, one key already written.
2. Promote the 59 fallback-only keys into `es.json` + `en.json` so the English build stops
   falling back to Spanish.
3. Wire the four `*.widgetHelp` keys, or decide against dashboard widget help and delete
   them as a set.
4. Leave the rest alone until someone decides on the TDEE panel, the Latin rarity ladder
   and the dashboard cartouches.
5. Re-run this analysis after any of the above — and keep the boundary-aware matching plus
   the full dynamic-prefix table, or the result will be wrong in both directions.
