# Rúbrica de user journey — Hubtify (baseline v0.9.4)

Solo análisis. Evidencia: código en `feat/codex-seal-modal` (= master + 1 commit) y la base real del
usuario (`%APPDATA%\hubtify\hubtify.db`, copia read-only, **solo agregados**). Los pasos se contaron
leyendo componentes, con el rigor de la auditoría de Coinify (`2026-09-03-coinify-audit.md`).

---

## 0. La base real, en dos números

14 días con actividad en 5 meses (`rpg_events` agrupado por día: 04-28→05-02, después huecos de
6, 9, 40 y 54 días, y 09-01/09-02). **1 solo sello del Códice** en toda la historia
(`day_seals`), con 6 días de nutrición cerrados. **132 óbolos ganados, 0 gastados**
(`obolos_ledger`; `rewards` y `shop_purchases` vacías). `favorite_foods` y `frequent_foods`
vacías. **67 de 68 tareas no tienen `due_date`.** 41 sesiones de Caldero, **0 vinculadas a una
tarea**. Mastery: quests 780, nutrition 841, cauldron 686, **finance 6**. 17 de 20 notificaciones
son `quest_stale`.

Traducción: el dueño de la app no la usa a diario, el sink de la economía no existe en la práctica,
los atajos de repetición nunca se estrenaron, y la vista "Hoy" no tiene de dónde sacar un "hoy".

---

## 1. La rúbrica (12 criterios)

| # | Criterio | Qué mide (verificable) |
|---|---|---|
| C1 | Tiempo hasta el primer valor | Interacciones desde el primer arranque hasta el primer registro que paga XP |
| C2 | Costo de la acción principal en régimen | Interacciones por acción repetida en cada módulo, con el atajo disponible |
| C3 | Superficie única de "hoy" | Cuántas rutas distintas hay que visitar para cerrar un día completo |
| C4 | Claridad de "qué hago ahora" | Cuántas de las N superficies principales dicen la siguiente acción concreta |
| C5 | Estados vacíos que enseñan | % de estados vacíos con CTA que dispara la acción (no que sólo navega) |
| C6 | Recuperación de ausencias | Ventana retroactiva por módulo + existencia de una explicación al volver |
| C7 | Un solo camino por concepto | Nº de caminos distintos que producen el mismo resultado con datos distintos |
| C8 | Continuidad desktop ↔ teléfono | Latencia de sync, paridad de features, taps de navegación pura |
| C9 | Canilla y desagüe | Ratio ganado/gastado de la moneda, medido en la base real |
| C10 | Invita en vez de castigar | Nº de mecánicas que restan (XP, HP, racha) por no aparecer |
| C11 | La metáfora ayuda | Nº de términos temáticos sin explicación en su lugar + contraste medido |
| C12 | Defaults que aciertan | Default del formulario vs. la distribución real en la base |

**Cómo se puntúa** (mismo eje para todos: 3 = falla estructural, 6 = funciona con fricción,
9 = ejemplar):

| # | 3 | 6 | 9 |
|---|---|---|---|
| C1 | Hay un muro (cuenta obligatoria o setup forzado) antes de ver el producto | Se puede saltear el setup en ≤2 clics; primer registro en ≤6 interacciones | Se registra algo útil sin crear cuenta; primer valor en ≤3 interacciones |
| C2 | La acción repetida cuesta ≥6 interacciones o siempre pega a la red | ≤4 interacciones, con atajo disponible en la pantalla principal | ≤2 interacciones para repetir lo de ayer, sin salir del hub |
| C3 | ≥4 rutas para cerrar el día | 2 rutas | 1 sola superficie hace todo |
| C4 | Ninguna superficie sugiere la siguiente acción | La home la sugiere; los módulos no | Cada superficie propone la acción concreta y el sistema avisa cuando falta |
| C5 | <40% de los vacíos tienen CTA | 40-75% | >90%, y el CTA abre el formulario, no la pantalla |
| C6 | Se pierde dato sin poder recuperarlo y nadie explica nada | Ventanas retroactivas existen pero son distintas por módulo | Ventana coherente + un resumen de "qué pasó mientras no estuviste" |
| C7 | Un mismo gesto produce filas distintas (bug latente) | Caminos duplicados pero equivalentes | Un camino por concepto, el resto se deriva |
| C8 | Features centrales sin equivalente y sync que puede pisar datos | Paridad funcional, sync automática pero diferida, nav costosa | Sync ≤5 s, paridad total, ≤1 tap de navegación por módulo |
| C9 | Ratio gastado/ganado = 0 en la base real | Existe el sink y se usó alguna vez | El sink se usa regularmente y es visible donde se gana |
| C10 | HP/XP/racha se pierden por ausencia sin gracia | Gracia limitada (1 día) y sin daño | Cero castigo + gracia explícita + modo pausa proactivo |
| C11 | Términos temáticos sin explicar y contraste <4.5:1 en superficies reales | Explicados en tooltip/ayuda; contraste OK en la superficie clara | Se entienden sin glosario; contraste OK sobre la superficie más oscura |
| C12 | El default es el valor menos frecuente de la base real | Default razonable, editable en 1 clic | El default es el último valor usado |

**Por qué importan.** C1/C2/C5 deciden si la app se estrena. C3/C4/C7/C12 deciden si se usa a
diario sin pensarla. C6/C9/C10 deciden si se vuelve después de un hueco — que, según §0, es
exactamente el patrón real de uso. C8 decide si existe fuera del escritorio. C11 es lo único que la
diferencia y también lo único que puede volverla ilegible.

---

## 2. Los journeys y sus pasos reales

### J1 — Usuario nuevo, primera sesión

`App.tsx:103-120` tiene dos compuertas antes de cualquier pixel de producto:

1. **Login obligatorio con Firebase** (`App.tsx:106-115`). No existe modo invitado ni offline en
   `AuthContext.tsx`. Alta = 3 campos + 1 clic (`AuthPage.tsx:64,235-246`).
2. **Onboarding de 4 pasos** (`Onboarding.tsx:31`), salteable entero con 1 clic
   (`Onboarding.tsx:222-224`). Camino completo: **6 clics, 0 tecleos obligatorios** — la fecha de
   nacimiento se satisface abriendo y cerrando el picker, que viene precargado en `hoy-25 años`
   (`RpgDatePicker.tsx:26-28,157-160`).
3. Dashboard vacío: **sí enseña**, con 3 CTAs (`Dashboard.tsx:413-428`) — pero los tres solo
   *navegan* al módulo, no abren el formulario.
4. Primeras tres acciones por el camino más corto: misión **3 clics + N tecleos**
   (`TaskList.tsx:568-580`, `TaskForm.tsx:97,145-161`); comida por el widget **3 clics + N**
   (`NutritionDashboardWidget.tsx:269-323`); gasto por el widget **2 clics + N**
   (`DashboardWidget.tsx:193-286`).

**Total: 4 campos de alta + 1-6 clics de onboarding + 9 clics + 3 campos de texto.**
Trampa: si el usuario usa el CTA "Registrá una comida", cae en `/nutrition` y se come **una
tercera compuerta de perfil** (`Today.tsx:1220-1226`, +4 clics) que el widget no exige.

### J2 — Día típico del usuario instalado

| Acción | Camino más corto | Interacciones |
|---|---|---|
| Completar misión | tilde en el widget (`TasksDashboardWidget.tsx:136`) | **1 clic**, sin navegar |
| Cargar gasto | quick-add del widget (`DashboardWidget.tsx:193-286`) | **2 clics + monto** |
| Registrar comida | widget → siempre round-trip a la Cloud Function (35 s de timeout, `estimate-core.ts:37`) | **3 clics + texto + espera** |
| — la misma, con favoritos | solo existe en `/nutrition` (`Today.tsx:1643`) | 1 cambio de ruta + **1 clic** |
| Cerrar el día (Nutrify) | footer sticky de `/nutrition` (`Today.tsx:2098-2113`) | 1 ruta + **2 clics** |
| Sellar el Códice | overlay global (`Layout.tsx:711`) | **1 clic + 1,5 s de hold + 1 clic** |

**Total realista: ~11 interacciones, 2 rutas y DOS rituales de cierre independientes** que se pagan
XP por separado y no se mencionan entre sí. El del Códice se anuncia (después de las 21:00, una
línea en el brief: `useSealInvite.ts:59-63`, `Dashboard.tsx:345-363`); el de Nutrify **no se anuncia
nunca**. En la base real: 6 cierres de Nutrify, **1 sello**.

### J3 — La vuelta (dos días afuera)

- HP vuelve solo a 100 (`rpg-stats.ts:88-92`); **no existe castigo** (`rpg-engine.ts:52-68`).
- La racha global **se rompe**: los indultos cubren un hueco de 1 día, no de 2
  (`rpg-handlers.ts:509-518`). La de Nutrify también (`meal-utils.ts:359-368`).
- **Nadie explica nada.** No hay pantalla de regreso; el logro `hero_return` recién se dispara a los
  14 días (`achievements.ts:145,181`). El brief del dashboard dice lo mismo si faltaste 1 día que si
  faltaste 10 (`Dashboard.tsx:305-335`).
- Muro rojo en Questify, con un botón que lo limpia entero: **1 clic** (`TaskList.tsx:750-760`).
- Ventanas retroactivas **incoherentes**: nutrición sin límite (`nutrition.ipc.ts:925-1000`),
  hábitos **solo ayer y solo antes del mediodía** (`quests.ipc.ts:829-833`,
  `HabitTracker.tsx:175`), sello hoy/ayer (`rpg-engine.ts:152`), Caldero **nada**.

**Pasos para volver: 1 clic (limpiar vencidas) + 1 tap por hábito recuperable + 2 taps por cada día
de nutrición a rellenar. Los hábitos y las sesiones del día 1 del hueco son irrecuperables.**

### J4 — El mismo día, desde el teléfono

Drawer sin bottom tabs por decisión de diseño (`2026-09-01-mobile-android-design.md:238`): **cada
cambio de módulo cuesta 2 taps**. Comida 4 · misión 3 · gasto 4 · cierre 2 (si ya estás ahí).
**Total ~13-15 taps, de los cuales ~6 son navegación pura.**
Sync: push con debounce de 30 s + `blur`, pull en `focus` (`Layout.tsx:413-504`) — **no hay
`appStateChange` de Capacitor**, solo `backButton` (`native-shell.ts:23`); con ambas apps abiertas y
quietas, el dato no cruza. Los escalares (nivel, XP, racha) son LWW puro (`sync.ts:290-296`).
Abiertos de QA 0.9.1: back-button navega en vez de cerrar menús de fila (GEN-01), `steps: null`
rompe el cierre de día (`Today.tsx:1015` vs `nutrition.ipc.ts:663`), y CAU-03 (crash del emulador al
iniciar sesión) sigue sin causa.

### J5 — El mes de Coinify (referencia)

**~330 interacciones, 6 pestañas, 3 modales** (`2026-09-03-coinify-audit.md §1`). Un gasto digital
cuesta 6 clics + 2 campos, siempre.

---

## 3. Puntuación baseline

| # | Criterio | Pts | Evidencia |
|---|---|---|---|
| C1 | Primer valor | **4** | Login Firebase obligatorio (`App.tsx:106-115`), sin modo invitado; después el vacío sí enseña (`Dashboard.tsx:413-428`) pero el CTA solo navega |
| C2 | Costo en régimen | **4** | Misión 1 clic (excelente); comida siempre a la red desde el hub; gasto 6 clics + 2 campos en la ruta completa; `favorite_foods`/`frequent_foods` **vacías** en la base real |
| C3 | Superficie de "hoy" | **5** | 2 rutas mínimo (`/` y `/nutrition`); 19 rutas totales (`App.tsx:110-155`); Coinify agrega 6 pestañas |
| C4 | Qué hago ahora | **5** | Brief + invitación al sello (`useSealInvite.ts`) — bien; cierre de Nutrify sin ningún aviso; 67/68 tareas sin `due_date` deja la vista "Hoy" estructuralmente vacía |
| C5 | Vacíos que enseñan | **4** | 2 de 5 widgets del dashboard son callejones sin salida (`TasksDashboardWidget.tsx:160-163`, `HabitsDashboardWidget.tsx:64-72`); "Configurá tu perfil" no es clickeable y además **miente** (el widget funciona igual); en Coinify, 5 vacíos sin CTA |
| C6 | Recuperación | **5** | Cero castigo (bien) pero 4 ventanas retroactivas distintas y **ninguna explicación al volver**; el logro de regreso recién a los 14 días |
| C7 | Un camino por concepto | **3** | 2 cierres de día · 3 compuertas de perfil de nutrición · 3 altas de cuotas que escriben filas distintas, con bug confirmado (`finance.ipc.ts:1058`) · quick-add duplicado y desincronizado en finanzas y nutrición |
| C8 | Continuidad | **4** | Sync diferida sin hook nativo de ciclo de vida; escalares LWW; timer flotante y PDF sin equivalente móvil; 6 de 15 taps son navegación; GEN-01 y CAU-03 abiertos |
| C9 | Canilla y desagüe | **3** | `SUM(delta)=132` ganados, **0 gastados**; `rewards`=0, `shop_purchases`=0. El sink existe en código y no existe en la vida |
| C10 | Invita, no castiga | **8** | `calculateHpPenalty` borrado a propósito (`rpg-engine.ts:52-60`), vencidas pagan XP completo (`quests.css:314-316`), indultos y Posada. **Lo mejor de la app** — le falta que la gracia cubra 2 días |
| C11 | La metáfora | **6** | Consistente y con identidad; pero contraste `--ink-faded` 3.80:1 sobre `--parch-2` (reincidente ×3), y 21 claves `*Help` solo en Coinify para explicarse |
| C12 | Defaults | **3** | `paymentMethod='cash'` (`QuickAddForm.tsx:66`) cuando el 67% real es `transfer` y **cero** efectivo cargado a mano; `account_id` NULL en 107/107 filas; fecha de nacimiento fabricada por default |

**Total: 54 / 120 · Promedio 4,5 / 10.**

---

## 4. Mejoras priorizadas por (puntos ganados) / (esfuerzo)

| # | Cambio concreto | Sube | Esf. | Archivos |
|---|---|---|---|---|
| 1 | **CTA real en los vacíos**: botón "Crear misión" / "Crear ritual" que abre el formulario, y hacer clickeable el aviso de perfil (que además debe decir la verdad: el registro funciona sin perfil) | C5 4→7 | **S** | `TasksDashboardWidget.tsx:160-163`, `HabitsDashboardWidget.tsx:64-72`, `NutritionDashboardWidget.tsx:223-229`, `Dashboard.tsx:413-428` |
| 2 | **Defaults desde la base**: `paymentMethod` = último usado (no `'cash'`); `resolveAccountId` mapea `transfer`/`debit` a la cuenta usada por última vez | C12 3→6, C2 4→5 | **S** | `QuickAddForm.tsx:66`, `DashboardWidget.tsx:28-29`, `shared-logic/modules/finance.ipc.ts` (`resolveAccountId`) |
| 3 | **Darle desagüe a los óbolos**: seedear 3 recompensas por defecto en la migración y mostrar el saldo en el modal del sello, donde se ganan | C9 3→6 | **S** | migración de `rewards`, `src/hub/rewards/RewardsPage.tsx`, `src/hub/codex/CodexSealModal.tsx` |
| 4 | **Matar la tercera compuerta de nutrición**: `/nutrition` registra sin perfil igual que el widget, y ofrece calcular el TDEE como banner, no como muro | C7 3→4, C1 4→5 | **S** | `Today.tsx:1220-1226`, `NutritionOnboarding.tsx` |
| 5 | **Brief de regreso**: si el último evento es de hace ≥2 días, el brief dice qué pasó (racha, días sin cerrar, vencidas) en vez del texto genérico | C6 5→7, C4 5→6 | **S** | `Dashboard.tsx:305-340`, `shared-logic/modules/rpg-stats.ts` |
| 6 | **Móvil, dos bugs abiertos**: registrar los menús de fila en el registro de popovers del back-button, y aceptar `steps: null` | C8 4→5 | **S** | `src/mobile/back-button.ts`, `dialog-dom.ts`, `Today.tsx:1015`, `nutrition.ipc.ts:663` |
| 7 | **Un solo cierre de día**: el cierre de Nutrify encadena al sello del Códice (o el Códice absorbe el paso de pasos/gimnasio); un solo XP, un solo ritual, un solo aviso | C7 3→6, C4 6→8, C3 5→6 | **M** | `Today.tsx:1794-2115`, `src/hub/codex/CodexSealModal.tsx`, `useSealInvite.ts`, `shared-logic/modules/nutrition.ipc.ts` |
| 8 | **Portar los atajos rápidos al widget de nutrición**: favoritos y "repetir ayer" en el hub, para que la comida repetida no pegue a la red | C2 5→7, C3 6→7 | **M** | `NutritionDashboardWidget.tsx:203-389`, reusando `Today.tsx:654-688,744-769` |
| 9 | **Ctrl+K también carga comida y gasto** (`"café 300"` / `"$4500 nafta"`), no solo misiones | C2 7→8, C3 7→8 | **M** | `src/shared/components/QuickAdd.tsx`, `quickadd-parser.ts` |
| 10 | **Un `due_date` por default al crear misión** (hoy, editable) o un bucket "sin fecha" visible en Hoy: hoy la vista principal no tiene de dónde sacar contenido | C4 8→9 | **M** | `TaskForm.tsx:145-161`, `TodayView.tsx` |
| 11 | **Gracia de 2 días para la racha** (el hueco real medido en la base es de 2+ días, no de 1) | C10 8→9, C6 7→8 | **M** | `rpg-handlers.ts:497-518`, `shared/rpg-engine.ts:183-189`, `meal-utils.ts:359-368` |
| 12 | **Modo local/invitado**: usar la app sin cuenta y ofrecer la sincronización cuando haya algo que sincronizar | C1 5→8 | **L** | `App.tsx:103-120`, `src/shared/AuthContext.tsx`, `src/shared/sync.ts` |

Si se hacen las 6 primeras (todas S), el total pasa de **54 a 65** (promedio 5,4). Con las de
esfuerzo M (7-11), llega a **78** (6,5). El #12 es el techo de C1 y no se puede subir de otra forma.
