# Contrato de lectura: `syl/snapshot`

> Estado: **propuesta (Fase 0.1)** · Última edición: 2026-07-09 · `schemaVersion: 1`
> Complementa a [`syl-integration-roadmap.md`](./syl-integration-roadmap.md).
> Fuente de verdad del shape que Syl consume con `firebase-admin`.

---

## Ubicación

```
hubtify_users/{uid}/syl/snapshot     (documento único, sobrescrito en cada push)
```

Doc **dedicado y aislado**: no toca los docs de sync (`questify`, `nutrify`, `finance/data`). El desktop lo re-escribe entero en cada `syncPush`. Idempotente, sin estado incremental.

---

## Reglas globales (invariantes del contrato)

1. **Casing:** TODO camelCase. Sin excepciones. Syl nunca ve snake_case.
2. **Soft-deletes:** las filas con `deletedAt != null` **NO aparecen**. Ya vienen filtradas. Syl nunca filtra borrados.
3. **Derivaciones:** las computa Hubtify reusando sus handlers existentes (ver "Implementación"). Syl **no re-deriva reglas de negocio**.
4. **Staleness:** Syl DEBE comparar `computedForDate` con la fecha actual. Si difieren, el snapshot es de una sesión anterior → avisar al usuario ("según tu última sesión...").
5. **Versionado:** `schemaVersion` sube ante cualquier cambio breaking. Syl valida que entiende la versión antes de leer.
6. **Fechas:** todas las fechas de día son `YYYY-MM-DD` (local del desktop). Los timestamps son ISO-8601 UTC.

---

## Schema

```jsonc
{
  "schemaVersion": 1,
  "computedAt": "2026-07-09T14:30:00.000Z",   // ISO UTC, momento del push
  "computedForDate": "2026-07-09",            // día local usado para "hoy"
  "appVersion": "0.7.3",

  "player": {
    "level": 12,
    "xp": 340,
    "xpToNextLevel": 160,
    "hp": 85,
    "maxHp": 100,
    "title": "Aventurero",
    "streak": 7,
    "totalTasks": 214,
    "totalMeals": 530,
    "totalExpenses": 388
  },

  "questify": {
    "habits": [
      {
        "id": "uuid",
        "name": "Gym",
        "frequency": "weekly",              // 'daily' | 'weekly' | 'monthly'
        "timesPerWeek": 3,
        "checkedToday": false,
        "checksThisPeriod": 1,              // checks en el período actual (semana base-lunes / mes / día)
        "targetThisPeriod": 3,             // meta del período
        "streak": 4,
        "pendingToday": true               // derivado: checksThisPeriod < targetThisPeriod
      }
    ],
    "habitsPendingToday": [                 // conveniencia: subset donde pendingToday == true
      { "id": "uuid", "name": "Gym", "frequency": "weekly", "remaining": 2 }
    ],
    "tasksActive": [                        // status==false, no borradas
      {
        "id": "uuid",
        "name": "Terminar informe",
        "tier": 2,                          // 1=quick(5xp) 2=normal(15xp) 3=epic(40xp)
        "category": "Trabajo",
        "projectId": "uuid|null",
        "dueDate": "2026-07-10|null",
        "createdAt": "2026-07-01T...",
        "subtaskProgress": { "done": 2, "total": 5 },   // para queries de voz de progreso
        "subtasks": [                       // anidadas, no borradas; habilitan targeting en Fase 2 (write)
          { "id": "uuid", "name": "Revisar sección 3", "tier": 1, "status": false }
        ]
      }
    ],
    "questsOverdue": [                       // dueDate < hoy AND status==false
      { "id": "uuid", "name": "Pagar factura", "tier": 1, "dueDate": "2026-07-05", "daysOverdue": 4 }
    ],
    "counts": {
      "habitsTotal": 5,
      "habitsPending": 2,
      "tasksActive": 8,
      "tasksOverdue": 1
    }
  },

  "nutrify": {
    "todayCalories": 1420,                  // total_calories_in de dailySummary(hoy), o suma de foodLog(hoy)
    "todayTarget": 1800,                    // tdee - deficitTargetKcal
    "todayBalance": -380,                   // balance de dailySummary(hoy) (negativo = déficit)
    "recentFoodLog": [                      // últimas N entradas, normalizadas a camelCase
      { "date": "2026-07-09", "time": "13:00", "description": "Milanesa con puré", "calories": 530, "meal": "almuerzo" }
    ],
    "profileSummary": {
      "sex": "M",
      "activityLevel": "moderate",
      "deficitTargetKcal": 500
    }
  },

  "coinify": {
    "todaySpend":    { "ARS": 12500, "USD": 0 },     // type='expense', impactsBalance=1, date=hoy
    "monthSpend":    { "ARS": 210000, "USD": 45 },   // idem, mes actual
    "monthBalance":  { "ARS": 88000, "USD": 320 },   // income - expense del MES actual, impactsBalance=1 (== finance:getMonthlyBalance)
    "recentTransactions": [                          // últimas N, no borradas, normalizadas
      { "id": "uuid", "type": "expense", "amount": 12500, "currency": "ARS", "category": "Comida", "description": "Super", "date": "2026-07-09" }
    ]
  }
}
```

---

## Definición precisa de las derivaciones

| Campo | Regla | Fuente en código |
|---|---|---|
| `habits[].pendingToday` | `checksThisPeriod < targetThisPeriod` | reusa el handler que arma `HabitWithStreak` (`quests/types.ts:30`) |
| `habitsPendingToday[].remaining` | `targetThisPeriod - checksThisPeriod` | idem |
| `questsOverdue` | `dueDate != null AND dueDate < computedForDate AND status == false AND deletedAt == null` | `tasks.status` es boolean (`types.ts:53`) |
| `daysOverdue` | días entre `dueDate` y `computedForDate` | — |
| `coinify.todaySpend` | `SUM(amount) WHERE type='expense' AND impactsBalance=1 AND deletedAt IS NULL AND date=hoy`, por moneda | `syl.snapshot.ts` (buildCoinify) |
| `coinify.monthSpend` | idem `todaySpend` pero `date LIKE 'YYYY-MM%'` (mes actual), por moneda | `syl.snapshot.ts` (buildCoinify) |
| `coinify.monthBalance` | `SUM(income) - SUM(expense) WHERE impactsBalance=1 AND deletedAt IS NULL AND date LIKE 'YYYY-MM%'` (mes actual), por moneda | `computeMonthlyBalance()` (`finance.balance.ts`), mismo helper que `finance:getMonthlyBalance` |
| `nutrify.todayCalories` | `total_calories_in` de `nutrition_daily_summary` donde `date=hoy` | `sync.ipc.ts:473` |
| `nutrify.todayTarget` | `tdee - deficitTargetKcal` del profile/summary | `nutrition.ipc.ts` |

**Ojo con finance:** las compras con tarjeta de crédito tienen `impactsBalance=0` (no pegan al balance hasta que se paga el resumen). Por eso todas las sumas de gasto/balance filtran `impactsBalance=1`. Syl recibe el número ya correcto — no tiene que saber de esto.

---

## Implementación (Fase 0.2)

`buildSylSnapshot(db)` en el main process **orquesta handlers existentes, no reinventa lógica**:

1. `player` ← `getRpgStats()` (`rpg-handlers.ts`)
2. `questify.habits` ← handler que computa `HabitWithStreak` (ya tiene `checksThisPeriod`/`targetThisPeriod`/`checkedToday`)
3. `questify.tasksActive` / `questsOverdue` ← query sobre `tasks` con `status=0 AND deleted_at IS NULL`; subtasks vía `subtasks WHERE task_id IN (...) AND deleted_at IS NULL`, `subtaskProgress` = count(done)/count(total)
4. `nutrify` ← `nutrition_daily_summary` + profile del día `computedForDate`
5. `coinify` ← queries de gasto/balance existentes (`finance.ipc.ts`)

Regla de oro: **si una derivación no existe todavía como handler, se crea UNA vez en Hubtify y la usan tanto la UI como el snapshot.** Nunca se copia lógica al snapshot.

**Guard:** no escribir el snapshot si no hay datos (mismo criterio que el resto de `syncPush` — nunca pisar Firestore con vacío).

---

## Qué NO va en el snapshot (por ahora)

- `cauldron` (pomodoro) — Syl no lo opera en el scope inicial.
- `drawings`, `rpgEvents` — ruido para las queries de voz.
- Subtasks de tasks **completadas** — solo van las de tasks activas.
- Histórico largo — solo `recent*` acotado (N configurable, default 20). Si Syl necesita histórico, se agrega en una vista aparte, no acá.

Todo esto se puede sumar en `schemaVersion: 2` si aparece la necesidad real.
