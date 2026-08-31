# Roadmap: Integración Hubtify ↔ Syl

> Estado: **propuesta** · Última edición: 2026-07-09
> Objetivo: que Syl (asistente de voz, daemon Python en mora-server) pueda **leer y operar** Hubtify (questify, nutrify, coinify) por voz, sin romper el sync existente ni perder datos.

---

## 0. Decisiones de arquitectura (candadas)

Estas ya están decididas y no se re-discuten sin motivo fuerte:

1. **No hay backend nuevo.** Cero Cloud Functions para questify/nutrify/finance. La única función existente es `estimateNutrition` (Gemini). Syl lee/escribe Firestore **directo con `firebase-admin`** desde el daemon.
2. **Auth = service account.** El JSON de credenciales vive server-side en el daemon de Syl. `firebase-admin` **bypassa las security rules** de Firestore por diseño — no hacen falta tokens scoped ni API keys. Único requisito: el JSON no va al repo, va a secret/env del daemon.
3. **Partir por riesgo, no por completitud.** Read-only primero (riesgo cero), write después (migración quirúrgica), listeners al final.
4. **La lógica de negocio vive en UN solo lugar: Hubtify.** Syl queda tonto. Nunca duplicamos reglas de derivación (ej: "hábito pendiente hoy") en Syl — driftearían y romperían la confianza.
5. **Cero tolerancia a races de escritura.** En una app de hábitos, perder un "marqué el gym" silenciosamente mata el producto. No es una opción aceptable en ninguna fase.

---

## 1. El modelo de datos hoy (verificado en código)

- **Dueño del dato:** el SQLite local del desktop (better-sqlite3). Firestore es un **espejo**, fresco solo cuando el desktop empuja.
- **El sync lo hace el cliente** (renderer, Firebase JS SDK). No hay backend involucrado.
- **Triggers de sync** (`Layout.tsx`, `useAuth.ts`):
  - `syncPush`: debounced 30s post-cambio · al `blur` · al `focus` · login/logout/switch de cuenta.
  - `syncPull`: al `focus` · login/switch/cuenta-nueva · manual en Settings.
  - **NO hay `onSnapshot`. NO hay pull periódico.** Todo event-driven.

### Forma actual en Firestore

| Ubicación | Contenido | Casing |
|---|---|---|
| `hubtify_users/{uid}` (doc main) | `playerStats`, `characterName`, `username`, `characterData`, `questify{}`, `nutrify{}`, `notifications[]` | mixto |
| `questify` (campo) | tasks[], subtasks[], projects[], categories[], habits[], habitChecks[], drawings[], rpgEvents[] | camelCase |
| `nutrify` (campo) | profile, foodLog[], frequentFoods[], dailyMetrics[], weeklyMetrics[], dailySummary[], dailyClosed[], favoriteFoods[] | snake_case (favoriteFoods=camelCase) |
| `hubtify_users/{uid}/finance/data` (subcol) | transactions[], loans[], loanPayments[], recurring[], recurringHistory[], installmentGroups[], categoryMappings[], categories[], creditCards[], creditCardStatements[] | camelCase |
| `hubtify_users/{uid}/cauldron/data` (subcol) | cauldron_presets[], cauldron_sessions[] | snake_case |

### Las 4 trampas del modelo actual

1. **Casing inconsistente** — camelCase (questify, finance) vs snake_case (nutrify, cauldron), con excepciones.
2. **Lo que Syl necesita son derivaciones, no campos** — "pendiente hoy", "vencida", "gasto de hoy", "calorías de hoy" son cálculos, no columnas.
3. **Soft-deletes por todos lados** — `deletedAt != null` = borrado. NO se puede filtrar en el push del doc main (el `deletedAt` es load-bearing para el multi-device sync del propio desktop).
4. **Staleness** — Firestore = último push del desktop. Inherente al modelo espejo.

---

## 2. Fases

### Fase 0 — Proyección de lectura para Syl (Hubtify)

**Objetivo:** Syl lee TODO, limpio, pre-derivado, sin drift, sin tocar el sync existente.

**Entregable:** un doc dedicado que el desktop escribe en cada push, separado de los docs de sync:

```
hubtify_users/{uid}/syl/snapshot
```

Contenido:
- **Casing normalizado** → todo camelCase. Mata trampa #1.
- **Ya filtrado** → cero rows con `deletedAt`. Mata trampa #3 sin tocar los docs de sync (esos conservan `deletedAt` para el multi-device).
- **Derivaciones pre-computadas** por el mismo Hubtify que ya tiene la lógica → mata trampa #2:
  - `habitsPendingToday[]` (aplica la regla weekly/timesPerWeek/base-lunes de `HabitTracker.tsx`)
  - `questsOverdue[]` (`dueDate < hoy AND status != done AND deletedAt == null`)
  - `todaySpend` (por moneda: ARS/USD, respetando `impactsBalance`)
  - `todayCalories` (de `dailySummary` o suma de `foodLog`)
  - listas raw-limpias (habits, tasks activas, últimas transactions) para flexibilidad de Syl
- **Metadata anti-staleness:** `computedAt`, `computedForDate`, `appVersion`, `schemaVersion`. Syl detecta si el snapshot es de hoy o quedó viejo (trampa #4).

**Propiedades clave:**
- **Aditivo y aislado** — doc nuevo, no toca la lógica de merge existente. Riesgo bajo.
- **Idempotente** — se re-escribe entero en cada push, sin estado incremental.

**Tareas:**
- [ ] 0.1 — Definir el schema exacto del snapshot (tipos, campos, `schemaVersion: 1`).
- [ ] 0.2 — Módulo `buildSylSnapshot(db)` en el main process que computa las derivaciones desde SQLite (reusa la lógica existente de habits/finance/nutrition).
- [ ] 0.3 — Hook en `syncPush` que escribe el snapshot tras el push principal (guard: no escribir si no hay datos, igual que el resto).
- [ ] 0.4 — Tests Vitest (in-memory sqlite): `pendingToday` weekly/daily/monthly, `overdue`, `spend` multi-moneda, `calories`, filtrado de `deletedAt`.
- [ ] 0.5 — Doc de contrato `docs/syl-integration-contract.md` (shape del snapshot, campo por campo).

**Ships:** Syl te lee los pendientes de los 3 módulos. Valor real, riesgo cero.

---

### Fase 1 — Read-tools de Syl (lado Syl, fuera de este repo)

**Objetivo:** los MCP tools de Syl consumen el snapshot.

Fuera del scope de Hubtify, pero parte del roadmap:
- [ ] 1.1 — Tool `hubtify_read` que lee `syl/snapshot` con `firebase-admin`.
- [ ] 1.2 — Queries: "¿qué hábitos me faltan hoy?", "¿cuántas quests vencidas?", "¿cuánto gasté hoy?", "¿cuántas calorías llevo?".
- [ ] 1.3 — Manejo de staleness: si `computedForDate != hoy`, avisar "según tu última sesión de Hubtify...".

---

### Fase 2 — Escritura idempotente (migración quirúrgica, Hubtify)

**Objetivo:** Syl marca/completa sin races ni datos perdidos.

**El problema:** hoy `habitChecks` y `tasks` viven como arrays en el doc main. `setDoc(merge:true)` reemplaza el array entero → dos escritores (Syl + desktop) casi juntos → last-writer-gana-todo-el-array → updates perdidos.

**La solución:** array → subcollection con **natural-key doc ID determinístico**:

```
hubtify_users/{uid}/habitChecks/{habitId}_{date}
hubtify_users/{uid}/questTasks/{taskId}     (solo el slice que Syl escribe)
```

`setDoc` sobre un ID determinístico = **UPSERT idempotente por construcción**. Dos escritores, mismo ID → un doc. La race se muere sola, sin merge manual.

**⚠️ El scope real (esto lo under-scopeó la primera versión):** no alcanza con "agregar una subcollection para Syl". Si Syl escribe en la subcollection pero el desktop sigue pusheando `questify.habitChecks[]` en el doc main, tenés **dos escritores en dos lugares distintos que nunca reconcilian**. Hay que migrar el slice **de ambos lados**:
- `getAllQuestData` / `mergeQuestData` / `syncPush` / `syncPull` del desktop → apuntar a la subcollection para habitChecks (y el status de tasks).
- Migración one-time de cuentas existentes: al primer arranque de la versión nueva, leer el array → escribir los docs de subcollection.

**Tareas:**
- [ ] 2.1 — Diseñar el natural-key para tasks (¿qué campos escribe Syl? probablemente solo `status`/`completedAt`, no la task entera).
- [ ] 2.2 — Migrar `habitChecks` a subcollection en getAll/merge/push/pull del desktop.
- [ ] 2.3 — Migración one-time array → subcollection para cuentas existentes (idempotente, corre una vez).
- [ ] 2.4 — Idempotency/write-origin: cada write lleva `writerId` (`syl` | `desktop:{deviceId}`) y `writeId`, para auditar y para el anti-echo de Fase 3.
- [ ] 2.5 — Tests: doble write = un efecto, simulación de race, migración.

---

### Fase 3 — Freshness bidireccional (listeners)

**Objetivo:** el desktop VE lo que Syl marca en vivo, y viceversa.

Hoy el desktop puleá al `focus`. O sea, marcás por voz → volvés a la ventana → lo ves. Ese caso **ya funciona gratis**. El gap que cierra esta fase: ventana abierta Y enfocada, sin tocarla, y Syl marca algo.

**⚠️ Infra net-new:** el desktop hoy no tiene NI UN listener de Firestore. Agregarlo trae su propio quilombo.

**Tareas:**
- [ ] 3.1 — `onSnapshot` en el desktop sobre las subcollections escribibles → merge a SQLite en cada snapshot.
- [ ] 3.2 — **Anti-echo:** el push del propio desktop dispara su propio snapshot → NO debe loopear (push → snapshot → merge → push → ∞). Filtrar por `writerId` propio, ignorar los ecos.
- [ ] 3.3 — Lifecycle: subscribe en login, teardown en `account:switched`/logout (el evento ya existe).
- [ ] 3.4 — Lado Syl: `onSnapshot` o webhook (fase 2 opcional del pedido original) para que Syl se entere de marcas manuales del usuario sin polling.
- [ ] 3.5 — Tests de listener + anti-echo.

---

### Fase 4 — Endurecimiento

- [ ] 4.1 — Resolver del todo el **problema del XP** (ver landmine abajo).
- [ ] 4.2 — Edge cases de conflicto, comportamiento offline, multi-cuenta.
- [ ] 4.3 — Observabilidad: log de writes de Syl, version stamps, auditoría.

---

## 3. 🔥 El landmine que nadie mencionó: el XP/RPG event

**Este es el más peligroso y hay que diseñarlo aparte.**

En el desktop, marcar un hábito o completar una quest **dispara un RPG event** (`processRpgEvent`): da XP, cambia HP, aplica combo multiplier. Es el corazón de la gamificación — el punto entero de Hubtify.

**El problema:** si Syl escribe el `habitCheck` directo a Firestore:
- Nadie procesa el RPG event → **no se otorga XP**.
- Cuando el desktop puleá, el merge (`mergeQuestData`) **solo mergea datos, NO re-emite RPG events**. Verificado: el merge inserta filas, no llama a `processRpgEvent`.

O sea, tal como está: **"Syl, marcá el gym" → se marca pero NO da XP.** Rompe la gamificación silenciosamente. Inaceptable según la decisión #5.

**Opciones de diseño (a resolver en Fase 2/4):**
- **(a) Reconciliación en el pull:** el desktop, al pullear checks nuevos de origen `syl`, detecta los que no tienen RPG event asociado y los procesa. Requiere trackear qué checks ya otorgaron XP.
- **(b) Intent + procesamiento:** Syl escribe una "intención" (`pendingHabitCheck`), el desktop la procesa (emite el RPG event) y la confirma. Más robusto, más complejo.
- **(c) XP del lado servidor:** mover el cálculo de XP a una Cloud Function que Syl invoca. Contradice la decisión #1 (no backend) — solo si (a)/(b) fallan.

**Recomendación:** design spike dedicado antes de arrancar Fase 2. La escritura de Syl NO está completa hasta que el XP se otorgue correctamente y sin doble-conteo (idempotencia sobre el RPG event, no solo sobre el check).

**→ Resuelto en [`syl-integration-xp-spike.md`](./syl-integration-xp-spike.md):** Opción A (desktop reconcilia, exactly-once via claim transaccional, Syl nunca computa XP). Verificado que `processRpgEvent` es stateful + random → Syl no puede computar XP. Trade-off: XP diferido, sin número en el turno de voz. Riesgo abierto: si el uso se vuelve desktop-less, Fase 4 = portar `shared/rpg-engine.ts` al daemon.

---

## 4. Concerns transversales

- **Versionado de schema:** `schemaVersion` en el snapshot y en las subcollections, para que Syl y Hubtify evolucionen independiente.
- **Seguridad del service account:** el JSON de `firebase-admin` en secret/env del daemon, nunca en repo. `firebase-admin` bypassa rules → el daemon tiene acceso total, tratarlo como credencial crítica.
- **Multi-cuenta:** Hubtify soporta múltiples cuentas (`account:switched`). Syl opera sobre UN uid — definir cuál/cómo se selecciona.
- **Idempotencia en dos niveles:** (1) sobre el dato (natural-key doc ID), (2) sobre el efecto secundario (RPG event). Son distintos y ambos hacen falta.

---

## 5. Orden de ejecución recomendado

```
Fase 0 (proyección read)  ──►  Fase 1 (read-tools Syl)   ──►  [ship: Syl te conoce]
                                        │
                                        ▼
                          [design spike: XP landmine]
                                        │
                                        ▼
Fase 2 (write idempotente + migración)  ──►  Fase 3 (listeners)  ──►  Fase 4 (endurecimiento)
```

**No bloquear toda la feature detrás del refactor de write.** Fase 0+1 ship valor solas. La migración de writes se gana con calma cuando el read ya está probado en uso real.
