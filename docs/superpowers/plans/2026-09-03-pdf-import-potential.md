# El potencial del import de resumen — qué trae el PDF que la app estaba tirando

> **Reconstruido el 2026-09-03 tras perderse el original sin commitear.** Lo verificado contra el
> código está marcado; el resto proviene de citas en la spec del rediseño
> (`docs/superpowers/specs/2026-09-03-coinify-redesign.md`) y en el resumen de la noche
> (`D:\hubtify-resumen\index.html`).

> Este documento no contiene ningún monto, comercio, saldo ni número de tarjeta real. Todo lo medido
> sale de los 5 resúmenes reales del usuario (`docsexample/`, gitignoreado): sólo **conteos,
> estructura y diferencias**, nunca contenido.

**Fecha del original:** 2026-09-03 · **Documentos medidos:** resúmenes Galicia VISA
(layout 2025-2026) · **Código auditado en el original:** `shared-logic/modules/finance-import.ipc.ts`
en v0.9.4.

**Convención de marcas:** **[V]** verificado de primera mano en el código al reconstruir ·
**[C]** citado textual en la spec del rediseño / otro documento del repo / el resumen de la noche ·
**[R]** reconstruido, sin fuente primaria sobreviviente.

**Cómo leer este documento:** la tesis (§0-§7) es de **antes** del rediseño de la 0.9.5. La **§8**
dice, punto por punto, qué de esto **ya se arregló** — que era el pedido explícito al reconstruirlo:
que el documento no mienta sobre el presente.

---

## 0. La tesis en una línea

> **El resumen del banco ya trae, impreso, todo lo que la app le está pidiendo tipeado al usuario.
> No hay que proyectar nada ni inventar nada: hay que LEER.**

---

## 1. El parser sólo miraba las líneas que empiezan con fecha: el 85 % del papel se descartaba

**[V] — y el número está escrito textual en el código que arregló esto**, en la cabecera de
`shared-logic/modules/finance-statement.ts:4-7`:

> *«El parser de líneas (`finance-import.ipc.ts`) lee el detalle del consumo y descarta el resto del
> documento: **el 85 % del papel**, donde están impresos —por la Ley 25.065 art. 23— todos los datos
> que hoy la app le pide tipeados al usuario. Este módulo lee ese 85 %.»*

**[V] La condición de descarte sigue estando ahí**, y es literal:
`finance-import.ipc.ts:144-145` —

```ts
const dateMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{2})\s/);
if (!dateMatch) return null;
```

Todo renglón que no arranque con `DD-MM-YY` volvía `null` y se perdía. Y lo que se perdía no era
ruido: era el encabezado y el pie enteros.

### Lo que estaba impreso y se tiraba

| Dato del papel | Qué hacía la app en su lugar |
|---|---|
| Fecha de cierre y de vencimiento (fila de 6 fechas `DD-Mes-AA`) | los pedía a mano al crear la tarjeta |
| Período del resumen | ofrecía **el mes de HOY** como default, casi siempre mal |
| Últimos 4 de la tarjeta | adivinaba la tarjeta por el nombre del archivo |
| `SALDO ANTERIOR` (ARS y USD) | no existía |
| `SU PAGO EN PESOS` / `EN USD` | caía en «líneas salteadas», mostrado como **error** |
| `TOTAL A PAGAR` (ARS y USD) | no existía: el total del resumen se calculaba sumando lo que la app tenía |
| `PAGO MINIMO` | no existía |
| Límite de compra y de financiación | no existían |
| Bloque **«Cuotas a vencer»** (6 meses + cola) | ver §2 |
| Código de barras del pie (que repite el cierre) | no existía |

Son **once campos**, y **[C]** spec §0 confirma que *«los 11 campos se extrajeron de los dos
documentos, sin excepción»*.

> Dicho de otra forma: **la app tenía un OCR de una sola columna** sobre un documento que el banco
> está legalmente obligado a imprimir completo.

---

## 2. El banco ya proyectó las cuotas. No hay que proyectar: hay que leer

El resumen imprime un bloque **«Cuotas a vencer»** con **los próximos 6 meses más una cola**
(«A partir de \<Mes\>/\<AA\> $X»). **[V]** — la estructura está declarada en
`finance-statement.ts:52-55`:

```ts
/** Bloque «Cuotas a vencer»: los próximos 6 meses, firmados por el banco. */
forecast: StatementForecastEntry[];
/** «A partir de <Mes>/<AA> $X» — la cola de todo lo que viene después. */
forecastTail: StatementForecastEntry | null;
```

**[C]** El documento de las cuotas huérfanas ya citaba esta sección del original antes de que se
perdiera: `2026-09-03-coinify-orphan-installments.md:56-60` —

> *«El resumen imprime un bloque «Cuotas a vencer» con los próximos 6 meses más la cola
> (`docs/superpowers/plans/2026-09-03-pdf-import-potential.md`, §2). Hoy proyectamos las cuotas
> nosotros a partir de la que trae la línea; parsear ese bloque permitiría además **validar** la
> proyección contra lo que firma el banco.»*

**La recomendación del original, y la que el rediseño adoptó:** el bloque **no** debe ser la fuente
de las cuotas. Debe guardarse como **fotografía inmutable del papel** y usarse para **contrastar**.
Las cuotas siguen saliendo de las líneas `NN/MM` del detalle, que son **hechos**; el bloque es una
**proyección** del banco. **[C]** spec §2.4: *«`forecast` se guarda como snapshot inmutable del
papel, nunca como fuente de las cuotas»*.

### 2.1 Lo que el PDF NO trae, y hay que decirlo

**La cotización aplicada a los consumos en dólares no está en el resumen.** Sólo está el texto legal
que describe *cómo* se calcula. **[C]** `2026-09-03-coinify-orphan-installments.md:61-64`, que cita
este mismo documento §2.

Por eso una fila en dólares **tiene** que seguir guardando la cotización del día del import, marcada
como aproximada. **[V]** `finance-import.ipc.ts:396,551` — `getCurrentRate(db, getFxHouse(db))` y
`fx_rate_source = 'process'`, que es la marca que la UI muestra con `~`.

> **La regla:** una cotización aproximada y **avisada** es honesta. Una cotización del papel que no
> existe sería inventada.

---

## 3. La conciliación exacta: un checksum que el papel te firma

Las tres cifras del pie permiten cerrar una identidad **exacta**, no aproximada:

```
SALDO ANTERIOR  +  SU PAGO  +  consumos  +  impuestos   =   TOTAL A PAGAR
```

Despejando lo que el import debería estar insertando:

```
Σ(filas del detalle)  =  TOTAL A PAGAR  −  SALDO ANTERIOR  −  SU PAGO
```

**[C]** spec §0: *«Diferencia medida: 0 en ARS en los dos documentos, 0 en USD en el primero»*, **a
6 decimales**.

**[V] La identidad está implementada y documentada en el código**,
`finance-statement.ts:317-329` y `:313`.

> **Nota de sigo — una trampa de signos que conviene tener escrita.** El código guarda `SU PAGO` en
> **magnitud positiva** (`Math.abs`, `finance-statement.ts:227,231`) porque el papel lo imprime
> negativo. Por eso la **implementación** hace `totalDue − previous + paid` (`:313`) mientras los
> **comentarios** dicen `TOTAL A PAGAR − SALDO ANTERIOR − SU PAGO` (`:66` y `:317-329`). Son la
> misma identidad en dos convenciones de signo, no una contradicción — pero el código convive con
> las dos redacciones y eso es una trampa para el próximo que lo lea. **[V]**

### 3.1 Por qué un checksum vale más que un parser mejor

Porque **la asignación de columnas ARS/USD es posicional**, y una heurística posicional falla en
silencio. **[V]** `finance-statement.ts:113-117`:

> *«En las filas de dos importes la primera columna es PESOS y la segunda DÓLARES. Es posicional, y
> por eso existe el checksum: una asignación equivocada rompe la conciliación en vez de guardarse en
> silencio.»*

Y la predicción se cumplió el mismo día: **[C]** spec §0 —

> *«En el segundo [documento] el checksum en USD **no cerró** — y la diferencia era exactamente una
> fila que el parser estaba perdiendo. O sea: el checksum no es decorativo, encontró un bug real la
> primera vez que se corrió.»*

**La recomendación del original:** el checksum **informa, no bloquea**. Tres estados, no dos:
**cierra** · **no cierra, con el faltante y la causa probable** · **sin checksum**, cuando al papel
le falta alguno de los tres totales — que es distinto de «cierra». **[C]** spec §2.3.

---

## 4. Los consumos en dólares guardaban dólares en el campo de pesos

En una línea en dólares del resumen, **la columna PESOS viene vacía** y la última columna de la
línea es la de DÓLARES. El parser tomaba «el último monto de la línea» como el importe en pesos.

**Medido: 5 de 5 filas en dólares de los resúmenes reales tenían `amountARS === amountUSD`.**
**[V]** — la medición está escrita textual en el comentario del arreglo,
`finance-import.ipc.ts:204-214`:

> *«Tomar «el último monto» como el importe en pesos guardaba dólares en `billed_amount_ars`
> (medido: 5 de 5 filas USD de los resúmenes reales tenían `amountARS === amountUSD`), y
> `computeStatementTotals` los sumaba al total EN PESOS del resumen.»*

Un importe en dólares entraba **uno a uno** al total en pesos, inflándolo.

**La heurística propuesta y adoptada:** el importe en pesos de un consumo en dólares es siempre
**bastante mayor** que el importe en dólares, y nunca igual. Con eso alcanza para distinguir la
columna real de la repetición, sin depender del layout exacto. **[V]**
`finance-import.ipc.ts:215-217`.

---

## 5. Los nombres de comercio salían con ruido

El detalle imprime, después del nombre del comercio, tokens que no son parte del nombre: el número
de comprobante, el marcador `NN/MM` de cuota, el bloque `USD <importe>` y códigos alfanuméricos
cortos.

**El original midió que 47 de 61 nombres importados quedaban con forma sospechosa** — y su
consecuencia práctica: **la detección de recurrentes por nombre no servía**, porque el mismo
comercio entraba escrito distinto cada mes.

**[V]** — la medición sobrevive textual en el comentario del arreglo,
`finance-import.ipc.ts:243-249`:

> *«El token tiene que LLEVAR AL MENOS UN DÍGITO para ser un código. Sin esa condición la regla se
> comía la última palabra de cualquier comercio cuyo nombre terminara en una palabra de 5 a 10
> letras («TIENDA SIN MARCADOR» → «TIENDA SIN»), que es parte de por qué **47 de 61 nombres
> importados quedaban con forma sospechosa** y la detección de recurrentes por nombre no servía.»*

---

## 6. El CSV de las billeteras NO trae cuotas: el PDF es la única fuente

Éste es el hallazgo que decide el alcance, y hay que decirlo fuerte porque es contraintuitivo: **si
las billeteras exportan CSV, ¿para qué pelearse con un PDF?**

Porque **el CSV no trae la información de cuotas**. Un CSV de billetera trae fecha, descripción,
monto, moneda y a veces categoría — y **nada más**. No hay columna «cuota 3 de 12».

**[V]** El importador genérico de tabla delimitada que se escribió después lo confirma por
omisión: `shared-logic/modules/finance-table.ts:21` —

```ts
export type TableField = 'date' | 'description' | 'amount' | 'currency' | 'category' | 'ignore';
```

**No hay campo de cuotas, y no lo hay porque no hay de dónde sacarlo.**

> **La conclusión operativa:** las dos vías son **complementarias, no alternativas**. El CSV resuelve
> el **volumen** (los ~180 movimientos digitales del mes de régimen). El PDF resuelve la
> **estructura** (cuotas, tarjeta, cierre, vencimiento, conciliación). Ninguna de las dos sola
> alcanza.

---

## 7. `pdfjs-dist` corre en el WebView: el import en Android era una DECISIÓN, no un límite

En v0.9.4, elegir un PDF en Android devolvía «solo escritorio». El motivo real no era técnico: era
que `pickPdfText` se había implementado con **`pdf-parse`, que es node-only**.

**`pdfjs-dist` corre en el navegador, y `getTextContent()` no necesita canvas** — sólo el
*renderizado* lo necesita, y para leer un resumen no hay que renderizar nada.

**[V] — el hallazgo está atribuido a esta investigación, textual, en el módulo que lo implementó**,
`src/mobile/pdf-text.ts:1-16`:

> *«`pickPdfText` estaba trabado en escritorio porque se implementó con `pdf-parse`, que es
> node-only. **La investigación midió que eso era una DECISIÓN, no un límite técnico**: `pdfjs-dist`
> corre en el navegador y `getTextContent()` no necesita canvas (solo el renderizado lo necesita).»*

**El riesgo real, acotado en el original:** lo único que puede fallar en un dispositivo de verdad es
la **resolución del worker** (Vite ≥ 7.1 + la CSP `worker-src` del WebView). Y la mitigación es
gratis: todo detrás de un `try/catch` que devuelve `{ unsupported: true }`, que es **exactamente el
comportamiento anterior**. **El peor caso cuesta cero.** **[V]** `src/mobile/pdf-text.ts:9-13`.

La parte que sí puede romper el parser —armar los renglones a partir de los fragmentos que devuelve
`getTextContent()`, que **no devuelve líneas**— es lógica pura y testeable. **[V]**
`tests/mobile/pdf-text.test.ts`.

---

## 8. Qué de todo esto YA SE ARREGLÓ en la 0.9.5

Verificado contra el código de `master` al reconstruir este documento. Ésta es la sección que
impide que el documento mienta sobre el presente.

| Hallazgo | Estado hoy | Evidencia |
|---|---|---|
| **Sólo se leían las líneas `DD-MM-YY`; el 85 % del papel se tiraba** | **ARREGLADO** — `finance-statement.ts` es un módulo nuevo, puro, que lee el encabezado y el pie. El parser de líneas **sigue** exigiendo `DD-MM-YY`, y está bien: ahora es *sólo* el parser del detalle | **[V]** `finance-statement.ts` completo; `finance-import.ipc.ts:144-145` (intacto, a propósito) |
| **11 campos del encabezado/pie tipeados a mano** | **ARREGLADO** — se extraen los 11 | **[V]** `finance-statement.ts:28-61` (`StatementHeader`); **[C]** spec §11.1: *8/8 campos en los dos documentos* |
| **«Cuotas a vencer» se descartaba** | **ARREGLADO** — se parsea y se guarda como snapshot inmutable en `forecast_json` | **[V]** `finance-statement.ts:52-55`, `:275-285`; **[C]** spec §3 (migración `finance` v19), **[V]** `src/modules/finance/finance.schema.ts:536` |
| **No había conciliación** | **ARREGLADO** — `reconcileStatement`, por moneda, con tres estados y **sin bloquear** | **[V]** `finance-statement.ts:300-347` |
| **`SU PAGO` iba a «líneas salteadas» como error** | **ARREGLADO** — el parser de líneas lo saltea explícitamente y el del encabezado lo lee como «lo que pagué en el mes» | **[V]** `finance-import.ipc.ts:164-170`; `finance-statement.ts:44,227,231` |
| **Una línea de consumo sin marcador `*`/`K` se descartaba entera** | **ARREGLADO** — sin marcador se acepta si trae la columna COMPROBANTE (token de 5-7 dígitos) y no es `SU PAGO` | **[V]** `finance-import.ipc.ts:172-184` |
| **Los dólares se guardaban en el campo de pesos** | **ARREGLADO** — heurística de magnitud + el checksum que la valida | **[V]** `finance-import.ipc.ts:197-218` |
| **Las líneas de impuestos/percepciones/intereses se tiraban** | **ARREGLADO** — se parsean como filas normales bajo la categoría reservada; son lo que hace que el total importado cierre contra el papel | **[V]** `finance-import.ipc.ts:47-125` (`TAX_PATTERNS`, `parseTaxLine`) |
| **Nombres de comercio con ruido** | **ARREGLADO en su causa más cara** (la regla que se comía la última palabra); el resto de la limpieza sigue siendo heurística | **[V]** `finance-import.ipc.ts:241-249` |
| **El import parseaba las cuotas y no escribía `installment_group_id`** | **ARREGLADO** — crea el plan, engancha la fila y proyecta, de forma idempotente entre resúmenes | **[V]** `finance-import.ipc.ts:457,464,479,490`; **[C]** spec §11.3: filas con plan **0 → 57**, **17 duplicados** detectados |
| **La tarjeta había que crearla antes, a mano** | **ARREGLADO en el camino del import** — se propone y se crea «VISA ··NNNN» con cierre, vencimiento y últimos 4 | **[V]** `src/modules/finance/components/Import.tsx:281-288,386`; **[C]** spec §11.2 |
| **PDF sólo en escritorio** | **ARREGLADO** — `pdfjs-dist` **5.4.296** pasa a dependencia directa y fijada; chunk aparte que sólo se descarga al elegir un PDF | **[V]** `package.json:96`, `src/mobile/pdf-text.ts`; **[C]** spec §11.6 (chunk de 399 kB) |
| **El CSV no trae cuotas** | **SIGUE SIENDO CIERTO** — y por eso el importador genérico no tiene campo de cuotas. No es una carencia: es el hecho | **[V]** `finance-table.ts:21` |
| **La cotización aplicada no está en el PDF** | **SIGUE SIENDO CIERTO** — la fila en dólares guarda la cotización del día, marcada `'process'` y avisada con `~` | **[V]** `finance-import.ipc.ts:396,551` |
| **La conciliación en USD del segundo documento no cerraba** | **ARREGLADO por la fila recuperada** — hoy cierra en 0 en las dos monedas en los dos documentos | **[C]** spec §11.1 |

### 8.1 Lo que quedó abierto

- **El worker de `pdfjs` en un teléfono de verdad.** **[C]** spec §11.6: *«Lo único que no se pudo
  verificar sin un teléfono real es que el WebView sirva el `.mjs` del worker con el MIME
  correcto; si no lo hace, cae en la red de contención.»*
- **La fragilidad de layout, asumida.** Todo el parser de encabezado vale para el layout
  **Galicia VISA 2025-2026**. Cada campo es opcional y su ausencia degrada al flujo manual; un
  cambio de layout **quita automatismo, no corrompe datos**. **[C]** spec §2.1.
- **Las dos redacciones de la fórmula de conciliación** conviviendo en el mismo archivo (§3).
- **Las 12 cuotas huérfanas** de importaciones viejas siguen intactas, y **no van a deduplicar** si
  se reimportan esos mismos resúmenes. `2026-09-03-coinify-orphan-installments.md`.

---

## 9. Lo que no se pudo recuperar del original

- **El desglose del 85 %** (qué porcentaje era encabezado, qué porcentaje pie, qué porcentaje texto
  legal). Sobrevive el número global, citado en el código.
- **Las capturas anotadas del layout** del resumen que acompañaban la §1.
- **El relevamiento de layouts de otros bancos argentinos** que el original comparaba contra el de
  Galicia para justificar la decisión de no escribir un parser por banco.
- **Las expresiones regulares candidatas descartadas** y por qué.
