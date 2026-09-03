# Coinify — rediseño: del cuaderno al resumen

**Fecha:** 2026-09-03 · **Rama:** `feat/coinify-redesign` (sobre `fix/coinify-data-bugs`)
**Insumos:** `2026-09-03-coinify-audit.md`, `2026-09-03-finance-apps-research.md`,
`2026-09-03-pdf-import-potential.md`, y los 5 resúmenes reales del usuario (`docsexample/`, gitignoreado).

> Este documento no contiene ningún monto, comercio, saldo ni número de tarjeta real.

---

## 0. La tesis, verificada

> Hoy Coinify te pide **anotar** lo que gastaste; debería mostrarte **lo que ya pasó** para que
> confirmes. El resumen es el punto de entrada, no una pestaña más.

La validé contra los insumos y contra los PDFs. **Se sostiene, y más fuerte de lo que decía el
enunciado.** Las tres mediciones que la confirman:

1. **La conciliación del resumen cierra exacto.** Con los dos documentos distintos que hay en
   `docsexample/`, en las dos monedas, a 6 decimales:

   ```
   Σ(filas parseadas)  ===  TOTAL A PAGAR − SALDO ANTERIOR − SU PAGO
   ```

   Diferencia medida: `0` en ARS en los dos documentos, `0` en USD en el primero. En el segundo el
   checksum en USD **no cerró** — y la diferencia era exactamente una fila que el parser estaba
   perdiendo (§2.1). O sea: el checksum no es decorativo, encontró un bug real la primera vez que
   se corrió.

2. **Todo lo que hoy se tipea está impreso en el papel.** Cierre, vencimiento, período, últimos 4
   de la tarjeta, total a pagar, pago mínimo, límites, saldo anterior, lo que pagaste el mes
   pasado y la tabla de cuotas a vencer de 6 meses: **los 11 campos se extrajeron de los dos
   documentos, sin excepción**.

3. **El default de la app es el caso que nunca pasa.** 0 filas de efectivo cargadas a mano contra
   41 por transferencia, y el formulario arranca en efectivo.

**Lo único donde la tesis se queda corta**, y por eso el alcance es más grande que "arreglar el
import": el 67% de lo que el usuario tipea a mano **no está en ningún PDF de tarjeta** — son
transferencias y billeteras. Importar el resumen resuelve el setup (140 interacciones) y las
cuotas, pero **no toca las 180 interacciones mensuales de régimen**. Por eso el rediseño incluye
también un importador de tabla delimitada (§5): sin él, "un orden de magnitud menos" es imposible
de alcanzar y el número quedaría maquillado.

---

## 1. Qué se va, qué queda, qué nace

### Estructura de navegación: 6 pestañas → 3

| Antes | Después | Por qué |
|---|---|---|
| Panel | **Panel** | queda igual |
| Transacciones | **Movimientos** | queda; es el libro mayor |
| Cuotas | Compromisos › Cuotas | |
| Recurrentes | Compromisos › Recurrentes | |
| Tarjetas | Compromisos › Tarjetas | |
| Préstamos | Compromisos › Préstamos (último) | tabla vacía en la base real: nunca se usó |
| *(Importar: sin entrada en el nav)* | **Botón primario en la cabecera del Tomo** | es el camino principal, no un modal escondido |
| *(Cuentas: solo por el dibujo del cofre)* | idem + link desde el Panel vacío | fuera de alcance mover el ABM |

**Compromisos** es una pantalla nueva (`/finance/commitments`) con sub-navegación segmentada que
monta los componentes que ya existían, sin reescribirlos. Las cuatro cosas que agrupa responden la
misma pregunta —*¿qué plata ya está comprometida?*— y son justo las cuatro que el usuario casi no
toca. Las rutas viejas (`/finance/installments`, `/recurring`, `/cards`, `/loans`) siguen vivas
como `<Navigate replace>`: ningún link, ningún paso del tour y ningún deep-link se rompe.

**Nada se borra.** Ni una tabla, ni un handler, ni una ruta. Lo que "muere" muere como pestaña de
primer nivel, no como funcionalidad — el precedente de las 12 filas huérfanas
(`2026-09-03-coinify-orphan-installments.md`) vale igual acá: no destruir lo que no se puede
reconstruir.

### Lo que la auditoría marcó como bueno y se conserva intacto

`Repetir último` · el presupuesto como anillo de la rueda · el modo *Monto total* con vista previa ·
el drill-down del cofre · ARS/USD nunca sumados · el par nominal·real · la marca `~` de cotización
aproximada · `account:switched` en todos lados · el parser de impuestos · el dedupe por número de
cuota.

---

## 2. El resumen como punto de entrada

### 2.1 Parser de encabezado y pie (`shared-logic/modules/finance-statement.ts`, nuevo)

Función pura `parseGaliciaStatement(text): StatementHeader`, sin DB, sin plataforma, testeable
contra fixtures anonimizadas. Extrae:

| Campo | De dónde sale del PDF |
|---|---|
| `closingDate` / `dueDate` | la fila de 6 fechas `DD-Mes-AA`, posiciones 3 y 4 |
| `prevClosingDate` / `prevDueDate` / `nextClosingDate` / `nextDueDate` | posiciones 1-2 y 5-6 |
| `period` (`YYYY-MM`) | mes de `closingDate` |
| `cardLast4` | `TARJETA NNNN Total Consumos de …` |
| `previousBalance` {ars, usd} | `SALDO ANTERIOR` |
| `payments` {ars, usd} | `SU PAGO EN PESOS` / `SU PAGO EN USD` (hoy caen en «líneas salteadas») |
| `consumos` {ars, usd} | la misma fila de `Total Consumos` |
| `totalDue` {ars, usd} | `TOTAL A PAGAR` |
| `minimumPayment` | bloque `PAGO MINIMO` |
| `purchaseLimit` / `financingLimit` | bloque `LÍMITES` |
| `forecast[]` {month, amount} + `forecastTail` | bloque `Cuotas a vencer:` (6 meses + cola) |

**Verificación cruzada de la fecha de cierre:** el código de barras del pie
(`YYYYMMDD…H`) trae la misma fecha de cierre que la posición 3 de la fila de fechas. Si las dos
coinciden, `closingDate` es confiable; si no, gana la fila de fechas y el preview lo dice. En los
dos documentos coincidieron.

**Orden de columnas:** en las filas de dos importes el primero es PESOS y el segundo DÓLARES. Es
una heurística posicional, y por eso **existe el checksum**: una asignación equivocada no se
guarda en silencio, rompe la conciliación y se muestra.

**Fragilidad, asumida y acotada.** Todo esto vale para el layout Galicia VISA 2025-2026. El
parser nunca *falla*: cada campo es opcional (`| null`) y su ausencia degrada a lo de hoy (el
usuario elige el mes a mano). Un cambio de layout del banco quita automatismo, no corrompe datos.

### 2.2 Dos bugs del parser de líneas que salieron de medir

1. **Una línea de consumo sin marcador `*`/`K` se descartaba.** El parser exigía el marcador; en
   uno de los documentos hay una fila que no lo trae y se perdía sin aviso (no llegaba ni a
   «líneas salteadas» útiles). Ahora una línea con fecha se acepta sin marcador si trae la columna
   COMPROBANTE (token de 5-7 dígitos) y no es una línea de `SU PAGO`. Con eso el checksum en USD
   del segundo documento pasa a cerrar en `0`.
2. **`SU PAGO EN PESOS` / `EN USD` iban a «líneas salteadas».** Eran, textualmente, el "total que
   pagué en el mes" que pidió el usuario, mostrado como error.

### 2.3 Conciliación

En el preview, antes de confirmar, y por moneda:

```
esperado = totalDue − previousBalance − payments      (los tres, del papel)
importado = Σ (filas marcadas)
```

- `|diff| ≤ 0.01` → **sello verde**, "cierra con el resumen del banco".
- `diff ≠ 0` → **aviso ámbar** con el faltante/sobrante y la causa probable (filas desmarcadas vs.
  líneas que el parser no entendió). **No bloquea**: el usuario puede importar igual y queda
  registrado en el resumen (`reconciled = 0`).
- Falta algún total del papel → no se muestra ni verde ni ámbar: se dice "sin checksum", que es
  distinto de "cierra".

Es lo contrario del comportamiento actual ("insertar y rezar") y sigue la regla de la
investigación: **datos con acción, no datos con culpa** — el ámbar no reta, dice qué mirar.

### 2.4 Qué escribe el import ahora, sin preguntar

| Antes se tipeaba | Ahora sale del papel |
|---|---|
| mes del resumen (default: el mes de HOY, casi siempre mal) | `header.period` |
| `closing_day` de la tarjeta | día de `closingDate` |
| `due_day` de la tarjeta | día de `dueDate` |
| qué tarjeta es | `cardLast4` contra `finance_credit_cards.last4`; si no hay ninguna, se **propone crear** «VISA ••NNNN» con cierre y vencimiento ya cargados |
| las cuotas futuras | ya las creaba la rama base; ahora además se **contrastan** contra `Cuotas a vencer` |
| «lo que pagué el mes pasado» | `SU PAGO`, que además salda el resumen anterior si estaba pendiente |

**Regla dura, heredada del precedente de las huérfanas:** *nunca inventar datos*. Concretamente:

- `SU PAGO` **solo salda un resumen que ya existe y está `pending`**. Si no existe el resumen del
  período anterior, el pago se **muestra** en el preview y **no se escribe** nada: la app no sabe
  qué había adentro de ese resumen y fabricarlo sería adivinar.
- Un resumen `paid` nunca se reescribe.
- La tarjeta solo se actualiza con cierre/vencimiento si el papel los trae; si no, se deja como está.
- `forecast` se guarda como **snapshot inmutable del papel**, nunca como fuente de las cuotas: las
  cuotas siguen saliendo de las líneas `NN/MM`, que son hechos, no proyecciones.

---

## 3. Modelo de datos — migración `finance` v19

Idempotente, aditiva, sin `UPDATE` masivo de filas existentes.

```sql
-- finance_credit_cards
ALTER TABLE finance_credit_cards ADD COLUMN last4  TEXT DEFAULT NULL;
ALTER TABLE finance_credit_cards ADD COLUMN issuer TEXT DEFAULT NULL;

-- finance_credit_card_statements: los números del PAPEL, al lado de los calculados
ALTER TABLE finance_credit_card_statements ADD COLUMN closing_date          TEXT DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN due_date              TEXT DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN statement_total_ars   REAL DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN statement_total_usd   REAL DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN minimum_payment_ars   REAL DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN previous_balance_ars  REAL DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN previous_balance_usd  REAL DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN prior_payment_ars     REAL DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN prior_payment_usd     REAL DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN reconciled            INTEGER DEFAULT NULL;
ALTER TABLE finance_credit_card_statements ADD COLUMN forecast_json         TEXT DEFAULT NULL;

-- finance_recurring: el medio de pago deja de estar hardcodeado en 'cash'
ALTER TABLE finance_recurring ADD COLUMN payment_method TEXT DEFAULT NULL;
```

**Por qué `forecast_json` y no una tabla.** `Cuotas a vencer` es una foto de un papel: se escribe
una vez, no se edita nunca, y solo tiene sentido junto a su resumen. Una tabla propia costaría
alta en `USER_DATA_TABLES` + get + merge + tombstones para algo que jamás va a divergir entre
dispositivos. Viaja con la fila del resumen, que ya sincroniza.

**`calculated_amount` vs `statement_total_ars`.** Conviven a propósito y **no** se pisan: el
primero es lo que Coinify calcula sumando las filas que tiene, el segundo es lo que dice el banco.
Que sean dos números distintos ES el dato — la conciliación vive de esa diferencia.

**Sync.** Las 13 columnas nuevas entran en `sync:getAllFinanceData` y en `sync:mergeFinanceData`
con el patrón que ya usa `due_day`: *ausente en el payload de un cliente viejo = sin opinión,
se conserva lo local; presente y `null` = borrado explícito*. Sin tablas nuevas, así que
`USER_DATA_TABLES` no cambia.

**Qué NO se migra.** No se toca ni una fila existente. Las 12 cuotas huérfanas siguen huérfanas
(mismo criterio que el documento de precedente: repararlas exige adivinar). Las 29 filas que
apuntan a `import_batch_id` inexistentes siguen igual. `finance_income_sources` sigue en el
esquema. **Cero filas modificadas por la v19.**

---

## 4. El default deja de ser efectivo

Nuevo handler `finance:getEntryDefaults` → `{ paymentMethod, currency, accountId }`.

**Inferido, no hardcodeado:** la moda de `payment_method` sobre los últimos 50 movimientos
`source = 'manual'`, tipo `expense`, excluyendo las categorías reservadas (`Pago Tarjeta`,
`Transferencia`, impuestos de tarjeta) — que son filas que escribe la app, no la persona. Con la
base real del usuario eso da `transfer`, que es lo que él usa el 67% de las veces.

**Fallback con cero historial:** `transfer`, no `cash`. Es una decisión de producto explícita y
está justificada por la investigación (el denominador común argentino es digital: transferencia,
billetera, QR). Un usuario de efectivo lo cambia una vez y a partir de ahí la moda lo aprende.

Se aplica en `QuickAddForm` y en el generador de recurrentes
(`finance.balance.ts`, que hoy escribe `'cash'` fijo). Los recurrentes además ganan su propia
columna `payment_method`: si el template la tiene, gana; si no, se infiere. **Ninguna fila ya
generada se reescribe.**

---

## 5. Importador de tabla delimitada (CSV) — por qué entra en este alcance

La medición de la auditoría dice que **el 55% del costo mensual son 30 movimientos digitales
tipeados a mano** (180 de 330 interacciones), y ninguno de ellos está en un PDF de tarjeta. Si el
rediseño solo mejora el import de tarjeta, el número de régimen baja de ~198 a ~190. No alcanza.

`finance:importParseDelimited(text, fileName)` sobre lo que ya funciona en Android
(`pickTextFile`): olfatea el delimitador (`,` `;` `\t` `|`), detecta el separador decimal por
cuál de los dos deja más celdas numéricas, propone el mapeo de columnas por nombre de encabezado
(es/en) y deja al usuario corregirlo. El mapeo se recuerda **en `localStorage`, por firma de
encabezado** — es conveniencia de dispositivo, no dato del usuario: perderlo cuesta 4 clics, así
que no justifica una tabla sincronizada.

Cubre Belo, Cuenta DNI (BIP), Mercado Pago y cualquier exportación futura sin escribir un parser
por proveedor. Las filas entran con `source = 'import'`, `payment_method` del origen elegido y
`account_id` **no nulo** — que es la otra mitad de "el cofre está desconectado".

---

## 6. Onboarding

Coinify no tenía ni un paso; Nutrify tiene uno entero. Se agregan dos cosas, para los dos momentos
distintos en que alguien puede necesitarlo:

1. **Paso 3 de 5 en `src/hub/Onboarding.tsx`** (usuarios nuevos): un solo camino visible
   —"Importá tu primer resumen"— con "lo hago después" como salida secundaria. Patrón Monarch: un
   botón, todo lo demás fuera del paso. No se pide crear categorías, ni cuentas, ni tarjetas: se
   infieren o se piden después.
2. **Empty state con salida en el Panel** (usuarios que ya pasaron el onboarding, o cuentas
   nuevas): con 0 movimientos y 0 tarjetas, el Panel se reemplaza por la misma pantalla en vez de
   mostrar seis gráficos en cero. NN/g: el estado vacío es onboarding, no vacío.

Y para el usuario que **ya tiene datos** (el caso real de este repo), el camino nuevo tiene que
estar a la vista sin pantalla de bienvenida: por eso **"Importar resumen" es un botón primario en
la cabecera del Tomo**, visible desde las tres pestañas.

---

## 7. Interacciones: antes y después

Mismo método que la auditoría (clic = clic real; campo = campo tipeado), leyendo los componentes.

| Bloque | Antes | Después | Por qué |
|---|---|---|---|
| 2 cuentas | 8 | 8 | sin cambio |
| 2 tarjetas | 14 | **0** | salen del resumen (nombre, cierre, vencimiento) |
| 5 recurrentes | 35 | 35 | sin cambio (+1 campo opcional de medio de pago) |
| 7 planes de cuotas | 70 | **0** | salen de las líneas `NN/MM` del resumen |
| 4 presupuestos | 14 | 14 | opcional, sin cambio |
| **Setup** | **~140** | **~57** | |
| 30 movimientos digitales | 180 | **~10** | 1 CSV de billetera: archivo + mapeo (recordado) + confirmar |
| Import de 1 resumen | ~10 + revisión fila por fila | **~4** | archivo + confirmar; el resto es confirmar defaults correctos |
| Generar + pagar resumen | 8 | **~2** | el pago sale del `SU PAGO` del resumen siguiente |
| **Mes de régimen** | **~198** | **~16** | |
| **Primer mes completo** | **~330** | **~73** | |

El número que importa es el de régimen —el que se paga *todos los meses*—: **198 → 16, un factor
de 12**. El de setup baja 2.5×, y baja menos porque las cuentas y los recurrentes no están en
ningún archivo: es exactamente lo que la auditoría anticipó en su §8 ("lo que NO se resuelve
importando").

---

## 8. Mobile

- Compromisos y el asistente de import se escriben con la sub-nav scrolleable que ya usa
  `FinanceLayout`, área de toque ≥44 px bajo `[data-shell="mobile"]`, y sin desborde a 390 px
  (test en `tests/visual/mobile/`).
- **Tres pestañas en vez de seis** es, por sí solo, la mejora más grande en mobile: la tira dejaba
  la pestaña activa fuera de vista.
- **PDF en Android:** se evalúa `pdfjs-dist` en el WebView. Decisión y resultado en §10.
- **CSV en Android: funciona hoy**, sin plumbing nuevo (`pickTextFile` ya está implementado en
  `platform-host.ts`). Es la razón de peso para que el importador genérico entre en este alcance.

---

## 9. Riesgos y cómo se acotan

| Riesgo | Mitigación |
|---|---|
| El banco cambia el layout | cada campo es opcional; sin él se degrada al flujo manual de hoy. Arnés de regresión con fixtures anonimizadas en `tests/fixtures/statements/` |
| Asignación ARS/USD por posición | el checksum la valida; un error rompe la conciliación en vez de guardarse callado |
| Confundir dos tarjetas del mismo emisor | `last4` como clave; sin `last4` se cae al nombre de archivo (comportamiento de hoy) |
| Duplicar el pago del resumen | solo se salda un resumen `pending` existente; `paid` es historia |
| Perder la nav vieja | rutas viejas → `<Navigate replace>`, no 404 |

---

## 10. Decisiones tomadas sin consultar (y por qué)

1. **Fusionar 4 pestañas en «Compromisos» en vez de eliminar Préstamos.** El usuario autorizó
   eliminar, pero borrar una tabla con handlers y tests para ahorrar una pestaña es destruir lo
   que no cuesta nada conservar. Degradar > eliminar.
2. **`forecast_json` en vez de tabla nueva.** Menos superficie de sync para un dato que no diverge.
3. **Fallback `transfer` con cero historial.** Ver §4.
4. **El importador CSV entra en alcance.** Sin él el "orden de magnitud" no existe (§5).
5. **La conciliación avisa, no bloquea.** Bloquear convertiría un checksum informativo en una
   pared; la investigación es explícita sobre el ciclo de culpa.
6. **PDF en Android: sí, con red de contención.** `pdfjs-dist` ya está en `node_modules` y
   `getTextContent()` no necesita canvas. Se implementa detrás de un `try/catch` que cae al toast
   de "solo escritorio" si el worker no resuelve; el riesgo es que en un device real no cargue, y
   el costo de ese fallo es exactamente el comportamiento de hoy.
