# Spec: Fase 2a — Write de hechos (habitChecks a subcollection)

> Estado: **spec (pre-código)** · 2026-07-09
> Complementa a [`syl-integration-roadmap.md`](./syl-integration-roadmap.md) §Fase 2 y al [spike XP](./syl-integration-xp-spike.md).
> Scope: migrar `habitChecks` de array-en-doc a subcollection con natural-key doc ID, en AMBOS lados del sync. Tasks = §7 (diferido).

---

## 1. Objetivo y scope

Que un segundo escritor (Syl) pueda marcar/desmarcar hábitos **sin races ni datos perdidos**. Requisito del roadmap: idempotencia por construcción.

- **En scope (2a.1):** `habitChecks` → subcollection `hubtify_users/{uid}/habitChecks/{habitId}_{date}`. Es la acción estrella por voz ("marcá el gym").
- **Diferido (2a.2, §7):** crear task + subtasks, completar task. Más pesado (entidades completas, no toggle). Sketch al final.
- **NO toca `player_stats`** — el XP es track aparte (2b, spike). App-safe.

---

## 2. Estado actual (verificado)

- **Almacenamiento:** `questify.habitChecks[]` como array dentro del doc main `hubtify_users/{uid}`.
- **Push** (`src/shared/sync-merge.ts`): mergea colecciones por **surrogate `id`**, LWW por `updatedAt ?? createdAt`, local gana en empate.
- **Pull** (`electron/modules/sync.ipc.ts:152` `mergeHabitChecks`): UPSERT por **natural key** `(habit_id, date)`, `WHERE excluded.updated_at > habit_checks.updated_at`.
- **⚠️ Asimetría:** push por surrogate id, pull por natural key. El mismo check lógico con distinto id sobrevive doble en el array del push hasta que un pull lo colapsa. La migración **unifica todo en natural key**.
- **Semántica de `checkHabit`** (`quests.ipc.ts:383`): toggle. check → INSERT (o un-delete); uncheck → `deleted_at` set (soft-delete, no borra la fila). Natural key `(habit_id, date)` estable; surrogate `id` random por INSERT. UNIQUE(habit_id, date) en el schema.

---

## 3. Modelo target

### Subcollection
```
hubtify_users/{uid}/habitChecks/{habitId}_{date}      // doc ID determinístico
```

### Shape del doc
```jsonc
{
  "habitId": "uuid",
  "date": "2026-07-09",          // YYYY-MM-DD
  "checked": true,               // false = desmarcado (equivale a deleted_at set)
  "createdAt": "2026-07-09T...",
  "updatedAt": "2026-07-09T...", // gobierna LWW
  "origin": "desktop" | "syl",   // quién lo escribió (para 2b + anti-echo Fase 3)
  "rpgClaimedAt": null            // 2b: claim transaccional del XP. null = XP no otorgado aún
}
```

### Por qué esto mata la race
Doc ID **determinístico** (`{habitId}_{date}`) = dos escritores (Syl + desktop) escriben el MISMO doc, no dos entradas de array. `setDoc` sobre ese ID es UPSERT idempotente. Reintento de Syl → mismo doc. Y como el estado es un **toggle**, LWW por `updatedAt` es la semántica correcta (la última acción del usuario gana). Nada de merge manual de arrays.

`checked` reemplaza al `deleted_at`: `checked:false` ≡ soft-deleted. En SQLite se sigue guardando como `deleted_at` (no cambia el schema local); el mapeo es en la capa de sync.

---

## 4. Cambios necesarios (LOS DOS LADOS)

Este es el scope real que se under-scopeó antes: no alcanza con "agregar la subcollection para Syl". El desktop también migra.

### 4.1 Push (`src/shared/sync.ts` + `sync-merge.ts`)
**Estrategia: ADDITIVE-FIRST (rollout low-risk).** El primer release NO saca `habitChecks` del array — dual-write:
- **Sigue escribiendo el array `questify.habitChecks`** exactamente como hoy (path legacy autoritativo, red de seguridad).
- **ADEMÁS** escribe cada check como doc de subcollection: `setDoc(doc(db,'hubtify_users',uid,'habitChecks',`${habitId}_${date}`), {...}, {merge:true})` con guard LWW. `origin: 'desktop'`. Usar `writeBatch`.
- Si el path de subcollection falla, el array legacy sigue cargando el dato → cero pérdida. **Sacar `habitChecks` del array = release POSTERIOR**, una vez probada la subcollection.

### 4.2 Pull (`src/shared/sync.ts` + `sync.ipc.ts`)
- Leer la subcollection `habitChecks` (no `questify.habitChecks`).
- Mapear `checked` → `deleted_at` y pasar a `mergeHabitChecks` (que YA hace UPSERT por natural key — sirve tal cual, es la pieza que ya estaba bien).

### 4.3 Snapshot Syl (Fase 0)
- **Sin cambios.** `buildSylSnapshot` deriva de SQLite local, no de Firestore. Sigue igual.

---

## 5. Migración y período de transición (lo delicado)

Cuentas existentes tienen `questify.habitChecks[]` en el doc main. Y puede haber **múltiples devices con versiones mezcladas** (uno actualizado escribe subcollection, otro viejo sigue escribiendo el array).

### 5.1 Migración one-time (idempotente)
Al primer arranque de la versión nueva, tras el primer pull: leer `questify.habitChecks[]` legacy → escribir los docs de subcollection (`writeBatch`) → marcar la cuenta como migrada (flag `sylMigrations.habitChecks: true` en el doc main). Corre una vez; idempotente (doc IDs determinísticos, re-correr no duplica).

### 5.2 Dual-read durante la transición
Mientras haya devices viejos, el pull del device nuevo lee **subcollection + array legacy** y mergea ambos a SQLite (natural key colapsa duplicados). El push del device nuevo escribe subcollection Y — durante una ventana de gracia — sigue reflejando en el array legacy, para que devices viejos no pierdan los checks nuevos.

### 5.3 Corte
**Decisión tomada:** dual-write controlado por una constante `HABITCHECKS_DUALWRITE_LEGACY = true`. El primer release (2a.1) sale con additive-first: array legacy sigue siendo autoritativo, subcollection es aditiva. Un release posterior (cuando telemetría/versiones muestren que todos los clientes activos escriben subcollection) flipea la constante a `false` y ahí sí se corta el array legacy. No se bloquea 2a.1 esperando definir el corte exacto — se defiere con un flag barato de flipear.

---

## 6. Concurrencia y campos para 2b

- **LWW por `updatedAt`** en el doc del check = correcto para un toggle. Escritores condicionan write a "mi updatedAt es más nuevo" (transacción firebase-admin del lado Syl; el desktop puede usar batch con lectura previa o aceptar LWW simple).
- **`origin`** habilita el anti-echo de Fase 3 (el device ignora sus propios ecos) y saber qué checks otorgan XP vía daemon (2b).
- **`rpgClaimedAt`** es el claim del XP (spike §3). En 2a se escribe siempre `null`; lo consume 2b. Se incluye ya para no re-migrar el shape después.

---

## 7. Tasks (2a.2 — diferido, sketch)

Más pesado que habitChecks porque no es toggle sino entidades:
- **Completar task:** `status` (boolean) + `completedAt`. Natural key = el `id` (UUID) de la task, que ya es estable → subcollection `questTasks/{taskId}` o mantener en array con merge por id (ya funciona por id en el push). Menos urgente migrar.
- **Crear task + subtasks:** Syl genera los UUID → doc IDs determinísticos → idempotente. Pero arrastra: categorías/proyectos referenciados, orden, y el XP de completar (2b).
- **Recomendación:** 2a.1 (habitChecks) primero y solo. Tasks se especifica aparte cuando habitChecks esté probado en uso real.

---

## 8. Plan de implementación (2a.1)

- [ ] 8.1 — Definir shape + doc ID helper `habitCheckDocId(habitId, date)`.
- [ ] 8.2 — Push: sacar `habitChecks` del array, escribir subcollection con `writeBatch` + LWW guard.
- [ ] 8.3 — Pull: leer subcollection, mapear `checked`→`deleted_at`, reusar `mergeHabitChecks`.
- [ ] 8.4 — Migración one-time + flag `sylMigrations.habitChecks`.
- [ ] 8.5 — Dual-read/dual-write de transición + gate por versión.
- [ ] 8.6 — Tests: idempotencia (doble write = un doc), toggle LWW, migración one-time, dual-read colapsa duplicados, uncheck (checked:false) propaga.

## 9. Beneficio colateral

Sacar `habitChecks` del doc main **alivia el límite de 1MB de Firestore**. Los checks crecen sin techo (uno por hábito por día); hoy inflan el doc main. Moverlos a subcollection es sano independientemente de Syl — future-proofing del sync.
