# Coinify — auditoría de diagnóstico (estado PRE-rediseño)

> **Reconstruido el 2026-09-03 tras perderse el original sin commitear.** Lo verificado contra el
> código está marcado; el resto proviene de citas en la spec del rediseño
> (`docs/superpowers/specs/2026-09-03-coinify-redesign.md`) y en el resumen de la noche
> (`D:\hubtify-resumen\index.html`).

> **ADVERTENCIA DE VIGENCIA — leer antes que nada.**
> Este documento describe Coinify **ANTES** del rediseño que entró en la **0.9.5**
> (`feat/coinify-redesign` + `fix/coinify-data-bugs`). **Varias de las cosas que denuncia ya no son
> ciertas.** Se conserva porque es la línea de base contra la que se midió el rediseño y porque su
> §9 («qué vale conservar») explica por qué el rediseño no borró nada. La §10 dice, punto por punto,
> qué de esto sigue vivo hoy.

> Este documento no contiene ningún monto, comercio, saldo ni número de tarjeta real. Todo lo que se
> cita de la base del usuario son **conteos y agregados**, medidos sobre copias de solo lectura de
> `%APPDATA%\hubtify\hubtify.db`.

**Fecha del original:** 2026-09-03 · **Base medida:** v0.9.4 · **Método:** los pasos se contaron
leyendo los componentes (clic = clic real; campo = campo tipeado), los números de la base salen de
consultas de agregado sobre una copia read-only.

**Convención de marcas en este documento reconstruido:**

| Marca | Significa |
|---|---|
| **[V]** | **Verificado de primera mano** en el código o en los documentos del repo al reconstruir |
| **[C]** | **Citado**: el número aparece textual en la spec del rediseño, en otra rúbrica del repo o en el resumen de la noche |
| **[R]** | **Reconstruido**: estaba en el original, se sostiene por coherencia con [V]/[C], pero su fuente primaria se perdió |

---

## 0. La base real, en cinco números

| Medida | Valor | Marca |
|---|---|---|
| Transacciones vivas | **107** | **[C]** spec §11.3 |
| `account_id` no nulo | **0 de 107** | **[C]** rúbrica de journey §6.0 y C12 |
| Gastos manuales vivos por medio de pago | **transfer 41 · credit_card 18 · debit 2 · cash 0** (de 61) | **[C]** rúbrica de journey §6.0 |
| Planes de cuotas · recurrentes · cuentas · tarjetas · resúmenes | **7 · 5 · 2 · 2 · 2** | **[C]** spec §11.3 |
| Maestría del módulo `finance` | **6** (contra quests 780, nutrition 841, cauldron 686) | **[C]** rúbrica de journey §0 |

Las **17 filas restantes en efectivo** (107 vivas − 61 manuales − las importadas) **no las escribió
una persona: las escribió el motor de recurrentes**, que tenía `payment_method` hardcodeado en
`'cash'`. **[R]**, y el hardcodeo sí está **[V]**: el comentario de
`shared-logic/modules/finance.balance.ts:567` lo dice textual — *«`payment_method` era la constante
`'cash'`: la plantilla no tenía dónde…»*.

**La lectura de estos cinco números:** el dueño de la app **no usa Coinify**. Y no por falta de
ganas — por lo que cuesta.

---

## 1. El costo de dejar un mes cargado: ~330 interacciones

Contadas leyendo los componentes, por bloque. **[C]** — la tabla completa sobrevive en la spec del
rediseño §7, columna «Antes».

| Bloque | Interacciones |
|---|---|
| 2 cuentas | 8 |
| 2 tarjetas | 14 |
| 5 recurrentes | 35 |
| 7 planes de cuotas | 70 |
| 4 presupuestos | 14 |
| **Setup inicial** | **~140** |
| 30 movimientos digitales tipeados a mano | 180 |
| Import de 1 resumen (+ revisión fila por fila) | ~10 |
| Generar + pagar el resumen | 8 |
| **Mes de régimen** — el que se paga *todos los meses* | **~198** |
| **Primer mes completo** | **~330** |

**El número que importa no es 330: es 198.** El setup se paga una vez; el régimen se paga siempre.
Y **el 55 % del costo mensual son 30 movimientos digitales tipeados a mano** (180 de 330) **[C]**
spec §5.

Un gasto digital cuesta **6 clics + 2 campos, siempre** **[C]** rúbrica de journey §J5 y C2. No hay
«repetir lo de ayer» en finanzas: Questify tiene el tilde, Nutrify tiene la pastilla, el Caldero
tiene Quick Brew, y Coinify te hace retipear monto y descripción cada vez. **Las 61 filas manuales
vivas de la base son 61 tipeos.**

---

## 2. El default del formulario es el caso que nunca pasa

`QuickAddForm` arrancaba en **`paymentMethod = 'cash'`** **[C]** (rúbrica de journey C12 lo cita en
`QuickAddForm.tsx:66`). Contra una base con **cero** filas de efectivo cargadas por una persona.

> **Cada alta manual empezaba corrigiendo el medio de pago.** Dos interacciones desperdiciadas,
> 61 veces.

Y el efectivo no sólo estaba en el default del formulario: estaba en el **respaldo del backend**.
`resolveAccountId` sólo sabía mapear automáticamente el caso «efectivo» —justo el que no se usa—,
así que todo lo demás caía en `NULL`. Ver §3.

**Por qué importa más de lo que parece.** Un default equivocado no es un detalle cosmético: es la
app afirmando algo falso sobre la persona, 61 veces, y haciéndole pagar la corrección cada vez.

---

## 3. El cofre está desconectado: `account_id` NULL en 107 de 107

**[C]** rúbrica de journey C12 y §6.0.

Las cuentas existen (2, creadas por su migración), el dibujo del cofre existe, el drill-down del
cofre funciona — y **ninguna transacción apunta a ninguna cuenta**. Incluidas las filas escritas
*después* de la migración que creó las cuentas.

Consecuencia en cadena: sin `account_id` no hay saldo por cuenta que valga, el cofre muestra un
reparto inventado, y **cualquier inferencia futura de «a qué cuenta va esto» no tiene de dónde
sacar nada** — devuelve `null` siempre y cae en el respaldo genérico «Efectivo», que es la cuenta
con 0 de 107. **[C]** rúbrica de journey, tercera medición C12: *«es literalmente el ancla de la
banda 3»*.

---

## 4. Dos pestañas de primer nivel que nunca se usaron

- **Préstamos:** tabla **vacía** en la base real. **[C]** spec §1 — *«tabla vacía en la base real:
  nunca se usó»*.
- **Presupuestos:** nunca usados. **[R]** — el original lo medía; de las fuentes que sobreviven sólo
  se puede confirmar que los 4 presupuestos costaban 14 interacciones y que la spec los clasificó
  como *«opcionales, sin cambio»* **[C]** spec §7. **No pude reverificar el conteo de la tabla en
  esta reconstrucción** (no se consulta la base del usuario para reescribir un documento).

Las dos ocupaban un lugar de primer nivel en una tira de **6 pestañas** que en el teléfono ni
siquiera entraba en pantalla: **696 px de desborde horizontal** en la tira de tabs, sin ninguna
señal de que scrollea, con el último tab cortado a mitad de palabra **[C]**
`2026-09-03-design-rubric.md` (C10 y su lista de fallos).

**Nota de criterio, que el rediseño después heredó:** «nunca se usó» justifica **degradar**, no
**borrar**. Ver §9.

---

## 5. Tres caminos distintos para cargar la misma compra en cuotas, uno con bug

**[V]** — los tres handlers siguen existiendo hoy en `shared-logic/modules/finance.ipc.ts`:
`finance:addTransaction` (`:192`, con `installments > 1`), `finance:createInstallmentGroup`
(`:1180`) y `finance:createThirdPartyPurchase` (`:1449`).

**[V] La descripción del bug está escrita textual en el código que lo arregló**, en la cabecera de
`src/modules/finance/utils/installment-payload.ts:1-12`:

> *«La misma compra en cuotas se carga desde tres pantallas (libro mayor, pestaña Cuotas, Préstamos)
> y las tres armaban el payload a mano. Dos consecuencias: 1. El libro mayor no mandaba
> `paymentMethod`, así que `finance:createInstallmentGroup` evaluaba `isCreditCard` en `false`
> aunque el usuario hubiera elegido tarjeta: el plan quedaba con `credit_card_id` NULL, descontaba
> del saldo y no entraba en ningún resumen. 2. Cada pantalla decidía por su cuenta si lo tipeado era
> el monto de la cuota o el total financiado.»*

En prosa: **cargar «tarjeta + N cuotas» desde el libro mayor perdía la tarjeta.** El plan quedaba
sin tarjeta, marcado como que impacta el saldo, y arrancando el mes de la compra en vez del
siguiente. **Ese plan descontaba del saldo y no llegaba nunca a ningún resumen.** El mismo gesto,
desde la pestaña Cuotas, escribía filas distintas.

Y el tercer camino divergía por su cuenta: `createThirdPartyPurchase` **omite `account_id` y fuerza
`credit_card`** **[C]** rúbrica de journey C7 (tercera medición).

> Esto no es «caminos duplicados pero equivalentes». Es **un mismo gesto produciendo filas
> distintas**, que es la definición de falla estructural. Y durante todo ese tiempo `npm test`
> estuvo en verde.

---

## 6. «Monto» quería decir dos cosas

En el libro mayor y en Préstamos el campo se rotulaba **«Monto»** y se interpretaba como el **monto
de la cuota**. Quien tipeaba el precio de vidriera generaba un plan **N veces más grande, sin ningún
aviso**. **[C]** resumen de la noche §3.4, y **[V]** por el punto 2 de la cabecera de
`installment-payload.ts` citada arriba.

Lo llamativo: **el toggle correcto ya existía y ya funcionaba bien** —«Monto de la cuota / Monto
total» con vista previa del reparto— pero **sólo en la pestaña Cuotas**. La app tenía la solución
adentro, en una sola de las tres puertas.

---

## 7. Había que crear la tarjeta antes de poder guardar una compra con tarjeta

El formulario valida que haya una tarjeta **seleccionada** antes de aceptar el alta: si elegís
«tarjeta de crédito» y no hay ninguna cargada, no podés guardar. **[V]**
`src/modules/finance/components/shared/QuickAddForm.tsx:243-246` —
`if (paymentMethod === 'credit_card' && !creditCardId) { toast(…'Seleccioná una tarjeta') ; return; }`.

O sea: el camino de alta te empuja al ABM de tarjetas —**7 campos tipeados a mano**, nombre, día de
cierre, día de vencimiento y demás— **antes** de dejarte registrar el gasto que estabas registrando.
Un alta interrumpida por otra alta.

**Lo irónico, y es el hallazgo que ordenó todo el rediseño:** esos 7 campos **están impresos en el
resumen** que el usuario ya tiene. Ver §8 y `2026-09-03-pdf-import-potential.md`.

---

## 8. El import parseaba las cuotas y las tiraba

El parser leía el marcador `CUOTA N/M` de la línea del resumen… y el `INSERT` **no escribía el
vínculo con el plan** (`installment_group_id`). **[C]** resumen de la noche §3.5.

La pestaña Cuotas, la proyección y «próximas batallas» hacen todas un `JOIN` contra la tabla de
planes. Resultado: **una compra importada en 12 cuotas no existía para ninguna de las tres**, y las
once cuotas que faltaban no aparecían hasta el resumen siguiente.

Ése es el origen de las **12 filas huérfanas** que hoy no se pueden reparar sin adivinar
(`2026-09-03-coinify-orphan-installments.md`).

### 8.1 Lo que NO se resuelve importando el resumen

Esta sección es la que la spec del rediseño cita como *«lo que la auditoría anticipó en su §8»*
**[C]** spec §7.

**El 67 % de lo que el usuario tipea a mano no está en ningún PDF de tarjeta** **[C]** spec §0: son
transferencias y billeteras. Importar el resumen resuelve el setup (~140) y las cuotas, pero **no
toca las ~180 interacciones mensuales de régimen**.

Tampoco están en ningún archivo:

- **Las cuentas** (8 interacciones) — no existen en ningún documento.
- **Los recurrentes** (35 interacciones) — no existen en ningún documento.

Por eso el setup sólo puede bajar ~2,5× y no un orden de magnitud, y por eso **cualquier rediseño
que se quede en «arreglar el import de tarjeta» está maquillando el número**: bajaría ~198 a ~190 y
nada más **[C]** spec §5.

---

## 9. Qué vale conservar (y por qué el rediseño no debe borrar nada)

Coinify no es un módulo mal hecho. Es un módulo **bien hecho para el gesto equivocado** (anotar en
vez de confirmar). Estas piezas son buenas y hay que sacarlas intactas del rediseño **[C]** — la
lista sobrevive textual en la spec §1, «Lo que la auditoría marcó como bueno y se conserva intacto»:

1. **`Repetir último`.** Es el único atajo real que tiene el módulo: rellena el formulario con el
   último movimiento. **[V]** sigue vivo en `QuickAddForm.tsx:213-215`.
2. **El presupuesto como anillo de la rueda.** Un anillo que se llena informa sin juzgar; es lo
   contrario del semáforo rojo/verde que la investigación de mercado desaconseja
   (`2026-09-03-finance-apps-research.md`).
3. **El modo «Monto total» con vista previa del reparto.** Ya resolvía bien la ambigüedad de §6 —el
   problema no era el toggle, era que vivía en una sola de las tres puertas.
4. **El drill-down del cofre.** La navegación por cuenta está bien pensada; lo que le falta es que
   `account_id` no sea NULL (§3).
5. **La disciplina ARS/USD: nunca sumados.** Es una decisión de fondo, correcta y sostenida en todo
   el módulo.
6. **El par nominal · real, y la marca `~` de cotización aproximada.** Decir «esto es una
   estimación» con un símbolo, en vez de fingir precisión, es exactamente el criterio correcto para
   un país con inflación.
7. **El parser de impuestos** y **el dedupe por número de cuota**.
8. **`account:switched` en todos lados.** El módulo cumple la convención multi-cuenta sin agujeros.

> **La regla que sale de acá y que el rediseño obedeció:** *degradar antes que eliminar*. Nada de
> Coinify muere; lo que sobra deja de ser pestaña de primer nivel, no deja de existir.

---

## 10. Qué de esta auditoría sigue siendo cierto hoy (0.9.5)

Verificado contra el código de `master` al reconstruir este documento.

| Hallazgo de la auditoría | Estado en 0.9.5 | Evidencia |
|---|---|---|
| Default `'cash'` en el formulario | **ARREGLADO** — la semilla es `'transfer'` y se pide la moda real a `finance:getEntryDefaults` | **[V]** `QuickAddForm.tsx:67,79,114` |
| El motor de recurrentes escribía `'cash'` fijo | **ARREGLADO** — la plantilla tiene su columna `payment_method` | **[V]** `finance.balance.ts:567,574`; migración `finance` v19 en `src/modules/finance/finance.schema.ts:536` |
| El libro mayor perdía la tarjeta al cargar cuotas | **ARREGLADO** — un solo lugar arma el payload | **[V]** `src/modules/finance/utils/installment-payload.ts` |
| «Monto» ambiguo en libro mayor y Préstamos | **ARREGLADO** — el toggle se extrajo y se reusa en las tres puertas | **[V]** `AmountModeToggle.tsx`, usado en `QuickAddForm.tsx`, `InstallmentAddForm.tsx`, `Loans.tsx` |
| El import tiraba las cuotas | **ARREGLADO** — el import crea el plan, engancha la fila y proyecta | **[V]** `finance-import.ipc.ts:457,464,479,490` |
| Hay que crear la tarjeta antes de guardar una compra con tarjeta | **PARCIAL** — en el alta manual **sigue igual**; desde el import la tarjeta **se propone y se crea sola**, con cierre, vencimiento y últimos 4 | **[V]** `QuickAddForm.tsx:243-246` (sigue) vs. `Import.tsx:281-288,386` (nuevo) |
| ~330 interacciones para un mes | **ARREGLADO** — ~73 el primer mes, **~16 el mes de régimen** | **[C]** spec §7 y §11 |
| 6 pestañas / 696 px de desborde en el teléfono | **ARREGLADO** — 3 pestañas, la tira entra a 390 px sin scrollear | **[C]** spec §11.5 |
| Préstamos y Presupuestos de primer nivel | **DEGRADADO, no borrado** — Préstamos pasa a sub-sección de Compromisos; las rutas viejas siguen vivas como redirecciones | **[C]** spec §1 |
| **Tres caminos para la misma compra en cuotas** | **SIGUE ABIERTO** — se unificó el *payload*, no los *handlers*: los tres siguen existiendo y `createThirdPartyPurchase` sigue divergiendo | **[V]** `finance.ipc.ts:192,1180,1449`; **[C]** rúbrica de journey C7 3.ª: *«siguen las 3 altas de cuotas»* |
| **`account_id` NULL en 107/107** | **SIGUE ABIERTO** — el import de CSV escribe `account_id` no nulo en filas *nuevas*, pero las 107 existentes no se tocan y ninguna migración las repara | **[C]** spec §3 («cero filas modificadas») y rúbrica de journey C12 3.ª |
| **Sin «repetir lo de ayer» en finanzas** | **SIGUE ABIERTO** | **[C]** rúbrica de journey C2 3.ª |
| **Las 12 cuotas huérfanas** | **INTACTAS a propósito** | `2026-09-03-coinify-orphan-installments.md` |

---

## 11. Lo que no se pudo recuperar del original

En honor a lo que este documento predica sobre no inventar datos, lo que la reconstrucción **no**
recuperó:

- **El desglose interacción por interacción** de cada bloque de la §1 (cómo se llega a 8, a 14, a
  35, a 70). Sobreviven los totales por bloque, no el conteo de cada clic.
- **El conteo exacto de la tabla de presupuestos** en la base real (§4).
- **El listado de los 5 estados vacíos de Coinify sin CTA** que la auditoría censó; sólo sobrevive
  el número, citado en la rúbrica de journey C5.
- **Las capturas y las consultas SQL literales** que acompañaban cada medición.
