# Avisos con la app cerrada (Android) — Fase 6

**Fecha:** 2026-09-03 · **Rama:** `feat/android-background` · **Base:** `fix/habit-notification`
**Cierra:** «fuera de alcance en v1» de `2026-09-01-mobile-android-design.md` §1 y §12 Fase 6.

## 1. El problema

El motor de notificaciones (`notifications.ipc.ts`, poll de 30 min) y el tick del Caldero
(`cauldron.ipc.ts`, `setInterval` de 1 s) viven en el Worker del WebView. Android lo congela
apenas la app pasa a segundo plano, y `platform().notify()` en mobile era un
`LocalNotifications.schedule` **sin `at`** — inmediato. Resultado: los avisos solo salían con la
app abierta, que es lo que el usuario reportó usándola.

**No hay forma de "correr en background"** sin un servicio en primer plano (notificación
permanente propia + plugin nativo). La salida es la contraria: **programar en vez de emitir**.
Se le entrega al SO, por adelantado, la alarma con su texto ya resuelto; el SO la dispara aunque
nuestro proceso no exista.

## 2. Arquitectura

```
shared-logic/modules/notification-schedule.ts   (puro, testeable, sin plugin)
  planCauldronNotifications(estado)  → NotificationPlan
  planHabitNotifications(db, opts)   → NotificationPlan
  pushPlan(plan) → platform().applyNotificationPlan?.(plan)   ← fire-and-forget
                                   │
src/mobile/platform-host.ts (hilo UI) ──┴─→ @capacitor/local-notifications
electron/platform.ts: NO implementa el método → en desktop no se programa ni se calcula nada
```

`NotificationPlan` es el **estado completo** de un ámbito, no un delta:

```ts
{ scope, owned: string[], ownedPersistent?: string[], schedule: ScheduledNotification[] }
```

El host cancela todo lo de `owned` que no esté en `schedule` y programa el resto. Reconciliar
entero es lo único que sobrevive a que el proceso muera entre dos cambios; diferenciar "qué
cambió" exigiría un registro persistente que no existe.

## 3. Qué se programa y cuándo

| Ámbito | Tags | Contenido | Se reconcilia en |
|---|---|---|---|
| `cauldron` | `cauldron:end`, `cauldron:ongoing` | alarma de fin a `targetEndTime`; aviso persistente «Enfoque — Ciclo 2/4 / Termina a las 15:42» | `start`, `pause`, `resume`, `skip`, `extend`, `confirmNext`, `stop`, `onTimeUp`, `resumeInterruptedSession`, `setLabels`, lifecycle `resume`, y el registro de handlers (arranque en frío) |
| `habits` | `habit:YYYY-MM-DD` (hoy + 7 días) | «Hábitos pendientes / Tenés hábitos sin marcar hoy.» a la hora configurada | marcar/saltear/crear/editar/borrar un hábito, `setHabitReminder`, `setModuleEnabled('quests')`, `setLocale`, `runCheck`, `startNotificationEngine()` (arranque), lifecycle `resume` |

El horizonte de 7 días no es un lujo: si la app no se abre en tres días, esos tres recordatorios
tienen que salir igual. `computeHabits(db, fechaFutura)` contesta «¿este hábito querría un check
tal día?» sin checks todavía, así que la predicción sale de **`habitsPendingToday`**, la misma
función que usan el motor y el auto-resolve (había TRES copias de esa cuenta; no se agrega una
cuarta).

**En Android `onTimeUp()` ya NO emite el aviso inmediato del Caldero** (`schedulingSupported()`
lo saltea): el texto ya salió por la alarma. Emitirlo otra vez sería un duplicado, y en mobile
ese tick puede llegar 40 min tarde, con lo cual además mentiría.

## 4. Duplicados

Tres mecanismos, en orden de importancia:

1. **Nunca se programa un momento pasado.** El plugin, ante un `at` vencido, dispara la
   notificación EN EL ACTO (`LocalNotificationManager.kt`, rama `isTriggered()`). Reprogramar al
   reabrir la app el recordatorio de las 21:00 a las 21:30 sería un duplicado garantizado. El
   planificador simplemente no lo incluye.
2. **Reprogramar el mismo id reemplaza la alarma**, no la duplica (el plugin usa el id como
   `requestId` con `PendingIntent.FLAG_CANCEL_CURRENT`). Por eso reconciliar entero en cada
   cambio es idempotente y barato.
3. **Ids estables por origen**: `notificationIdFor(tag)` (FNV-1a → int32 en `[2^30, 2^31)`).
   Cancelar `cauldron:ongoing` no puede tocar `habit:2026-09-04`.

Se eligió **cancelar y reprogramar** en vez de diferenciar contra `getPending()`: el estado
autoritativo (DB + estado del Caldero) vive de nuestro lado, y una consulta al plugin agregaría
un round-trip y un segundo lugar donde equivocarse.

## 5. Alarma exacta vs inexacta — decisión

`isExactNotification` es `true` **por defecto** en el plugin, y en Android 12+ sin
`SCHEDULE_EXACT_ALARM` eso ABRE la pantalla de sistema «Alarmas y recordatorios» en medio de un
`schedule()` y deja la promesa colgada (`LocalNotificationsPlugin.kt:127`, `doSchedule`).

**Decisión:** exacta solo si el permiso YA está concedido (`checkExactNotificationSetting()`,
que no abre nada); si no, `isExactNotification: false` explícito. Sin consulta cacheada: el
permiso se revoca desde Ajustes y equivocarse cuesta una pantalla de sistema sorpresa.

**Verificado en el emulador (Android 15 / API 35):** con `targetSdk 35` el permiso está
**denegado por defecto** (Android 13+ dejó de pre-concederlo), así que el camino normal es el
inexacto. `dumpsys alarm` con permiso denegado:

```
type=RTC_WAKEUP origWhen=2026-09-03 02:39:31.915 window=+44s930ms  maxWhenElapsed=+1m41s
```

es decir: **el sistema puede correr el aviso**. La ventana la elige Android en función de cuánto
falta (≈45 s para una alarma a 1 minuto; para 25 min es de varios minutos, y bajo Doze
`setAndAllowWhileIdle` está limitado a **una vez cada 9 minutos por app**). Para un pomodoro eso
es una degradación real, así que **Ajustes → Notificaciones → «Avisos puntuales»** ofrece
concederlo con un gesto explícito (`changeExactNotificationSetting()`). Con el permiso dado:

```
type=RTC_WAKEUP origWhen=2026-09-03 03:10:41.124 window=0 exactAllowReason=permission flags=0x5
```

No se declara `USE_EXACT_ALARM` (Android 14+, auto-concedido): la política de Google Play lo
reserva para apps cuya función central es reloj-despertador o calendario, y Hubtify no lo es.

`allowWhileIdle: true` va **siempre**. Sin él el plugin usa `AlarmManager.set(RTC, …)`, que no
despierta el equipo: bajo Doze el aviso puede quedarse esperando la próxima ventana de
mantenimiento (horas). Con él usa `setAndAllowWhileIdle(RTC_WAKEUP, …)`.

## 6. Permisos

- `POST_NOTIFICATIONS` (Android 13+): ya se pedía en `notificationsReady()`, una vez por sesión.
  **Cambio:** un plan que solo CANCELA no lo dispara — cancelar no necesita permiso, y un plan
  vacío al arrancar no debe abrir un diálogo sin motivo.
- `SCHEDULE_EXACT_ALARM`: lo declara el manifest del plugin y se mergea solo (verificado en el
  manifest fusionado). Nunca se pide implícitamente; ver §5.

## 7. Notificación persistente del Caldero

**El contador vivo NO es viable** sin plugin nativo propio: para que el tiempo restante bajara
segundo a segundo haría falta o bien re-notificar desde código (imposible: el Worker está
congelado) o bien `setUsesChronometer()` / un foreground service, y el plugin no expone ninguno
de los dos.

Lo que **sí** es viable y se implementó: un aviso persistente ESTÁTICO con la **hora de término**
(«Termina a las 15:42»), que no envejece mal — a diferencia de un «faltan 12 min» congelado.
`ongoing: true`, `autoCancel: false`, canal aparte `hubtify-ongoing` con **importancia 2 (LOW)**
para que reprogramarlo no dispare un heads-up cada vez. Se retira con
`removeDeliveredNotificationsById` porque `cancel()` no baja una notificación ya publicada
(solo la marca en el storage del plugin).

## 8. Si el usuario mata la app

Las alarmas las guarda el sistema (`AlarmManager` + `PendingIntent`), no el proceso:

- **Cerrar desde recientes / kill por memoria:** las alarmas sobreviven. Verificado con
  `adb shell am kill`: el recordatorio de hábitos llegó igual y Android levantó el proceso de
  nuevo para entregarlo.
- **Reinicio del teléfono:** el plugin las restaura (`LocalNotificationRestoreReceiver` +
  `RECEIVE_BOOT_COMPLETED`, en su manifest).
- **«Forzar detención» desde Ajustes:** Android CANCELA todas las alarmas de la app. No hay
  vuelta: se rearman al abrirla de nuevo (arranque en frío → `syncHabitSchedule()` y
  `syncCauldronSchedule()`).
- **Fabricantes agresivos** (MIUI/Xiaomi, Huawei, OPPO, vivo, y Samsung con optimización de
  batería): tratan el swipe desde recientes como un force-stop y matan las alarmas. No hay API
  para evitarlo; la única mitigación real es que el usuario excluya Hubtify de la optimización
  de batería. Es una limitación conocida, no un bug.

## 9. Desktop

`electron/platform.ts` **no implementa** `applyNotificationPlan`, y esa ausencia ES la señal:
`schedulingSupported()` devuelve false y ni se calcula el plan (nada de `computeHabits` × 8 días
por cada check de hábito en escritorio). El proceso principal de Electron no se congela y sus
notificaciones siguen saliendo por `notify()`. Hay test explícito
(`tests/electron/platform.test.ts`) y casos «escritorio no programa nada» en las dos suites de
integración.

## 10. Verificación en emulador (AVD `hubtify`, Android 15 / API 35)

Todo con `window.api` por CDP, sin tocar la UI (ver §11):

| Qué | Resultado |
|---|---|
| Sesión de 1 min → `dumpsys alarm` | `RTC_WAKEUP` a `+1 min` para `TimedNotificationPublisher` |
| App a segundo plano (`keyevent 3`) y espera | «¡Poción completada! / Ciclo 1/4 — Siguiente: Descanso (1 min) (BG-test)» entregada con la app fuera de foco |
| Aviso persistente | canal `hubtify-ongoing`, `flags=ONGOING_EVENT`, «Enfoque — Ciclo 1/4 / Termina a las 02:39» |
| Reabrir la app | el persistente se retira; el aviso de fin queda; **ni un duplicado** |
| Recordatorio de hábitos armado | 8 alarmas: hoy + 7 días, todas a la hora configurada |
| Marcar el hábito | la alarma de HOY desaparece; quedan las 7 siguientes |
| `am kill` + esperar | «Hábitos pendientes / Tenés hábitos sin marcar hoy.» llegó con el proceso muerto |
| Opt-in de alarma exacta | abre «Alarms & reminders», al volver resuelve `granted` y las alarmas pasan a `window=0` |

## 11. Nota sobre CAU-03

CAU-03 (el emulador muere en <1 s al tocar «Iniciar Poción», 3/3) **no se reprodujo**: toda la
verificación se hizo por CDP contra `window.api`, sin pasar por la UI. Dato nuevo: arrancar
sesiones con `cauldronStart` es estable (2/2, con el proceso sobreviviendo el ciclo completo),
así que **el problema no está en el handler, ni en el worker, ni en el plugin de
notificaciones** — está en el camino de renderizado del botón. El Caldero SÍ quedó verificado en
emulador; lo que queda sin verificar es el botón.
