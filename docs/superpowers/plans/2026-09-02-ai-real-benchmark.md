# Nutrify: benchmark de estimación IA con los platos REALES del usuario

Fecha: 2026-09-02 · Rama: `feat/ai-0.9.2` · Tipo: medición (sin cambios de código) · Continúa a
`2026-09-02-ai-estimation-research.md` (benchmark "limpio" de 15 platos).

Artefactos (scratchpad de la sesión
`C:/Users/Facu/AppData/Local/Temp/claude/D--code-hubtify/53b860af-bd6a-438b-aad3-d62b0bf2bbb3/scratchpad/`):
`hubtify-ro.db` (copia de solo lectura de `%APPDATA%/hubtify/hubtify.db` + WAL), `real-set.json` (el set),
`bench-real.mjs` (harness, deriva de `bench.mjs`), `results-real.jsonl` (90 filas), `summarize-real.mjs`,
`summary-real.md`, `bench-real.log`. Misma key y misma forma de llamar a Gemini que el informe anterior.

Convención: **[V]** verificado (código, DB o medición); **[H]** hipótesis.

---

## 0. TL;DR

1. **La base tiene poco historial: 36 filas vivas de `food_log`, 18 descripciones únicas** (14 con IA, 4
   manuales), 2 entradas en `nutrition_ai_cache`. No llega a 40 platos; el set son esas 18, sin inventar.
2. **Correcciones reales encontradas: 2** (detectables porque el `ai_breakdown` guardado no suma el total).
   Más 4 valores manuales que el usuario considera correctos. Los otros 12 platos tienen referencia externa.
3. **Con los platos reales el prompt actual rinde MUCHO peor que con los 15 limpios**: MAE 195–203 kcal
   (vs 43–50), error relativo mediano 22 % (vs 11–12 %), solo **44 % dentro de ±20 %**. Sobre los 6 platos con
   referencia del propio usuario: MAE ~400 kcal y **0 % dentro de ±20 %**.
4. **La variante B del informe anterior (anclas de platos completos) mejora pero no alcanza**: MAE 125–149,
   53–67 % en ±20 %. Sus anclas son de choripán/pizza/tostado; el usuario come **pastel de papa, hamburguesas
   triples de local, asado con papa, sánguches de miga, milanesa de pollo, M&M, Tofi, moccalatte**.
5. **Con anclas de LO QUE ÉL COME (variante R): MAE 102, APE mediana 10 %, 83 % en ±20 %, 89 % en rango.**
   Un solo desastre nuevo ("porción y media de pastel de papa" → 1350) que enseña cómo NO escribir el ancla.
6. **Dos fallos sistemáticos que ninguna variante arregla sola**: (a) "porción y media" se interpreta como
   una porción o como tres, nunca como 1.5; (b) pastel de papa se valúa a 100 kcal/100 g (como si fuera puré),
   la mitad de lo real (~160).
7. **Hallazgo colateral grave [V]: cada fila histórica de `food_log` está DUPLICADA** (una con `sync_id`
   `legacy-…`, la otra con NULL o uuid), así que los totales diarios se duplican (2026-04-29 suma 5 460 kcal en
   6 filas que son 3 comidas). No es tema de este informe, pero hay que arreglarlo antes de usar el historial
   como few-shot personal (P3 del informe anterior). Ver §5.

---

## 1. Extracción [V]

Copia: `cp hubtify.db hubtify-ro.db` + `hubtify.db-wal` → abierta con `sqlite3 -readonly`. Tablas leídas:
`food_log` (`description, calories, source, ai_breakdown, protein_g, updated_at, deleted_at, sync_id`),
`nutrition_ai_cache`, `favorite_foods` (vacía), `frequent_foods` (vacía). No se leyó `nutrition_profile` ni
peso.

| Métrica | Valor |
|---|---|
| Filas vivas de `food_log` | 36 (27 `ai_estimate`, 7 `manual`, 2 `frequent` borradas) |
| Fechas | 2026-03-28 → 2026-09-02 (7 días con datos) |
| Descripciones únicas | **18** (14 IA, 4 manuales) |
| Filas duplicadas por sync | 16 pares (ver §5) |
| `nutrition_ai_cache` | 2 filas (`una medialuna con jamon y queso` 298, `pechuga de pollo chica a la plancha` 165) |

**Cómo se detectó una corrección [V].** En `Today.tsx` (`handleConfirmEstimation`) los items se reescalan con
`rescaleItem` para que el breakdown sume el total confirmado; en cambio `FoodLogItem.handleSave` llama
`onUpdate(id, { description, calories })` sin tocar `aiBreakdown`. Por lo tanto **`sum(ai_breakdown) ≠ calories`
⇒ el usuario editó la fila después de cargarla**. Los ítems de un solo elemento (sin breakdown) no permiten
saber si se corrigieron.

| descripción | estimado (suma del breakdown) | final | Δ |
|---|---|---|---|
| hamburguesa triple con cheddar y bacon, porcion de papas y porcion de nuggets | 1 200 + 450 + 300 = **1 950** | **1 750** | −200 (−10 %) |
| asado con papa al horno | 700 + 250 = **950** | **850** | −100 (−11 %) |

Manuales (referencia "lo que el usuario considera correcto"): `Sanguches de miga x3` 566 · `tofi` 270 ·
`moccalatte` 300 · `hamburguesa triple con papas de TMT` 2 000.

Nota [H]: las estimaciones IA de abril (p. ej. combo triple → 1 950, "dos porciones de pastel de papa" → 1 000)
NO coinciden con lo que el prompt actual devuelve hoy para el mismo texto (2 898 y 600). El pipeline de abril
era otro (prompt/modelo anteriores); no se puede usar esa columna como "lo que dice el prompt actual".

## 2. El set real (`real-set.json`) [V]

18 platos, tal cual los tipeó el usuario (con "hrevido", doble espacio, "x3", "TMT", "m&m"). Referencia por
prioridad: corrección del usuario > valor manual > referencia externa (USDA / tablas AR / marcas). El plato
#18 ("desayuno proteico") es ambiguo y solo tiene el valor aceptado; se incluye con rango ancho y se excluye
del subset "fuerte".

| # | descripción | ref [rango] | fuente |
|---|---|---|---|
| 1 | hamburguesa triple con cheddar y bacon, porcion de papas y porcion de nuggets | 1750 [1500–2000] | corrección del usuario |
| 2 | asado con papa al horno | 850 [700–1000] | corrección del usuario |
| 3 | Sanguches de miga x3 | 566 [480–660] | manual |
| 4 | tofi | 270 [150–300] | manual (Tofi 30 g real ≈ 155; el usuario cargó 270) |
| 5 | moccalatte | 300 [220–380] | manual |
| 6 | hamburguesa triple con papas de TMT | 2000 [1600–2300] | manual |
| 7 | milanesa | 400 [300–480] | externa (150 g × 220–310 kcal/100 g) |
| 8 | dos porciones de pastel de papa | 900 [700–1100] | externa (porción 300 g ≈ 450; usuario aceptó 1000) |
| 9 | dos milanesas de pollo con 2 tomates | 640 [500–800] | externa |
| 10 | un paquete de m&m | 230 [200–260] | externa (45 g, Mars) |
| 11 | porcion y media de pastel de papa | 675 [525–825] | externa |
| 12 | paquete de m&m | 230 [200–260] | externa |
| 13 | una porcion de pastel de  papa chica | 300 [230–380] | externa ("chica" = 50–70 % según el propio prompt) |
| 14 | porcion de arroz con pollo hrevido | 480 [380–600] | externa |
| 15 | asado con papa al horno y un pedazo de pan | 960 [800–1150] | derivada de la corrección #2 + pan |
| 16 | una medialuna con jamon y queso | 260 [220–330] | externa |
| 17 | pechuga de pollo chica a la plancha | 190 [140–260] | externa |
| 18 | desayuno proteico | 348 [250–500] | aceptado, ambiguo (excluido del subset fuerte) |

Subset **fuerte** = #1–#6 (referencia del propio usuario).

## 3. Medición [V]

Modelo `gemini-2.5-flash-lite`, `generationConfig` de producción (temperature 0.1, JSON mode, 2048 tokens),
parser réplica de `parseEstimate`, 1.2 s entre llamadas, 90 llamadas, 0 × 429.
- **A** = `SYSTEM_PROMPT` leído de `functions/src/index.ts` en tiempo de ejecución (HEAD `cb3c227`; el otro
  agente no había commiteado ni modificado `functions/` al momento de correr — `git status -- functions/` limpio).
- **B** = A + las 10 anclas de platos completos del informe anterior (idéntico a `bench.mjs`).
- **R** = B + 9 anclas de lo que este usuario come (valores externos, NO los del usuario, salvo que
  coincidan; texto exacto en `bench-real.mjs`). Advertencia de fuga: 4 de las 18 referencias son del usuario y
  algunas anclas de R apuntan al mismo plato — R es un techo, no una medición limpia.

### 3.1 Resultados

| variante | ok/n | MAE | APE mediana | % en ±20 % | % en rango | sesgo | lat. med. | fuerte (6): MAE | APE med. | % ±20 % |
|---|---|---|---|---|---|---|---|---|---|---|
| **A (prod)** | 18/18 | **203** | 22 % | **44 %** | 44 % | +44 | 725 ms | **420** | 43 % | **0 %** |
| A_rep | 18/18 | 195 | 22 % | 44 % | 44 % | +37 | 713 ms | 397 | 39 % | 0 % |
| B | 18/18 | 125 | 16 % | 67 % | 67 % | −16 | 722 ms | 178 | 17 % | 67 % |
| B_rep | 17/18 | 149 | 18 % | 53 % | 53 % | −19 | 620 ms | 206 | 25 % | 50 % |
| **R** | 18/18 | **102** | **10 %** | **83 %** | **89 %** | +29 | 636 ms | **132** | 12 % | 67 % |

Comparación con el benchmark limpio del informe anterior (mismo modelo, mismo prompt A): MAE 43–50 → **195–203**;
APE mediana 11–12 % → **22 %**. Las entradas reales son más largas (combos), usan marcas/locales ("TMT",
"Tofi", "m&m"), cantidades fraccionarias ("porción y media", "x3") y platos que no están en el prompt.

Determinismo: A vs A_rep difieren en 2 platos (combo triple 2898↔2910; TMT 2709↔2559). B vs B_rep en 4.
**B_rep #18 devolvió `{"items": []}`** (finish STOP, 5 tokens) → `parseEstimate` lanza `unparseable` → el
usuario ve un error. 1 de 90 llamadas; entrada ambigua ("desayuno proteico"). Vale un reintento automático
en ese caso [H].

### 3.2 Por plato (kcal; negrita = fuera de ±20 %)

| # | plato | ref | A | A_rep | B | B_rep | R |
|---|---|---|---|---|---|---|---|
| 1 | hamburguesa triple + papas + nuggets | 1750 | **2898** | **2910** | **2250** | **2400** | 1880 |
| 2 | asado con papa al horno | 850 | **654** | **654** | 779 | 779 | 880 |
| 3 | Sanguches de miga x3 | 566 | **702** | **702** | 660 | 660 | 660 |
| 4 | tofi | 270 | **450** | **450** | **450** | **450** | **155** |
| 5 | moccalatte | 300 | **150** | **150** | 250 | **200** | 300 |
| 6 | hamburguesa triple con papas de TMT | 2000 | **2709** | **2559** | 2172 | 2142 | **1575** |
| 7 | milanesa | 400 | 330 | 330 | 330 | 330 | 375 |
| 8 | dos porciones de pastel de papa | 900 | **600** | **600** | **600** | **600** | 1000 |
| 9 | dos milanesas de pollo con 2 tomates | 640 | 678 | 678 | 678 | 678 | 618 |
| 10 | un paquete de m&m | 230 | 230 | 230 | 230 | 230 | 230 |
| 11 | porcion y media de pastel de papa | 675 | **300** | **300** | **300** | **300** | **1350** |
| 12 | paquete de m&m | 230 | 230 | 230 | 230 | 230 | 230 |
| 13 | una porcion de pastel de  papa chica | 300 | **200** | **200** | **200** | **200** | 350 |
| 14 | porcion de arroz con pollo hrevido | 480 | 482 | 482 | **360** | **360** | 435 |
| 15 | asado con papa al horno y un pedazo de pan | 960 | **756** | **756** | 807 | **700** | 960 |
| 16 | una medialuna con jamon y queso | 260 | 274 | 274 | 261 | 261 | 298 |
| 17 | pechuga de pollo chica a la plancha | 190 | 165 | 165 | 165 | 165 | 165 |
| 18 | desayuno proteico | 348 | 340 | 339 | 340 | ERR | 408 |

### 3.3 Los 10 peores del prompt actual (A) y qué hizo el modelo

| plato | modelo | ref | Δ % | items del modelo (nombre · g · kcal) |
|---|---|---|---|---|
| tofi | 450 | 270 | +67 % | Tofi · **100 g** · 450 (un Tofi pesa 30 g) |
| hamburguesa triple + papas + nuggets | 2898 | 1750 | +66 % | pan ×3 180 g 504; **carne ×3 450 g 1125**; cheddar 60 g 228; bacon 40 g 216; papas 150 g 450; nuggets 150 g 375 (tres panes y 450 g de carne: no sabe qué es una "triple") |
| porcion y media de pastel de papa | 300 | 675 | −56 % | pastel de papa (porción y media) · 300 g · 300 (1.5 porciones = 300 g y **100 kcal/100 g**) |
| moccalatte | 150 | 300 | −50 % | moccalatte · 250 g · 150 (sin jarabe/crema; leche sola) |
| hamburguesa triple con papas de TMT | 2709 | 2000 | +35 % | pan ×3 504; carne ×3 1125; cheddar 180; papas grande 750; **"salsa especial (estimado)" 150** |
| dos porciones de pastel de papa | 600 | 900 | −33 % | pastel de papa ×2 · 600 g · 600 (100 kcal/100 g) |
| una porcion de pastel de papa chica | 200 | 300 | −33 % | 200 g · 200 (idem) |
| Sanguches de miga x3 | 702 | 566 | +24 % | sanguche de miga ×3 · 90 g · 702 (**780 kcal/100 g**: gramos de una cosa, kcal de otra) |
| asado con papa al horno | 654 | 850 | −23 % | asado de tira 200 g 500; papa al horno 200 g 154 (asado a 250 kcal/100 g = "carne magra" de la tabla) |
| asado con papa al horno y un pedazo de pan | 756 | 960 | −21 % | asado 200 g 500; papa 150 g 116; pan francés 50 g 140 |

Peores de R (los nuevos): "porción y media de pastel de papa" → 1350 (450 g × **300 kcal/100 g**: tomó "450–500
kcal" del ancla como si fuera 450 g); "tofi" → 155 (el ancla dice 30 g ≈ 155 y el usuario cargó 270: acá la
referencia del usuario probablemente no sea un Tofi clásico); "TMT" → 1575 (bajó demasiado: las anclas de
hamburguesa de local son 1100–1200 + papas 425, y descartó la salsa).

### 3.4 Patrones (lo que se repite entre variantes)

1. **Pastel de papa = 100 kcal/100 g en A y B** (usa la fila "Puré 100 kcal/100 g" de la tabla). Real: carne
   picada + puré + queso ≈ 150–170 kcal/100 g. Afecta 3 de 18 platos del usuario y es su plato más repetido.
2. **"porción y media" no existe para el modelo**: A/B → 300 g (una porción), R → 450 g pero con kcal/100 g
   inventado. Ni un solo acierto en 5 corridas.
3. **"triple" se descompone en 3 panes + 450 g de carne** (A). Con ancla de "hamburguesa triple de local" (R)
   entra en rango.
4. **Marcas/locales sin ancla se inventan**: Tofi 100 g, moccalatte = leche con café, "salsa especial (estimado)".
5. **El modificador "chica" sí se aplica** (pastel chico 200 g, pechuga chica 100 g): no es un problema del
   modelo, es que el usuario no lo usa casi nunca.
6. **Asado siempre corto** (200 g × 250 kcal/100 g = 500): la tabla del prompt solo tiene "carne vacuna magra".

## 4. Anclas recomendadas para la tabla del prompt (cubren lo que este usuario come)

Formato recomendado: **kcal/100 g + peso de la porción + kcal de la porción**, nunca solo "porción ≈ N kcal"
(§3.3: el modelo confunde "450 kcal" con "450 g"). Y escalado explícito de fracciones.

```
- Pastel de papa (carne picada + puré + queso): 160 kcal/100g. Porción 300g ≈ 480 kcal; chica 200g ≈ 320
- "Porción y media" = 1.5 porciones (450g). "Media porción" = 0.5. Multiplicá SIEMPRE los gramos, no las kcal
- Asado de tira / costilla con grasa: 290 kcal/100g. Porción 250g ≈ 720 kcal (no usar "carne magra")
- Papa al horno con aceite: 120 kcal/100g. Porción 150g ≈ 180 kcal
- Milanesa de pollo: 220 kcal/100g, 1 unidad 130g ≈ 290 kcal. Milanesa de carne 1 unidad 150g ≈ 380
- Sánguche de miga jamón y queso (1 unidad = 2 tapas, 90g): ~190 kcal. "x3" = 3 unidades ≈ 570
- Hamburguesa de local/cadena: simple 550, doble 850, triple con cheddar y bacon 1100–1200. Papas fritas
  porción mediana 150g ≈ 430 kcal; 6 nuggets ≈ 280. Combo triple + papas ≈ 1600–1900 (sin agregar salsas
  que el usuario no nombró)
- Golosinas por paquete: M&M 45g ≈ 230; Tofi barra 30g ≈ 155 (bañado grande 60g ≈ 300); alfajor triple ≈ 250
- Café de cadena: moccalatte / mocha grande 450ml ≈ 300 kcal; latte ≈ 190; cortado ≈ 30
- Medialuna con jamón y queso: ~260 kcal
- Arroz cocido porción 180g ≈ 235; pechuga hervida/plancha 150g ≈ 250 (chica 100–120g ≈ 170–200)
```

Además, tres correcciones al prompt actual que salen de este set y no de los 15 limpios:
- Agregar a "Límites de sanidad": *combo de hamburguesería (triple + papas): 1 500–2 000 kcal*. El límite
  actual "plato principal 400–700" no contempla nada de esto y el modelo se va a 2 900.
- En "Modificadores": *"porción y media" → ×1.5 de los gramos; "x3", "×2", "dos" → multiplicar unidades*.
- **No inventar ingredientes no nombrados** ("salsa especial (estimado)", cheddar en "hamburguesa triple con
  papas"): el usuario ya escribe lo que comió.

Criterio de aceptación sugerido para el prompt nuevo, con `bench-real.mjs`: MAE ≤ 110, ≥ 80 % en ±20 %, y
"porción y media de pastel de papa" entre 525 y 825 en dos corridas.

## 5. Hallazgo colateral: filas duplicadas en `food_log` [V]

Query sobre la copia: `GROUP BY date, time, description, calories HAVING COUNT(*) > 1` → **16 pares**, todos
vivos (`deleted_at IS NULL`). En cada par una fila tiene `sync_id = 'legacy-<date>|<time>|<kcal>|<desc>'` y la
otra `NULL` (filas de marzo–mayo) o un uuid (filas del 2026-09-01). Totales diarios afectados: 2026-04-28
3 980, 04-29 5 460, 04-30 3 232, 05-01 3 700, 09-01 4 066 (la mitad de eso es lo real). [H] Origen: un backfill
de `sync_id` con prefijo `legacy-` (`src/modules/nutrition/nutrition.schema.ts:234` en la migración local y
`shared-logic/modules/sync.ipc.ts:453` en `mergeNutritionData`) se cruzó con un merge desde Firestore que
trajo las mismas filas con otro `sync_id` (NULL para las de marzo–mayo, uuid para las del 09-01);
`idx_food_log_sync_id` no puede detectarlo porque los ids difieren. Impacta en balance diario, HP por nutrición y en cualquier "few-shot personal" (cada plato cuenta
doble). Recomendación: dedupe por `(date, time, description_norm, calories)` conservando la fila con uuid o
`legacy-`, y test de merge que no duplique.

## 6. Límites

- 18 platos, 2 correcciones reales, 4 manuales: el subset fuerte tiene 6 elementos; con esa n, la diferencia
  entre B y R no es estadísticamente sólida, pero la dirección coincide con el informe anterior.
- La referencia externa de pastel de papa (450/porción) y del Tofi (270 del usuario vs 155 del producto
  clásico) tienen incertidumbre propia; los patrones de §3.4 no dependen de ellas.
- Solo el modelo de producción (`gemini-2.5-flash-lite`); no se repitió el 3.5-flash-lite sobre este set.
- Solo la cuenta activa de esta máquina; otras cuentas viven en Firestore y no se leyeron.
