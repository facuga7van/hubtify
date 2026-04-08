# Sistema de Notificaciones — Hubtify

## Resumen

Sistema de notificaciones para Hubtify con dos canales independientes: notificaciones in-app (centro de notificaciones + toasts) y notificaciones nativas del sistema (Windows). Ambas con toggles independientes en Settings.

## Arquitectura General

Dos capas separadas:

### NotificationEngine (main process — Electron)

Servicio en el main process que:
- Corre queries periódicamente (cada 30 min) contra SQLite
- Evalúa condiciones por módulo
- Persiste notificaciones en tabla `notifications` de SQLite
- Dispara system notifications nativas cuando corresponde
- Auto-resuelve notificaciones cuya condición ya no se cumple

### NotificationCenter (renderer — React)

Componente React con:
- Campanita en el sidebar con badge numérico (count de activas)
- Panel drawer lateral con lista de notificaciones agrupadas por módulo
- Acciones: Ir (navega al módulo), Snooze (6h), Dismiss (descarta)
- Cuando se abre, pide data fresca al engine

### Flujo

1. Engine corre check periódico → genera notificaciones → guarda en DB
2. Manda evento al renderer: "hay notificaciones nuevas"
3. Campanita muestra badge con count
4. Usuario abre centro → ve lista → puede actuar, snooze o dismiss
5. Cuando condición se resuelve, engine auto-resuelve la notificación

## Base de Datos

### Tabla `notifications`

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- quest_due_soon, quest_overdue, quest_stale, nutri_pending, nutri_no_meals, finance_installment_due, finance_card_closing, finance_loan_pending, finance_recurring_missing
  module TEXT NOT NULL,        -- quests, nutrition, finance
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_route TEXT NOT NULL,  -- ruta para navegar (ej: /quests, /nutrition, /finance)
  status TEXT NOT NULL DEFAULT 'active',  -- active, snoozed, resolved, dismissed
  snoozed_until TEXT,          -- ISO datetime, null si no está snoozed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),  -- para sync conflict resolution (last-write-wins)
  resolved_at TEXT,
  ref_id TEXT,                 -- ID del recurso relacionado para deduplicación y auto-resolve
  deleted_at TEXT              -- soft delete para sync multi-account
);

CREATE INDEX idx_notifications_type_ref ON notifications(type, ref_id);
```

IMPORTANTE: Esta tabla DEBE agregarse a `USER_DATA_TABLES` en `electron/modules/sync.ipc.ts` e incluirse en los sync handlers correspondientes.

Migración: `{ namespace: 'notifications', version: 1, up: '...' }`. Debe importarse y ejecutarse en `electron/main.ts` via `runModuleMigrations()`.

### Sync Handlers

Las notificaciones abarcan todos los módulos, por lo que necesitan sus propios sync handlers separados:
- `sync:getAllNotificationData` / `sync:mergeNotificationData`
- Firestore subcollection: `hubtify_users/{uid}/notifications/data`
- El merge handler debe usar el patrón `INSERT OR IGNORE`

### Cleanup / Retención

En cada ciclo de polling, eliminar notificaciones resolved o dismissed con más de 30 días de antigüedad (`resolved_at` o `updated_at` > 30 días).

## Notification Engine — Evaluadores

### Deduplicación

Antes de insertar, chequear si ya existe notificación activa con mismo `type` + `ref_id`. Si existe, no duplicar.

### Auto-resolve

En cada ciclo, chequear notificaciones activas: si la condición ya no se cumple, marcar como `resolved` con `resolved_at = datetime('now')`.

### Evaluadores por módulo

Cada módulo tiene una función evaluadora:

```
evaluateQuestNotifications(db) → [{ type, title, body, ref_id, action_route }]
evaluateNutritionNotifications(db) → [...]
evaluateFinanceNotifications(db) → [...]
```

### Condiciones específicas

#### Questify

1. **Vencimiento próximo** (`quest_due_soon`)
   - Condición: `due_date = DATE('now', '+1 day') AND status = 0`
   - Título: "Tarea {nombre} vence mañana"
   - ref_id: task ID
   - Ruta: `/quests`

2. **Vencida** (`quest_overdue`)
   - Condición: `due_date < DATE('now') AND status = 0`
   - Título: "Tarea {nombre} está vencida"
   - ref_id: task ID
   - Ruta: `/quests`

3. **Estancada** (`quest_stale`)
   - Condición: `status = 0 AND updated_at < DATE('now', '-7 days')`
   - Título: "Tarea {nombre} no avanza hace una semana"
   - ref_id: task ID
   - Ruta: `/quests`

#### Nutrify

4. **Días pendientes** (`nutri_pending`)
   - Condición: Reusar query de `getPendingDays()` — días con food_log sin cerrar en últimos 7 días
   - Título: "Tenés el día {fecha} sin cerrar"
   - ref_id: date string (YYYY-MM-DD)
   - Ruta: `/nutrition`

5. **Sin comidas registradas** (`nutri_no_meals`)
   - Condición: `DATE('now')` no tiene registros en food_log Y hora actual >= 20:00. IMPORTANTE: el check de "hora actual >= 20:00" NO puede hacerse en SQLite (usa UTC). Este check debe hacerse en JavaScript usando la timezone local del usuario (`new Date().getHours() >= 20`). La query SQLite solo verifica la ausencia de registros; el filtro horario se aplica en JS.
   - Título: "No registraste comidas hoy"
   - ref_id: date string (YYYY-MM-DD)
   - Ruta: `/nutrition`

#### Coinify

6. **Cuotas próximas** (`finance_installment_due`)
   - Condición: No existe tabla `finance_installments`. Las cuotas se modelan como filas individuales en `finance_transactions` que comparten un `installment_group_id` apuntando a `finance_installment_groups`. Buscar transacciones con `installment_group_id IS NOT NULL` cuya `date` esté dentro de los próximos 3 días.
   - Título: "Cuota de {nombre} vence en {X} días"
   - ref_id: `installment_group_id` (no el ID de la transacción individual)
   - Ruta: `/finance`

7. **Cierre de tarjeta** (`finance_card_closing`)
   - Condición: `closingDay` de alguna tarjeta es dentro de 2 días
   - Título: "Tu tarjeta {nombre} cierra en 2 días"
   - ref_id: card ID
   - Ruta: `/finance`

8. **Préstamo pendiente** (`finance_loan_pending`)
   - Condición: La tabla `finance_loans` usa `settled INTEGER NOT NULL DEFAULT 0` (0 = activo, 1 = saldado), NO `status = 'active'`. Condición: `settled = 0 AND created_at < DATE('now', '-30 days')`
   - Título: "Préstamo con {nombre} lleva un mes abierto"
   - ref_id: loan ID
   - Ruta: `/finance`

9. **Recurrente no registrado** (`finance_recurring_missing`)
   - Condición: La tabla `finance_recurring` tiene columna `billing_day`. Verificar si existe alguna transacción con `source = 'recurring'` AND `recurring_id = {id}` para el mes actual. Si hoy > `billing_day` y no existe transacción matching para el mes actual, disparar la notificación. Nota: la auto-generación en `main.ts` ya crea estas transacciones automáticamente, por lo que esta notificación se dispara solo si la auto-generación falló o el usuario borró la transacción.
   - Título: "Gasto recurrente {nombre} no se registró este mes"
   - ref_id: recurring ID
   - Ruta: `/finance`

## System Notifications Nativas

- Agrupadas, no individuales: "Tenés {N} cosas pendientes en Hubtify"
- Solo se envían si hay notificaciones nuevas Y pasaron más de 3 horas desde la última nativa
- Reemplaza el sistema de reminders genérico actual (el interval de 3h en notifications.ipc.ts)

## Ciclo de Polling (cada 30 min)

1. Correr evaluadores de cada módulo
2. Deduplicar contra notificaciones activas (type + ref_id)
3. Insertar nuevas
4. Auto-resolve las que ya no aplican
5. Si hay nuevas → evento al renderer + system notification nativa (si habilitado y pasaron 3h)

## UI — Centro de Notificaciones

### Campanita (NotificationBell)
- Ubicada en el sidebar, arriba de la navegación de módulos
- Badge numérico con count de notificaciones activas (no resolved, no dismissed, no snoozed)
- Sin badge si no hay notificaciones
- DEBE escuchar `account:switched` y recargar el count (igual que NotificationCenter)

### Panel (Drawer)
- Se abre al clickear la campanita, sobre el contenido actual (no reemplaza la vista)
- Lista agrupada por módulo
- Cada notificación muestra:
  - Ícono del módulo + título
  - Body con detalle
  - Timestamp relativo ("hace 2 horas")
  - Tres acciones: **Ir** (navega y cierra panel), **Snooze** (6h), **Dismiss** (descarta)
- Estado vacío: mensaje "Todo al día" con ícono temático RPG

### Estados
- Nueva → fondo resaltado
- Snoozed → no aparece hasta que vuelve (snoozed_until < now)
- Resolved → desaparece automáticamente
- Dismissed → desaparece

## Settings

En SettingsPage.tsx, dos toggles independientes:
- "Notificaciones in-app" → habilita/deshabilita centro de notificaciones + toasts
- "Notificaciones del sistema" → habilita/deshabilita nativas de Windows

Reemplaza el toggle actual de "Reminders".

Valores guardados en localStorage:
- `hubtify_notifications_inapp` (boolean)
- `hubtify_notifications_system` (boolean)

Nota: Los settings son GLOBALES (no per-account), almacenados en localStorage. Esto es intencional — las preferencias de notificación aplican a la instalación de la app, no a cuentas individuales.

## IPC Channels Nuevos

- `notifications:getAll` → retorna notificaciones activas + snoozed vencidos
- `notifications:dismiss(id)` → marca como dismissed
- `notifications:snooze(id)` → marca como snoozed con snoozed_until = now + 6h
- `notifications:runCheck` → fuerza un ciclo de evaluación (para cuando se abre el centro)
- `notifications:getCount` → retorna count de activas (para el badge)

Nota: El handler existente `notifications:send` se mantiene para notificaciones ad-hoc del sistema. El handler `notifications:setReminders` es reemplazado por el nuevo engine.

### TypeScript Interface

Definir en `shared/types.ts`:

```typescript
interface AppNotification {
  id: string;
  type: string;
  module: string;
  title: string;
  body: string;
  actionRoute: string;
  status: 'active' | 'snoozed' | 'resolved' | 'dismissed';
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  deletedAt: string | null;
  refId: string | null;
}
```

## Archivos a crear/modificar

### Crear:
- `electron/modules/notifications.schema.ts` — migración de la tabla
- `electron/modules/notification-engine.ts` — servicio con evaluadores y ciclo de polling
- `src/shared/components/NotificationCenter.tsx` — panel drawer
- `src/shared/components/NotificationBell.tsx` — campanita con badge
- `src/shared/styles/notifications.css` — estilos del centro

### Modificar:
- `electron/modules/notifications.ipc.ts` — nuevos IPC handlers, reemplazar reminders
- `electron/preload.ts` — exponer nuevos channels
- `shared/types.ts` — tipos en HubtifyApi
- `electron/ipc/registry.ts` — si hace falta registrar nuevos handlers
- `electron/main.ts` — iniciar el engine al arrancar
- `src/hub/Layout.tsx` — integrar campanita
- `src/hub/SettingsPage.tsx` — reemplazar toggle de reminders por los dos nuevos
- `electron/modules/sync.ipc.ts` — agregar tabla a USER_DATA_TABLES y sync handlers
- `src/i18n/es.json` + `src/i18n/en.json` — claves i18n

## Convenciones del proyecto aplicadas

- IPC channels: `notifications:action` pattern
- DB: snake_case en SQL, camelCase en JS via aliases
- IDs: `crypto.randomUUID()` via `genId()`
- Handler wrapper: `ipcHandle()` de `electron/ipc/ipc-handle.ts`
- account:switched listener en NotificationCenter Y NotificationBell (ambos deben recargar datos)
- Tabla en USER_DATA_TABLES + sync handlers
- i18n con fallback: `t('key', 'Texto por defecto')`
- CSS con prefijo: `.notif-*`
- Commits: `type(scope): description` sin AI attribution
