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

---

## 5. Segunda medición (rama `feat/journey-improvements`, sobre `release/0.9.5`)

Mismo método que la baseline: los pasos se contaron leyendo los componentes; los
números vienen de una **copia de solo lectura** de `%APPDATA%\hubtify\hubtify.db`
en el scratchpad, con consultas de agregado.

### 5.0 Advertencia de método, antes de los puntajes

**La base real no se movió**, y no podía moverse: los cambios están en una rama,
no en la app que el dueño usa. Reconsultada hoy, devuelve exactamente lo mismo
que la baseline:

| Medida | Baseline | Segunda medición |
|---|---|---|
| Tareas / sin `due_date` | 68 / 67 | 68 / 67 |
| Óbolos ganados / gastados | 132 / 0 | 132 / 0 |
| `rewards` / `shop_purchases` | 0 / 0 | 0 / 0 |
| `favorite_foods` / `frequent_foods` | 0 / 0 | 0 / 0 |
| Sellos del Códice / cierres de Nutrify | 1 / 6 | 1 / 6 |
| Sesiones de Caldero / vinculadas a una tarea | 41 / 0 | 41 / 0 |

Por eso **ningún criterio que la rúbrica define por una medición de la base puede
alcanzar su banda alta acá**. Lo que sí cambió, y es lo que se puntúa, es si el
código todavía tiene el agujero estructural que producía ese número. Donde la
distinción importa (C9, C12) está dicho en la evidencia.

### 5.1 Los journeys, recontados

**J1 — usuario nuevo.** Las dos compuertas siguen: login de Firebase obligatorio
(`App.tsx:106-115`) y onboarding de 4 pasos salteable con 1 clic. Lo que cambió
es lo que pasa después: los cuatro botones del vacío del tablero
(`Dashboard.tsx:483-498`) ya no navegan — piden el formulario del widget por el
bus `hub:quickCreate` (`src/hub/widgets/quick-create.ts`) y el widget lo abre y
se trae a la vista. **La primera misión pasa de 3 clics + N tecleos a 1 clic + el
nombre + Enter.** El vacío suma un cuarto botón, "Creá tu primer ritual", que
antes no existía en ningún lado del tablero.

**J2 — día típico.**

| Acción | Camino más corto | Antes | Ahora |
|---|---|---|---|
| Completar misión | tilde en el widget | 1 clic | 1 clic |
| Cargar gasto | quick-add del widget | 2 clics + monto | igual |
| Registrar comida nueva | widget → Cloud Function | 3 clics + texto + espera | igual |
| **Repetir una comida** | pastilla en el widget del hub (`NutritionDashboardWidget.tsx:377-400`) | 1 cambio de ruta + 1 clic | **1 clic, sin red** |
| **Repetir el día de ayer** | botón en el mismo widget | inalcanzable sin un favorito previo | **1 clic + confirmación** |
| **Cerrar el día** | el lacre del Códice cierra también la jornada de comidas (`CodexSealModal.tsx:542-598`) | **dos** rituales, 1 ruta + 2 clics + 1 clic + hold | **un** ritual: 1 clic + 1,5 s de hold |

**Dejaron de ser dos rituales.** El footer de Nutrify abre el mismo Códice
(`Today.tsx:1971-1990`) y el popup de cierre —con su `closeResult` y su
`doCloseDay`— se borró. Encadenar es seguro sin migración porque los dos
backends ya rebotaban por su cuenta (`alreadyClosed`, `already_sealed`), y
nutrición corre primero para que un rebote del sello no se lleve puesto un
cierre que el usuario sí pidió.

**J3 — la vuelta.** A partir de dos días sin anotar nada, el tablero abre con un
bloque de regreso (`Dashboard.tsx:416-459`, lógica pura en
`src/hub/return-brief.ts`): cuántos días pasaron, qué pasó con la racha, qué
quedó vencido y **una** acción para retomar. La racha en cero se dice con "no
hay multa"; las vencidas, como "se posponen sin costo". Las ventanas
retroactivas por módulo siguen siendo cuatro y distintas.

**J4 — teléfono.** Todo lo nuevo tiene reglas bajo `[data-shell="mobile"]` con
blancos de 44 px, y de paso el botón de cerrar el día —que medía 37,5 px— llegó
al piso. Los dos bugs abiertos de QA 0.9.1 y la sync sin `appStateChange` siguen
como estaban: no se tocaron.

### 5.2 Puntuación

| # | Criterio | Baseline | Ahora | Evidencia |
|---|---|---|---|---|
| C1 | Primer valor | 4 | **5** | El muro del login sigue y es el techo; pero después el vacío ya no sólo enseña: crea (`Dashboard.tsx:483-498` → `quick-create.ts`). Primera misión en 1 clic + nombre |
| C2 | Costo en régimen | 4 | **7** | Repetir comida = 1 clic sin red desde el hub; "Repetir ayer" = 1 clic + confirmación. `frequent_foods` por fin se llena sola (`nutrition.ipc.ts:80-137`, 8 tests). El alta completa de Coinify sigue en 6 clics |
| C3 | Superficie de "hoy" | 5 | **7** | Un día completo se cierra desde el hub + el overlay del Códice; ya no hace falta pasar por `/nutrition`. Las 19 rutas y las 6 pestañas de Coinify siguen ahí para todo lo demás |
| C4 | Qué hago ahora | 5 | **7** | "Hoy" dejó de estar estructuralmente vacía (bucket sin fecha, `TodayView.tsx:198-225`); el cierre de nutrición ahora se anuncia porque viaja con la invitación al sello; el regreso propone una acción concreta |
| C5 | Vacíos que enseñan | 4 | **7** | Los 2 callejones sin salida del tablero crean de verdad; el aviso de Nutrify dice qué falta, es un botón y lleva al cálculo, y el anillo dejó de llenarse contra 2000 kcal inventadas. Los 5 vacíos de Coinify siguen sin CTA (los toma el rediseño en paralelo) |
| C6 | Recuperación | 5 | **7** | Existe el resumen de "qué pasó mientras no estuviste" (≥2 días, 8 tests). Falta la ventana retroactiva coherente entre módulos, que es lo que separa un 7 de un 9 |
| C7 | Un camino por concepto | 3 | **5** | Se eliminó el duplicado más caro: dos cierres de día que pagaban XP por separado. Siguen las 3 compuertas de perfil de nutrición, las 3 altas de cuotas de Coinify y `copyDay` vs `repeatDay` |
| C8 | Continuidad | 4 | **4** | Sin cambios de fondo. Lo nuevo respeta 44 px y no desborda a 390 px (11 suites móviles verdes), pero GEN-01, CAU-03 y el hook de ciclo de vida siguen abiertos |
| C9 | Canilla y desagüe | 3 | **6** | El agujero estructural se cerró: `rewards` arranca con tres premios borrables (core v8, ids deterministas y `updated_at` fijo para que el merge converja) y el saldo se ve donde se gana, con qué alcanza (`CodexSealModal.tsx:713-732`). **No es 8**: en la base real el ratio gastado/ganado sigue siendo 0 y sólo puede moverlo el uso |
| C10 | Invita, no castiga | 8 | **8** | Intacto, que era el objetivo. El bloque de regreso informa y no reprocha. Sigue faltando la gracia de 2 días para la racha |
| C11 | La metáfora | 6 | **6** | Los términos nuevos ("la bolsa", "el regreso", "la jornada de comidas", "sin fecha") se explican en su lugar y usan tokens existentes. `--ink-faded` 3.80:1 sobre `--parch-2` sigue sin resolverse |
| C12 | Defaults | 3 | **4** | `frequent_foods` guarda el último valor usado, que es el que el atajo ofrece; el formulario de misión sugiere hoy sin imponerlo. `paymentMethod='cash'` **no se tocó a propósito** (lo hace el rediseño de Coinify en paralelo); `account_id` NULL y la fecha de nacimiento fabricada siguen |

**Total: 73 / 120 · Promedio 6,1 / 10** (baseline 54 / 120 · 4,5).

### 5.3 Lo que quedó sin hacer, y por qué

- **Defaults de medio de pago (C12)** — excluido a propósito: lo cubre el
  rediseño de Coinify en otra rama y chocarían.
- **Modo local/invitado (C1)** — es el techo real de C1 y sigue siendo un
  cambio grande (`AuthContext`, `App.tsx`, `sync.ts`). No entró.
- **Ventana retroactiva coherente y gracia de 2 días (C6/C10)** — tocan el motor
  de rachas e indultos; es trabajo con riesgo de XP que merece su propia rama.
- **Los 5 vacíos de Coinify (C5)** y **las 3 altas de cuotas (C7)** — misma
  razón que el primer punto.
- **Ctrl+K para comida y gasto (C9 del informe original)** y **los dos bugs
  móviles abiertos (C8)** — no entraron en esta pasada.

---

## 6. Tercera medición (rama `feat/iteration-2`, sobre `release/0.9.5`)

Mismo método que las dos vueltas anteriores: los pasos se contaron leyendo los componentes, con
archivo:línea, y los números de la base salen de una **copia de solo lectura** de
`%APPDATA%\hubtify\hubtify.db` consultada sólo con agregados. Ningún dato personal salió de ahí.

Gates de la rama, corridos y verificados para este informe (no citados de segunda mano):
`npx tsc --noEmit` **0** · `npm run typecheck:shared-logic` **0** · `npm test` **1974/1974**
en 167 archivos (base `release/0.9.5`: 1868) · `npm run test:visual` **320/320** en 42 archivos
(base 217) · `npm run test:visual:mobile` **66/66** en 13 archivos (base 57).

> **Revisión del 2026-09-03, después de tres commits posteriores a la primera escritura de §6**
> (`90a0632` merge de `release/0.9.5`, `55aea72` el quick-add del hub, `528b294` los respaldos de
> i18n). Se reverificó todo en el código y se movieron **dos** filas: C7 6→7 y C12 6→7. **C2 y C11
> NO se movieron**, aunque los commits resolvieron el motivo que §6.2 daba para no subirlos: el
> motivo cambió de identidad, el puntaje no. Está explicado en cada fila y en §6.3.

### 6.0 Advertencia de método, otra vez

**La base real no se movió, y no podía moverse.** Los 17 commits de esta vuelta viven en una rama;
la app que el dueño usa sigue siendo la publicada. El último día con actividad en `rpg_events` es
`2026-09-02`, el mismo que en la segunda medición. Por eso, y hay que repetirlo porque es la
tentación más grande del ejercicio: **ningún criterio que la rúbrica define por una medición de la
base puede alcanzar su banda alta acá.** Lo que se puntúa es si el código todavía tiene el agujero
estructural que producía ese número. Donde la distinción decide el puntaje (C9, C12) está dicho en
la evidencia.

Y una corrección de método sobre las dos vueltas anteriores: **los conteos de §0 y §5.0 incluían
filas borradas.** Las tablas de Questify usan borrado suave (`deleted_at`), así que `COUNT(*)`
cuenta fantasmas. Reconsultado con `deleted_at IS NULL`, el retrato cambia bastante:

| Medida | Baseline | Segunda | Tercera (con `deleted_at IS NULL`) |
|---|---|---|---|
| Tareas totales / vivas | 68 | 68 | 68 / **37** |
| Tareas vivas sin `due_date` | 67 de 68 | igual | **36 de 37** |
| Tareas vivas con proyecto | — | — | **28 de 37** (Dardo 14 · Whatsnap 8 · Managea 3 · Hubtify 2 · Mudanza 1 · sin proyecto 9) |
| Tareas vivas por tier | 2→27 / 1→27 / 3→14 | igual | **1→16 · 2→14 · 3→7** |
| Hábitos totales / vivos | 23 | 23 | 23 / **3** |
| `times_per_week` de los hábitos | — | — | **1 en 18 · 7 en 3 · 3 en 2** |
| Óbolos ganados / gastados | 132 / 0 | 132 / 0 | **132 / 0** (105 de logros + 27 del sello) |
| `rewards` / `shop_purchases` | 0 / 0 | 0 / 0 | **0 / 0** |
| `favorite_foods` / `frequent_foods` | 0 / 0 | 0 / 0 | **0 / 0** |
| Sellos del Códice / cierres de Nutrify | 1 / 6 | 1 / 6 | **1 / 6** (el sello es del 2026-09-01) |
| Sesiones de Caldero / vinculadas a tarea | 41 / 0 | 41 / 0 | **41 / 0** |
| Última receta usada del Caldero | — | — | **`preset-classic`** (2026-09-01 22:51), no la propia (última: 2026-05-02) |
| Gastos manuales vivos, por medio de pago | «67 % transfer, 0 efectivo» | igual | **transfer 41 · credit_card 18 · debit 2 · cash 0** (de 61) |
| `account_id` en `finance_transactions` | NULL 107/107 | igual | **NULL 107/107** |
| Planes de cuotas manuales, por medio | — | — | **credit_card 3 · transfer 1 · debit 0** |
| Días con actividad en 5 meses | 14 | 14 | **14** |

Dos de esos números son la evidencia dura de dos criterios, y conviene leerlos antes de la tabla de
puntajes: **`cash` tiene CERO filas manuales vivas** de 61 (era el default del formulario), y
**`times_per_week` vale 7 en exactamente 3 hábitos de 23** — los tres que nacieron por el widget del
tablero mientras el formulario escribía 1. El bug de C7 no era latente: dejó cicatriz en la base.

### 6.1 Los journeys, recontados

#### J1 — Usuario nuevo, ahora con bifurcación

La primera compuerta dejó de ser un muro y pasó a ser una bifurcación. El portón hoy es
`App.tsx:127-137` — `if (!user && !guest)` — con `shellVisible` en `:101` y `/login` que ya no
redirige sin usuario (`:160`).

**Rama A, con cuenta:** igual que en las dos vueltas anteriores (3 campos + 1 clic).

**Rama B, invitado:**

1. **1 clic** en «Entrar sin cuenta» (`AuthPage.tsx:284`) → `enterGuestMode()` + `navigate('/')`
   (`App.tsx:60-63`). El botón dice la verdad y la dice entera: «Tus datos quedan solo en este
   dispositivo: sin respaldo en la nube ni sincronización con el teléfono. Podés vincular una
   cuenta cuando quieras y todo lo que cargaste se conserva» (`AuthPage.tsx:288`,
   `es.json:976-983`).
2. **1 clic** para saltear el onboarding, que sigue siendo compuerta obligatoria (`App.tsx:140`,
   salida en `Onboarding.tsx:246`).
3. **1 clic** en «Creá tu primera misión» (`Dashboard.tsx:477`) → `requestQuickCreate('quest')`
   (`quick-create.ts:17-19`) → el widget abre su formulario en línea y se trae a la vista
   (`TasksDashboardWidget.tsx:83-86`). Nombre + **Enter** (`WidgetQuickCreate.tsx:51`).
4. El XP no se paga al crear sino al completar: **1 clic** en el tilde
   (`TasksDashboardWidget.tsx:193` → `:123-140`, `processRpgEvent` en `:135-139`).

**Total sin cuenta: 4 clics + un nombre.** Contra los 4 campos de alta + 1-6 clics de onboarding +
9 clics + 3 campos de la baseline. La compuerta de Firebase, que era el techo declarado de C1 en
las dos mediciones anteriores, ya no existe.

Tres asteriscos honestos sobre esa rama:

- **El CTA de comida es peor en invitado que con cuenta.** `estimate-service.ts:80-82` tira
  `NoSessionError` antes de pegarle a la red; el widget deshabilita «Estimar»
  (`NutritionDashboardWidget.tsx:447`, título `nutrify.aiUnavailableShort` en `:448-449`) y empuja
  al alta manual (`:492`). Es la degradación correcta —antes reventaba con un error de red— pero
  son ~6 clics y 2 campos contra los 3 clics + texto de la rama con cuenta.
- **La tercera compuerta de perfil de Nutrify sigue en pie.** `Today.tsx:1202-1208` devuelve
  `<NutritionOnboarding>` y no renderiza nada más si no hay perfil, mientras el widget del tablero
  registra sin perfil sin problema (`NutritionDashboardWidget.tsx:329-345`). La ruta y el widget se
  siguen contradiciendo.
- **Y hay un caso borde que destruye datos y está vivo.** `Layout.tsx:536-540`:
  `if (lastUid && lastUid !== authUser.uid) await window.api.syncClearUserData();`, disparado sin
  condición al montar (`:555-557`). `Layout.tsx` no menciona `guest` en ninguna línea. Dispositivo
  con cuenta X → invitado → login con cuenta Y = se borra lo que el invitado cargó, sin aviso.

#### J2 — Día típico, antes → ahora

«Antes» es la segunda medición, no la baseline.

| Acción | Camino más corto | Antes | Ahora |
|---|---|---|---|
| Completar misión | tilde del widget (`TasksDashboardWidget.tsx:193`) | 1 clic | 1 clic |
| **Cargar gasto desde el hub** | quick-add del widget (`DashboardWidget.tsx:223-234`) | «2 clics + monto», con un dato falso | **2 clics + monto, y la fila sale bien** — `55aea72` cableó la inferencia acá también (`:98-121`, `:379`) |
| **Cargar gasto en Coinify** | el formulario ya está abierto (`Transactions.tsx:181`, `:735`) | 6 clics + 2 campos | **2 clics + monto** — medio, moneda, cuenta y categoría llegan inferidos (`QuickAddForm.tsx:106-130`) |
| **Crear misión por Ctrl+K** | paleta global (`Layout.tsx:357-359`, foco automático en `QuickAdd.tsx:106`) | 0 clics, misión **huérfana** | **0 clics, con proyecto y tier del historial** (`QuickAdd.tsx:97-98`, `:135`) |
| Repetir una comida | pastilla del widget | 1 clic, sin red | igual |
| **Arrancar el Caldero desde el hub** | «Quick Brew» (`CauldronDashboardWidget.tsx:229-238`) | 1 clic, siempre `presets[0]` | 1 clic, receta resuelta en el momento del clic (`:160-162`) y nombrada en el tooltip (`:233-235`) |
| Cerrar el día | el pie de Nutrify abre el Códice (`Today.tsx:1995-2014`) | 1 clic + 1,5 s de hold | igual |

**El renglón que importa es el segundo, y su historia vale más que su número.** Cuando §6 se
escribió, la inferencia de defaults existía, tenía cinco archivos de test, funcionaba — y **el
quick-add del tablero, que es el camino que J2 mide, no la llamaba**: `'cash'` a mano (0 de 61 filas
manuales vivas), `'Otros'` a mano, `'ARS'` a mano y un `<AccountSelect>` sin semilla, que sólo podía
caer en «Efectivo». El mismo gasto nacía con transferencia desde `/finance` y con efectivo desde el
hub.

`55aea72` lo cerró, y lo cerró con la misma disciplina y no con un parche: `DashboardWidget.tsx:98-121`
llama al mismo `finance:getEntryDefaults` con feature-detection del canal (`:101`), un `touched` por
control para que la inferencia no pise lo que el usuario ya eligió (`:53-55`, `:105`, `:111`,
`:118`), re-inferencia en `account:switched` (`:128-137`), la cuenta como **semilla** del
`AccountSelect` (`:117`, `:379`) y un select de moneda propio (`:334-337`), porque escribir dólares
desde un atajo que sólo muestra un «$» sería una fila que el usuario no ve. El respaldo pasó de
`'cash'` a `'transfer'` (`:44`). Lo demuestra
`tests/visual/entry-defaults-parity.browser.test.tsx:167` con un `expect(hub).toEqual(ledger)`, y el
mismo archivo deja escrita la divergencia previa —hub `{cash, Otros, ARS, cuenta genérica}` contra
libro mayor `{transfer, Comida, USD, a2}`— más dos casos que verifican que tocar el control gana
sobre la inferencia (`:187`, `:202`).

#### J3 — La vuelta (dos días afuera)

**Sin cambios de fondo, y hay que decirlo.** `src/hub/return-brief.ts`,
`shared-logic/modules/rpg-handlers.ts`, `shared/rpg-engine.ts`, `meal-utils.ts` y las cuatro
ventanas retroactivas (`nutrition.ipc.ts`, `quests.ipc.ts:829-833`, `rpg-engine.ts:152`, Caldero
sin ninguna) **no aparecen en el diff de esta rama**. El parte de regreso sigue existiendo y
sigue disparándose a los 2 días (`Dashboard.tsx:385`, `:409-448`), y las ventanas siguen siendo
cuatro y distintas.

Lo único que mejoró en el regreso es indirecto y no lo mide C6: **si el tablero falla al cargar,
ahora lo dice.** Antes, tres superficies mostraban «no tenés nada» cuando lo que había pasado era
una excepción — que para alguien que vuelve después de días es la peor mentira posible, porque
confirma su miedo. Hoy `HabitsDashboardWidget.tsx:120-128`, `AchievementsPage.tsx:193-200` y
`CauldronPage.tsx:783-797` renderizan `ErrorState` **antes** de la rama de vacío, y
`CauldronPage.tsx:260-271` se niega a declarar «cargado» si alguna consulta falló.

#### J4 — El mismo día, desde el teléfono

**Navegación: sin cambios.** Sigue el cajón sin barra inferior: 1 tap para abrir
(`MobileShell.tsx:115-124`), 1 tap en el ítem, que además cierra el cajón
(`:151-153`). **2 taps por cambio de módulo.** Búsqueda en todo el repo de `bottom-nav|BottomTab|
tabbar`: sólo pega en `Sidebar.tsx:120,375`, que es la *sección* inferior del menú, no pestañas.

**Sync: acá sí cambió todo.** El agujero era real y era de pérdida de datos: en el WebView de
Android, tapar la app con otra Activity no dispara `blur` ni `visibilitychange`, así que el push
quedaba colgado de un `setTimeout` de 30 s que muere con el proceso, y el pull al volver no ocurría
nunca.

- `native-shell.ts:42-44` engancha `App.addListener('appStateChange')` y emite
  `hubtify:appForeground` / `hubtify:appBackground` (`app-lifecycle-events.ts:16,19`). El
  `backButton` sigue en `:24-34`.
- `lifecycle-sync.ts:25-28` une `blur` + background y `focus` + foreground al **mismo** handler, así
  que el throttle y el orden pull→push no se duplican.
- `Layout.tsx:510` lo consume. Al irse al fondo: `:478` limpia el timer pendiente y `:481` empuja
  ya. Al volver: `:500` pull y `:502` push, en ese orden, con el throttle de 3 min de `:47`.
- El estado de la sync es visible por primera vez: store puro en `sync-status.ts:15-25` alimentado
  desde `sync.ts:120,267,273,284,291,430,437`, con `dirtyDuringSync` (`:45`, `:78-81`, `:86`) para
  que una edición a mitad de vuelo no se reporte como «sincronizado». Montado en la cabecera del
  teléfono (`MobileShell.tsx:130`) y arriba del contenido en escritorio (`Layout.tsx:635`).
- Paridad: el `catch` de «ya hay una poción al fuego» llamaba `cauldronOpenWindow?.()`, que en
  Android no existe (`platforms: 'desktop'`), y el `?.` se tragaba la llamada: no pasaba nada. Hoy
  `CauldronDashboardWidget.tsx:170-182` mantiene la ventana en escritorio y en el teléfono hace
  toast + navegación.

**Lo que sigue abierto en el teléfono:** los 2 taps; el debounce de 30 s en régimen
(`Layout.tsx:431`, sólo se saltea al ir al fondo); y los escalares (nivel, XP, racha) siguen siendo
LWW de documento entero (`sync.ts:297-306`), sin merge por campo.

**Y dos correcciones importantes a lo que §5.2 daba por abierto:** GEN-01 **ya estaba OK** en la
base — fila 25 de `2026-09-02-mobile-qa-0.9.1.md` lo marca `**OK**` con la traza del back-button
cerrando el `quest-row-menu` sin navegar. Lo que fallaba en esa corrida era **NUT-01 sub-caso (d)**
(`:23`), la fila de comida en edición, y su arreglo está en esta rama
(`FoodLogItem.tsx:130`, `usePopoverRegistration(editing, cancelEdit)`). NUT-03 también estaba
arreglado: `nutrition.ipc.ts:772` es exactamente el `metrics.steps != null` que el documento de QA
pedía, con `tests/modules/nutrition/daily-metrics-steps.test.ts` cubriendo `null`, `undefined`,
válido y los tres inválidos.

### 6.2 Puntuación

| # | Criterio | Base | 2ª | **3ª** | Evidencia dura |
|---|---|---|---|---|---|
| C1 | Primer valor | 4 | 5 | **7** | Cae el muro: `App.tsx:127-137` acepta invitado; primer registro **sin cuenta en 4 clics + un nombre** (`AuthPage.tsx:284` → `Dashboard.tsx:477` → `TasksDashboardWidget.tsx:193`). `tests/shared/guest-link.test.ts:99` prueba con SQLite en memoria y migraciones reales que el pull **fusiona** y la misión del invitado sobrevive. **No es 9**: la banda alta pide ≤3 interacciones y son 4-5; el onboarding sigue siendo compuerta (`App.tsx:140`); y `Layout.tsx:536-540` borra los datos del invitado si el dispositivo tenía otra cuenta |
| C2 | Costo en régimen | 4 | 7 | **8** | El alta completa de Coinify pasó de 6 clics + 2 campos a **2 clics + monto** (`QuickAddForm.tsx:106-130`, `:326-328`, `:421`); Ctrl+K pasó de crear una misión huérfana —que después había que arrastrar a un proyecto— a heredar proyecto y tier (`QuickAdd.tsx:97-98`); el Caldero arranca en 1 clic con la receta resuelta (`CauldronDashboardWidget.tsx:160-162`); y con `55aea72` el gasto desde el hub volvió a costar 2 clics + monto sin escribir un dato falso. **Sigue sin ser 9, con otro motivo que el que decía la primera escritura de §6.** Aquel motivo —4 clics en el tablero, 2 deshaciendo el default— está resuelto. El que queda es de fondo: la banda pide «≤2 interacciones para **repetir lo de ayer**», y en finanzas **no existe repetir lo de ayer**. Questify (tilde), Nutrify (pastilla + «repetir el día de ayer») y el Caldero lo cumplen; Coinify te hace retipear monto y descripción cada vez, y las 61 filas manuales vivas de la base son 61 tipeos |
| C3 | Superficie de "hoy" | 5 | 7 | **7** | **No se movió.** El único cambio con nombre de C3 en los commits (`c3db037`) es alineación: la tira de stats, las pestañas y la lista de «Hoy» compartían contenedor pero no medida, y a 1640 px la página tenía dos ejes con 312 px de desvío; ahora los tres toman la medida de la columna. Es densidad, no rutas. Siguen 19 rutas, siguen las pestañas de Coinify, y un día completo se sigue cerrando desde el hub + el Códice |
| C4 | Qué hago ahora | 5 | 7 | **8** | Tres cosas nuevas dicen la acción concreta donde antes no había nada: el esqueleto dice **qué forma** viene en vez de una brújula girando (`Skeleton.tsx:4-20`, `Dashboard.tsx`), cada ítem del menú dice **qué hace** en nombre accesible, `title` y tooltip (`Sidebar.tsx:345,346,365`) y en el teléfono como segundo renglón pintado (`layout.css:1093-1099`), y el error dejó de disfrazarse de vacío en 3 superficies (`HabitsDashboardWidget.tsx:120-128`, `AchievementsPage.tsx:193-200`, `CauldronPage.tsx:783-797`), más `DashboardWidgetWrapper` que aísla cada cuadro en su propio `ErrorBoundary`. Cuatro subtítulos ornamentales ahora dicen qué hace la página (`es.json:914,332,1727,1950`). **No es 9**: 11 de 32 vacíos siguen sin proponer nada |
| C5 | Vacíos que enseñan | 4 | 7 | **7** | **No se movió, y es el criterio con más commits de la vuelta.** Se arreglaron ~12 superficies (los 5 vacíos de la lista de Coinify, `TaskList.tsx:451-458` con `Sword` + botón que abre el alta, `AchievementsPage.tsx:244-255` con «Ver todos», Recompensas `:447-451`, `PotionShelf.tsx:137-143`, `MissionPicker.tsx:220-229`). Pero el censo completo, que ninguna medición anterior había hecho, da **32 vacíos: 21 con alguna acción (65,6 %) y sólo 12 que abren el formulario (37,5 %)**. La banda 6 es «40-75 %» y la banda 9 es «>90 %, y el CTA abre el formulario». El número está donde estaba: dentro de la banda de 6-7. El punto que sí se ganó —el error que mentía— está contado en C4, no acá |
| C6 | Recuperación | 5 | 7 | **7** | **Intacto.** `return-brief.ts`, `rpg-handlers.ts`, `meal-utils.ts` y las cuatro ventanas retroactivas no aparecen en el diff (`git diff cd905a5..HEAD`). Sigue faltando exactamente lo que separa un 7 de un 9: una ventana coherente entre módulos |
| C7 | Un camino por concepto | 3 | 5 | **7** | Se cerraron **dos** divergencias de banda 3 —«un mismo gesto produce filas distintas»—, no una. **La segunda es la más cara y la encontró esta misma medición**: el quick-add del hub y el libro mayor escribían la misma transacción con cuatro columnas distintas, y `55aea72` las igualó con un `expect(hub).toEqual(ledger)` de testigo (`entry-defaults-parity.browser.test.tsx:167`). La primera tiene **daño medido en la base**: `HabitsDashboardWidget.tsx:90` escribía `timesPerWeek: 7` y `HabitTracker.tsx:246` escribía 1 para el mismo gesto — y la base tiene 18 hábitos con 1 y **3 con 7**, que son los 3 que nacieron por el widget. Además la fila de misión ya no muestra dos cuadrados con tilde idénticos: cumplir es cuadrado, elegir es disco (`QuestRowActions.tsx:283-296`, `quests.css:355-391`). **No es 8** porque **siguen** las 3 compuertas de perfil (`Onboarding.tsx:138`, `Today.tsx:1202-1208`, `NutritionSettings.tsx:201`), `copyDay`/`repeatDay` (`nutrition.ipc.ts:361-380` vs `:382-392`) y sobre todo las 3 altas de cuotas, que no son «duplicadas pero equivalentes» (la banda 6) sino **divergentes**: `createThirdPartyPurchase` omite `account_id` y fuerza `credit_card` |
| C8 | Continuidad | 4 | 4 | **7** | El salto más grande de la vuelta, y era una pérdida de datos real: en Android tapar la app no dispara `blur`, así que el push moría con el proceso. Hoy `native-shell.ts:42-44` + `lifecycle-sync.ts:25-28` + `Layout.tsx:478,481,500,502`. La sync se ve por primera vez (`sync-status.ts` + `SyncStatusChip` en `MobileShell.tsx:130` y `Layout.tsx:635`), con `dirtyDuringSync` para no mentir. La paridad del Caldero se arregló (`CauldronDashboardWidget.tsx:170-182`). **No es 9**: la banda pide ≤5 s, paridad total y ≤1 tap — hay 30 s de debounce en régimen (`Layout.tsx:431`), 2 taps por módulo (`MobileShell.tsx:115-124,151-153`) y escalares LWW de documento entero (`sync.ts:297-306`) |
| C9 | Canilla y desagüe | 3 | 6 | **6** | **Intacto, como se esperaba.** El seed de 3 recompensas sigue en `migrate.ts:383-396` y la bolsa sigue visible en el sello. En la base real: 132 ganados (105 de logros + 27 del sello), **0 gastados**, `rewards` y `shop_purchases` vacías. Sólo lo mueve el uso, y §6.0 dice por qué no puede moverse acá |
| C10 | Invita, no castiga | 8 | 8 | **8** | **Intacto, que sigue siendo el objetivo.** Nada del motor de HP, XP, racha, indultos o Posada aparece en el diff. Le sigue faltando lo mismo: que la gracia cubra 2 días, que es el hueco real medido |
| C11 | La metáfora | 6 | 6 | **8** | Se rompió el empate de dos vueltas. Una palabra por concepto en i18n: **Vigor** (`es.json:346,854,2119,2121`, cero «SALUD» en ambos idiomas), **Hábito**, **Misión**. La función viaja en 4 canales por ítem de menú (`Sidebar.tsx:345,346,361,365`). Lo que sólo vivía en `title=` —que en touch no existe— se pintó: indultos con rótulo (`Sidebar.tsx:244-253`), la racha con su regla (`:282-284`, `es.json:2108`), el Vigor con un sello que abre **con foco** (`HelpBubble.tsx:87,91`), lo mismo en Maestrías (`CharacterPage.tsx:326-332`). `528b294` completó la limpieza en la tercera capa, la de los respaldos del TSX —lo que se ve si falta una clave—: «HP» suelto **0 en las tres capas** (sobreviven 7+7+3 dentro del par abreviado «XP y HP», exención documentada y de doble filo en el test), `SALUD`/`VITA` 0, `ritual` 0, `tarea`/`subtarea` 0 (la sub-unidad pasó a «paso»), y un par que nadie había visto: «Meta diaria» plegado a «objetivo diario». Vigilado por `tests/i18n/vocabulario-unico.test.ts` (20 casos sobre las 3 capas, con un test de arnés que impide el falso verde). **Sigue sin ser 9, y el motivo que queda es duro:** la banda pide contraste OK **sobre la superficie más oscura**, y `--ink-faded` sobre `--parch-3` da **3,43:1**. Además la cabecera del teléfono titula `/` como «Tabla del Aventurero» (`MobileShell.tsx:29,126`) mientras el menú dice «Inicio» (`es.json:1018`), y queda un «HP» suelto **fuera** del catálogo, en JSX a mano, que el test no puede ver (`Today.tsx:2403` — ver §6.4 #10) |
| C12 | Defaults | 3 | 4 | **7** | Tres servicios de inferencia reales, con SQL sobre filas vivas y 5 archivos de test: `quests-defaults.ts:56-64` (moda sobre las 30 misiones vivas más recientes, con abstención si el proyecto murió, `:73-77`), `cauldron-defaults.ts:38-44` (la **última** usada, que es la regla que converge entre dispositivos) y `finance-defaults.ts:178-187` (`GROUP BY installment_group_id`: cuenta **planes**, no filas). Contra la base: el respaldo de cuotas pasó de `'debit'` —que tiene **0 planes**— a `'credit_card'`, que tiene 3 de 4; el de gasto suelto pasó de `'cash'` —**0 de 61 filas manuales vivas**— a `'transfer'`, que tiene 41. Y con `55aea72` la inferencia por fin llega a **las dos puertas**, no a una: el agujero de J2 que justificaba el 6 está cerrado y medido (`DashboardWidget.tsx:98-121`, `:379`). **No es 8 ni 9**, y por dos motivos que ninguna rama puede tocar: `account_id` sigue NULL en **107/107** filas, así que la inferencia de cuenta no tiene de dónde sacar nada y devuelve `null` siempre, dejando el respaldo genérico «Efectivo» —la cuenta con 0 de 107—, que es literalmente el ancla de la banda 3; y la fecha de nacimiento se sigue fabricando. Además la banda 9 pide «el último valor usado» y quests y finanzas usan la **moda** (sólo el Caldero usa el último) |

**Total: 87 / 120 · Promedio 7,3 / 10.**
Baseline 54 / 120 (4,5) → segunda 73 / 120 (6,1) → **tercera 87 / 120 (7,3)**.

Los tres que más se movieron: **C8 +3** (4→7), **C11 +2** (6→8) y **C1 +2** (5→7).
Los cinco que no se movieron: **C3, C5, C6, C9 y C10**.
Y dos —**C2 y C11**— se quedaron donde estaban **aunque los commits de la revisión resolvieron el
motivo que esta tabla daba para no subirlos**. Está dicho en cada fila: el motivo cambió de
identidad, el puntaje no. Inventar el punto habría sido más fácil que explicarlo.

### 6.3 Lo que quedó sin hacer, y por qué

- **C5 no se movió, y es el que más trabajo se llevó.** Doce superficies mejoraron de verdad, pero
  el criterio se puntúa por porcentaje y el censo completo —el primero que se hace— da 65,6 % con
  acción y 37,5 % que abren el formulario. Para llegar a 9 hacen falta **20 superficies más** con
  un CTA que abra el formulario en el lugar: empezando por los 5 vacíos pelados del tablero de
  Coinify (`finance/Dashboard.tsx:1126-1130,1373-1375,1491-1495,1505-1507`,
  `CreditCards.tsx:162-166`) y los 3 que sólo navegan (`AchievementsPage.tsx:208`,
  `Transactions.tsx:887`, `NutritionDashboardWidget.tsx:340`).
- **C3 no se movió.** Cerrar un día sigue costando el hub + el overlay del Códice, que es lo que ya
  medía 7. Para llegar a 9 hay que decidir algo más grande: que la ruta `/nutrition` deje de ser
  necesaria del todo, o que el Códice absorba también el paso de Coinify.
- **C6 y C10 no se tocaron a propósito.** Las cuatro ventanas retroactivas y la gracia de 2 días
  tocan el motor de rachas e indultos: es trabajo con riesgo de XP y merece su propia rama con su
  propio arnés. Sigue siendo el mismo pendiente que en §5.3.
- **C9 no se tocó y no podía tocarse.** El agujero estructural ya se había cerrado en la vuelta
  anterior; lo que falta es uso, y el uso no ocurre en una rama.
- **Las 3 altas de cuotas (C7).** Existe el constructor compartido
  (`finance/utils/installment-payload.ts:91-107`) y **sólo 1 de los 3 llamadores lo usa**
  (`Transactions.tsx:387-390`). `InstallmentAddForm.tsx:136-153` arma el payload a mano y
  `Loans.tsx:164-175` va a otro handler entero.
- **Las 3 compuertas de perfil de nutrición (C7/C1).** Sigue en pie el muro de
  `Today.tsx:1202-1208`, contradicho por el widget que registra sin perfil.
- **Los 2 taps del cajón (C8).** Es una decisión de diseño registrada
  (`2026-09-01-mobile-android-design.md:238`), no un olvido: para moverla hay que reabrir esa
  decisión, no escribir código.
- **El techo de C12 no está en el código.** Con la inferencia ya cableada en las dos puertas, lo
  que queda son dos cosas que ninguna rama puede arreglar: `account_id` es NULL en 107/107 filas
  —así que la inferencia de cuenta no tiene historial que leer y el respaldo cae en «Efectivo», la
  cuenta con 0 filas— y la fecha de nacimiento se sigue fabricando en el picker. La primera se
  arregla sola en cuanto una transacción nazca con cuenta; la segunda es una línea que nadie
  escribió.
- **El «HP» de `Today.tsx:2403` (C11).** Es una línea y no entró: hay que envolverla en `t()` para
  que el arnés de vocabulario pueda verla. Mientras siga en JSX pelado, el test seguirá verde y la
  palabra seguirá en pantalla.

**Lo que empeoró, y se corrigió en la misma vuelta.** Queda escrito porque el ciclo importa más que
el resultado. La rama había arreglado el default del medio de pago en el formulario de Coinify y
**no en el camino que este mismo informe usa para medir el día típico**. Hasta entonces «el default
es `cash`» era una falla pareja: fea, pero igual en todos lados. Por unas horas fue una
**inconsistencia** —el mismo gasto salía con transferencia desde `/finance` y con efectivo desde el
tablero—, que es peor que el bug original, porque convierte un default equivocado en dos verdades
distintas para el mismo gesto: exactamente lo que C7 llama falla estructural. `55aea72` lo cerró
llamando al mismo canal con la misma disciplina y dejando un test de paridad de testigo. Es el único
renglón de esta medición que fue de 3 a 7 dentro de la misma iteración.

**Y una advertencia que sigue viva.** Ese arreglo lo encontró una medición, no un test: durante
todo el tiempo que las dos puertas escribieron filas distintas, `npm test` estuvo en verde. Hoy hay
un test que lo cubre (`entry-defaults-parity.browser.test.tsx`) — pero es **el único** par de puertas
del repo que tiene uno. Las 3 altas de cuotas no lo tienen, y ahí la divergencia sigue.

### 6.4 Hallazgos nuevos

1. ~~**La rama está 4 commits atrás de `release/0.9.5`**~~ — **RESUELTO por `90a0632`.**
   `git merge-base --is-ancestor release/0.9.5 HEAD` ahora dice sí, y están
   `usePrefersReducedMotion.ts`, `platform-detect.ts` y el `CauldronSVG` que apaga los 20
   `<animate>` SMIL. Se deja anotado porque el hallazgo era real: la rama se midió contra una base
   de la que estaba desprendida, y eso pudo haber publicado un regreso del crash. **No suma puntos
   en C8**: ese arreglo ya vivía en `release/0.9.5`, o sea en la base contra la que se mide esta
   iteración; lo que pasó es que la rama se puso al día consigo misma. Corrección aparte, que sí
   vale: **CAU-03 ya no está «sin causa»** —es el rasterizador por software del host, no un teléfono
   de verdad— así que §5.2 y el encargo de esta vuelta lo listaban mal.
2. **Cuatro citas de este mismo documento ya no apuntan a nada.** `Today.tsx:1015` (§2 J4) hoy es
   `setWeightPopup({ show: false })`; `nutrition.ipc.ts:663` hoy es un `ORDER BY` dentro de
   `nutrition:getUserCorrections`; `finance.ipc.ts:1058` (§3 C7) hoy está dentro de
   `finance:markStatementPaid`. El formulario de cierre de día **migró entero al Códice**:
   `src/hub/codex/nutritionClose.ts:28-34` (`parseSteps`) y `:78`; una búsqueda de
   `nutritionSaveDailyMetrics` bajo `src/modules/nutrition/` no devuelve nada.
3. **El `--ink-faded` a 3,80:1 es un número muerto desde antes de la segunda medición.** Hoy
   `theme.css:47` vale `#5a4428` y sobre `--parch-2` (`#d4bc82`) da **4,94:1**, que pasa AA.
   `git diff release/0.9.5..HEAD -- src/hub/styles/theme.css` está **vacío**: el arreglo entró antes
   de 0.9.5, en `feat/design-improvements`. §5.2 lo listó como pendiente y ya no lo era. Lo que sí
   falla es sobre `--parch-3` (`#b89a6a`): **3,43:1**, y por eso C11 no llega a 9.
4. **La divergencia real de las cuotas no es la que decía §3.** No es `finance.ipc.ts:1058`, es
   `finance:createInstallmentGroup` (`:1233-1240`) contra `finance:createThirdPartyPurchase`
   (`:1492-1498`): el segundo **omite la columna `account_id`** y fuerza
   `payment_method = 'credit_card'` y `for_third_party = 1` sin mirar lo que el usuario eligió. El
   mismo objeto conceptual —una compra en cuotas— aterriza en `finance_transactions` con juegos de
   columnas distintos según la pantalla.
5. **La afirmación «los 5 vacíos de Coinify siguen sin CTA» (§5.2 C5) ya no se sostiene, y a la vez
   había 5 más que nadie contó.** Los cinco de las listas se arreglaron esta vuelta (4 de ellos
   abren un formulario). Los que quedan pelados son otros: los tiles del tablero de Coinify
   (`finance/Dashboard.tsx:1126-1130,1373-1375,1491-1495,1505-1507`) y `CreditCards.tsx:162-166`.
6. **El Caldero: la regla es la correcta y en esta base no cambia nada.** El argumento de la
   ejecución fue «30 de 41 sesiones son de una receta propia, `p[0]` era siempre Classic». Es verdad
   como **moda** y falso como **última usada**: las 30 sesiones de la receta propia —que se llama
   `test`— son todas del 2026-05-02, y la última sesión de la base (2026-09-01 22:51) es de
   `preset-classic`. La regla implementada (`cauldron-defaults.ts:38-44`) es la mejor de las dos
   porque converge entre dispositivos, pero **en la base del dueño devuelve exactamente lo que
   devolvía `presets[0]`**. Además `resolveDefaultPresetId` (`hooks.ts:59-75`) pone `localStorage`
   por encima del historial, y `quickStartPresetId` (`hooks.ts:39-42`, usado en
   `QuestRowActions.tsx:103`) sigue cayendo en `presets[0]` sin consultar nada.
7. **`clearsLocalDataOnLink()` no lo importa nadie en `src/`.** `guest.ts:79` es un espejo copiado a
   mano del guard de `Layout.tsx:536-540`, sin ningún vínculo en tiempo de compilación. Las tres
   citas que los atan ya están corridas: `guest.ts:71` y `guest-link.test.ts:142` dicen
   `Layout.tsx:531-533`, `guest-link.test.ts:16` dice `:529-533`, y el bloque real vive en
   `:536-540`. El día que alguien mueva ese `if`, el espejo miente en silencio.
8. **El test que documenta la pérdida de datos la congela.** `guest-link.test.ts:150-161` afirma
   `expect(names(db)).toEqual([])` con el comentario «comportamiento ACTUAL, no deseado». Está bien
   documentado, pero es un test **verde** sobre una pérdida de datos: dentro de tres meses se lee
   como «esto está cubierto».
9. **El botón de vincular cuenta no dice «Vincular cuenta».** `PlayerCard.tsx:175-180` lo pone en
   `aria-label` y `title`; lo que ve alguien que mira la pantalla es «Solo en este dispositivo»
   (`:155`) y un ícono de persona.
10. **Los ~10 fallbacks con vocabulario viejo: resueltos por `528b294`, con dos colas.** Verificados
    uno por uno: `Dashboard.tsx:481` dice «Creá tu primer **hábito**», `:556` «**VIGOR**»,
    `widget-registry.ts:53` «**Hábitos** Diarios», `CharacterPage.tsx:421` «**VIGOR MÁX**». El censo
    de las tres capas da 0 en las seis familias de palabras. Las dos colas:
    **(a)** `CodexSealModal.tsx:702` sigue diciendo «estampar el **lacre**» — fuera del alcance de ese
    commit, que se ocupó de seis conceptos y no del vocabulario del sello, pero es el mismo tipo de
    deuda y ahora es la única que queda.
    **(b) El test tiene un punto ciego que deja vivo el «HP» más visible de todos.**
    `vocabulario-unico.test.ts` extrae el segundo argumento literal de `t('clave', 'respaldo')`; el
    texto en JSX que no pasa por `t()` le es invisible. Y `Today.tsx:2403` renderiza
    `{data.hpChange} HP` **a mano, sin traducir, suelto** —no dentro del par «XP y HP»— dos líneas
    arriba de un `t('nutrify.hpExplanation', 'Vigor según…')`. O sea: el catálogo está limpio, el
    arnés está verde, y la palabra que el criterio quería sacar se sigue pintando en la pantalla de
    cierre de Nutrify. La capa que el test mide («respaldos») y la capa que importa («español
    visible») no son el mismo conjunto.
11. **La regla de la racha se esconde en pantallas bajas.** `layout.css:741-743` oculta
    `.sidebar-streak__rule` con `@media (max-height: 780px)` en escritorio, donde vuelve a depender
    de `title=` — que es justo lo que este commit se propuso eliminar. En el teléfono
    (`layout.css:1089-1091`) se reimpone.
12. **Los conteos de §0 y §5.0 mezclaban filas borradas con vivas.** No es un error del análisis
    original —`COUNT(*)` es lo natural— pero cambia el retrato: 37 misiones vivas de 68, **3 hábitos
    vivos de 23**, y la distribución de tiers se da vuelta (1→16 · 2→14 · 3→7, contra el
    2→27 · 1→27 · 3→14 que decía §0). Cualquier medición futura tiene que filtrar por
    `deleted_at IS NULL`.
