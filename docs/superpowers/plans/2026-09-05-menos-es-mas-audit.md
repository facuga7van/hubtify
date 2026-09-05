# Auditoría "menos es más" — 2026-09-05

Cuatro auditorías paralelas sobre v0.9.9: densidad de UI y burbujas de ayuda, Coinify (matching e integridad), Caldero ↔ misión, Nutrify ↔ hábito de gimnasio. Todo verificado en código; los bugs de Coinify se reprodujeron con tests temporales.

## 1. Coinify

### 1.1 Cómo matchea hoy el import de resumen (`shared-logic/modules/finance-import.ipc.ts:460-466`)

```sql
COUNT(*) FROM finance_transactions
WHERE deleted_at IS NULL AND source = 'import'
  AND date = ? AND description = ? AND amount = ? AND currency = ?
  AND installment_number IS ?
  AND (import_batch_id IS NULL OR import_batch_id <> ?)
```

Igualdad estricta en 5 campos. Sin tolerancia de fecha ni monto, sin normalizar descripción, y **solo contra filas `source='import'`**. Para cuotas: identidad de plan = `description + currency + total_installments + fecha compra + tarjeta`; si el plan existe y tiene esa `installment_number`, se **pisa** la fila proyectada (`materialise`, `:509-515, 559-571`).

### 1.2 Bugs verificados

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| C1 | Alta | Cuotas importadas quedan con `date` = fecha de compra; toda la app filtra por `date`, así que la pestaña Cuotas, planes activos, proyección y próximas batallas las apilan en el mes de compra. `finance-import.installments.test.ts:189` lo consagra. | `finance-import.ipc.ts:564,588-598`; `finance.ipc.ts:1158,1110,1172`; `finance.balance.ts:1462` |
| C2 | Alta | Editar cualquier campo de una compra con tarjeta desde Movimientos manda `paymentMethod` sin `creditCardId` → `credit_card_id = NULL` con `impacts_balance = 0`. La fila sale del resumen y nunca entra al balance. | `Transactions.tsx:516`; `finance.ipc.ts:293-295` |
| C3 | Alta | Dos compras distintas mismo comercio, misma fecha, mismas N cuotas, distinto monto, en un PDF: `materialise` pisa la primera. Medido: total 30.000 en vez de 90.000. | `finance-import.ipc.ts:555-571` |
| C4 | Alta | Dos líneas de cuota idénticas (dos unidades) colapsan en una. El comentario `:458-459` promete lo contrario. | `:559-571` |
| C5 | Alta | Nunca matchea contra altas manuales. Cargar a mano e importar después (flujo que sugiere `CoinifyStart.tsx:65`) duplica. | `:462` |
| C6 | Alta | Import sin tarjeta de cuota N/M proyecta desde `row.date` (compra), no desde `statementMonth`: escribe gastos con `impacts_balance=1` en meses pasados. | `:620-621` |
| C7 | Alta | `saveStatementPaper` pisa `closing_day` con el cierre del papel; si el banco corre el cierre por feriado, compras ya pagadas caen al período siguiente (medido: doble conteo). | `finance.ipc.ts:952-954,707` |
| C8 | Media | Generar un resumen pendiente ya descuenta del balance (`impacts_balance=1` al generar, no al pagar). Contradice `finance.balance.ts:364-365`. | `finance.ipc.ts:787` |
| C9 | Media | `payStatement` fecha el pago en `{period}-01`: la cuenta ve el pago un mes antes. | `:775,1046-1060` |
| C10 | Media | Editar descripción/categoría de una fila importada, o borrarla, rompe la clave: reimportar duplica o resucita. | `finance-import.ipc.ts:463` |
| C11 | Baja | `materialise` pisa `category` corregida a mano. | `:511,564` |
| C12 | Baja | `settleLoan` y `updateRecurringAmount` usan UTC (`now.slice(0,10)`); resto usa `todayDateString()`. | `finance.ipc.ts:1389,1696` |
| C13 | Baja | `exportCsv` cuenta doble compras con tarjeta + Pago Tarjeta. | `:1940-1945` |
| C14 | Baja | "10 de 1 vigentes": `row_count` vs `liveCount` mezclan filas del PDF con proyectadas. | `:520,702`; `Import.tsx:850` |
| C15 | Baja | `pickLikelyCard` cae a `cards[0]` en silencio. | `Import.tsx:56` |
| C16 | Baja | Select de categoría del import usa la constante `CATEGORIES`, no `finance_categories`. | `Import.tsx:629`; `TableImport.tsx:293` |

Sin tests para: C1, C3, C4, C5, C6, C10.

### 1.3 Código muerto (verificado con rg)

- Handlers sin llamador: `finance:getLoansByPerson` (`finance.ipc.ts:1333`), `finance:deleteLoanPayment` (`:1442`), `finance:getPreviousMonthSummary` (`:1920`), `finance:getTodayTransactionsCount` (`:1086`).
- `finance:getMonthlyTotal` se llama y se descarta (`DashboardWidget.tsx:63-66`). `transactionCount` de `getInstallmentGroups` no lo lee nadie.
- `api-ext.ts` entero (~300 líneas de feature-detection para canales que ya están en `api-channels.ts:207-298`).
- `finance_income_sources` migrada a `finance_recurring` en v3, se sigue sincronizando (`sync.ipc.ts:276`).
- Préstamos: `finance_loans` vacía en producción (`Commitments.tsx:12`), y no tocan balance ni cuentas.

### 1.4 Redundancia de UI en Coinify

- Tres accesos al importador (header, botón Movimientos, botón Recurrentes → redirección).
- Tres formularios para crear un gasto (widget hub, QuickAddForm, botones Panel) y tres caminos para un plan de cuotas con payloads distintos.
- Panel: "Total en cuentas" dos veces (`Dashboard.tsx:1117,1141`); toggle "Comparar con mes anterior" repite la línea de tendencia (`:1225-1253` vs `:1045-1083`); desglose bajo la card duplica la rueda (`:1188-1216`); "Alianzas y Deudas" sobre tabla vacía (`:1395-1438`).
- Movimientos: `showForm=true` por defecto (`Transactions.tsx:181`); sección Recurrentes (`:869-894`) ya vive en Compromisos.
- Cuotas: mismo Gauge "3/12" dos veces por grupo (`Installments.tsx:249,288`) y contador textual dos veces (`:252,279`). Proyección a 12 meses vs 3 del Panel.
- Tarjetas muestra rango `cierre+1 → cierre` que no aplica a filas importadas.

## 2. Burbujas de ayuda y densidad

### 2.1 Diagnóstico técnico

Tres motores para lo mismo: `HelpBubble.tsx` (55 instancias en 20 archivos), `Tooltip.tsx`, `useAnchoredPopup.ts` (el más maduro, HelpBubble no lo usa). Más 256 `title=` nativos.

El mensaje del HelpBubble va por portal `position:fixed`, **no empuja contenido**. Lo que rompe:

1. Variante `sealed` es `position:absolute; top:6px; right:6px` (`help-bubble.css:8-9,39`) y exige padre posicionado. En `CauldronPage.tsx:1380` ni `.cauldron-modal-head` ni `.cauldron-modal` tienen `position`: el sello se dibuja en la esquina de la PANTALLA. En `Dashboard.tsx:611/660` queda a caballo del `border-bottom` del título.
2. Variante `inline`: caja 18px + `top:-1px` + `margin-right:7px` dentro de rótulos de 13px → la fila con sello queda ~5px más alta que sus hermanas (`Today.tsx:1352-1363`). El `::after` de 32px infla `scrollWidth` (documentado como costo conocido en `help-bubble.css:129-133` y `layout.css:339-346`). `Import.tsx:495` con `float:right` envuelve el `<h2>`.
3. Salto en primer frame: el tip se monta sin `top/left` y `positionTip` corre dos rAF después (`HelpBubble.tsx:71-74,95-99`) mientras ya corre el fade-in. `Tooltip.tsx:64-67` y `useAnchoredPopup.ts:58` lo evitan.
4. Toggle de Ajustes desmonta el trigger → reflow de todas las cabeceras. `HelpBubble.tsx:69` y `:78` son el mismo check duplicado.
5. Touch: abre solo por hover/focus, sin click, sin Escape.

### 2.2 Densidad por pantalla (lo más prescindible)

| Pantalla | Ayuda | Prescindible |
|---|---|---|
| Hub | 2 HB + 4 Tooltip | 4 cartouches NIVEL/XP/RACHA/VIGOR repiten la sidebar (`Dashboard.tsx:553-556`); epígrafe + nota marginal; form de 6 campos en widget finanzas |
| Questify Hoy | 4 HB | stats strip (`TaskList.tsx:584-589`); 4 HB son onboarding fijo; frases rotativas |
| Coinify | 5+1+6 HB | ver 1.4 |
| Nutrify Hoy | 8 HB + 15 title | fila "Progreso %" duplica el anillo; "Repetir ayer" como card; badge "Al instante" |
| Nutrify Gráficos | 7 HB | KPI "Días logueados" = heatmap; archivo de semanas siempre listado |
| Nutrify Ajustes | 5 HB | TDEE mostrado 3 veces; card para un checkbox |
| Caldero | 5 HB + 14 title | "Weekly Focus" es la 3ª repetición del dato semanal; FloatingTimer sobre su propia página en desktop |
| Personaje | 6 HB + 14 Tooltip | barras HP/XP = sidebar; nivel 3 veces; 3 sellos repiten Libro de Hechos |
| Ajustes | 0 | Changelog vs Notas del parche; Reiniciar Tour vs Repetir intro |
| Sidebar | 1 | regla de racha en prosa (`Sidebar.tsx:290-292`); "N niveles para X" (`:225-231`) |

Tour actual (`tourSteps.ts:10-24`): 13 pasos, un one-liner por módulo. No cubre ningún concepto; eso lo cargan los 55 HB.

## 3. Caldero ↔ misión

Funciona y está cubierto (120/120 con `ELECTRON_RUN_AS_NODE=1 electron vitest --project unit`; con `npx vitest` directo falla por ABI de better-sqlite3, es entorno). `task_id` en `cauldron_sessions`, en `USER_DATA_TABLES`, sobrevive pausa/reinicio.

| # | Sev | Hallazgo | Evidencia |
|---|---|---|---|
| K1 | Media | Tras "Completar misión" no se limpia el vínculo: botón sigue visible, segundo click falla, próximo enfoque nace etiquetado con tarea cerrada. `readTaskMeta` no mira `status`. | `CauldronPage.tsx:451-501`; `cauldron.ipc.ts:189,514` |
| K2 | Media | "Enfocar en el Caldero" desde Questify en `awaiting_next` re-etiqueta el frasco que YA terminó. | `cauldron.ipc.ts:994-1005` |
| K3 | Baja | Toast "Misión enlazada" falso si `startBrew` falla por otro motivo. | `QuestRowActions.tsx:105-114` |
| K4 | Baja | Picker no escucha `quests:dataChanged` ni `sync:questsUpdated`. | `MissionPicker.tsx:66-72` |
| K5 | Baja | `handlePickMission` sin catch. | `CauldronPage.tsx:434-441` |
| K6 | Baja | `api.ts:4-24` y `isTaskLinkWired()` son andamiaje muerto. | `api.ts` |

UX: trigger es texto itálico `--ink-faded` con subrayado punteado, única afordancia (`cauldron.css:1082-1094`). Sin grupo "para hoy" en el picker. Banner "Retomar", widget y notificación Android no muestran la misión. Chip flotante y PiP no dejan cambiarla. Sin XP extra por misión.

## 4. Nutrify ↔ hábito de gimnasio

La checkbox "Gimnasio" del sello del Códice (`CodexSealModal.tsx:541-566`) es una métrica interna de Nutrify. Guarda en `nutrition_daily_metrics.gym` (sincronizada), da +5 XP (`nutrition.ipc.ts:1153`), no toca HP, y alimenta `getDynamicActivityFactor` (`:1488-1524`, 14 días, 60% dinámico / 40% perfil) que ajusta el TDEE de los días siguientes.

**Acoplamiento con hábitos de Questify: ninguno.** Los hábitos no tienen tipo ni categoría; el nombre es texto libre. Se pide el mismo dato dos veces.

Colateral: `nutrition_profile.gym_calories` y `step_calories_factor` son columnas muertas que `saveProfile` resetea; i18n `gymCalories`, `gymCaloriesHint`, `exerciseConfig` huérfanas.

## 5. Propuestas

### P1. Integridad de Coinify (antes que cualquier feature)

Orden: C1 + C2 (pérdida silenciosa en uso normal), C3/C4/C5 (import), C7/C8/C9 (contabilidad del resumen), resto. Cada uno con test que falle primero. Borrar el código muerto de 1.3.

### P2. Revisión de coincidencias estilo Google Fotos

Reemplazar el `COUNT(*)` estricto por un matcher de tres niveles que compare contra TODAS las transacciones vivas del período (manuales incluidas):

- **Idéntica**: mismos 5 campos → se omite sin preguntar (hoy).
- **Probable**: mismo monto y moneda, fecha ±3 días, y (descripción normalizada similar O misma tarjeta O mismo `installment_number`) → va a la bandeja.
- **Nueva**: se inserta.

Bandeja "¿Son el mismo gasto?": dos cards enfrentadas (la del resumen y la de la app) con fecha, monto, descripción, categoría, origen; botones **Mismo** / **Distintos** / **Después**. "Mismo" enlaza la manual al lote (`import_batch_id`, `statement_period`, `credit_card_id`) en vez de insertar. La decisión se persiste en `finance_import_matches (batch_id, row_key, tx_id, decision)` (→ `USER_DATA_TABLES`) para no volver a preguntar al reimportar. Para C3/C4: dos líneas idénticas en un mismo PDF son siempre dos filas, nunca se fusionan dentro del mismo lote.

### P3. Un solo motor de ayuda, y podar

- HelpBubble y Tooltip sobre `useAnchoredPopup` + `popover="manual"` (top layer nativo, Chromium ≥114 cubre Electron 41 y WebView 124). Trigger siempre en flujo, `inline-flex` 24px, sin `::after`, sin variante absoluta. Hover + focus + click toggle; Escape cierra.
- De 55 burbujas a ~10: quedan solo las que explican una REGLA no obvia (Vigor, indultos, cuotas propias/terceros, cierre del día, nominal/real). Las de "qué es esta sección" pasan a mini-tours de 3 pasos por módulo en la primera visita a la ruta.
- Fuente única de nivel/XP/vigor/racha: la sidebar. Sacar cartouches del Hub y barras de Personaje.
- Coinify: `showForm=false` en Movimientos, un solo acceso al importador, un Gauge por grupo de cuotas, toggle "Comparar" y desglose bajo la card fuera, Préstamos oculto hasta que exista un préstamo.
- Nutrify Hoy: fuera fila "Progreso %", "Repetir ayer" al menú, TDEE una sola vez en Ajustes.
- Caldero: fuera "Weekly Focus", FloatingTimer oculto sobre su página también en desktop.
- Ajustes: fusionar Changelog/Notas y Reiniciar tour/Repetir intro.

### P4. Caldero

K1 y K2 primero (con test "tras completar, el siguiente enfoque nace sin misión" y `setSessionTask({ scope: 'next' })`). Luego: grupo "Para hoy" arriba del picker (sort por `dueDate`, cero backend), recarga por `quests:dataChanged`, misión en banner "Retomar" y en widget, runa "al fuego" en la fila de Questify de la tarea vinculada. Borrar `isTaskLinkWired`.

### P5. Gimnasio: el hábito es la fuente

Opción recomendada: en Nutrify Ajustes, "¿Qué hábito es tu entrenamiento?" (select de hábitos de Questify) → `nutrition_profile.gym_habit_id`. Con hábito vinculado: la checkbox del Códice desaparece y se muestra "Entrenaste hoy (hábito X)" de solo lectura; `HABIT_CHECKED`/`UNCHECKED` de ese hábito hace upsert en `nutrition_daily_metrics.gym`; `xpGym = 0` (el hábito ya paga). Sin hábito vinculado, todo sigue igual.

Alternativa más general: `habits.kind` ('exercise' | 'sleep' | 'reading' | …) para que cualquier módulo consuma hábitos sin hardcodear. Más grande; queda para después.

Limpieza: borrar `gym_calories`, `step_calories_factor` y las 3 claves i18n huérfanas.

## 6. Ideas nuevas

1. **Bandeja post-import unificada** en Coinify: coincidencias dudosas + categorías sin asignar + tarjeta detectada, en un solo paso después de importar. Hoy cada cosa vive en un lugar distinto.
2. **Progressive disclosure** como regla de diseño: cada pantalla arranca con lo esencial y un "ver más" por sección, en vez de todo desplegado.
3. **Cuotas por mes de facturación**: una vez arreglado C1, la pestaña Cuotas puede agrupar por `statement_period` y mostrar "vence en el resumen de octubre", que es como piensa el usuario.
4. **Hábitos tipados** (ver P5 alternativa) como puente general entre módulos: ejercicio → Nutrify, sueño → futuro Vigor, lectura → Questify XP.
5. **Alerta de cierre corrido**: si el papel trae un `closing_day` distinto al configurado, preguntar en vez de pisar (evita C7).
