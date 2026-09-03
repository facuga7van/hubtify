# Las cuotas importadas viejas: por qué NO hay migración de reparación

Decisión tomada al arreglar los cuatro bugs de datos de Coinify (2026-09-03).
Medido sobre una copia read-only de `%APPDATA%\hubtify\hubtify.db` (v0.9.4).
**Este documento no contiene montos ni nombres de comercio.**

## Qué hay en la base

12 filas con `installments > 1` y `installment_group_id IS NULL`, todas
`source = 'import'`, escritas por tres lotes de abril de 2026.

| Dato | Estado en las 12 filas |
| --- | --- |
| `installment_number` | **NULL en las 12** |
| `credit_card_id` | **NULL en las 12** |
| `statement_period` | **NULL en las 12** |
| `import_batch_id` | apunta a 3 lotes que **no existen** en `finance_import_batches` (tabla vacía) |
| Identidad (comercio, fecha, monto, N) | **8 compras distintas**: un par ×2, otro par ×2, y una ×3 |

## Por qué no se puede reparar sin adivinar

1. **No sabemos en qué cuota va cada plan.** `installment_number` está en NULL y
   la descripción es el comercio pelado: el parser borra el marcador `NN/MM`
   antes de guardar. Sin la cuota actual no hay ni posición ni cuántas faltan.
2. **No sabemos de qué tarjeta son.** `credit_card_id` es NULL en las 12. Generar
   las cuotas que faltan sin tarjeta las escribe con `impacts_balance = 1`: serían
   gastos futuros nuevos golpeando el saldo. El arreglo saldría peor que el bug.
3. **4 de las 12 filas son reimportaciones de la misma compra.** Un grupo por fila
   triplicaría una compra en la pestaña Cuotas y en la proyección — el mismo
   síntoma que estamos arreglando, ahora visible.

Se puede *inferir* el mes del resumen: si se asume que la cuota 1 cae en el
resumen del mes de la compra, hay exactamente un mes (2025-11) que deja las 8
compras con `1 ≤ cuota ≤ N`. Es una coincidencia elegante y **sigue siendo una
suposición**: con `closing_day = 1` en las dos tarjetas, una compra del 12 de
noviembre cae en el resumen de diciembre, no en el de noviembre, y toda la serie
se corre un mes. No alcanza para escribir plata en la base de nadie.

## Qué sí se hizo

- El import **nuevo** ya crea el plan, engancha la fila y proyecta las cuotas que
  faltan, de forma idempotente entre resúmenes (`finance:importConfirm`).
- Las 12 filas viejas quedan **exactamente como están**: ninguna migración las
  toca. Siguen siendo transacciones válidas del libro mayor; lo único que les
  falta es el plan.

## Propuesta para el rediseño (no implementada acá)

Marcar en la UI las filas `installments > 1 AND installment_group_id IS NULL` con
una acción «completar plan» que pida lo único que falta —cuota actual y tarjeta—
y arme el grupo con el handler que ya existe. Es un dato de tres clics que solo
el usuario tiene, y evita que la app lo invente.

## Anotado para el rediseño

- El resumen imprime un bloque **«Cuotas a vencer»** con los próximos 6 meses más
  la cola (`docs/superpowers/plans/2026-09-03-pdf-import-potential.md`, §2). Hoy
  proyectamos las cuotas nosotros a partir de la que trae la línea; parsear ese
  bloque permitiría además **validar** la proyección contra lo que firma el banco.
  Queda afuera de este arreglo: es un parser nuevo, no un bug de datos.
- La **cotización aplicada NO está en el PDF** (solo el texto legal que describe
  cómo se calcula, mismo documento §2). Por eso una fila en dólares sigue
  guardando la cotización del día del import marcada como `process` —aproximada y
  avisada con `~`— en vez de una del papel que no existe.
