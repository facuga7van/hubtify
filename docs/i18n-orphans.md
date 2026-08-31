# Orphaned i18n keys

**Generated 2026-08-31. 151 orphans out of 1076 keys in `src/i18n/es.json` (14%).**

> **Nothing here has been deleted.** This file is the *safe base* for a later cleanup.
> Several of these strings are better copy than what the UI shows today — they are
> unwired, not wrong. Read the verdicts before removing anything.

## How this was produced

1. Every leaf key in `src/i18n/es.json` was flattened to a dotted path (1076 keys).
2. Each path was searched as a literal across every `.ts`/`.tsx` in `src/` and
   `electron/`, excluding `src/i18n/` itself.
3. Keys reached through a **dynamically built** path were then excluded, since a
   literal search cannot see them. The dynamic prefixes detected in the code are:

   `cauldron.flavor.` · `cauldron.flavor.idle.` · `cauldron.flavor.paused.` ·
   `cauldron.ingredientNames.` · `datePicker.months.` · `events.` ·
   `nutrify.status.` · `nutrify.weekdays.`

   (39 keys were spared by this step — e.g. all of `events.*`, built as
   `` t(`events.${type}`) ``.)

### Correction to a previous audit

`questify.tier.quick` / `.normal` / `.epic` were reported as orphaned. **They are
not.** `src/modules/quests/utils.tsx:8-10` maps `TaskTier` 1/2/3 to those keys.
`questify.tier.*` is the *live* tier vocabulary; `questify.tiers.*`
(Communis/Rara/Epica/Legendaria/Delata) is the unused Latin rarity vocabulary —
the two are the other way round from what the audit said.

## Verdicts

| Verdict | Meaning |
|---------|---------|
| **KEEP — better copy** | Real, useful text that no code path reaches. Fixing the code is the right move, not deleting the key. |
| **KEEP — needs a decision** | Feature-adjacent; may belong to work in progress. |
| **RESIDUE** | Belongs to a flow that no longer exists. Safe to delete once nobody is mid-flight in these files. |

### Cluster notes

**`onboarding.login*` / `register*` / `noAccount` / `hasAccount` / `passwordMin` /
`connectionError` / `syncDesc` (13) — RESIDUE.** The onboarding auth step was
replaced by `src/hub/AuthPage.tsx`, which owns its own `auth.*` strings.

**`hub.dashboard` / `hub.character` / `hub.codex` (3) — RESIDUE.** Duplicates of
`dashboard.title` and `character.title`; the sidebar uses the latter.

**`questify.tiers.legendary` — RESIDUE.** Part of the unused Latin rarity set
(see the correction above). Note the sibling `tiers.*` keys are *not* listed here
only because the dead `.quest-tier-label--*` CSS still names them in
`quests.css`; the whole cluster is unwired.

**`coinify.deleteCardConfirm` / `coinify.deleteCategoryConfirm` — KEEP, better copy.**
Both spell out the cascade ("this also deletes the transactions…"). The code
currently passes a generic confirm message instead. **Wire these up; do not delete.**

**`nutrify.gymCalories` / `gymCaloriesHint` / `stepFactor` / `stepFactorHint` /
`exerciseConfig` / `tdeeBreakdown` / `overTdee` / `greatDeficit` / `onTrack` (9) —
KEEP, needs a decision.** A designed-but-unshipped TDEE-breakdown / exercise-config
panel. Delete only if that panel is formally abandoned.

**`cauldron.ticker.*` (4) and `cauldron.stats.*Sub` (3) — RESIDUE.** Sub-labels and
a status ticker that the current `CauldronPage` layout does not render.

**`cauldron.presets.classic` / `longFocus` / `quickSprint` (3) — KEEP, needs a
decision.** Names for built-in presets; presets are currently user-created only.

**`rpg.titles.*` (7) and `toast.good` / `critical` / `legendary` / `streakBonus` /
`combo` (5) — KEEP, needs a decision.** A level-title ladder and bonus-tier toast
labels. `BonusTier` (`'normal' | 'good' | 'critical' | 'legendary'`) still exists in
`src/modules/quests/types.ts`, so the toast keys have a live type behind them —
they are just never looked up.

**`dashboard.cart*` (9) — KEEP, needs a decision.** A complete set of
title/foot/tooltip triples for three dashboard cards. Either a removed widget or a
planned one.

**`character.*` (19) — mostly RESIDUE.** The character page was rewritten for the
Codex redesign (`hero-*` classes) and stopped using this vocabulary.

**`*.widgetHelp` (`coinify`, `nutrify`, `questify`, `cauldron`) — KEEP, better copy.**
Help-bubble text for the dashboard widgets, never attached to a `HelpBubble`.

---

## Full list

### `account` (1)

| Key | ES | EN |
|-----|----|----|
| `account.cached` | Cuentas guardadas | Saved accounts |

### `app` (2)

| Key | ES | EN |
|-----|----|----|
| `app.welcomeSub` | Tu registro de misiones te espera | Your quest log awaits |
| `app.version` | Hubtify v0.1.0 | Hubtify v0.1.0 |

### `auth` (1)

| Key | ES | EN |
|-----|----|----|
| `auth.errors.usernameRequired` | Elegí un nombre de usuario | Please choose a username |

### `cauldron` (14)

| Key | ES | EN |
|-----|----|----|
| `cauldron.presets.classic` | Clásico | Classic |
| `cauldron.presets.longFocus` | Enfoque Largo | Long Focus |
| `cauldron.presets.quickSprint` | Sprint Rápido | Quick Sprint |
| `cauldron.stats.streakSub` | días seguidos | days in a row |
| `cauldron.stats.totalSub` | desde que te uniste al gremio | since joining the guild |
| `cauldron.stats.weekSub` | sesiones esta semana | sessions this week |
| `cauldron.history.duration` | {{minutes}} min | {{minutes}} min |
| `cauldron.ticker.brewing` | Preparando poción de enfoque... | Brewing focus potion... |
| `cauldron.ticker.cycle` | Ciclo {{current}} de {{total}} | Cycle {{current}} of {{total}} |
| `cauldron.ticker.resting` | Los ingredientes reposan... | Ingredients settling... |
| `cauldron.ticker.today` | {{count}} pociones hoy | {{count}} brews today |
| `cauldron.eyebrow` | CALDERO | CAULDRON |
| `cauldron.widget.title` | Caldero | Cauldron |
| `cauldron.widgetHelp` | Timer Pomodoro: sesiones de enfoque con descansos. Completar ciclos otorga XP. | Pomodoro timer: focus sessions with breaks. Completing cycles grants XP. |

### `character` (19)

| Key | ES | EN |
|-----|----|----|
| `character.characterName` | Nombre del Personaje | Character Name |
| `character.coinifyTracked` | Coinify Registradas | Coinify Tracked |
| `character.dayStreak` | Racha de Días | Day Streak |
| `character.healthy` | Saludable | Healthy |
| `character.injured` | Herido | Injured |
| `character.levelProgress` | Progreso de Nivel | Level Progress |
| `character.maxLevel` | ¡Nivel máximo alcanzado! | Max level reached! |
| `character.nextTitle` | Próximo título | Next title |
| `character.nutrifylLogged` | Nutrify Registradas | Nutrify Logged |
| `character.questifyCompleted` | Questify Completadas | Questify Completed |
| `character.radiant` | Radiante | Radiant |
| `character.recentActivity` | Actividad Reciente | Recent Activity |
| `character.status` | Estado | Status |
| `character.subtitle` | Tus estadísticas RPG y personalización | Your RPG stats and customization |
| `character.tired` | Cansado | Tired |
| `character.todayCombo` | Combo de Hoy | Today's Combo |
| `character.totalXp` | XP Total | Total XP |
| `character.xpNeeded` | ({{xp}} XP total necesario) | ({{xp}} XP total needed) |
| `character.xpToLevel` | XP para nivel {{level}} | XP to level {{level}} |

### `coinify` (19)

| Key | ES | EN |
|-----|----|----|
| `coinify.title` | Libro del Tesorero | Treasurer's Ledger |
| `coinify.eyebrow` | COINIFY — LIBER THESAURI | COINIFY — LIBER THESAURI |
| `coinify.activate` | Activar | Activate |
| `coinify.byCategory` | Por Categoría | By Category |
| `coinify.crypto24h` | 24h | 24h |
| `coinify.editRecurring` | Editar recurrente | Edit recurring |
| `coinify.installmentsSubtitle` | Cuotas del mes | Monthly installments |
| `coinify.netDebts` | Deudas netas | Net debts |
| `coinify.noActiveDebts` | Sin deudas pendientes | No pending debts |
| `coinify.recurringSection` | Recurrentes | Recurring |
| `coinify.transactionsSection` | Transacciones | Transactions |
| `coinify.yes` | Sí | Yes |
| `coinify.deleteCategoryConfirm` | ¿Eliminar esta categoría? Las transacciones existentes no se verán afectadas. | Delete this category? Existing transactions won't be affected. |
| `coinify.deleteCardConfirm` | ¿Eliminar esta tarjeta? Los gastos asociados no se verán afectados. | Delete this card? Associated transactions won't be affected. |
| `coinify.pending` | Pendiente | Pending |
| `coinify.ccTracking` | TC | CC |
| `coinify.pendingCC` | TC Pendiente | CC Pending |
| `coinify.recurringOverdue` | vencido | overdue |
| `coinify.widgetHelp` | Balance mensual rápido: ingresos vs gastos del mes actual. | Quick monthly balance: income vs expenses for the current month. |

### `common` (3)

| Key | ES | EN |
|-----|----|----|
| `common.moduleNotInstalled` | Módulo no instalado | Module not installed |
| `common.combo` | Combo x | Combo x |
| `common.confirm` | Confirmar | Confirm |

### `dashboard` (12)

| Key | ES | EN |
|-----|----|----|
| `dashboard.cartDueToday` | MISIONES HOY | QUESTS TODAY |
| `dashboard.cartDueTodayFoot` | pendientes hoy | due today |
| `dashboard.cartDueTodayTip` | Misiones pendientes para hoy | Quests due today |
| `dashboard.cartMeals` | PROVISIONES | PROVISIONS |
| `dashboard.cartMealsFoot` | registradas hoy | logged today |
| `dashboard.cartMealsTip` | Comidas registradas hoy | Meals logged today |
| `dashboard.cartTransactions` | TRANSACCIONES | TRANSACTIONS |
| `dashboard.cartTransactionsFoot` | movimientos del día | movements today |
| `dashboard.cartTransactionsTip` | Movimientos financieros del día | Financial movements today |
| `dashboard.moduleQuests` | Libro de Misiones | Book of Quests |
| `dashboard.quote` | « Non est ad astra mollis e terris via. » | « Non est ad astra mollis e terris via. » |
| `dashboard.quoteAuthor` | — Séneca, transcripto de viejo volumen | — Seneca, transcribed from an old volume |

### `hub` (3)

| Key | ES | EN |
|-----|----|----|
| `hub.character` | Ficha del Héroe | Hero's Sheet |
| `hub.codex` | Códice del Aventurero | Adventurer's Codex |
| `hub.dashboard` | Tabla del Aventurero | Adventurer's Codex |

### `nutrify` (40)

| Key | ES | EN |
|-----|----|----|
| `nutrify.title` | Diario de Provisiones | Provision Journal |
| `nutrify.eyebrow` | NUTRIFY — PROVISIONES | NUTRIFY — PROVISIONS |
| `nutrify.calorieTarget` | {{pct}}% de {{target}} kcal | {{pct}}% of {{target}} kcal |
| `nutrify.dashboard` | Panel de Nutrify | Nutrify Dashboard |
| `nutrify.dashboardSub` | Resumen de los últimos 30 días | Last 30 days overview |
| `nutrify.dailyMetrics` | Métricas Diarias | Daily Metrics |
| `nutrify.consumed` | consumidas | consumed |
| `nutrify.overTarget` | sobre objetivo | over target |
| `nutrify.overTdee` | Superaste tu TDEE — ¡cuidado! | Over your TDEE — be careful! |
| `nutrify.overTargetWarning` | Pasaste tu objetivo pero todavía bajo TDEE | Over target but still under TDEE |
| `nutrify.greatDeficit` | ¡Gran déficit! Bonus de XP al cerrar el día | Great deficit! XP bonus when closing the day |
| `nutrify.onTrack` | Vas bien, seguí así | On track, keep it up |
| `nutrify.overBy` | Excedido por | Over by |
| `nutrify.dayStreak` | Racha de días | Day Streak |
| `nutrify.avgDailyKcal` | Promedio diario kcal | Avg Daily kcal |
| `nutrify.weeklyBalance` | Balance semanal (kcal) | Weekly Balance (kcal) |
| `nutrify.calories30` | Calorías (Últimos 30 Días) | Calories (Last 30 Days) |
| `nutrify.weightTrend` | Tendencia de Peso | Weight Trend |
| `nutrify.widgetHelp` | Resumen diario: calorías consumidas y tendencia de la semana. | Daily summary: calories consumed and weekly trend. |
| `nutrify.startLogging` | Empezá a registrar comidas para ver gráficos | Start logging food to see charts here |
| `nutrify.age` | Edad | Age |
| `nutrify.aiEstimate` | Estimación IA | AI Estimation |
| `nutrify.aiPlaceholder` | Describe lo que comiste... | Describe what you ate... |
| `nutrify.estimateError` | Error al estimar. Intenta en el modulo completo. | Estimation failed. Try the full module. |
| `nutrify.goal_maintain` | Mantener | Maintain |
| `nutrify.gymCalories` | Calorías por gym | Gym calories |
| `nutrify.gymCaloriesHint` | Calorías extra que quemás en un día de gym | Extra calories burned on a gym day |
| `nutrify.stepFactor` | Factor de pasos | Step factor |
| `nutrify.stepFactorHint` | Calorías por paso (típico: 0.03-0.05) | Calories per step (typical: 0.03-0.05) |
| `nutrify.exerciseConfig` | Configuración de Ejercicio | Exercise Configuration |
| `nutrify.tdeeBreakdown` | Desglose Energético | Energy Breakdown |
| `nutrify.goalDesc_deficit` | Perder peso gradualmente | Lose weight gradually |
| `nutrify.goalDesc_maintain` | Conservar composición | Maintain body composition |
| `nutrify.goalDesc_surplus` | Ganar masa muscular | Build muscle mass |
| `nutrify.weightCheckin.placeholder` | Tu peso actual (kg) | Your current weight (kg) |
| `nutrify.weightPopupEnabled` | Recordatorio de pesaje | Weigh-in reminder |
| `nutrify.mealFrom` | Desde | From |
| `nutrify.mealPickerTitle` | ¿Qué comida es? | Which meal? |
| `nutrify.mealTo` | Hasta | To |
| `nutrify.changeMeal` | Cambiar comida | Change meal |

### `onboarding` (13)

| Key | ES | EN |
|-----|----|----|
| `onboarding.yourModules` | Tus Módulos | Your Modules |
| `onboarding.questifyDesc` | Tareas y productividad | Tasks and productivity |
| `onboarding.nutriftyDesc` | Nutrición y calorías | Nutrition and calories |
| `onboarding.coinifyDesc` | Finanzas personales | Personal finance |
| `onboarding.loginTitle` | Iniciar Sesión | Login |
| `onboarding.registerTitle` | Crear Cuenta | Create Account |
| `onboarding.syncDesc` | Sincroniza tu progreso entre dispositivos | Sync your progress across devices |
| `onboarding.login` | Entrar | Login |
| `onboarding.register` | Crear Cuenta | Create Account |
| `onboarding.noAccount` | ¿No tenés cuenta? Registrate | Don't have an account? Register |
| `onboarding.hasAccount` | ¿Ya tenés cuenta? Iniciá sesión | Already have an account? Login |
| `onboarding.passwordMin` | La contraseña debe tener al menos 6 caracteres | Password must be at least 6 characters |
| `onboarding.connectionError` | Error de conexión | Connection error |

### `questify` (8)

| Key | ES | EN |
|-----|----|----|
| `questify.streakDays` | {{count}} días | {{count}} days |
| `questify.reward` | RECOMPENSA | REWARD |
| `questify.normal` | Normal | Normal |
| `questify.epic` | Épica | Epic |
| `questify.questsPending` | quests pendientes | quests pending |
| `questify.penalty` | CASTIGO | PENALTY |
| `questify.tiers.legendary` | Legendaria | Legendary |
| `questify.widgetHelp` | Vista rápida de tus misiones pendientes más próximas. | Quick view of your nearest pending quests. |

### `rpg` (9)

| Key | ES | EN |
|-----|----|----|
| `rpg.combo` | Combo | Combo |
| `rpg.loading` | Cargando... | Loading... |
| `rpg.titles.peasant` | Campesino | Peasant |
| `rpg.titles.squire` | Escudero | Squire |
| `rpg.titles.warrior` | Guerrero | Warrior |
| `rpg.titles.knight` | Caballero | Knight |
| `rpg.titles.champion` | Campeón | Champion |
| `rpg.titles.hero` | Héroe | Hero |
| `rpg.titles.legend` | Leyenda | Legend |

### `settings` (2)

| Key | ES | EN |
|-----|----|----|
| `settings.downloading` | Descargando... {{percent}}% | Downloading... {{percent}}% |
| `settings.installAndRestart` | Instalar y reiniciar | Install and restart |

### `toast` (5)

| Key | ES | EN |
|-----|----|----|
| `toast.good` | ¡Buen golpe! | Nice hit! |
| `toast.critical` | ¡Golpe crítico! | Critical hit! |
| `toast.legendary` | ¡LEGENDARIO! | LEGENDARY! |
| `toast.streakBonus` | ¡Racha bonus +{{xp}} XP! | Streak bonus +{{xp}} XP! |
| `toast.combo` | Combo | Combo |


---

## Recommended cleanup order

1. Wire up the **KEEP — better copy** keys (`coinify.deleteCardConfirm`,
   `coinify.deleteCategoryConfirm`, the four `*.widgetHelp`). That is a UX
   improvement, not a cleanup.
2. Delete the **RESIDUE** clusters in one commit per cluster: `onboarding.*` auth,
   `hub.dashboard/character/codex`, `cauldron.ticker.*` + `cauldron.stats.*Sub`,
   `character.*`.
3. Leave **KEEP — needs a decision** alone until a human decides on the TDEE panel,
   the level-title ladder, and the dashboard cart widgets.
4. Re-run the detection above afterwards — and remember to check `en.json` too;
   the tables below flag any key that is missing from one of the two files.
