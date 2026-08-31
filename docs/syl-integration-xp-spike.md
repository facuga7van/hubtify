# Design Spike: XP/RPG en las escrituras de Syl

> Estado: **spike (gate antes de Fase 2)** · 2026-07-09
> Complementa a [`syl-integration-roadmap.md`](./syl-integration-roadmap.md) §3 (el landmine).
> Resuelve: cómo se otorga XP cuando Syl marca/completa algo, sin doble-contar y sin duplicar lógica.

---

## 1. El problema (verificado en código)

Marcar un hábito / completar una quest dispara `processRpgEvent` (`electron/ipc/rpg-handlers.ts`). Ese cómputo:

1. **Es stateful** — el XP depende del estado vivo: `daily_combo`, `streak`, `hp` actuales (`rpg-handlers.ts:74-89`). `calculateXpGain(baseXp, comboMultiplier, bonusMultiplier, hp)`.
2. **Tiene aleatoriedad** — `rollRandomBonus()` (`:77`). No reproducible sin el mismo roll.
3. **Escribe transaccional** — inserta `rpg_events` Y actualiza `player_stats` (level/xp/hp/title/streak/combo) en la misma transacción (`:103-119`).

Además:
- **`player_stats` es la fuente de verdad del XP/nivel.** Viaja entre dispositivos como **scalar snapshot** (campo `playerStats` del doc main), restaurado por `syncRestoreStats` solo si el remoto es más nuevo (`sync.ts:137-140`, LWW por timestamp). NO se recomputa desde los eventos.
- **`mergeQuestData` NO re-emite RPG events.** Solo inserta filas. Un `habitCheck` que llega por sync entra **sin otorgar XP**.

### La restricción dura

**El XP tiene que computarse donde vive el estado (combo/streak/hp) + el random. Hoy eso es el desktop. Syl NO PUEDE computar XP** — no tiene el estado ni puede reproducir el roll. Cualquier diseño que ponga a Syl a calcular XP duplica lógica de negocio Y da números incorrectos. Descartado de entrada.

---

## 2. Opciones

### Opción A — El desktop reconcilia (grant on reconcile)
Syl escribe **solo el hecho crudo** (`habitCheck` con `origin: 'syl'`, sin `rpg_event`). El desktop, al reconciliar (pull en Fase 2, `onSnapshot` en Fase 3), detecta los checks de origen `syl` no procesados y llama `processRpgEvent` por cada uno, **exactamente una vez**.

- ✅ XP computado donde vive el estado (único lugar correcto). Cero duplicación. Respeta decisión #1 (no backend).
- ✅ La math ya es compartida (`shared/rpg-engine.ts`) — no hay que tocarla.
- ⚠️ XP **diferido**: Syl no puede decir "ganaste 15 XP" en el turno de voz (no conoce el roll). Solo confirma "listo, marqué el gym".
- ⚠️ Multi-device: necesita claim transaccional (abajo).

### Opción B — Cola de intents explícita
Syl escribe un `pendingRpgIntent`, el desktop lo consume y confirma. Es **A con una colección aparte** en vez de derivar el intent del flag `origin` del check. Más piezas, mismo XP-delay, beneficio marginal (audit más limpio). Converge con A.

### Opción C — Motor RPG server-side
Mover `processRpgEvent` + `player_stats` a una Cloud Function (o al daemon de Syl) siempre-encendido. **Contradice la decisión #1** y es una re-arquitectura grande: `player_stats` pasa a ser **server-authoritative**, el desktop deja de ser dueño del XP. Rechazado para Fase 2.

---

## 3. Recomendación: Opción A

### Exactly-once via claim transaccional
El riesgo es doble-contar XP si varios dispositivos reconcilian el mismo check de Syl. Solución:

1. Cada `habitCheck` de Syl vive en la subcollection con natural-key doc ID (`habitChecks/{habitId}_{date}`, Fase 2) + campos `origin: 'syl'`, `rpgClaimedAt: null`.
2. Cuando un desktop reconcilia, hace una **transacción Firestore** sobre el doc del check: si `rpgClaimedAt == null`, lo setea (claim) y procede; si ya está claimeado, lo saltea.
3. El device que claimeó: corre `processRpgEvent` **local**, actualiza su `player_stats`, y lo pushea como scalar.
4. Los demás devices reciben el `player_stats` actualizado por el sync scalar (LWW) — **NO re-otorgan**. El XP se propaga solo.

**Idempotencia en 2 niveles** (invariante del roadmap): (1) sobre el **dato** = natural-key doc ID; (2) sobre el **efecto** = flag `rpgClaimedAt`. Son distintos y ambos hacen falta.

### Trade-offs aceptados
- **XP diferido, sin feedback en voz.** Syl confirma la acción, no el número de XP. Aceptable para UX de voz.
- **Combo/streak se aplican al momento del reconcile, no de la marca.** Menor. Mismo día = OK. Para reconcile tardío (desktop abre al día siguiente), pasar la `date` del check a `processRpgEvent` en vez de usar `today`, para que el streak/combo se evalúen contra la fecha real del check. Es un ajuste chico en el handler.

---

## 4. Constraint duro: la app general es sagrada

**Hubtify es un producto con usuarios reales que NO tienen Syl.** El daemon vive en Syl (mora-server, single-user del dueño). Por lo tanto:

- **NADA de lo de Syl puede cambiar el funcionamiento de la app para usuarios sin Syl.** Descartado hacer `player_stats` server-authoritative "para todos" — eso re-plumbearía el core para servir a un asistente de una sola persona. Off the table.
- **Syl es una integración aditiva, de una sola cuenta.** Todo su efecto queda scopeado a la cuenta del dueño. Cero impacto en el resto.

### Escenario "capaz no abro el desktop"

Si el desktop capaz nunca se abre, el reconcile de la Opción A nunca corre → el XP queda congelado. Dos caminos, ambos respetando el constraint:

**Camino 1 — XP desktop-authoritative (cero cambio a la app).**
Syl escribe hechos, lee el snapshot. XP se acredita en batch cuando (si) se abre el desktop. Desktop-less → XP/nivel congelado, pero checks y **rachas de hábito siguen correctas** (derivadas de los checks vía `computeHabits`, no de `player_stats`). El habit-tracking por voz funciona entero; solo el número de XP/nivel queda quieto.

**Camino 2 — el daemon de Syl otorga XP a la cuenta del dueño (laburo del lado Syl).**
El daemon corre `shared/rpg-engine.ts` (la math ya es portable) y escribe `player_stats` en Firestore para esa cuenta. Clave: **el desktop ya hace pull-before-push con LWW en el focus** (`sync.ts:137`, `Layout.tsx:227-229`) → al abrir, **absorbe** el stats más nuevo del daemon antes de pushear. NO hay clobber; el desktop suma encima. Único hueco de race: el daemon escribe durante una sesión de desktop activa (raro por premisa); los **listeners de Fase 3** lo cierran del todo.

**El laburo pesado del Camino 2 es del lado del daemon (dominio de Syl), NO de Hubtify.** Hubtify solo garantiza que `player_stats` sea legible/escribible en Firestore con timestamp sano para el LWW — que ya lo es. Cambio en la app ≈ cero.

---

## 5. Plan resultante

**Fase 2 se parte en dos tracks desacoplados** (el dato y el XP son independientes):

- **Fase 2a — write de hechos.** Checks/tasks a subcollection con natural-key idempotente. App-safe, cero riesgo. Ships habit-tracking por voz con rachas correctas. NO toca `player_stats`. **Va sí o sí, sin bloqueos.**
- **Fase 2b — XP-desde-voz (Camino 2).** El motor se porta del lado de Syl (daemon corre `rpg-engine` contra `player_stats` en Firestore). Hubtify solo aporta/documenta el contrato de `player_stats`. Se hace con calma después. Fase 3 (listeners) cierra el race residual.

**Decisión tomada:** el dueño confirmó que capaz no abre el desktop → Camino 2 es el objetivo para el XP, pero **desacoplado** del write de hechos (2a) para no bloquear el valor shippeable. La app general no se toca en ningún caso.
