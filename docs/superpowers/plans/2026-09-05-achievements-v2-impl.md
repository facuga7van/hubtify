# Logros v2 — contrato de implementación

**Rama:** `feat/achievements-v2` · **Worktree:** `D:/tmp/hubtify-achv2` · **Base:** `feat/coinify-integridad @ 0bcca68`

Tres agentes en paralelo, **propiedad exclusiva de archivos**. Nadie toca un archivo que no es suyo.
Si necesitás algo de otro archivo, dejá un `// TODO(achv2-<tu-nombre>): ...` y seguí.

**Fuente de verdad del catálogo:** el array `D` en `docs/superpowers/plans/easter-eggs-picker.html`
(149 entradas; `p:"X"` = cambios a logros ya publicados, `p:"A"` = vía de progresión, `p:"B"` = huevos).
Campos: `id`, `h` oculto, `c` costo, `t` título ES, `d` desc ES, `x` trigger en prosa, `f` familia,
`T` tier, `v` aviso. **Los renombres de abajo pisan lo que dice el HTML.**

---

## Propiedad de archivos

| Agente | Archivos que POSEE |
|---|---|
| **CATALOG** | `shared/achievements.ts` (entero) · `src/i18n/es.json` · `src/i18n/en.json` · `src/hub/codex/achievementCatalog.ts` · `shared/rpg-engine.test.ts` · `tests/ipc/rpg-achievements.test.ts` · `tests/ipc/rpg-event-labels.test.ts` |
| **ENGINE** | `shared-logic/modules/rpg-handlers.ts` (entero) · `shared-logic/db/migrate.ts` (solo la migración nueva) · `tests/ipc/rpg-achievement-context.test.ts` (nuevo) |
| **EMITTERS** | `shared/rpg-engine.ts` · `src/modules/finance/utils/rpg-events.ts` · `src/modules/finance/components/Transactions.tsx` · `src/modules/finance/components/DashboardWidget.tsx` · `src/modules/quests/components/TaskList.tsx` · `src/modules/cauldron/**` · `shared-logic/modules/cauldron*.ts` · `src/hub/codex/nutritionClose.ts` · `src/modules/nutrition/components/Today.tsx` · `src/modules/nutrition/**/weekly-api.ts` · tests de esos módulos |

`shared/achievements.ts` es de CATALOG **incluida la interfaz `AchievementContext`**: CATALOG declara los
campos nuevos según el contrato de abajo; ENGINE los implementa en `buildAchievementContext` con los
MISMOS nombres. Si uno de los dos ve que el contrato no cierra, lo anota en el TODO y no lo inventa.

---

## Contrato: campos nuevos de `AchievementContext`

Todos lazy + memoizados (patrón `sealsCount` / `distinctHabits`). Todos leen tablas que **no se podan**
salvo donde se indica. `refDay` = día de referencia del contexto.

| Campo | Tipo | Query / origen | Usado por |
|---|---|---|---|
| `bestiaryCategories` | `number` | `SELECT COUNT(*) FROM (SELECT category FROM finance_transactions WHERE type='expense' AND deleted_at IS NULL AND category NOT IN ('Transferencia','Pago Tarjeta') GROUP BY category HAVING COUNT(*) >= 3)` | bestiary_i/ii/iii |
| `budgetsActive` | `number` | `finance_budgets WHERE deleted_at IS NULL AND monthly_limit > 0` — verificar nombre real de la tabla/columna | drawn_ward |
| `statementImportMonths` | `number` | `COUNT(DISTINCT substr(created_at,1,7)) FROM finance_import_batches` — verificar tabla | iron_bank_i/ii/iii |
| `loansSettledAged` | `number` | `finance_loans WHERE settled=1 AND settled_date IS NOT NULL AND julianday(settled_date)-julianday(date) >= 7` — verificar columnas | lannister_i/ii/iii |
| `financeActiveMonths` | `number` | `COUNT(DISTINCT substr(date,1,7)) FROM finance_transactions WHERE deleted_at IS NULL` | path_i/ii/iii |
| `statementsPaid` | `number` | `finance_credit_card_statements WHERE status='paid'` — verificar | statement_settled |
| `financeMovementsToday` | `readonly {type:'expense'\|'income'; amount:number}[]` | del memo `day()`: agregar `payload` al SELECT y parsear `amount` de EXPENSE/INCOME_LOGGED | the_mirror, lead_into_gold |
| `daysSinceLastInModule` | `number` | **PRE-INSERT** (junto a `previousEvent`): `MAX(created_at) FROM rpg_events WHERE module_id = ?` → `daysDiff`. 0 si no hay previa o no hay evento | hundred_days_gone |
| `firstEventDateInModule` | `string \| null` | `MIN(created_at) FROM rpg_events WHERE module_id = ?` (fecha YYYY-MM-DD). ⚠ se poda a 365d, aceptable acá | the_ledgers_name_day |
| `checksPerHabit` | `readonly number[]` | `SELECT COUNT(*) c FROM habit_checks WHERE kind='check' AND deleted_at IS NULL GROUP BY habit_id` → array de conteos | nine_divines_ii/iii |
| `epicTasksTotal` | `number` | `rpg_events WHERE event_type='TASK_COMPLETED' AND json_extract(payload,'$.tier')=3` | great_undertaking |
| `repeatedTasksTotal` | `number` | ídem con `$.repeated = 1` (JSON true) | turning_wheel |
| `overdueClosedTotal` | `number` | ídem con `$.overdue = 1` | in_its_own_hour |
| `habitShieldsSpent` | `number` | `habit_checks WHERE kind='shield' AND deleted_at IS NULL` | raised_shield |
| `pendingTasks` | `number` | calcar `quests:getPendingCount` (`quests.ipc.ts` ~664) | cleared_board |
| `daysSinceThisHabit` | `number` | **solo si `event.type==='HABIT_CHECKED'`**: `MAX(date) FROM habit_checks WHERE habit_id=? AND kind='check' AND date < ? AND deleted_at IS NULL` con `payload.habitId` / `payload.date` → `daysDiff`. 0 si no hay previa | knee_healed |
| `pomodoroDays` | `number` | `COUNT(DISTINCT substr(created_at,1,10)) FROM rpg_events WHERE event_type='POMODORO_COMPLETED'` | beacons_i/ii/iii |
| `pomodoroHoursToday` | `readonly number[]` | del memo `day()`: horas de las filas POMODORO_COMPLETED (agregar `created_at` al SELECT) | sun_to_sun |
| `daysSinceLastPomodoro` | `number` | **PRE-INSERT**: `MAX(created_at) FROM rpg_events WHERE event_type='POMODORO_COMPLETED'` → `daysDiff`. 0 si no hay | cold_hearth |
| `firstHourToday` / `lastHourToday` | `number \| null` | del memo `day()` con `created_at` | dawn_to_dusk |
| `gapBeforeToday` | `number` | `MAX(created_at) FROM rpg_events WHERE created_at < refDay AND ${MEANINGFUL_EVENT_SQL}` → `daysDiff(…, refDay)`. 0 si no hay | like_nothing_happened |
| `daysSinceFirstEvent` | `number` | **NO desde rpg_events** (se poda). Desde una fecha de alta que no se pode: `player_stats.created_at` si existe, si no `user_profile`. Verificar y elegir | long_expected |
| `mealSlotsToday` | `readonly string[]` | `SELECT DISTINCT meal FROM food_log WHERE date=? AND deleted_at IS NULL AND meal IS NOT NULL` — verificar tabla/columna | long_table |
| `rewardsRedeemed` | `number` | `obolos_ledger WHERE delta < 0` (o por `reason`) — verificar | ferrymans_coin, just_in_case |
| `obolosSpent` | `number` | `COALESCE(-SUM(delta),0) FROM obolos_ledger WHERE delta < 0` | bag_of_tricks, horn_of_valhalla |
| `obolosBalance` | `number` | `COALESCE(SUM(delta),0) FROM obolos_ledger` | just_in_case |
| `innNightsLastStay` | `number` | `player_stats.inn_last_stay_days` (columna nueva, ver ENGINE) | well_rested |

### Trampa PRE-INSERT
`buildAchievementContext` corre DESPUÉS del insert del evento. Todo campo "días desde el último X"
tiene que calcularse **antes** del `INSERT INTO rpg_events` (como ya hace `previousEvent` en
`rpg-handlers.ts:565`) y pasarse al contexto. Si se calcula después, devuelve siempre 0.

---

## ENGINE — además de los campos

1. **Fix `hero_return`:** la query de `previousEvent` (`rpg-handlers.ts:565`) debe filtrar con
   `WHERE ${MEANINGFUL_EVENT_SQL}`. Hoy un `TASK_CREATED` de QuickAdd en medio del hueco reinicia el reloj.
2. **Migración core** en `shared-logic/db/migrate.ts`: `ALTER TABLE player_stats ADD COLUMN inn_last_stay_days INTEGER NOT NULL DEFAULT 0`.
3. **`setInnMode(db,false)`** (`rpg-handlers.ts:302`): al salir de la Posada, escribir `inn_last_stay_days = daysDiff(inn_since, today)`.
4. **NO** implementar racionamiento del backfill. La contención va por `!!c.event` en los predicados (CATALOG).
5. Test nuevo `tests/ipc/rpg-achievement-context.test.ts`: cada getter nuevo con DB en memoria, y el fix de `previousEvent` (un QuickAdd en el hueco NO reinicia el reloj).

## EMITTERS — payloads y eventos nuevos

| Dónde | Qué |
|---|---|
| `src/modules/finance/utils/rpg-events.ts` `emitMovementLogged()` + 2 call sites | payload `amount:number`, `currency:string`, `installments?:number` (cuando es alta con cuotas) en `EXPENSE_LOGGED`/`INCOME_LOGGED` |
| `src/modules/quests/components/TaskList.tsx` (~292) | `TASK_COMPLETED` payload `repeated: boolean` (`statusResult.repeated`) y `overdue: boolean` (`getDueDateStatus(task.dueDate)==='overdue'`, antes de completar) |
| `src/modules/cauldron/components/CauldronFloatingTimer.tsx` (~112) | `POMODORO_COMPLETED` payload `taskId` (ya está en `result.taskId`) |
| cauldron | **evento nuevo `CAULDRON_LAP_COMPLETED`** (xp 0, módulo `cauldron`) cuando `cycleComplete` (`cauldron.ipc.ts` ~324) |
| cauldron | **evento nuevo `POMODORO_EXTENDED`** (xp 0) en `cauldron:extend` (`cauldron.ipc.ts` ~1141) |
| `shared/rpg-engine.ts` | agregar ambos a `RpgEventType` y a `NON_MEANINGFUL_EVENT_TYPES` (si no, el sello y Cronista se autoalimentan) |
| `src/hub/codex/nutritionClose.ts` (~86) | `DAY_SUMMARY` payload `onTarget: (b.xpBonus ?? 0) > 0`, `weighed: (b.xpWeight ?? 0) > 0` |
| `src/modules/nutrition/components/Today.tsx` `handleLogEvent` (~659) | `MEAL_LOGGED` payload `isEvent: true` |
| `Today.tsx` ~826 `repeatDay` | **verificar** que también emita `source:'copy_day'`; si no, agregarlo |
| `weekly-api.ts` (~45) | `WEEK_SUMMARY` payload `daysClosed: report.daysClosed` |

Etiquetas i18n de los dos eventos nuevos (`rpg.eventTypes.CAULDRON_LAP_COMPLETED`, `POMODORO_EXTENDED`)
las agrega **CATALOG** — EMITTERS no toca i18n.

---

## CATALOG — reglas de escritura

1. **Header:** reemplazar el bloque de reglas (líneas 4-27) por el que está al final de este documento.
2. **Re-umbrales a los 40 publicados** (entradas `p:"X"` #1-7 del HTML). `lucky_strike` solo cambia la desc.
3. **Comentario de `second_chance`** (~229-231): está desactualizado, `DAY_REOPENED` SÍ se emite (`Today.tsx:1075`). Reescribirlo.
4. **Regla `!!c.event`:** todo peldaño **II o superior** y toda entrada que no sea "primera vez" ni estado de identidad exige `!!c.event` en el predicado. Los tier I y los huevos que ya leen `c.event` no necesitan más.
5. **`Math.floor`** en cualquier comparación contra XP (`the_number`). El XP guarda dos decimales.
6. `daysDiff` se importa de `./rpg-engine` (verificado: sin ciclo).
7. **i18n:** `rpg.achievements.<id>.title` / `.desc` en ES y EN para cada id nuevo o renombrado. EN: traducción fiel, misma referencia cuando exista en inglés (Oghma Infinium, Lord of Cinder, Arrow in the Knee…). Alfabético dentro de la sección.
8. **`ID_GROUPS`** en `achievementCatalog.ts`: una línea por id. El grupo es el estante DESTINO. Los huevos van a su estante temático (mientras están bloqueados viven en `hidden` igual).
9. **Ids absorbidos** (se ELIMINAN del catálogo, y sus i18n): `nine_rites`→`nine_divines_i`, `long_watch`→`isengard_ii`, `the_beacons`→`beacons_i`, `all_debts_paid`→`lannister_i`, `full_granary`→`winter_i`, `bestiary_of_coin`→`bestiary_i`. Ninguno de estos estaba publicado, así que no hay migración de `achievements_unlocked`.
10. Tests: actualizar el bloque de calibración de `shared/rpg-engine.test.ts` (conteos, % ocultos), y que `tests/ipc/rpg-event-labels.test.ts` pase — ese test exige que todo `event_type` que un logro consulta exista y tenga etiqueta.

### Renombres que PISAN el HTML (mezcla de franquicias, menos descarados)

| id | Título ES final |
|---|---|
| `bestiary_i` | Aprendiz del Brujo |
| `bestiary_ii` | Manual de Monstruos |
| `bestiary_iii` | El Bestiario de Kaer Morhen |
| `path_i` | La Senda |
| `path_ii` | Sinluz |
| `path_iii` | El Lobo Blanco |
| `heavy_tome` | El Libro de Mazarbul |
| `statement_settled` | Las Cuentas de Erebor |
| `fighters_guild_i/ii/iii` | Gremio de Aventureros I / II / III |
| `turning_wheel` | La Rueda del Tiempo |
| `raised_shield` | Escudo Hyliano |
| `beacons_i/ii/iii` | Hoguera Encendida I / II / III |
| `labelled_potion` | Golondrina |
| `one_more_log` | Pieza de Corazón |
| `tome_of_clear_thought` | Tomo del Pensamiento Claro |
| `archive_caught_up` | El Bibliotecario |
| `ferrymans_coin` | Frasco de Estus |
| `long_rest` | Meditación |
| `the_blessed_penny` | La Suerte del Bardo |
| `cold_hearth` | Invernalia |

Todo lo demás: el título `t` del HTML.

### Decisiones cerradas
- `hundred_days_gone`: `=== 100` exacto.
- `day_that_isnt` (La Ruptura del Dragón): **cualquier módulo**, no solo caldero.
- `fighters_guild_iii`: 25 misiones/día (no bajar a 20).
- `a_hundred_lines`: "Cartas en el Asunto".
- Los tres cupos de onboarding quedan en umbral 1: `marginalia`, `rewritten`, `broken_flask`.
- Oghma Infinium = Códice (365 sellos). La familia de hábitos es Los Nueve Divinos.

---

## Verificación (todos, antes de reportar)

```
cd D:/tmp/hubtify-achv2
npm run typecheck:shared-logic
npm test -- <archivos propios>
```
No corrás la suite entera al principio: es lenta. Al final CATALOG corre la suite completa una vez.

**Commits:** cada agente commitea SUS archivos con conventional commits, sin Co-Authored-By.
Scopes: `feat(rpg)`, `feat(finance)`, `feat(quests)`, `feat(cauldron)`, `feat(nutrition)`, `fix(rpg)`.

---

## Header nuevo de `shared/achievements.ts` (reemplaza reglas 1-3 + calibración)

```
 * Reglas que este archivo obedece:
 *
 *  1. NADA PUNITIVO. Un logro no se pierde nunca, no vence nunca, y ninguno se
 *     paga por EVITAR algo. Un huevo sobre una ausencia solo puede caer en el
 *     REGRESO — mientras el hueco dura no hay evento, no hay contexto y no
 *     corre ningún `check`. Si el copy se lee como reproche, está mal escrito.
 *
 *  2. ESCALERAS SÍ, PERO CON PISO DE CALENDARIO. Una familia I/II/III es
 *     legítima solo cuando sus peldaños no se pueden subir con ganas:
 *       a. Todo peldaño por encima del I se mide en unidades que el calendario
 *          no deja apurar (días distintos, meses, sellos) o en profundidad que
 *          no se fabrica (N hábitos con M marcas CADA UNO). Un peldaño que se
 *          alcanza en una tarde de entusiasmo es el mismo logro dos veces.
 *       b. El peldaño I es la ÚNICA "primera vez" a la que un módulo tiene
 *          derecho. Si un módulo necesita seis medallas de estreno, el que está
 *          mal calibrado es el módulo.
 *       c. Si el camino óptimo para subir un tier es ensuciar los datos del
 *          usuario (partir una compra, crear hábitos falsos), el tier está mal.
 *     CRONISTA sigue siendo la excepción declarada: cuenta filas de rpg_events.
 *
 *  3. RECOMPENSAR MAESTRÍA, VARIEDAD Y DESCUBRIMIENTO. Un logro se paga por
 *     hacer algo BIEN (combo máximo), algo RARO (una tirada de 3.0) o algo que
 *     el jugador no sabía que existía.
 *
 *  4. LOS HUEVOS SON COINCIDENCIA, NO ESFUERZO. Un `hidden: true` de la familia
 *     de coincidencia se ENCUENTRA, no se persigue. Test único: si alguien
 *     puede leer el título y proponérselo, es una misión. Que lo vea el 0,3%
 *     de la gente no es un costo: es el producto.
 *
 *  5. NINGUNA ENTRADA MIDE EL PROPIO CATÁLOGO. Un medidor de completitud
 *     convierte al último huevo en una casilla de checklist.
 *
 *  6. EL BACKFILL RECONOCE, NO REGALA. La barrida sin evento (`event === null`)
 *     debe encontrar únicamente peldaños I y estados de identidad. Toda entrada
 *     por encima exige `!!c.event`: se gana en el acto que la dispara.
 *
 *  7. NUTRIFY NO ESCALONA COMIDA, PESO NI CUMPLIMIENTO. Solo el archivo
 *     (pergaminos, días cerrados como crónica). `the_pact_kept` y
 *     `honest_scales` son terminales por diseño: no admiten tier II jamás.
 *
 * Calibración (verificada por `shared/rpg-engine.test.ts`):
 *   - Dos denominadores. La VÍA DE PROGRESIÓN se calibra; la COLA DE AZAR (los
 *     huevos de coincidencia) no se calibra, se acepta.
 *   - Objetivo sobre el catálogo completo: día 1 <= 2%, semana 1 ~6%,
 *     mes 1 ~15%, mes 6 ~32%, año 1 ~45%, techo asintótico ~62%. El resto que
 *     nunca se completa ES la cola de azar, y es deliberado.
 *   - LA MÉTRICA QUE MANDA: ningún tramo de 30 días del primer año puede
 *     terminar sin un solo desbloqueo.
 *   - `first_step` dispara con el PRIMER evento de cualquier tipo.
 *   - El XP guarda dos decimales (`Math.round(x*100)/100`): toda igualdad
 *     contra XP usa `Math.floor`. `rpg_events` se poda a 365 días: ningún
 *     umbral sobre `countByType` puede superar lo que cabe en un año.
```
