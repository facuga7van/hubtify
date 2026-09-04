# Nutrify — Resumen semanal (Pergamino de la semana)

Fecha: 2026-09-04
Estado: diseño aprobado, pendiente de plan de implementación

## Problema

Nutrify registra comida día a día y paga XP al cerrar cada día, pero no existe
ningún momento en que el usuario vea **cómo le fue en la semana**. El Códice
(`/nutrition/dashboard`) muestra datos crudos —heatmap, tendencia de peso,
`MacroHistory`, racha, TDEE adaptativo— con rangos de 7/30/90/365 días. Son
gráficos, no un veredicto.

Lo que falta no son más gráficos. Falta una frase: *"cumpliste 5 de 7, promedio
1850 kcal contra un objetivo de 1900, bajaste 400 g, fuiste al gimnasio 3 veces"*.

## Solución

Un **ritual de cierre de semana**: un pergamino que aparece cuando la semana
termina, se lee, y se sella. Sellarlo paga un bonus de consistencia escalado por
cuántos días cumpliste. Una vez sellado queda archivado y es inmutable.

Espeja el ritual que el módulo ya tiene (`nutrition:closeDay` →
`nutrition_daily_closed`), a un nivel de agregación arriba.

### Alternativas descartadas

- **Panel rodante siempre visible en el Códice.** Barato (sin tabla, sin sync,
  sin migración) pero es más UI, no un momento. Descartado: se buscaba un evento
  con peso narrativo.
- **Derivar el informe al vuelo, persistir solo el sello.** Menos columnas, pero
  el veredicto de una semana vieja cambiaría al tocar el déficit hoy. Un resumen
  que muta no es un resumen.
- **Sello en `app_state` sin tabla nueva.** `app_state` está fuera de
  `USER_DATA_TABLES` porque guarda `last_uid`; las semanas no sincronizarían
  entre cuentas.
- **Denominador variable en la primera semana.** Un usuario que se da de alta un
  jueves y cierra jueves-domingo perfecto cobra `4/7`, no `4/4`. Se evaluó
  recortar el denominador con `MIN(date)` de `food_log` y se descartó: ver
  §Denominador.

## Alcance

Dentro:

- Cumplimiento (días en objetivo sobre 7) y promedio de kcal consumidas contra
  el objetivo
- Peso y tendencia de la semana
- Hábitos: días con pasos, días de gimnasio, racha al terminar la semana
- Bonus de XP escalado por consistencia

Fuera (decisión explícita, YAGNI):

- **Macros.** `nutrition_daily_summary` los guarda, pero no entran en esta
  versión.
- **`reopenWeek`.** No existe, a propósito. Ver §Inmutabilidad.
- **Modo Posada (`player_stats.inn_since`).** Ni el XP ni la etiqueta. La app no
  guarda registro de que la Posada estuvo activa, así que ni siquiera se puede
  marcar la semana. Ver §Posada.

## Frontera de la semana

**Lunes a domingo**, vía `getMondayOfWeek` (`shared/date-utils.ts:43`).

No es arbitrario: `nutrition_weekly_metrics` ya se keyea por lunes. La evidencia
fuerte es el **escritor** — `saveWeeklyMetrics` guarda en `getMondayOfWeek()`
(`nutrition.ipc.ts:792`) — y el lector lo acompaña: `shouldAskWeight` consulta
`getMondayOfWeek(today)` (`:1147`). Con cualquier otra frontera, el pesaje de "tu
semana" caería en una semana distinta a la del resumen.

### Trampa: reloj nutricional, no reloj de pared

Toda frontera se calcula sobre `nutritionToday(db)`, nunca sobre `new Date()`
— **salvo el pesaje, que es una excepción deliberada; ver la subsección
siguiente**.
Con `day_cutoff_hour = 4`, el lunes a la 01:00 el día nutricional todavía es
domingo; usar el reloj de pared adelantaría la semana un día. Esta clase de bug
ya apareció tres veces en el repo.

### El pesaje es la excepción, y es correcta

`nutrition:saveWeeklyMetrics` (`nutrition.ipc.ts:792`) hace
`metrics.date ?? getMondayOfWeek()` — sin argumento, o sea **reloj de pared** — y
su único llamador (`Today.tsx:1014`) no pasa fecha. Esto **no** se toca.

La regla del reloj nutricional existe porque una comida a la 01:00 pertenece a la
jornada alimentaria de ayer: seguís comiendo del mismo día. **Un pesaje no es un
evento de consumo.** Tu peso corporal a la 01:00 del lunes es el peso del lunes,
no el del domingo. Aplicarle el corte de las 4 AM sería un error de categoría.

Y no es solo conceptual — el escritor actual produce el resultado correcto para
esta feature. Lunes 01:00 con `day_cutoff_hour = 4`, semana V:

| Escritor | Clave que asigna | Qué significa para V |
| --- | --- | --- |
| Reloj de pared (actual) | `vStart+7` | `weight_end(V)` — **correcto** |
| Lunes nutricional | `vStart` | pisa `weight_start(V)` vía `INSERT OR REPLACE` |

`saveWeeklyMetrics` hace `INSERT OR REPLACE` sobre `date` (`nutrition.ipc.ts:793`),
así que la clave decide **qué fila se sobreescribe**. Keyear por el lunes
nutricional haría que el pesaje que el usuario entiende como "así terminé la
semana" reemplace al del lunes anterior: `weight_start` con el valor equivocado,
`weight_end` ausente, y un delta de cero o basura.

En resumen: el lector usa el reloj nutricional para todo lo que sea comida y
cierre; el peso entra por el reloj de pared, a propósito, y las ventanas
`[vStart, vStart+6]` / `[vStart+7, vStart+13]` lo recogen bien.

**Asimetría preexistente, fuera de alcance — pero conviene nombrarla bien.**
`shouldAskWeight` consulta el lunes NUTRICIONAL (`nutrition.ipc.ts:1147`) mientras
el escritor guarda en el de pared. El lunes `vStart+7` a la 01:00, para un usuario
que no se pesó en toda la semana V: `shouldAskWeight` calcula
`getMondayOfWeek(vStart+6) = vStart`, no encuentra nada y **pregunta**. El usuario
responde, y el escritor archiva la respuesta bajo `vStart+7`. O sea: pregunta por
la semana V y guarda en la V+1. `weight_start(V)` queda NULL para siempre y el
pergamino dice "sin pesaje" aunque el usuario hizo exactamente lo que se le pidió.

Es angosto (ventana de 4 horas, usuario que se salteó la semana entera) y es
anterior a esta feature, así que no se arregla acá. Pero es un camino vivo a un
extremo NULL, y por eso queda escrito y no como nota al pie.

### Nota defensiva sobre `getMondayOfWeek`

`getMondayOfWeek` ancla en `T00:00:00` (`date-utils.ts:44`), a diferencia del
resto de los helpers de fecha del repo (`nextDateString`, `daysAgoFrom`,
`shiftDay`), que anclan en `T12:00:00` explícitamente "so DST can never shift it".
Como esta función pasa a ser la PRIMARY KEY de una tabla nueva, un cambio de
horario a medianoche podría correr una frontera de semana. El plan debe usar un
helper anclado al mediodía para derivar el lunes, o justificar por escrito por
qué no hace falta.

## Cuándo hay pergamino pendiente

`nutrition:getPendingWeeks`, calcado de `nutrition:getPendingDays`
(`nutrition.ipc.ts:1242`). Una semana está pendiente cuando se cumplen las cinco:

1. Ya terminó: `weekStart < getMondayOfWeek(nutritionToday(db))`
2. Tiene ≥ 1 día cerrado vivo en `nutrition_daily_closed` (`deleted_at IS NULL`)
3. No existe fila en `nutrition_weekly_closed` para ese `week_start`
4. `weekStart >= shiftDateString(getMondayOfWeek(nutritionToday(db)), -28)`,
   inclusivo — cubre las 4 semanas terminadas anteriores a la actual
5. **Hay con qué medir el peso, o ya se esperó suficiente**: existe un pesaje en
   `[weekStart+7, weekStart+13]`, **o** `nutritionToday(db) >= weekStart+14`

La condición 4 evita que volver de dos meses de vacaciones deposite doce
pergaminos encima del usuario.

### Por qué la condición 5

`weight_end` sale del pesaje de la semana **siguiente**: es el que mide cómo
terminó la semana que se está sellando. Pero la condición 1 vuelve pendiente a la
semana el lunes a la mañana, cuando ese pesaje todavía no existe. Sin la
condición 5, el usuario abre el pergamino el lunes temprano, lo sella, y
`weight_end` queda NULL **para siempre** (§Inmutabilidad). Justo el dato que
motivó la feature —*"bajaste 400 g"*— sería el que casi nunca aparece.

El pergamino porta hasta que haya con qué llenarlo. El escape evita que un
usuario que dejó de pesarse quede con pergaminos trabados para siempre: pasado
ese punto se sella igual, sin peso.

**El escape es `weekStart+14`, y el número no es negociable.** `weight_check_day`
es configurable de 1 a 7 (lo clampea `nutrition:saveProfile`, lo expone
`NutritionSettings`) y `shouldAskWeight` solo pregunta cuando `dow >= checkDay`. El usuario puede entonces RESPONDER en cualquier día
entre `weekStart+7` (lunes) y `weekStart+13` (domingo), según su configuración.
Un escape más corto dispara antes que la respuesta para todo usuario con
`weight_check_day >= 4`:

| `weight_check_day` | Usuario responde en | Escape a `+10` |
| --- | --- | --- |
| 1 (lunes, default) | `weekStart+7` | llega tarde, bien |
| 2-3 | `+8`, `+9` | llega tarde, bien |
| 4 (jueves) | `+10` | **empate el mismo día** |
| 5-7 | `+11` … `+13` | **el escape gana** |

La fila en sí, sin embargo, no queda fechada el día que el usuario responde:
`saveWeeklyMetrics` nunca recibe `date` desde `Today.tsx`, así que usa
`getMondayOfWeek()`, que lee el reloj de pared y redondea para atrás — la fila
SIEMPRE cae en `weekStart+7`, nunca en `+8`..`+13`. Eso no cambia la conclusión:
el escape tiene que sobrevivir a la última RESPUESTA posible (`+13`), porque es
la respuesta —no la fecha de la fila— la que determina cuándo `weight_end` deja
de estar vacío. Para más de la mitad de las configuraciones posibles un escape
más corto no haría su trabajo: retendría el pergamino tres días y después lo
soltaría con `weight_end` en NULL igual. `weekStart+14` cubre el peor caso
(`+13`) por construcción, sin leer la configuración y sin carreras.

**El gate reduce el caso NULL, no lo elimina.** La condición 5 prueba que existe
el pesaje de la semana SIGUIENTE (`weight_end`). No dice nada de `weight_start`:
si el usuario no se pesó durante la semana V, ese dato no existe y el delta es
imposible igual.

Y no se puede extender el gate para exigir los dos. `weight_start` es un pesaje
del pasado: si no se tomó en su momento, **no va a aparecer nunca**. Un gate que
lo espere no espera nada — trabaría el pergamino hasta el escape de 14 días,
siempre, para después sellarlo igual de vacío. Sería el bug de la ronda anterior
otra vez, con otra columna.

Entonces: la condición 5 garantiza el extremo que todavía puede llegar, y acepta
que el otro ya se perdió.

## Esquema — migración `nutrition` v19

La última migración del namespace es la v18 (`nutrition.schema.ts:531`).

```sql
CREATE TABLE IF NOT EXISTS nutrition_weekly_closed (
  week_start      TEXT PRIMARY KEY,   -- lunes YYYY-MM-DD (reloj nutricional)
  days_closed     INTEGER NOT NULL DEFAULT 0,
  days_compliant  INTEGER NOT NULL DEFAULT 0,
  avg_consumed    INTEGER NOT NULL DEFAULT 0,
  avg_target      INTEGER NOT NULL DEFAULT 0,
  weight_start    REAL,               -- NULL = no hubo pesaje
  weight_end      REAL,
  days_steps      INTEGER NOT NULL DEFAULT 0,
  days_gym        INTEGER NOT NULL DEFAULT 0,
  streak_end      INTEGER NOT NULL DEFAULT 0,
  xp_total        INTEGER NOT NULL DEFAULT 0,
  closed_at       TEXT,
  updated_at      TEXT
);
```

### Sin `deleted_at`, a propósito

`nutrition_daily_closed` tiene esa columna porque `reopenDay` la escribe
(`nutrition.ipc.ts:1104`, vía `reopenDayRecord`; el `UPDATE … SET deleted_at`
está en `:1337`). Acá **no hay ningún productor**:

- No existe `reopenWeek` (§Inmutabilidad)
- El cambio de cuenta no deja lápidas: `clearUserDataInto` hace
  `DELETE FROM ${table}` duro (`sync.ipc.ts:1384`)
- El merge de sync solo **copia** un `deleted_at` entrante; no lo origina

Declarar la columna sería documentar un estado que ningún camino del código puede
producir. Si algún día se agrega `reopenWeek`, la migración que lo haga agrega la
columna.

`xp_total` guarda el XP **base declarado**, no lo que el motor terminó pagando.
La contabilidad real vive en `rpg_events`; ver §El toast no puede mentir.

## Cómo se calcula el veredicto

### Cumplimiento

Para cada fila viva de `nutrition_daily_closed` en `[lunes, domingo]`:

```
scoreNutritionDay(row.consumed, row.target, deficitActual).compliant
```

`consumed` y `target` ya vienen congelados en la fila del cierre diario. El único
input vivo es `deficitTargetKcal` del perfil, que solo elige la banda (déficit /
superávit / mantenimiento, ver `shared/meal-utils.ts:137`). Ese input deja de
importar apenas se sella: el resultado queda escrito.

**Sin perfil no hay veredicto.** `scoreNutritionDay` interpreta un
`deficitTargetKcal` ausente como `0` → banda de mantenimiento, re-puntuando en
silencio la semana de alguien que está en déficit. Por eso ambos handlers cortan
antes, igual que `closeDay` (`nutrition.ipc.ts:1008`).

**Nota de precisión.** `closeDay` guarda `Math.round(target)`
(`nutrition.ipc.ts:1064`) pero puntúa con el valor sin redondear. Re-puntuar desde
la fila puede voltear el resultado justo en el borde de la banda. La diferencia
máxima es de 1 kcal sobre el objetivo; se acepta, cubierto por el test 12.

### Peso

- `weight_start` = primer pesaje en `[lunes, domingo]` de esa semana
- `weight_end` = primer pesaje en `[lunes+7, domingo+7]`

La condición 5 de §Cuándo hay pergamino pendiente garantiza que, en el camino
normal, `weight_end` existe antes de que el sello se ofrezca. Si el usuario dejó
de pesarse y entra por el escape de 14 días —o si nunca registró el pesaje de
apertura, que ya no puede aparecer— la columna queda NULL y el pergamino dice
"sin pesaje". No se inventa un delta a partir de un solo punto.

### Hábitos

- `days_steps` = días con `steps > 0` en `nutrition_daily_metrics`
- `days_gym` = días con `gym = 1`
- `streak_end` = `computeNutritionStreak(rows, <domingo de esa semana>, deficit).streak`

`streak_end` se calcula **a la fecha del domingo de esa semana**, no al momento de
sellar. Sellar puede pasar hasta 4 semanas después; si se calculara al sellar,
cuatro pergaminos atrasados sellados en la misma sesión registrarían todos el
mismo número, que no describe ninguna de las cuatro semanas.

### Dos definiciones de "cumplir" conviven, a propósito

`days_compliant` y `streak_end` no miden lo mismo y **el pergamino no debe
presentarlos como si lo hicieran**:

| Campo | Fuente | Regla |
| --- | --- | --- |
| `days_compliant` | `nutrition_daily_closed` (congelado) | `scoreNutritionDay`, sin indulto |
| `streak_end` | `nutrition_daily_summary` (vivo) | `computeNutritionStreak`, **con un día de gracia por semana** más el indulto de días con evento |

Una semana puede legítimamente leer "3 de 7 en objetivo" al lado de "racha: 41
días". No es una contradicción: la racha mide *presentarse* y perdona un día por
semana (`meal-utils.ts:319-322, 359-367`); el cumplimiento mide *precisión* y no
perdona nada. La UI los etiqueta distinto y explica la diferencia en un
`HelpBubble`.

## Denominador

**Siempre 7. Sin excepciones.**

Se evaluó recortarlo en la primera semana del usuario —alta un jueves, cierra
jueves a domingo perfecto, cobra `4/4` en vez de `4/7`— derivándolo de
`MIN(date)` de `food_log`. Se descartó, y vale escribir por qué:

- **Es gameable.** `nutrition:deleteFood` (`nutrition.ipc.ts:431`) y
  `nutrition:deleteByDate` (`:697`) hacen soft-delete y están cableados a la UI.
  Borrar las comidas más viejas corre `MIN(date)` hacia adelante. Semana uno con
  lunes-miércoles arruinados: se reabren, se les borra la comida, `firstLog` pasa
  al jueves, y `4/4` paga 50 en vez de los 23 honestos. Es exactamente el
  cherry-picking que el denominador fijo existe para matar, reentrando por otra
  puerta.
- **Rompe sin adversario.** Cualquiera que borre historia vieja (empezar de cero,
  limpiar entradas basura) corre `firstLog` hacia una semana pendiente cualquiera
  y se lleva un denominador que no describe nada.
- **Abre un techo falso.** Alta un domingo, cierra ese domingo cumpliendo:
  `1/1` → 40 + 10 = **50 XP, el techo semanal entero, por un buen día**. Habría
  que agregarle un piso al denominador, y un `Math.min` al ratio para el caso en
  que sync traiga cierres anteriores al `firstLog` local.

Cinco problemas —el exploit, la ficción del borrado masivo, el piso, el clamp y
una columna `days_counted` extra— por una injusticia leve que ocurre una vez en
la vida del usuario. No vale.

Con denominador fijo en 7 el clamp tampoco hace falta: `week_start` acota el rango
a siete fechas y `nutrition_daily_closed` tiene `date` como PRIMARY KEY, así que
`days_compliant <= 7` por construcción.

**Efecto colateral bueno:** `deleteFood` y `deleteByDate` lanzan
`'Cannot modify a closed day'` cuando `isDayClosed` (`nutrition.ipc.ts:428`,
`:699`). Los días ya contados como cumplidos no se pueden vaciar. Eso refuerza
§Inmutabilidad por debajo, sin código nuevo.

## Posada

El modo Posada es la primitiva que la app ya tiene para "estoy de viaje": mientras
`player_stats.inn_since` está activo, el XP fluye pero la racha se congela, y
`processRpgEvent` lo respeta en cada escritura de racha (`rpg-handlers.ts:496,
581, 598`).

Una semana **entera** en la Posada desaparece sola: sin ningún cierre diario no
cumple la condición 2 y nunca se ofrece como pendiente. Nada que hacer, y es el
comportamiento correcto.

El caso que sí importa es la semana **parcial**: te fuiste el miércoles, cerraste
lunes y martes, y el pergamino archiva "2 de 7". El resumen semanal sería el
primer mecanismo de la app que puntúa una ausencia autorizada como fracaso —
exactamente lo contrario de lo que la Posada existe para hacer.

### Y no se puede arreglar hoy, ni siquiera etiquetando

Se intentó agregar una columna `inn_week` para al menos **marcar** la semana sin
tocar el XP. No es implementable con los datos que la app guarda:

- `player_stats.inn_since` es una sola columna nullable con la fecha de entrada
  (`shared-logic/db/migrate.ts:206`)
- Salir de la Posada la **borra**: `UPDATE player_stats SET inn_since = NULL`
  (`rpg-handlers.ts:331, :334`). No queda rastro
- `rpg:setInnMode` (`rpg-handlers.ts:1907`) no escribe ninguna fila en
  `rpg_events`; `Layout.tsx:395` solo emite un `CustomEvent` del navegador
- No existe tabla de períodos ni tipo de evento `INN_*`. El único otro consumidor,
  el logro `deserved_rest` (`shared/achievements.ts:227`), pregunta
  `innSince !== null` — o sea, si estás descansando **ahora**

El único predicado calculable es "la Posada está activa en este instante". Pero la
condición 5 retiene el pergamino entre 7 y 14 días, y la ventana de 4 semanas
permite sellar hasta un mes después: para cuando el sello se ofrece, el usuario ya
volvió y `inn_since` es NULL. La columna diría `0` exactamente en el caso que
existía para marcar.

**Queda como limitación conocida y documentada.** Registrar los períodos de Posada
—una tabla de intervalos, o una bandera capturada en `closeDay`, que sí corre
mientras el viaje está vivo— es la precondición de cualquier arreglo, y es scope
nuevo sobre una tabla existente. Va junto con el ajuste de XP en la feature
aparte.

## Inmutabilidad

Todo se congela al sellar. Cambiar el objetivo en noviembre no altera lo que dice
la semana de septiembre. Reabrir un día de una semana ya sellada **no** recalcula
el pergamino — eso no es un bug, es la definición del artefacto.

Por eso no existe `reopenWeek`: reabrirlo abriría exactamente la puerta que el
guard del motor cierra.

## XP

### Calibración

Un día perfecto paga `30 (precisión) + 15 (bonus) + 5 (pasos) + 5 (gym) +
5 (peso) = 60 XP` base (`nutrition.ipc.ts:1046-1049`), y encima corre el
multiplicador de combo. Una semana perfecta de cierres diarios ronda los
**420 XP base**, bastante más una vez aplicados combo (hasta 2.0×) y bonus
aleatorio.

`BUDGET_MONTH_MET` declara 100 de base (`rpg-handlers.ts:153`). **No es plano**:
no está en `FLAT_XP_EVENTS` (`rpg-handlers.ts:105`) ni en
`NON_MEANINGFUL_EVENT_TYPES` (`shared/rpg-engine.ts:107-117`), así que monta
combo y bonus aleatorio y además avanza racha y combo. Sirve como precedente del
**guard por balde**, no de la planitud.

Los precedentes de planitud son `DAY_SEALED` y `ACHIEVEMENT_UNLOCKED`, que sí
están en ambas listas. `WEEK_SUMMARY` se modela sobre esos dos.

Techo del bonus semanal: **50 XP planos** — 12 % del base semanal, y menos en la
práctica, porque los cierres diarios multiplican y este no.

### Fórmula

```
xpTotal = round(40 * daysCompliant / 7) + (daysCompliant === 7 ? 10 : 0)
```

| Cumplidos | XP |
| --------- | -- |
| 7/7       | 50 |
| 5/7       | 29 |
| 4/7       | 23 |
| 1/7       | 6  |
| 0/7       | 0  |

**El denominador es 7, no `days_closed`.** Si se dividiera por los días cerrados,
cerrar únicamente los tres días que salieron bien daría ratio 1.0 y el máximo:
cherry-picking. Con el denominador fijado por el calendario, no cerrar un día
simplemente cuesta, y no queda nada que optimizar.

### Evento `WEEK_SUMMARY`

Módulo `nutrition`. **Dos** registros en `shared-logic/modules/rpg-handlers.ts`:

```ts
REF_PAYLOAD_KEY_BY_TYPE.WEEK_SUMMARY = 'weekStart'   // línea 160
FLAT_XP_EVENTS.add('WEEK_SUMMARY')                   // línea 105
```

Y **uno** en `shared/rpg-engine.ts`:

```ts
NON_MEANINGFUL_EVENT_TYPES += 'WEEK_SUMMARY'         // línea 107
```

`REF_FIELD_BY_TYPE` **no** se toca. Su único consumidor es la rama de undo
(`rpg-handlers.ts:434`, `REF_FIELD_BY_TYPE[originalType]` donde `originalType`
sale de `undoMap`). Como no hay `reopenWeek` ni evento de undo, `WEEK_SUMMARY`
nunca puede ser un `originalType`: la entrada sería código muerto.

**Plano, sin dados.** Mismo razonamiento ya documentado para `DAY_SEALED` y
`ACHIEVEMENT_UNLOCKED` (`rpg-handlers.ts:97-105`): el premio es derivado de días
que ya cobraron su combo. Dejarlo montar el multiplicador otra vez sería
multiplicar un agregado de valores ya multiplicados.

**No significativo.** Entrar en `NON_MEANINGFUL_EVENT_TYPES` no es cosmético.
`isMeaningfulEvent` (`rpg-engine.ts:142`) alimenta `eventsToday`, `modulesToday`,
`typesToday`, `xpToday` y el total de por vida en `buildAchievementContext`. Sin
esa entrada, sellar 4 semanas atrasadas de un saque inyecta 4 eventos
"significativos" de Nutrify en un mismo día — entrada directa a los logros
`polymath`, `perfect_day`, `sunday_guardian` y a la escalera del Cronista. Es
farmeo, y por el mismo motivo escrito en el comentario de `FLAT_STREAK_EVENTS`:
un premio derivado no puede alimentar al matcher que lo generó.

**HP: 0.** Los cierres diarios ya movieron el vigor siete veces; cobrarlo de nuevo
en el agregado es doble contabilidad.

### Quién emite el evento

El renderer, después de que `closeWeek` devuelve — el mismo reparto que usa el
cierre diario en `src/hub/codex/nutritionClose.ts:86-91`:

```ts
const res = await window.api.nutritionCloseWeek(weekStart);
if (!res.success) return null;
const { report } = res;

const rpg = await window.api.processRpgEvent({
  type: 'WEEK_SUMMARY',
  moduleId: 'nutrition',
  payload: { xp: report.xpTotal, hp: 0, weekStart: report.weekStart },
  timestamp: Date.now(),
});
```

**`weekStart` sale de `report.weekStart`, nunca de un `getMondayOfWeek()` local.**
El renderer corre con el reloj de pared: derivarlo ahí produciría, el lunes a la
01:00, un lunes distinto al `week_start` de la fila recién sellada. Eso es peor
que pagar 0 — escribe el pago en el **balde equivocado** y rompe la unicidad por
semana en las dos direcciones.

**`payload.xp` es obligatorio.** No hay entrada de `WEEK_SUMMARY` en
`DEFAULT_EVENT_XP`, y `resolveBaseXp` cae en `DEFAULT_EVENT_XP[type] ?? 0`
(`rpg-handlers.ts:199`): omitirlo paga 0 en silencio. Cubierto por el test 13.

### El toast no puede mentir

El toast muestra `rpg.xpGained` — lo que el motor **pagó** — nunca
`report.xpTotal`, que es lo que el sello **declaró**.

No es una preferencia estilística. `closeNutritionDay` devuelve `b.xpTotal`
(`nutritionClose.ts:83, 92`), la base declarada, y copiar ese patrón acá rompe en
tres caminos vivos:

- `payload.xp` ausente → el motor paga 0 (test 13) y `report.xpTotal` dice 50
- `weekStart` ausente → sin `refId` no se paga (test 14), mismo desfase
- Multi-dispositivo: el otro equipo ya selló esa semana y el `ref_id` mergeó, así
  que el guard local paga 0 sobre un `report.xpTotal` de 50

En los tres casos el usuario vería "+50 XP" por un pago que no ocurrió.

### Guard en el motor

Modelado sobre `BUDGET_MONTH_MET` (`rpg-handlers.ts:371-379`), con una diferencia
deliberada:

```ts
if (event.type === 'WEEK_SUMMARY') {
  if (!refId) {
    // Sin balde no hay forma de verificar unicidad: no se paga.
    baseXp = 0;
  } else {
    const alreadyPaid = db.prepare(
      "SELECT 1 FROM rpg_events WHERE event_type = 'WEEK_SUMMARY' AND ref_id = ? LIMIT 1"
    ).get(refId);
    if (alreadyPaid) baseXp = 0;
  }
}
```

**Ubicación**: bloque propio entre la extracción de `refId`
(`rpg-handlers.ts:366`) y `const isFlat` (`:381`). **No** anidado dentro del
bloque de `BUDGET_MONTH_MET`.

**No se replica el fallback de `BUDGET_MONTH_MET`** (`refId = monthKey(today)`,
línea 369), por dos razones:

1. El motor solo conoce `getLocalDateString()` — el reloj de PARED. Derivar el
   lunes ahí violaría §Trampa, y meter `nutritionToday(db)` dentro de
   `rpg-handlers.ts` sería invertir capas.
2. Cualquier fallback razonable (`getMondayOfWeek(shift(today, -7))`) apunta
   siempre a la semana **pasada**. Con la ventana de 4 semanas, sellar cuatro
   pergaminos atrasados sin `weekStart` los colapsaría en un solo balde: el guard
   convertiría tres pagos legítimos en 0. No sería una protección, sería un bug
   de subpago.

Negarse a pagar sin balde cierra el ataque por omisión sin inventar un balde
equivocado. El emisor siempre tiene el `weekStart`: se lo devuelve `closeWeek`.

### Superficie de exploit

| Ataque | Qué lo mata |
| --- | --- |
| Sellar la misma semana dos veces | Guard por `ref_id` en el motor |
| Reabrir día → re-cerrar → re-sellar | Condición 3 (ya hay fila) más el guard |
| Cerrar solo los días buenos | Denominador fijo en 7 |
| Borrar comidas viejas para achicar el denominador | El denominador no depende de `food_log` |
| Semana sin ningún cierre | No califica como pendiente (condición 2) |
| `payload.weekStart` omitido | Sin `refId` no se paga |
| `payload.xp` inflado | `clampNumber(..., MAX_EVENT_XP)` en `resolveBaseXp` |
| Sellar 4 semanas atrasadas para inflar logros diarios | `NON_MEANINGFUL_EVENT_TYPES` |

**Limitación conocida (multi-dispositivo).** El guard de `ref_id` es local. Dos
dispositivos offline que sellen la misma semana pagan cada uno localmente; recién
converge cuando `rpg_events` mergea. Es la misma limitación que ya tiene
`closeDay`, así que se acepta — pero queda escrito, no se presenta la tabla de
arriba como absoluta.

## Superficie IPC

Cuatro handlers en `shared-logic/modules/nutrition.ipc.ts`. Los tipos van en
`shared/types.ts`; los canales, en `shared/api-channels.ts`.
`electron/preload.ts` se regenera y no se edita a mano.

```ts
/** Veredicto de una semana. Idéntico esté sellado o en vista previa. */
export interface WeekReport {
  weekStart: string;        // lunes YYYY-MM-DD
  weekEnd: string;          // domingo YYYY-MM-DD
  daysClosed: number;
  daysCompliant: number;    // sobre 7
  avgConsumed: number;
  avgTarget: number;
  weightStart: number | null;
  weightEnd: number | null;
  daysSteps: number;
  daysGym: number;
  streakEnd: number;
  xpTotal: number;          // lo que pagaría (preview) o declaró (sellado)
  sealed: boolean;
  closedAt: string | null;
}

export type CloseWeekResult =
  | { success: true; report: WeekReport }
  | { success: false; alreadyClosed: true }
  | { success: false; error: 'No profile' | 'No closed days'
                           | 'Week not finished' | 'Waiting for weigh-in' };
```

| Canal | Parámetros | Devuelve |
| --- | --- | --- |
| `nutrition:getPendingWeeks` | — | `string[]` de lunes sin sellar, ascendente |
| `nutrition:getWeekReport` | `weekStart: string` | `WeekReport \| null` |
| `nutrition:closeWeek` | `weekStart: string` | `CloseWeekResult` |
| `nutrition:getClosedWeeks` | `limit?: number` | `WeekReport[]`, descendente |

Casos de error, explícitos:

- Sin perfil → `{ success: false, error: 'No profile' }` (espeja `closeDay:1008`)
- Sin ningún cierre diario vivo → `error: 'No closed days'`
- La semana todavía no terminó → `error: 'Week not finished'`
- **Gate de peso sin cumplir → `error: 'Waiting for weigh-in'`**
- Ya sellada → `{ success: false, alreadyClosed: true }`
- `getWeekReport` sobre una semana sin datos o sin perfil → `null`

**`closeWeek` revalida la condición 5, no confía en `getPendingWeeks`.** El gate
de peso es la única regla de este diseño que vivía sólo en el listado de
pendientes: `nutrition:closeWeek` es un canal público, y un bug de UI, la vista
de archivo o cualquier otro llamador podía sellar una semana bloqueada y congelar
`weight_end = NULL` para siempre. Es el mismo principio que ya rige el guard del
motor —*el emisor garantiza unicidad; esto es el motor negándose a confiar en
él*—, aplicado acá.

## Sync

**No hay interfaz de nutrición que editar.** A diferencia de quests
(`SyncQuestData`, `sync.ipc.ts:198`), `sync:getAllNutritionData` devuelve un
literal sin tipo (`sync.ipc.ts:1162`) y `sync:mergeNutritionData` recibe
`Record<string, unknown>` (`:1166`). Los pasos reales son tres:

1. `nutrition_weekly_closed` entra en `USER_DATA_TABLES` (`sync.ipc.ts:224`)
2. `weeklyClosed` se agrega al literal que devuelve `sync:getAllNutritionData`
   (`:1162`), junto a `dailyClosed`
3. `weeklyClosed` se mergea en `mergeNutritionDataInto` (`:1412+`) con el trío
   `getWC/insertWC/updateWC`, calcado de `getDC/insertDC/updateDC`
   (`sync.ipc.ts:1521-1523`), menos la parte de `deleted_at`

Last-write-wins por `updated_at`, keyeado por `week_start`, igual que
`nutrition_daily_closed` lo hace por `date`.

### El payload de sync es snake_case crudo, no `WeekReport`

`WeekReport` es la forma que ve el **renderer**. La carga de sync es otra cosa: el
literal de `sync:getAllNutritionData` se arma con filas de `SELECT *`
(`sync.ipc.ts:1152, :1162`), así que viaja en snake_case. El merge de su gemela lo
refleja — `isUsableRow(raw, 'dailyClosed', ['date'])` y `getDC.get(c.date)`
(`sync.ipc.ts:1525-1527`).

Para la tabla semanal eso significa `['week_start']` en `isUsableRow` y
`getWC.get(c.week_start)`. Si alguien toma `WeekReport` como referencia y escribe
`c.weekStart`, el lookup devuelve `undefined` para **todas** las filas: el merge
no falla, no avisa, y simplemente no hace nada. Es el peor modo de falla posible
en sync, y por eso queda escrito acá.

## UI

`WeeklyScroll.tsx` en `src/modules/nutrition/components/`, montado arriba de los
gráficos en el Códice (`/nutrition/dashboard`, `App.tsx:176`).

- **Pendiente**: pergamino lacrado → click → despliega el veredicto y el XP que
  paga → botón *Sellar la semana*
- **Sellado**: lista de semanas archivadas, click para releer
- **Semana de 0 XP**: se sella igual y el pergamino lo dice sin castigar. La
  semana entra al archivo porque el archivo tiene que estar completo.
- `days_compliant` y `streak_end` van etiquetados distinto, con un `HelpBubble`
  que explica el día de gracia (ver §Dos definiciones de "cumplir")
- El toast del sellado usa `xpGained` del motor (ver §El toast no puede mentir)
- Prefijo `.nutri-scroll-*` en `src/modules/nutrition/styles/nutri.css`
- Aviso en `Today.tsx` reusando `.nutri-pending-banner` (`Today.tsx:1270`), que
  linkea al Códice
- Iconos SVG inline de `src/shared/components/icons/`. `Scroll` ya existe
  (`NutritionCharts.tsx:14`). Sin emojis.
- **`useConfirm()` antes de sellar**: no es destructivo, pero es irreversible
- **Listener de `account:switched`**: obligatorio, el componente carga datos del
  backend

## i18n

Tres lugares, en `src/i18n/es.json` y `src/i18n/en.json`, alfabéticos dentro de su
sección y siempre con fallback:

1. Claves `nutrify.weekly*` — `t('nutrify.weeklySeal', 'Sellar la semana')`
2. `events.WEEK_SUMMARY` en el bloque `"events"` (`es.json:950-955`). Sin esto la
   línea de tiempo del Códice muestra el string crudo `WEEK_SUMMARY`
3. Entrada `WEEK_SUMMARY` en el mapa de iconos de `src/hub/CharacterPage.tsx:64`
   (`DAY_SUMMARY: Scale` es el vecino). Sin esto el evento aparece sin icono

## Tests

En `tests/`, espejando la estructura de origen.

1. `closeWeek` sella y devuelve el `WeekReport` correcto
2. Re-sellar devuelve `alreadyClosed` y no escribe una fila nueva
3. Denominador: 4 días cerrados y compliant paga 23, no 50
4. `getPendingWeeks` excluye selladas, incluye las de ≥ 1 cierre vivo
5. La ventana de 4 semanas corta en el borde exacto (`-28` días, inclusivo)
6. Peso NULL cuando falta el pesaje: no inventa delta
7. **Guard del motor**: un segundo `WEEK_SUMMARY` con el mismo `ref_id` paga 0
8. La semana en curso nunca aparece pendiente
9. Reabrir un día de una semana sellada no altera el sello
10. **Frontera con `day_cutoff_hour = 4` a la 01:00 del lunes**: la semana en
    curso sigue siendo la anterior
11. Sin perfil: `closeWeek` → `error: 'No profile'`; `getWeekReport` → `null`
12. Borde de redondeo: un día cuyo `consumed` iguala `Math.round(target)` puntúa
    igual que en `closeDay`
13. `WEEK_SUMMARY` sin `payload.xp` paga 0 (protege el contrato del emisor)
14. `WEEK_SUMMARY` sin `weekStart` en el payload paga 0 (no hay fallback)
15. `WEEK_SUMMARY` no cuenta como evento significativo: sellar 4 semanas
    atrasadas no mueve `eventsToday` ni el contexto de logros
16. `streak_end` se calcula al domingo de esa semana: dos semanas selladas en la
    misma sesión registran valores distintos
17. **Condición 5, default**: una semana terminada sin pesaje de la semana
    siguiente NO aparece pendiente antes de `weekStart+14`, y SÍ aparece después
18. **Condición 5, `weight_check_day = 7`**: el pesaje cae en `weekStart+13` y el
    pergamino lo espera — el escape no dispara antes
19. **`closeWeek` revalida el gate**: llamarlo directo sobre una semana bloqueada
    devuelve `error: 'Waiting for weigh-in'`, no sella
20. Borrar comidas viejas no cambia el XP de ninguna semana (el denominador no
    depende de `food_log`)
21. **Guarda del escritor**: `saveWeeklyMetrics` sin `date`, invocado a las 01:00
    de un lunes, keyea la fila en **ese** lunes y no en el anterior. Es la
    propiedad de la que depende `weight_end` (§El pesaje es la excepción), y
    describe el comportamiento actual — pasa antes de que la feature aterrice

Los casos 7, 10, 14, 15, 17, 18 y 19 son los que sostienen el diseño; el resto es
higiene.

Guardas de comportamiento existente, que deben pasar **antes** de que la feature
aterrice: 10, 12 y 21.

### Dónde corre cada test

Todos van al project `unit` de `vitest.config.ts` (`name: 'unit'`,
`environment: 'node'` en la línea 29, `include` en la 30 — que abarca
`src/**`, `shared/**` y `tests/**/*.test.ts`), contra SQLite en memoria y con los
handlers registrados vía `getHandler(channel)`.

**Ninguno monta un componente.** El project `browser` solo levanta
`tests/visual/**/*.test.tsx` (`vitest.config.ts:45`), y arrancar un Chromium
entero para verificar comportamiento de handlers sería desproporcionado. Todo lo
que este diseño agrega vive en `shared-logic/`, que es justamente donde se puede
testear sin DOM.

El test 21 necesita `vi.setSystemTime`: `saveWeeklyMetrics` no recibe reloj
inyectable, llama a `getMondayOfWeek()` que lee `new Date()` directo.
