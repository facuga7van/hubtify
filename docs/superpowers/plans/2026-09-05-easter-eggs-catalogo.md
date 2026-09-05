# Catálogo de logros y easter eggs — para marcar

**Estado:** propuesta. Nada implementado. Marcá con `[x]` lo que entra y editá libremente el
título, la descripción o el trigger de cada entrada. Lo que quede sin marcar, no existe.

- **128 entradas** (74 logros + 54 easter eggs), sobre las 40 que ya están en el catálogo.
- **Costo:** `0` = solo `shared/achievements.ts` + i18n · `P` = payload nuevo en el emisor ·
  `C` = getter lazy en `AchievementContext` · `E` = evento nuevo · `M` = persistencia nueva.
- Aplicado: dedup de 14 colisiones entre agentes, poda de 9 entradas que eran misiones disfrazadas
  de huevo, y marcado de lo roto o inseguro.

---

## Antes de marcar: cinco cosas que hay que arreglar igual

Salieron de la investigación y son independientes de qué elijas.

### 1. Bug vivo en `hero_return`

`daysSinceLastActivity` se mide contra la última fila de `rpg_events` **incluidas las no
significativas**. Un `TASK_CREATED` de QuickAdd en medio del hueco reinicia el reloj: alguien que
estuvo dos meses afuera pero tiró una tarea suelta un martes **no cobra `hero_return` nunca**.

Arreglo: agregar `WHERE ${MEANINGFUL_EVENT_SQL}` a la consulta de `previousEventAt`
(`shared-logic/modules/rpg-handlers.ts:565`). Una línea. Sin esto, **los 11 huevos de regreso de
este documento son código muerto**.

### 2. Comentario falso en `second_chance`

`shared/achievements.ts:229-231` dice que `DAY_REOPENED` "ya nadie lo emite".
`src/modules/nutrition/components/Today.tsx:1075` lo emite hoy. El logro es alcanzable; el que está
mal es el comentario.

### 3. `POMODORO_COMPLETED` viaja pelado

`{ xp: 8, hp: 0 }` y nada más, aunque `result.taskId` está en el mismo callback a dos líneas
(`CauldronFloatingTimer.tsx:112`). Señal que ya se paga y se tira.

### 4. El XP no es entero

`rpg-handlers.ts:500` guarda `Math.round(xp * 100) / 100` — dos decimales. **Cualquier igualdad
estricta contra un XP fallaría siempre.** Por eso `#93` usa `Math.floor`.

### 5. `daysSinceLastActivity` tiene techo

El sync poda `rpg_events` a los 365 días. Si la fila anterior ya no está, el getter devuelve **0, no
infinito**. Un huevo de "volviste después de un año" con umbral 365 sería inalcanzable por
construcción — por eso `#79` usa 300, y por eso `#100` no puede sacar su fecha de `rpg_events`.

### Verificado: qué hace el backfill

`rpg-handlers.ts:963` — `insertEvent.run()` está adentro de `if (mode === 'live')`.

- El backfill **SÍ** escribe en la tabla `achievements_unlocked` (línea 962, sin guard).
- El backfill **NO** escribe filas `ACHIEVEMENT_UNLOCKED` en `rpg_events`.

Consecuencia: `#74` dispara en el backfill; `#50` no se autodispara, pero cae en el evento
*siguiente* del mismo día porque el contexto se arma antes de escribir las filas.

---

# PARTE A — LOGROS (1-74)

Metas perseguibles. Mezcla de visibles y ocultos.

## Coinify (1-15)

- [ ] **1. `coin_both_columns`** · visible · `0`
  **Debe y Haber** — "Un gasto y un ingreso anotados el mismo día. El libro tiene dos columnas."
  **Trigger:** un `EXPENSE_LOGGED` y un `INCOME_LOGGED` el mismo día.
  *GoT — un libro que solo registra pérdidas no es un libro.*

- [ ] **2. `first_wage`** · visible · `0`
  **La Paga Inesperada** — "Registraste tu primer ingreso. Lo que ya era tuyo y todavía no sabías."
  **Trigger:** primer `INCOME_LOGGED`.
  *Witcher — la Ley de la Sorpresa, definida sin nombrarla.*

- [ ] **3. `all_debts_paid`** · visible · `0`
  **Toda Deuda se Paga** — "Tres préstamos saldados. La palabra vale lo que vale el oro."
  **Trigger:** `LOAN_SETTLED >= 3`.
  *GoT — el lema sin la casa.*

- [ ] **4. `full_granary`** · visible · `0`
  **El Granero Lleno** — "Tres meses cerrados dentro del presupuesto. El invierno no asusta a quien guardó grano."
  **Trigger:** `BUDGET_MONTH_MET >= 3`.
  *GoT — aprovisionarse para el invierno largo.*

- [ ] **5. `master_of_coin`** · visible · `0`
  **Consejero de la Moneda** — "Los cuatro oficios de Coinify cumplidos: anotar, saldar, cerrar el mes y archivar un resumen."
  **Trigger:** al menos uno de cada: movimiento, `LOAN_SETTLED`, `BUDGET_MONTH_MET`, `STATEMENT_IMPORTED`.
  *GoT + oficio medieval real (Master of the Mint).*

- [ ] **6. `books_never_forget`** · **oculto** · `0`
  **Los Libros no Olvidan** — "Cinco resúmenes archivados. El papel se pierde; el asiento queda."
  **Trigger:** `STATEMENT_IMPORTED >= 5`.
  *GoT — la banca de ultramar no olvida un asiento.*

- [ ] **7. `heavy_tome`** · **oculto** · `0`
  **El Tomo Pesado** — "Un solo resumen con cincuenta renglones o más."
  **Trigger:** `STATEMENT_IMPORTED` con `payload.count >= 50`.
  *GoT — los libros de una casa de contaduría.* (fusiona `paper_avalanche`)

- [ ] **8. `contract_collected`** · **oculto** · `0`
  **Contrato Cobrado** — "Anotaste un movimiento con el multiplicador al máximo. La paga llega al final del trabajo."
  **Trigger:** movimiento de finanzas con `comboMultiplier >= 2.0`.
  *Witcher — el contrato se cobra recién cuando está cerrado.*

- [ ] **9. `market_day`** · visible · `0`
  **Día de Feria** — "Cinco movimientos anotados en un mismo día."
  **Trigger:** 5 movimientos (gasto + ingreso) el mismo día.
  *GoT — el día de feria en el patio del castillo.*

- [ ] **10. `sealed_with_gold`** · visible · `0`
  **Sello con Oro** — "Cerraste un día del Códice en el que Coinify estuvo presente."
  **Trigger:** `DAY_SEALED` con `'finance'` en `payload.modules`.
  *GoT — el escribano estampa la página del día.*

- [ ] **11. `bestiary_of_coin`** · visible · `C`
  **El Bestiario del Gasto** — "Ocho categorías distintas usadas alguna vez. No se pelea contra lo que no tiene nombre."
  **Trigger:** 8 categorías de gasto distintas (excluye transferencias y pagos de tarjeta).
  *Witcher — el bestiario: primero nombrás al monstruo.*

- [ ] **12. `drawn_ward`** · visible · `C`
  **El Círculo Trazado** — "Le pusiste un límite a una categoría. El escudo se traza antes de la pelea, no durante."
  **Trigger:** al menos un presupuesto con límite mensual.
  *Witcher — la señal que se traza en el piso antes del combate.*

- [ ] **13. `coin_from_overseas`** · **oculto** · `P`
  **Moneda de Ultramar** — "Anotaste un movimiento en moneda extranjera."
  **Trigger:** movimiento con `payload.currency !== 'ARS'`.
  *GoT — la moneda de hierro de la ciudad libre del otro lado del mar.*

- [ ] **14. `statement_settled`** · visible · `E`
  **Resumen Saldado** — "Pagaste un resumen de tarjeta completo. Los libros quedaron parejos."
  **Trigger:** evento nuevo `STATEMENT_PAID` (con `xp: 0` — las compras ya pagaron al anotarse).
  *GoT — a la casa que paga no le mandan cobradores.*

- [ ] **15. `twelve_moons`** · **oculto** · `P`
  **Doce Lunas** — "Anotaste un plan de doce cuotas o más. El que lo escribe, no se olvida."
  **Trigger:** `EXPENSE_LOGGED` con `payload.installments >= 12`.
  *GoT — una promesa larga que cruza el giro entero de las estaciones.*

## Questify (16-27)

- [ ] **16. `road_goes_on`** · visible · `0`
  **El Camino Sigue** — "Marcaste tu primer paso dentro de una misión. Un tramo, y después otro."
  **Trigger:** primer `SUBTASK_COMPLETED`. · *LotR — el Camino sigue y sigue.*

- [ ] **17. `the_company`** · visible · `0`
  **La Compañía** — "Misión, paso y rito en un mismo día. Tres caminos, una sola marcha."
  **Trigger:** `TASK_COMPLETED` + `SUBTASK_COMPLETED` + `HABIT_CHECKED` el mismo día.
  *LotR — gente distinta caminando junta.*
  ⚠ Colisiona de título con **#39**. Hay que renombrar uno de los dos.

- [ ] **18. `nine_rites`** · visible · `0`
  **Los Nueve Ritos** — "Nueve hábitos distintos marcados alguna vez. Cada uno con su altar."
  **Trigger:** `distinctHabits >= 9`. · *TES — los Nueve Divinos y sus nueve santuarios.*

- [ ] **19. `great_undertaking`** · visible · `0`
  **Empresa Mayor** — "Cerraste una misión épica. Alguien tenía que cargarla, y fuiste vos."
  **Trigger:** `TASK_COMPLETED` con `payload.tier === 3`.
  *LotR — el que se ofrece a llevar la carga sin saber el camino.*
  (fusiona `contract_fulfilled`; título alternativo: **Contrato Cumplido**, Witcher)

- [ ] **20. `dawn_ride`** · visible · `0`
  **Cabalgata del Alba** — "Tres misiones cerradas antes de las nueve. El este ya estaba mirando."
  **Trigger:** 3 `TASK_COMPLETED` y el evento cae antes de las 9.
  *LotR — los jinetes que llegan al amanecer.*

- [ ] **21. `shrine_round`** · visible · `0`
  **Ronda de Altares** — "Cinco ritos marcados en un mismo día. La ronda entera, altar por altar."
  **Trigger:** 5 `HABIT_CHECKED` el mismo día. · *Skyrim — la peregrinación de bendiciones.*

- [ ] **22. `turning_wheel`** · visible · `P`
  **La Rueda que Gira** — "Cerraste una misión que vuelve sola. El relato no termina: se repite."
  **Trigger:** `TASK_COMPLETED` con `payload.repeated === true`. · *TES — la Rueda del tiempo lórico.*

- [ ] **23. `rewritten`** · **oculto** · `0`
  **Lo Escrito se Reescribe** — "Reabriste una misión que ya habías cerrado. Ni las profecías son definitivas."
  **Trigger:** primer `TASK_UNCOMPLETED`.
  *TES — los Pergaminos Ancestrales: profecía que cambia al leerse.*

- [ ] **24. `marginalia`** · **oculto** · `0`
  **Notas al Margen** — "Anotaste una misión al vuelo, sin abrir el tablero. Los libros grandes empiezan en un margen."
  **Trigger:** primer `TASK_CREATED` (solo lo emite el QuickAdd).
  *LotR — el Libro Rojo empezado a mano alzada.*

- [ ] **25. `raised_shield`** · **oculto** · `C`
  **El Escudo Alzado** — "Un escudo mantuvo tu rito en pie el día que faltaste."
  **Trigger:** al menos un `habit_checks` con `kind = 'shield'`.
  *Skyrim — el golpe llega y la racha aguanta. Celebra el perdón que el sistema ya da.*

- [ ] **26. `cleared_board`** · visible · `C`
  **Tablero Despejado** — "No queda ninguna misión abierta. El salón quedó en silencio."
  **Trigger:** `pendingTasks === 0` y al menos un cierre hoy.
  *Skyrim — la etiqueta "Cleared" sobre la mazmorra vaciada.*

- [ ] **27. `in_its_own_hour`** · **oculto** · `P`
  **A Su Debida Hora** — "Cerraste una misión vencida. Nada llega tarde: llega cuando tiene que llegar."
  **Trigger:** `TASK_COMPLETED` con `payload.overdue === true`.
  *LotR — el mago que nunca llega tarde ni temprano (la idea, no la frase).*

## Caldero (28-38)

- [ ] **28. `long_watch`** · visible · `0`
  **La Larga Vigilia** — "Ocho pociones en un mismo día. Alguien tenía que quedarse mirando el fuego."
  **Trigger:** 8 `POMODORO_COMPLETED` el mismo día. · *LotR — la guardia larga sobre las murallas.*

- [ ] **29. `midnight_oil`** · visible · `0`
  **Aceite de Medianoche** — "Tres pociones al fuego pasadas las diez. Las forjas que no duermen."
  **Trigger:** pomodoro a las 22 o después, con 3 ya hechos ese día.
  *LotR — las fraguas encendidas toda la noche.*

- [ ] **30. `perfect_boil`** · visible · `0`
  **El Hervor Perfecto** — "Una poción salida con el multiplicador al tope. La mezcla justa."
  **Trigger:** `POMODORO_COMPLETED` con `comboMultiplier >= 2.0`.
  *Skyrim — la poción de cuatro ingredientes que sale redonda.*

- [ ] **31. `anvil_and_edge`** · visible · `0`
  **Yunque y Filo** — "Tres pociones y tres misiones el mismo día. Primero se forja, después se usa."
  **Trigger:** 3 pomodoros + 3 tareas el mismo día. · *Skyrim — el bucle forjar → salir a usarlo.*

- [ ] **32. `the_beacons`** · visible · `C`
  **Las Almenaras** — "Siete días distintos con el caldero encendido. Un fuego llama al siguiente."
  **Trigger:** 7 días **distintos** (no consecutivos) con pomodoro.
  *LotR — las almenaras de Gondor. Días distintos a propósito: no hay racha que romper.*

- [ ] **33. `broken_flask`** · **oculto** · `0`
  **El Frasco Roto** — "Un enfoque cortado dejó su marca en el estante. El inventario también guarda lo que no salió."
  **Trigger:** primer `POMODORO_ABANDONED`.
  *Skyrim — el frasco fallido que igual ocupa lugar en la mochila.*

- [ ] **34. `labelled_potion`** · **oculto** · `P`
  **Poción con Etiqueta** — "Terminaste una poción con la misión escrita en el frasco."
  **Trigger:** `POMODORO_COMPLETED` con `payload.taskId`.
  *Skyrim — la poción sin etiqueta es una apuesta. Revela el puente Caldero↔Questify.*

- [ ] **35. `embers`** · **oculto** · `0`
  **Rescoldo** — "Sellaste un día con tres pociones ya en el estante. El fuego se apaga cuando el trabajo terminó."
  **Trigger:** `DAY_SEALED` con 3 pomodoros ese día. · *LotR — tapar las brasas antes de dormir.*

- [ ] **36. `full_circle`** · visible · `E`
  **El Círculo Cerrado** — "Una vuelta entera del caldero, descanso largo incluido."
  **Trigger:** evento nuevo `CAULDRON_LAP_COMPLETED` (el dato ya existe: `cycleComplete`).
  *LotR — el Camino que sigue hasta volver a la puerta de casa.*

- [ ] **37. `one_more_log`** · **oculto** · `E`
  **Un Poco Más de Leña** — "Pediste tiempo extra en vez de cortar. El fuego aguanta si lo alimentás."
  **Trigger:** evento nuevo `POMODORO_EXTENDED` (`xp: 0`).
  *LotR — Sam echando otra rama al fuego. Descubre una perilla hoy invisible.*

- [ ] **38. `sun_to_sun`** · visible · `C`
  **De Sol a Sol** — "Una poción con luz y otra con la noche encima, el mismo día."
  **Trigger:** pomodoros antes de las 12 **y** después de las 20 el mismo día.
  *LotR — los enanos que trabajan de sol a sol bajo la montaña.*
  ⚠ Colisiona de título con **#40**.

## Transversales (39-50)

- [ ] **39. `fellowship`** · visible · `0`
  **La Compañía** — "Los cuatro módulos conocen tu letra. No hizo falta que fuera el mismo día."
  **Trigger:** al menos un evento de por vida en cada uno de los 4 módulos.
  *LotR — la compañía se arma de a uno. Es el `perfect_day` para quien no vive corriendo.*
  ⚠ Colisiona de título con **#17**.

- [ ] **40. `dawn_to_dusk`** · visible · `C`
  **De Sol a Sol** — "Abriste el día antes de las siete y lo cerraste después de las diez de la noche."
  **Trigger:** primer evento del día antes de las 7 y último después de las 22.
  *LotR — la jornada larga, no la productiva.* ⚠ Colisiona de título con **#38**.

- [ ] **41. `critical_hit`** · **oculto** · `0`
  **Golpe Crítico** — "Un solo hecho pagó cien de experiencia. Los dados aplaudieron."
  **Trigger:** `bonusMultiplier >= 2.0` y `xpGained >= 100`.
  *D&D — el crítico. El filtro por bonus deja afuera los hitos de racha.*

- [ ] **42. `million_to_one`** · **oculto** · `0`
  **Una entre un Millón** — "El dado más alto sobre el combo más alto. Lo improbable se cansó de esperar."
  **Trigger:** `bonusMultiplier >= 3.0` y `comboMultiplier >= 2.0`.
  *Discworld — las casualidades de una en un millón.*

- [ ] **43. `second_breakfast`** · **oculto** · `0`
  **Segundo Desayuno** — "Dos comidas anotadas antes de las once. Alguien acá entiende de medias mañanas."
  **Trigger:** 2 `MEAL_LOGGED` antes de las 11. · *LotR — el segundo desayuno hobbit.*

- [ ] **44. `cold_trail`** · **oculto** · `0`
  **El Rastro Frío** — "Marcaste un hábito de un día que ya había pasado. El rastro seguía tibio."
  **Trigger:** `HABIT_CHECKED` con `payload.date` distinto del día del evento.
  *Witcher — rastrear lo que ya pasó.*

- [ ] **45. `long_night`** · **oculto** · `0`
  **La Noche Larga** — "Cinco hechos y todavía no amaneció."
  **Trigger:** evento antes de las 5 con 5 hechos ese día.
  *GoT — disjunto de `night_owl` porque después de medianoche el día ya rotó.*

- [ ] **46. `last_ember`** · **oculto** · `0`
  **La Última Brasa** — "Anotaste un hecho con el Vigor casi apagado. Los días duros también se registran."
  **Trigger:** evento con XP > 0 y `stats.hp <= 40`.
  *Dark Souls — la hoguera que no se apaga. Premia presentarse, nunca evitar.*

- [ ] **47. `unlucky_thirteen`** · **oculto** · `0`
  **Ni te Cases ni te Embarques** — "Cerraste algo un martes 13. Los dados no se enteraron."
  **Trigger:** `weekday === 2` y día del mes `13`.
  *Superstición de mesa, localizada al Río de la Plata (acá es martes, no viernes).*
  Nota: **#104** es su hermano raro — el mismo día, pero con el dado del 2% encima.

- [ ] **48. `suns_edge`** · **oculto** · `0`
  **El Filo del Sol** — "Un hecho anotado en un solsticio. El sol también lleva su cuenta."
  **Trigger:** fecha `06-21` o `12-21`. · *Zelda / Discworld — la fecha que el mundo marca sola.*

- [ ] **49. `secret_hunter`** · **oculto** · `C`
  **Cazador de Secretos** — "Cinco medallones que nadie te mostró."
  **Trigger:** 5 logros ocultos desbloqueados.
  *Zelda (semillas escondidas) / Skyrim (muros de palabras).*
  Nota: el `Set` de desbloqueados ya existe dentro de `evaluateAchievements` — **cero queries**.

- [ ] **50. `medallion_night`** · **oculto** · `0`
  **Noche de Medallones** — "Tres medallones en un mismo día. El estante hizo ruido."
  **Trigger:** 3 `ACHIEVEMENT_UNLOCKED` el mismo día. · *Meta / Skyrim.*
  ⚠ Verificado: no se autodispara en el backfill, pero **cae en el evento siguiente**, no en el tercero.

**Descartado del lote transversal:** `amber_flask` (`DAY_SUMMARY.payload.hp > 0`). En objetivo de
déficit, curar HP se logra comiendo muy poco: premiaría restringir. **#55** cubre la idea con la
señal correcta.

## Nutrify (51-62)

- [ ] **51. `first_scroll`** · visible · `0`
  **Primer Pergamino** — "Sellaste tu primer pergamino semanal. La semana ya es historia escrita."
  **Trigger:** primer `WEEK_SUMMARY`. · *D&D / TES — el pergamino de un solo uso.*

- [ ] **52. `scroll_keeper`** · visible · `0`
  **Custodio de Pergaminos** — "Cuatro semanas selladas. El archivo ya tiene estante propio."
  **Trigger:** `WEEK_SUMMARY >= 4`. · *TES — la biblioteca infinita de Apocrypha.*

- [ ] **53. `seven_nights_written`** · visible · `P`
  **Siete Noches Escritas** — "Una semana con los siete días cerrados. Ninguna noche quedó en blanco."
  **Trigger:** `WEEK_SUMMARY` con `payload.daysClosed >= 7`.
  *D&D — la bitácora de campaña. Premia registrar, jamás cumplir.*

- [ ] **54. `set_table`** · visible · `0`
  **La Mesa Puesta** — "Cuatro registros de comida en un mismo día. La mesa quedó puesta entera."
  **Trigger:** 4 `MEAL_LOGGED` el mismo día.
  *TES — el salón de hidromiel. Premia anotar, no comer más ni menos.*

- [ ] **55. `the_pact_kept`** · visible · `P`
  **El Pacto Cumplido** — "Cerraste un día dentro del objetivo que vos mismo elegiste. El pacto era con vos."
  **Trigger:** `DAY_SUMMARY` con `payload.onTarget === true`, donde `onTarget = xpBonus > 0`.
  *D&D — el pacto del brujo: vale porque VOS lo redactaste.*
  ⚠ **No usar `hp > 0`.** En déficit, comer 800 sobre 3000 cura HP igual. `xpBonus > 0` exige
  `slackPct <= 0.30`, o sea cerca del objetivo del lado bueno.

- [ ] **56. `yesterdays_pantry`** · **oculto** · `0`
  **La Despensa de Ayer** — "Repetiste el día de ayer entero. El camino cómodo también es camino."
  **Trigger:** `MEAL_LOGGED` con `payload.source === 'copy_day'`.
  *D&D — las raciones de viaje.* (fusiona `same_stew`)
  ⚠ Verificar que el `repeatDay` de `Today.tsx:826` también setee `source`. Hoy solo se confirmó el
  botón de la línea 702.

- [ ] **57. `the_feast`** · visible · `P`
  **El Banquete** — "Registraste un festín. El asado también entra en el códice."
  **Trigger:** `MEAL_LOGGED` con `payload.isEvent === true`.
  *Elden Ring. Visible a propósito: el mensaje "el asado paga igual" tiene que verse.*

- [ ] **58. `honest_scales`** · **oculto** · `P`
  **El Fiel de la Balanza** — "Te pesaste y lo anotaste. El número no importa: importa que lo mirás de frente."
  **Trigger:** `DAY_SUMMARY` con `payload.weighed === true`. · *D&D — la balanza pesa, no juzga.*
  ⚠ **Una sola, nunca escalera.** Premia el acto de medir, jamás el valor ni la dirección.

- [ ] **59. `oath_of_the_table`** · visible · `C`
  **Juramento de la Mesa** — "Siete jornadas cerradas cerca del objetivo que elegiste. Déficit, mantenimiento o superávit: el juramento es tuyo."
  **Trigger:** 7 cierres con `xp_bonus > 0`. · *D&D — el juramento que se sostiene por convicción propia.*

- [ ] **60. `thirty_nights_at_table`** · visible · `0`
  **Treinta Noches en la Mesa** — "Treinta días cerrados en Nutrify. Un mes entero anotado."
  **Trigger:** `DAY_SUMMARY >= 30`. · *Cuenta cierres, no cumplimientos: es crónica, no dieta.*

- [ ] **61. `tea_of_the_scribe`** · **oculto** · `0`
  **La Merienda del Escriba** — "Anotaste algo entre las cuatro y las siete. Hasta el escriba corta para merendar."
  **Trigger:** `MEAL_LOGGED` entre las 16 y las 19.
  *TES. La franja es literalmente la `merienda` del `MealSchedule`.*

- [ ] **62. `archive_caught_up`** · **oculto** · `0`
  **El Archivo al Día** — "Tres pergaminos atrasados sellados de una sentada. El archivo respira."
  **Trigger:** 3 `WEEK_SUMMARY` el mismo día. · *TES — la biblioteca que crece sola.*

## El Códice (63-74)

- [ ] **63. `bound_volume`** · visible · `0`
  **Tomo Encuadernado** — "Cien días sellados. Lo que empezó como hojas sueltas ya es un libro."
  **Trigger:** `sealsCount >= 100`. · *TES — los Pergaminos Ancestrales.*

- [ ] **64. `centenary_vow`** · visible · `0`
  **Voto Centenario** — "Cien días de racha."
  **Trigger:** `streak >= 100` o `bestStreak >= 100`.
  *Calza con el hito 100 de `STREAK_MILESTONES`. Lee `bestStreak`: nunca se pierde.*

- [ ] **65. `seal_of_four_hands`** · visible · `0`
  **Sello de las Cuatro Manos** — "Sellaste un día donde los cuatro oficios dejaron huella."
  **Trigger:** `DAY_SEALED` con `payload.modules.length >= 4`.
  *Elden Ring. Distinto de `perfect_day`: ese lo VIVIÓ, este lo CERRÓ.*

- [ ] **66. `overflowing_page`** · **oculto** · `0`
  **Página Desbordada** — "Veinte hechos en una sola jornada. No entraron en la página."
  **Trigger:** `DAY_SEALED` con `payload.eventsCount >= 20` (= `SEAL_EVENT_CAP`).
  *D&D — las notas del máster cuando la sesión se le fue de las manos.*

- [ ] **67. `long_rest`** · visible · `0`
  **Descanso Largo** — "Tres días en la Posada y la app te siguió esperando."
  **Trigger:** `innSince !== null` y 3 días o más desde el check-in.
  *D&D. Hermana visible de `deserved_rest`.* Pide importar `daysDiff` (verificado: sin ciclo).

- [ ] **68. `saving_throw`** · **oculto** · `0`
  **Tirada de Salvación** — "El indulto llegó con treinta días en juego. Los salvó todos."
  **Trigger:** `pardonUsed` con `streak >= 30`. · *D&D — el dado que aparece cuando importa.*

- [ ] **69. `the_heros_face`** · visible · `C`
  **El Rostro del Héroe** — "Le diste cara a tu personaje, no solo nombre."
  **Trigger:** avatar personalizado. · *TES — el espejo de la creación. Par de `awakening`.*

- [ ] **70. `knight_errant`** · visible · `0`
  **Caballero Andante** — "Nivel 20. El título ya no es de cortesía."
  **Trigger:** `level >= 20`. · *Calza con `TITLE_THRESHOLDS[20] = 'Caballero'`.*

- [ ] **71. `well_rested`** · **oculto** · `M`
  **Bien Descansado** — "Volviste de la Posada y el primer día de vuelta rindió."
  **Trigger:** 2+ noches en la Posada, ya saliste, y `xpToday >= 60`.
  *TES — el bono por dormir en cama: descansar PAGA, no cuesta.*
  Nota: única entrada del documento que pide persistencia nueva (`inn_last_stay_days`).

- [ ] **72. `ferrymans_coin`** · visible · `C`
  **La Moneda del Barquero** — "Gastaste tus primeros óbolos en algo tuyo. Guardarlos no era el juego."
  **Trigger:** al menos un canje.
  *Dark Souls — las almas no valen nada hasta que las gastás.*

- [ ] **73. `ashless_flame`** · **oculto** · `0`
  **La Llama Sin Ceniza** — "Una jornada larga sellada con el Vigor entero. Ni una brasa de menos."
  **Trigger:** `DAY_SEALED` con `vigor === 100` y `eventsCount >= 10`.
  *Dark Souls. Más raro que `radiant_seal` (>= 90).*

- [ ] **74. `half_the_library`** · visible · `C`
  **Media Biblioteca** — "Veinte logros en el estante. La biblioteca crece sola."
  **Trigger:** 20 filas en `achievements_unlocked`. · *TES — Apocrypha.*
  ⚠ **Decisión de diseño pendiente.** Un medidor de completitud convierte al último oculto en una
  casilla de checklist. Verificado: **esta sí dispara en el backfill**.

---

# PARTE B — EASTER EGGS (75-128)

No son metas: son hallazgos. **Todos ocultos.** Coincidencia antes que esfuerzo, y el copy es el
premio — el XP es contabilidad. Se podaron 9 propuestas que eran misiones difíciles disfrazadas o
farmeables (lista al final).

## La familia del regreso (75-85)

**El principio:** un logro necesita un evento para evaluarse. Mientras el hueco dura, el `check` no
corre. Estos caen mecánicamente en la vuelta, nunca en la ausencia. Precedente: `hero_return`.

⚠ **Los once dependen del arreglo #1 del encabezado.** Sin él, un QuickAdd suelto en medio del hueco
los mata a todos.

- [ ] **75. `gate_guard`** · `0` · ~3%
  **El Guardia de la Puerta** — "Treinta días de racha alguna vez. Treinta de silencio después. Todo guardia de puerta fue aventurero — la diferencia es que vos volviste."
  **Trigger:** volver tras 30 días con `bestStreak >= 30`.
  *El arquetipo entero, sin la cita. El remate invierte la tragedia del personaje: al guardia le
  pasó que nunca volvió. `bestStreak` no se resetea: el huevo te puede esperar dos años.*
  (fusiona `used_to_be_adventurer`)

- [ ] **76. `knee_healed`** · `C` · ~20%
  **La Rodilla Ya Está Bien** — "Un rito que tenías abandonado hace más de un mes volvió a marcarse. Antes hacías esto todos los días. Después pasó lo que pasa. Nadie preguntó nada."
  **Trigger:** `HABIT_CHECKED` de un hábito sin marcar hace 30+ días.
  *El chiste está en el título; la última línea es el abrazo. La flecha no se nombra.*

- [ ] **77. `no_haste`** · `0` · ~12%
  **No Hay que Apurarse** — "Dos meses sin aparecer. Los que viven mil años tampoco se apuran, y nadie les dice nada."
  **Trigger:** 60 días o más de hueco.
  *LotR — el cónclave de árboles que se toma tres días para decir una frase, y tiene razón.*

- [ ] **78. `seat_kept`** · `0` · ~2%
  **Te Guardaron el Banco** — "Casi un año de silencio. El fuego seguía encendido y tu banquito seguía libre. Como si te hubieras ido a fumar."
  **Trigger:** 300 días o más de hueco.
  *LotR — la taberna del pueblo donde nada cambió nunca.*
  ⚠ **300, no 365** — ver el punto 5 del encabezado.

- [ ] **79. `cold_hearth`** · `C` · ~15%
  **El Caldero Estaba Frío** — "Mes y medio sin encender el fuego. Volviste, soplaste una vez y arrancó. Los calderos buenos no se ofenden."
  **Trigger:** `POMODORO_COMPLETED` tras 45 días sin ninguno.
  *LotR — reencender el hogar al volver del viaje. Regreso por módulo: podés haber usado todo lo demás.*

- [ ] **80. `hundred_days_gone`** · `C` · ~0,4%
  **Cien Días** — "Volviste a anotar un movimiento exactamente cien días después del último. Vos también llevabas las cuentas al día, una vez. El libro no preguntó nada."
  **Trigger:** movimiento de finanzas **exactamente** 100 días después del anterior.
  *La flecha en la rodilla en clave contable.*
  Decisión abierta: `=== 100` exacto (lo hace huevo) vs `>= 100 && <= 102` (~1,2%, más piadoso).

- [ ] **81. `the_answer`** · `0` · ~0,3%
  **Cuarenta y Dos** — "Cuarenta y dos días de silencio exactos. No preguntes cuál era la pregunta."
  **Trigger:** hueco de **exactamente** 42 días.
  *El número que se reconoce sin nombrarlo. La igualdad estricta ES el chiste: 41 no, 43 tampoco.*

- [ ] **82. `the_same_bell`** · `0` · ~7%
  **La Misma Campana** — "Volviste el mismo día de la semana en que te fuiste. El calendario no se movió de la silla."
  **Trigger:** hueco >= 7 días y múltiplo exacto de 7.
  *Discworld — los relojes de Ankh-Morpork, todos mal pero de acuerdo entre ellos.*

- [ ] **83. `back_through_the_forge`** · `0` · ~6%
  **Por la Puerta de la Fragua** — "Una semana afuera y lo primero que tocaste fue el fuego. Sabías por dónde se entra."
  **Trigger:** hueco >= 7 días y el evento de vuelta es del caldero.
  *Dark Souls — la hoguera es el punto de retorno. No cuánto faltaste: por dónde volviste.*

- [ ] **84. `like_nothing_happened`** · `C` · ~2%
  **Como Si Nada** — "Dos semanas sin aparecer y volviste con doscientos XP en un día. Nadie te va a preguntar nada. Se nota que preparaste la entrada."
  **Trigger:** día de vuelta tras 14+ días, con `xpToday >= 200`.
  *El que falta a seis sesiones y vuelve con la ficha rehecha y nueve páginas de trasfondo.*
  ⚠ **No usar `daysSinceLastActivity`** — es código muerto acá: ese campo solo lo ve el primer evento
  del regreso, y ahí el combo arranca en 1.0, así que `xpToday` no puede valer 200. Necesita
  `gapBeforeToday` (hueco a nivel DÍA).

- [ ] **85. `table_is_set`** · `0` · ~8%
  **La Mesa Servida** — "Volviste, y lo primero que hiciste fue sentarte a la mesa. Estaba puesta desde el principio."
  **Trigger:** hueco >= 7 días y el evento de vuelta es de Nutrify.
  *Sin chiste, a propósito.*
  ⚠ **Decisión tuya.** Un agente propuso este; otro cortó su propia versión con este argumento:
  *"a alguien que dejó de registrar comida le aparece de sorpresa un cartel que demuestra que la app
  le contó los días"*. La calidez del regreso a Nutrify quizá va en la pantalla, no en un medallón.

## Coincidencias de número — Coinify (86-93)

Ninguna depende de la conducta ni juzga un gasto. Solo del número. Casi todas piden `amount` en el
payload de los movimientos (una línea; los dos call sites ya tienen el monto en la mano).

- [ ] **86. `capicua`** · `P` · ~2%
  **Capicúa** — "El monto se lee igual de ida que de vuelta. No lo buscaste. Por eso cuenta."
  **Trigger:** monto capicúa de 4 dígitos o más.
  *Witcher — la superstición del jugador de dados de taberna.*

- [ ] **87. `perfect_figure`** · `P` · ~0,6%
  **La Cifra Perfecta** — "Cuatro dígitos, todos el mismo. Los alquimistas cobraban fortunas por números así y nunca los conseguían."
  **Trigger:** monto de 4+ dígitos idénticos. · *Sapkowski — la alquimia como estafa de feria.*

- [ ] **88. `the_mirror`** · `P+C` · ~4%
  **El Espejo** — "Dos movimientos distintos, el mismo monto exacto, el mismo día. El libro tartamudeó."
  **Trigger:** dos movimientos del día con monto idéntico. · *Coincidencia pura, cero moraleja.*

- [ ] **89. `lead_into_gold`** · `P+C` · ~1%
  **Plomo en Oro** — "Un gasto y un ingreso por el mismo monto exacto el mismo día. Toda la alquimia del mundo para terminar donde empezaste."
  **Trigger:** un gasto y un ingreso del mismo monto, el mismo día.
  *Sapkowski / GoT — la promesa alquímica que siempre termina en cero.*

- [ ] **90. `a_single_coin`** · `P` · ~1%
  **Una Sola Moneda** — "Anotaste un movimiento de exactamente una unidad. Alguien, en algún camino, le debe una canción a eso."
  **Trigger:** monto igual a 1. · *Witcher — la moneda que se le tira al brujo, sin la cita.*

- [ ] **91. `the_blessed_penny`** · `P` · ~0,2%
  **La Moneda Bendecida** — "El dado sacó un x3 sobre un movimiento de menos de diez. Dos por ciento de probabilidad, gastados en monedas."
  **Trigger:** `bonusMultiplier >= 3.0` sobre un monto < 10.
  *El azar del motor riéndose de sí mismo. Imposible de perseguir.*

- [ ] **92. `the_date_in_the_sum`** · `P` · ~0,8%
  **La Fecha en el Monto** — "El monto salió idéntico al día y al mes en que lo anotaste. Los cuervos también traen mensajes que nadie mandó."
  **Trigger:** monto redondeado === DDMM de la fecha.
  *GoT — los presagios que llegan por cuervo y no significan nada.*

- [ ] **93. `the_ledgers_name_day`** · `C` · ~1,5%
  **El Día del Nombre** — "Anotaste un movimiento el mismo día y mes que el primero de todos, un año o más después. El libro cumple años y nunca lo menciona."
  **Trigger:** mismo día y mes que el primer movimiento de finanzas, en un año posterior.
  *GoT — "name day" es el cumpleaños en Poniente, y término medieval real.*

## Coincidencias de número — el motor (94-95)

- [ ] **94. `the_number`** · `0` · ~1%
  **Justo Ese Número** — "El día pasó por seiscientos sesenta y seis de experiencia. Nadie lo buscaba y ahí está. No lo digas en voz alta."
  **Trigger:** `Math.floor(xpToday) === 666`.
  *Cultura de mesa — la superstición numérica tratada con la seriedad exacta que merece.*
  ⚠ El `Math.floor` es **obligatorio** — ver el punto 4 del encabezado.

- [ ] **95. `the_thousandth`** · `0` · ~1 de 50 que llegan a mil
  **El Milésimo** — "El hecho número mil de tu crónica sacó el dado del dos por ciento. Ni el novecientos noventa y nueve. El mil."
  **Trigger:** `totalEvents === 1000` con `bonusMultiplier >= 3.0`.
  *Speedrun / datamining — el frame exacto. Nadie puede apuntarle: el dado no se pide.*
  Nota: un merge de sync que inserte varias filas de golpe puede saltear el 1000. Que se pierda
  también es parte de ser un huevo.

## Coincidencias de calendario y reloj (96-108)

- [ ] **96. `day_that_isnt`** · `0` · 0% / ~35% en año bisiesto
  **El Día que No Existe** — "Encendiste el caldero un 29 de febrero. Ese día el calendario miente y todo lo que pasó, pasó todo junto. Volvé en cuatro años."
  **Trigger:** fecha `02-29`.
  *Daggerfall — la ruptura del tiempo donde todos los finales fueron ciertos a la vez.*
  Decisión abierta: restringir al caldero (más raro, guiño más nítido) o cualquier módulo.

- [ ] **97. `eleventy_one`** · `0` · ~2%
  **Las Once del Once** — "Once del once, a las once. El calendario y el reloj se pusieron de acuerdo una sola vez, y fue con vos."
  **Trigger:** `11-11` a las 11 en punto.
  *LotR — el cumpleaños de "ciento once", el número dicho raro a propósito.*

- [ ] **98. `three_sevens`** · `0` · ~0,5%
  **El Día se Repitió Tres Veces** — "El número del mes, el del día y el de la hora salieron iguales. Pasa una hora al año, y justo estabas despierto haciendo algo. Los que leen estrellas le pondrían nombre."
  **Trigger:** mes === día === hora.
  *TES — los signos natales y la astrología del calendario. Doce horas al año en todo el planeta.*

- [ ] **99. `palindrome_day`** · `0` · ~1 por década
  **El Día Capicúa** — "La fecha se lee igual de ida y de vuelta. La próxima tarda años en llegar. Estabas."
  **Trigger:** `YYYYMMDD` capicúa.
  *La próxima en formato ISO es 2030-03-02; después, 2040-04-02.*

- [ ] **100. `long_expected`** · `C` · ~10%
  **Hoy Cumplís Uno** — "Hace exactamente un año registraste tu primer hecho. En los libros esto se festeja con fuegos artificiales y un discurso que nadie termina de escuchar."
  **Trigger:** `daysSinceFirstEvent === 365`.
  *LotR — la fiesta del capítulo uno y el anfitrión que se va a mitad del brindis.*
  ⚠ **No sacarlo de `rpg_events`**: la poda al año se lleva justo la fila que se necesita. Tiene que
  salir de una fecha de alta que no se pode (`user_profile` o `player_stats`). Si no, el huevo se
  autodestruye el día exacto en que tiene que salir.

- [ ] **101. `still_standing`** · `0` · ~2%
  **Todavía de Pie** — "Primero de enero, antes de que salga el sol, y anotaste algo. Nadie pregunta si dormiste."
  **Trigger:** `01-01` antes de las 6.
  *Discworld — Hogswatch y sus madrugadas de dudosa procedencia. No juzga el motivo.*

- [ ] **102. `last_two_hours`** · `0` · ~2%
  **El Año se Va Agradecido** — "Faltaban menos de dos horas para que terminara el año y vos tachando cosas. Había tiempo hasta mañana. No lo usaste."
  **Trigger:** `TASK_COMPLETED` el `12-31` a las 22 o después.
  *Cultura de mesa — la última tirada de la sesión, cuando ya todos guardaron los dados.*

- [ ] **103. `omens_and_portents`** · `0` · ~6%
  **Presagios** — "Un movimiento anotado un viernes trece. No pasó nada. Igual quedó anotado."
  **Trigger:** movimiento de finanzas un viernes 13.
  *GoT — los agüeros que ocupan capítulos y terminan sin significar nada. El deadpan es el logro.*

- [ ] **104. `dice_did_notice`** · `0` · ~0,3%
  **Los Dados Sí se Enteraron** — "Sacaste un x3 un martes 13. Alguien mintió sobre la mala suerte, o te tocó el único dado honesto de la bolsa."
  **Trigger:** martes 13 con `bonusMultiplier >= 3.0`.
  *El martes 13 rioplatense cruzado con el dado maldito. Hermano raro de **#47**.*

- [ ] **105. `hour_of_the_wolf`** · `0` · ~2%
  **La Hora del Lobo** — "Un gasto anotado a las cuatro de la mañana. Ni el libro pregunta a esa hora."
  **Trigger:** `EXPENSE_LOGGED` a las 4.
  *ASOIAF + folklore. El remate es la garantía anti-moraleja: el chiste está en la hora, nunca en
  qué compraste.*

- [ ] **106. `four_in_the_morning`** · `0` · ~4%
  **Las Cuatro de la Mañana** — "Una poción terminada a las cuatro. A esa hora ya no hay decisiones, hay inercia. Que conste que quedó registrada."
  **Trigger:** `POMODORO_COMPLETED` a las 4.
  *LotR — la hora anterior al alba, dicha como parte meteorológico y no como consuelo épico.*

- [ ] **107. `night_watch`** · `0` · ~3%
  **La Guardia de la Noche** — "Un pomodoro entre las dos y las cinco de la mañana. La guardia no la pidió nadie, pero alguien la hace."
  **Trigger:** pomodoro entre las 2 y las 5. · *GoT — el turno que nadie quiere.*
  ⚠ Contiene a **#106**. Elegí uno de los dos, o dejá los dos sabiendo que co-disparan.

- [ ] **108. `blood_moon`** · `0` (helper puro, 6 líneas) · ~1%
  **Luna de Sangre** — "Luna llena, pasada la medianoche, y vos anotando. En ciertos reinos, a esta hora vuelve todo lo que diste por terminado."
  **Trigger:** hora >= 23 y luna llena.
  *Zelda — la luna que resucita lo derrotado, siempre a medianoche.*
  El helper es determinístico, sin DB ni reloj: edad lunar sinódica sobre `event.date`, época en la
  luna nueva del 2000-01-06. Deriva unas horas por década, irrelevante para un huevo.

## Los dados (109-112)

- [ ] **109. `tavern_tale`** · `0` · ~8%
  **El Golpe de Taberna** — "Doscientos XP de un solo hecho: combo al máximo, tirada de x3 y una misión épica, todo en el mismo instante. Vas a contar esto más veces de las que la gente quiere escucharlo."
  **Trigger:** `xpGained >= 200` con `bonusMultiplier >= 3.0`.
  *D&D — el crítico que el grupo sigue contando tres campañas después. El techo teórico exacto es
  40 × 2.0 × 3.0 = 240.* (fusiona `two_hundred_forty`)

- [ ] **110. `full_word`** · `0` · ~8%
  **La Palabra Entera** — "Una misión épica, el multiplicador al tope y un x3, todo en la misma tirada. Las tres sílabas salieron juntas. No suele pasar."
  **Trigger:** `TASK_COMPLETED` tier 3 + combo >= 2.0 + bonus >= 3.0.
  *TES — los Gritos se aprenden de a una palabra y recién sirven completos.*

- [ ] **111. `loaded_dice`** · `0` · ~1%
  **Los Dados Están Cargados** — "Cinco tiradas de x3 en un mismo día. Nadie te está acusando de nada. Nadie te va a pedir los dados prestados tampoco."
  **Trigger:** `epicsToday >= 5`.
  *Cultura de mesa. La segunda frase retracta y la tercera reinstala.*

- [ ] **112. `witching_hour`** · `0` · ~1 de 10.000 eventos
  **La Hora Bruja** — "El dado del dos por ciento, a las tres de la mañana. A esa hora los dados no le responden a nadie."
  **Trigger:** hora === 3 con `bonusMultiplier >= 3.0`.
  *Discworld — la hora en que las cosas se deciden solas.*

## El estado contradictorio (113-120)

- [ ] **113. `enemies_nearby`** · `0` · ~10%
  **Todavía Quedaba un Enemigo Cerca** — "Encendiste el caldero desde la Posada. Ibas a descansar. El cartel de siempre apareció igual."
  **Trigger:** `POMODORO_COMPLETED` con `innSince !== null`.
  *Morrowind / Oblivion — el cartel que te frena el descanso. "El cartel de siempre" es el guiño:
  quien lo jugó lo lee en tipografía de menú.*

- [ ] **114. `working_holiday`** · `0` · ~5%
  **Vacaciones de Trabajo** — "Los cuatro oficios en un mismo día. Técnicamente estabas descansando en la Posada. Técnicamente."
  **Trigger:** los 4 módulos el mismo día con `innSince !== null`.
  *Dos estados que se contradicen, ciertos a la vez. Imposible de perseguir: nadie se va a la Posada
  con el plan de laburar.* (fusiona `long_rest` de la ronda 2)

- [ ] **115. `shall_we_rest`** · `0` · ~8%
  **¿Descansamos?** — "Fuiste a la Posada antes de encadenar cuatro días. Todo grupo tiene uno que propone acampar, y el grupo siempre acepta."
  **Trigger:** `innSince !== null` con `bestStreak <= 3`.
  *D&D — el que pide descanso largo después del primer goblin. `bestStreak` no baja nunca: es una
  ventana de principiante que se cierra sola y no vuelve a abrirse jamás.*

- [ ] **116. `always_the_same_trick`** · `0` · ~6%
  **Siempre el Mismo Truco** — "Diez hechos en un día y todos del mismo tipo. Empezaste con mil formas posibles de jugar esto y terminaste con una. Como todo el mundo."
  **Trigger:** 10 hechos en el día, un solo tipo distinto.
  *Skyrim — todos juran que esta vez van a hacer otra build y todos terminan siendo arquero sigiloso.*

- [ ] **117. `no_name_on_the_door`** · `0` · ~6%
  **Sin Nombre en la Puerta** — "Nivel diez y tu personaje sigue llamándose como vino de fábrica. A esta altura ya no es un olvido: es un estilo."
  **Trigger:** `level >= 10` sin nombre de personaje.
  *El protagonista mudo de Souls, y el que le da Enter a la pantalla del nombre en TES.*
  ⚠ Borde declarado: es lo más cerca de "premiar no hacer algo". Lo salva que nadie planifica llegar
  a nivel 10 sin nombre, que el remate reencuadra la omisión como decisión, y que ponerle nombre
  después no lo revoca.

- [ ] **118. `takes_no_notes`** · `0` · ~12%
  **El Que No Toma Notas** — "Quinientos hechos en la crónica y tres sellos. Jugás como alguien que se acuerda de todo. Ojalá."
  **Trigger:** `totalEvents >= 500` con `sealsCount <= 3`.
  *Demostrablemente no punitivo: saltear el sello no cuesta nada por diseño, y este huevo
  literalmente **paga** 25 XP y 15 óbolos por haberlo salteado.*

- [ ] **119. `just_in_case`** · `C` · ~10%
  **Por Si Acaso** — "Quinientos óbolos y ni uno gastado. Los estás guardando para la pelea importante. Nadie llegó nunca al final del juego con los elixires usados."
  **Trigger:** saldo >= 500 óbolos con cero canjes.
  *El chiste universal de RPG. Y de paso es el empujón contra la métrica de fracaso declarada en
  `rpg-handlers`: "un saldo que nadie gasta en 30 días".*

- [ ] **120. `door_never_opened`** · `0` · ~5%
  **La Puerta que Nunca Abriste** — "Quinientos hechos en la crónica y este módulo lo estrenaste hoy. Estaba sin llave todo el tiempo."
  **Trigger:** primer evento de un módulo con `totalEvents >= 500`.
  *Planescape — lo que puede cambiar la naturaleza de una persona.*

## Coincidencias del juego (121-123)

- [ ] **121. `solvent_crown`** · `0` · ~1%
  **La Corona Solvente** — "Saldaste una deuda el mismo día que un mes cerró dentro del presupuesto. Reinos enteros se hundieron por no lograr las dos cosas juntas."
  **Trigger:** `LOAN_SETTLED` y `BUDGET_MONTH_MET` el mismo día.
  *GoT deep cut. Coincidencia genuina: `BUDGET_MONTH_MET` lo dispara la app sola al abrir el mes.*

- [ ] **122. `a_hundred_lines`** · `0` · ~0,3%
  **Cien Renglones Justos** — "El resumen que importaste traía exactamente cien renglones. Ni noventa y nueve ni ciento uno."
  **Trigger:** `STATEMENT_IMPORTED` con `payload.count === 100`.
  *El escriba al que se le da el número redondo una vez en la vida.*

- [ ] **123. `buzzer_pardon`** · `0` · ~4%
  **Sobre la Hora** — "Salvaste la racha faltando menos de una hora para que se cerrara el día. No había público. Hubo testigo."
  **Trigger:** `pardonUsed` con hora >= 23.
  *Cultura de mesa — la tirada salvadora en el último minuto, cuando ya nadie esperaba nada.*

## Papeles y tinta (124-128)

Los tres de Nutrify que sobrevivieron no hablan de comida: hablan del papel, de la tinta y de cerrar
libros.

- [ ] **124. `a_single_line`** · `0` · ~30%
  **Un Solo Renglón** — "Un hecho en todo el día, y lo sellaste igual. Hay sesiones enteras que se van en comprar cuerda, y esas también se anotan."
  **Trigger:** `DAY_SEALED` con `eventsCount === 1`.
  *El huevo tierno del lote: dice en voz alta lo mismo que el mood `gentle` de `codexPhrases.ts`.*

- [ ] **125. `session_notes`** · `0` · ~4%
  **Notas de la Sesión** — "Cuatro de la mañana, sellando el día de ayer. El máster también escribe el resumen cuando ya se durmieron todos."
  **Trigger:** `DAY_SEALED` retro antes de las 5.
  *Co-dispara con `late_memory` y `early_bird` la primera vez: tres desbloqueos de un saque.*

- [ ] **126. `three_keys`** · `0` · ~20%
  **Las Tres Llaves** — "El día cerrado, la semana sellada y el códice firmado, todo en la misma noche. Alguien acá disfruta ordenar."
  **Trigger:** `DAY_SEALED` con un `DAY_SUMMARY` y un `WEEK_SUMMARY` ese mismo día.
  *La contaduría de fin de sesión, mientras el resto ya se puso el abrigo.*
  Nota: verificado que `countByTypeToday` es RAW, así que ve `WEEK_SUMMARY` pese a ser
  NON_MEANINGFUL. El sello se exige como `event` y no como conteo para que el orden de inserción
  no importe.

- [ ] **127. `hole_in_the_sheet`** · `0` · ~8%
  **El Agujero en la Ficha** — "Abriste el día dos veces en la misma jornada. Esa parte de la hoja ya no tiene papel de tanto borrar."
  **Trigger:** 2 `DAY_REOPENED` el mismo día.
  *La ficha a lápiz gastada hasta el agujero. Habla de papel y de goma, nunca de lo que se anotó.
  Misma familia afectiva que `second_chance`: corregirse es gratis.*

- [ ] **128. `long_table`** · `C` · ~10%
  **La Mesa Larga** — "Los cuatro turnos de la mesa, anotados el mismo día. La página quedó sin un solo hueco."
  **Trigger:** los 4 slots de comida distintos registrados el mismo día.
  *TES — la mesa larga del salón de hidromiel.*
  Nota de copy: el sujeto de la frase es **la página**, no la persona. No hay cantidad, no hay
  dirección, no hay logro corporal. Si aun así te hace ruido, vetalo sin discusión.

---

## Podadas en la tercera pasada

Los agentes se auto-cortaron estas nueve al aplicar el criterio de huevo. El motivo vale más que
la idea.

| Idea | Por qué no, bajo el criterio de easter egg |
|---|---|
| `third_door` — 3 misiones épicas en un día | Misión difícil disfrazada. Se lee el título y se sale a buscarlo. |
| `eagles_come_late` — 4 módulos + algo pasadas las 23 | Es `perfect_day` con horario. Jornada heroica, perseguible. |
| `camp_night` — sello con 4 módulos + Vigor 90 + 15 hechos | Tres condiciones de esfuerzo apiladas. Checklist disfrazada de coincidencia. |
| `still_a_second` — 2 pociones antes de las 10 | Perseguible en cinco minutos y sin sorpresa. |
| `one_of_those_days` — 5 destildadas en un día | Se farmea en cuarenta segundos tildando y destildando. |
| `third_flask` — 2 pomodoros abandonados + 1 completado | El chiste era bueno, pero la condición es una receta: abandonar dos a propósito. |
| `adoring_fan` — 5 logros en un día | La gracia dependía de dos guards defensivos. Un huevo que necesita andamios no es un huevo. |
| `table_was_waiting` (versión visible) | Su única defensa era ser visible. Ver **#85**, que es la misma idea y sigue abierta. |
| `punctual_as_monday` — sellar el pergamino apenas cierra | `weeklyGateOpen` solo abre con pesaje ese día: el disparador selecciona por pesaje puntual aunque el copy nunca lo diga. |

## Descartadas de fondo

| Idea | Por qué no |
|---|---|
| "Una semana sin gastos" / "Ahorraste $X" / "Balance positivo" | Punitivo por abstinencia. Y castiga un mes legítimamente caro: una mudanza, un remedio. |
| "Ayuno del Peregrino" / "Racha de déficit" / "Bajaste X kg" | Riesgo de conducta alimentaria. En déficit `compliant` no tiene piso: 800 sobre 3000 cumple. |
| "Sellaste el día con el Vigor en cero" | Un mal día de comida convertido en punchline coleccionable, apareciendo sin que nadie lo pida. |
| "El Banquete Perfecto" (comiste el evento Y cerraste en objetivo) | Enseña compensación. "Podés ir al asado si después lo arreglás" es la frase que no queremos decir. |
| "Veinte misiones rápidas (tier 1)" | La forma óptima de conseguirlo es inventar micro-tareas falsas. Ensucia el dato del usuario. |
| "Terminá un pomodoro sin pausarlo" | La pausa es feature de primera clase (sobrevive a que Android mate el proceso). Castigarla traiciona el esfuerzo de ingeniería. |
| "A Veinticuatro del Veinticinco" (abandonar en el minuto 24) | Graciosísima y farmeable: esperás 24 minutos y cortás. Un premio no puede colgar de un evento que paga cero por diseño. |
| "Última cuota de un plan pagada" | La escribe la generación automática del mes. La máquina hizo el trabajo, nadie se presentó. |
| "El Máster Te Odia" (N tiradas de 1.0x) | El 1.0x es el 70% de la tabla: es el resultado NORMAL. Enmarcar la moda como desgracia enseña que los dados te castigan. |
| "Racha de sellos" en cualquier forma | Saltear el sello no cuesta nada por diseño. Una racha de sellos convierte el olvido en pérdida. |
| Escalera de regresos (7 / 30 / 90 días) | Un contador de recaídas. Un regreso, un ángulo distinto, nunca un ranking de ausencias. |
| `half_codex` / medidor de ocultos descubiertos | Convierte al último huevo en una casilla de checklist. Ver **#74**, que sigue abierta. |
| "Rueda de Quesos" (8 gastos en un día) | Incentiva partir una compra en ocho asientos. El chiste no vale corromper el libro mayor. |
| Citas literales (la flecha, el anillo, "un Lannister siempre paga") | Guiños, no copias. Todos los títulos de arriba funcionan sin conocer la obra. |

---

## Si se aprueba todo

El catálogo pasaría de 40 a 168 entradas y de 8 a ~70 ocultas. Habría que actualizar el bloque de
calibración de la cabecera de `shared/achievements.ts` y `shared/rpg-engine.test.ts`, y sumar una
línea por id en `ID_GROUPS` (`src/hub/codex/achievementCatalog.ts`) — el grupo es el estante
**destino**, no el escondite: mientras están bloqueados, los ocultos viven todos en `hidden`.

**Declaración visible que conviene que sea deliberada:** `ACHIEVEMENTS_TOTAL` alimenta el "n / TOTAL"
del estante. Con 54 huevos, el contador va a mostrar un piso de misterio que para la mayoría de la
gente **no baja nunca**. Es coherente con la decisión de tener easter eggs, pero es una decisión.

**Aviso de backfill:** las entradas que no dependen de `c.event` se desbloquean de golpe en el primer
arranque después del update, sin pagar XP ni óbolos (que es lo correcto). Las que dependen de
`c.event` solo pueden caer en vivo.
