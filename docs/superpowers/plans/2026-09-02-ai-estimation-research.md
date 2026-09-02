# Nutrify: por qué la IA "estima medio para el orto" y qué se puede hacer gratis

Fecha: 2026-09-02 · Rama: `fix/mobile-0.9.1` · Tipo: investigación (sin cambios de código)

Artefactos crudos (fuera del repo, en el scratchpad de la sesión
`C:/Users/Facu/AppData/Local/Temp/claude/D--code-hubtify/53b860af-bd6a-438b-aad3-d62b0bf2bbb3/scratchpad/`):
`bench.mjs` (corrida 1, 225 llamadas), `bench-ext.mjs` (corrida 2, 105 llamadas), `results.jsonl`,
`results-ext.jsonl`, `summarize-all.mjs`, `summary-all.md`, `bench.log`, `bench2.log`, `bench-ext.log`.
La key de Gemini se lee de `gemini.key` (es la misma que el secret `GEMINI_API_KEY` del proyecto
`hubtify-ab4ab`, verificado comparando ambas) y nunca se imprime.

Convención: **[V]** = verificado leyendo código, documentación oficial o midiendo; **[H]** = hipótesis.

---

## 0. TL;DR

1. **El intento anterior no murió: el benchmark terminó.** `bench2.log` cierra con `DONE exit=0`, 225 filas
   en `results.jsonl`. Lo que faltó fue el informe. Esta sesión sumó 105 llamadas más (repeticiones para medir
   varianza + `gemini-3.1-flash-lite` + `gemini-3.8-flash`). Total: 330 llamadas reales, 0 × 429.
2. **Medido con 15 platos argentinos "limpios", el prompt actual sobre `gemini-2.5-flash-lite` NO es un
   desastre**: error absoluto medio 43–50 kcal, error relativo mediano 11–12 %, 87 % dentro del rango de
   referencia. Falla sistemáticamente en dos platos (tostado → 238 kcal; mate con 3 bizcochitos → 137 kcal),
   y devuelve **el mismo número siempre** para el mismo texto (temperatura 0.1) — así que un error se repite
   en cada carga y se siente peor de lo que el promedio dice.
3. **La palanca más grande y gratis es el prompt, no el modelo**: agregar una tabla de "porciones estándar
   argentinas de platos completos" (variante B) bajó el error en los platos cubiertos a 11–18 kcal en los
   modelos 3.x y no empeoró los no cubiertos. La variante "razoná la porción antes del número" (C) **empeoró**
   en el modelo actual (pizza → 780 kcal) y duplica tokens de salida. No adoptarla.
4. **Mejor combinación medida: `gemini-3.5-flash-lite` + variante B → MAE 30–33 kcal, 100 % en rango,
   ~960 ms de latencia mediana, dos corridas casi idénticas.** `gemini-3.1-flash-lite` + B da lo mismo
   (MAE 30) pero tiene fecha de apagado (2027-05-07). `gemini-3.8-flash` no aporta nada extra y cuesta 8×.
5. **"Cambiar a `gemini-2.5-flash`" es una trampa**: con thinking por defecto tarda 8 s y trunca el JSON
   (`MAX_TOKENS`) en 4–6 de 15 platos. Solo sirve con `thinkingBudget: 0`, y ahí rinde igual que flash-lite.
6. **¿Es gratis?** Todos los modelos Flash/Flash-Lite 2.5 y 3.x tienen "Free tier" en la página oficial de
   precios. PERO el tier lo decide el proyecto de Google Cloud, no la key: si la key vive en un proyecto con
   facturación (y `hubtify-ab4ab` la tiene: Cloud Functions + Secret Manager exigen Blaze), cada llamada se
   cobra. A los volúmenes de una persona son **centavos**: ~US$ 0,23/mes hoy, ~US$ 0,90/mes con
   `gemini-3.5-flash-lite` (30 llamadas/día). Grounding con Google Search NO conviene: US$ 14–35 por mil
   llamadas (60–150× el costo del modelo) y el error no está en "hechos" sino en porciones.
7. El cache local `nutrition_ai_cache` no expira nunca y no distingue "lo dijo el modelo" de "lo corrigió el
   usuario"; el widget del dashboard ni lee ni escribe ese cache. Las correcciones del usuario no llegan al
   modelo. Ahí está la segunda palanca: **few-shot personal** a partir de las correcciones.

---

## 1. Estado actual con evidencia

### 1.1 Backend: `functions/src/index.ts` + `functions/src/gemini.ts` [V]

| Aspecto | Valor | Dónde |
|---|---|---|
| Modelo | `gemini-2.5-flash-lite` | `gemini.ts:7` `GEMINI_MODEL` |
| Endpoint | `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=…` (API key, no Vertex) | `index.ts` |
| generationConfig | `temperature: 0.1`, `responseMimeType: 'application/json'`, `maxOutputTokens: 2048`, **sin** `responseSchema`, **sin** `thinkingConfig` | `gemini.ts buildGenerationConfig()` |
| Por qué sin schema | Comentario en `gemini.ts`: el schema hacía que flash-lite loopeara (`"protein_g": 1.5000000000000002220446…`) hasta el cap → 30 s → 504. Cloud Logging del 2026-09-02 lo confirma. | `gemini.ts` |
| Qué recibe el modelo | `systemInstruction` = `SYSTEM_PROMPT` (constante, ~1 990 tokens) + `contents` = **solo `description.trim()`**. Sin idioma, sin porción, sin perfil, sin hora, sin historial. | `gemini.ts buildRequestBody()` |
| Timeout servidor | 30 s (`AbortController`) → `deadline-exceeded` | `index.ts` |
| Auth | `context.auth` obligatorio; `data.description` string no vacío; ningún otro parámetro se acepta | `index.ts` |
| `parseEstimate` | Lee solo `parts[0].text`, `JSON.parse`, exige `items[]` no vacío, filtra items con `calories > 0`, redondea, macros a `number|null` (0 se conserva como 0), suma totales. **Ignora `grams`** aunque el prompt los pide. | `gemini.ts parseEstimate()` |

**El prompt completo** (`SYSTEM_PROMPT`, `index.ts`) tiene: rol ("nutricionista … comida argentina"),
método "gramos primero", reglas de macros, modificadores de tamaño (chico 50–70 %, grande 140–170 %), una
tabla de **kcal/100 g de ~24 ingredientes** con pesos unitarios, pesos por formato (miga, molde, felipe,
tostada), **límites de sanidad** (sándwich simple 150–350, plato principal 400–700, snack 80–250, fruta
40–120, bebida 0–150) y **5 ejemplos few-shot** (milanesa con puré → 530; 3 empanadas → 900; sanguche chico
de queso y tomate; café con leche y 2 medialunas; ensalada). Es un prompt razonablemente bueno; tiene anclas de
**ingredientes** pero casi ninguna de **platos completos** (choripán, tostado, tarta, asado, pizza…).

### 1.2 Cliente [V]

- `src/modules/nutrition/estimate-service.ts`: `httpsCallable('estimateNutrition', { timeout: 35000 })`,
  envía `{ description }` y nada más. Reintento: 1 solo (`RETRY_DELAYS_MS = [800]`) y **solo** para
  `unavailable/internal/resource-exhausted/aborted/cancelled` o errores sin código; `deadline-exceeded` no se
  reintenta (documentado en `estimate-core.ts`: el servidor ya abortó y el mismo prompt va a tardar igual).
- `src/modules/nutrition/estimate-with-cache.ts` `resolveEstimate()`: consulta `nutrition:getCachedEstimate`
  primero salvo `skipCache`; si hay hit, no hay red (`origin: 'cache'`).
- **Cache `nutrition_ai_cache`** (`src/modules/nutrition/nutrition.schema.ts` v14,
  `shared-logic/modules/nutrition.ipc.ts:493-558`): clave = `description_norm` (minúsculas ASCII, sin
  acentos, espacios colapsados — `normalize.ts`), columnas `calories, ai_breakdown, protein_g, carbs_g,
  fat_g, hits, created_at, updated_at`. **Sin expiración, sin versión de prompt/modelo, sin columna que
  indique si el valor lo puso el modelo o el usuario.** Local-only a propósito (no está en
  `USER_DATA_TABLES`). `cacheEstimate` hace upsert: una corrección REEMPLAZA el valor y borra el breakdown.
- **UI `Today.tsx`** (`handleEstimate`/`handleConfirmEstimation`, líneas 355–520 y 1540–1600):
  - El usuario **sí puede corregir**: cada ingrediente tiene input de kcal (`EstimationBreakdown`,
    `rescaleItem` reescala los macros) y se pueden quitar ingredientes; si no hay items, edita el total.
  - Al confirmar se guarda en `food_log` y en el cache con `corrected = calories !== estimation.totalCalories`.
  - **No hay cantidad ni porción** en el flujo de IA: ni gramos, ni "chica/grande". El `PortionPicker`
    (×0.5, ×1.5…) existe **solo** para favoritos/frecuentes (`openPortionFavorite`, `scalePortion`).
  - El botón "Re-estimar con IA" (`nutrify.reEstimate`) solo aparece cuando el resultado vino del cache.
- `FoodLogItem.tsx:131-147`: editar una fila ya registrada también escribe el cache con `corrected: true`;
  `handleReEstimate` llama directo al modelo y refresca el cache.
- **`NutritionDashboardWidget.tsx:75-92`**: llama `estimateNutrition()` directo — **ni lee ni escribe el
  cache**. Un plato cargado desde el dashboard no aprende ni se beneficia de correcciones previas.

### 1.3 Tests y documentación previa [V]

- `tests/functions/gemini.test.ts`: asegura que NO hay `responseSchema`, cap de 2048 tokens, cuerpo de
  request, y `parseEstimate` (suma, rechaza truncado/vacío/sin items). **Ningún test mide precisión.**
- `tests/modules/nutrition/estimate-robustness.test.ts`: normalización, clasificación de errores, política
  de timeout/retry, `normalizeResult`.
- `docs/superpowers/specs/2026-03-28-gemini-proxy-cloud-function-design.md` (mover Gemini a Cloud Function),
  `docs/superpowers/plans/2026-03-22-nutrify-ai-only.md` (época Ollama), `2026-06-26-nutrify-deep-improvements.md`
  (macros). Ninguna discute precisión, modelo ni prompt engineering.

---

## 2. Diagnóstico

| # | Hipótesis del pedido | Veredicto | Evidencia |
|---|---|---|---|
| a | Prompt sin anclas / sin gramos / sin few-shot | **Parcialmente falso.** Ya pide gramos primero, ya tiene 5 few-shot y 24 anclas de ingredientes. Lo que le falta son anclas de **platos completos**. | Prompt en `index.ts`; benchmark: variante B (anclas de platos) es la única que mejora consistentemente (§4). |
| b | Sin cantidad/porción | **Verdadero.** Solo viaja el texto. El prompt entiende "chico/grande" pero la UI no ofrece ese dato. | `buildRequestBody`, `Today.tsx`. |
| c | Platos argentinos que un modelo chico conoce mal | **Matizado.** Milanesa, empanada, choripán, pizza, asado los estima bien (dentro del rango en todos los modelos). Falla en **tostado** (todos los modelos 2.5 lo subestiman: 238–261) y en **bizcochitos** (137–230). No es "no conoce": es que el prompt lo empuja: "Sándwich/sanguche simple: 150–350 kcal (NUNCA 450+)" + "Tostada: 1 rebanada = 25 g". | Tabla por plato (§4.3). |
| d | `flash-lite` es el más chico | **Verdadero pero irrelevante en aislamiento.** Con el prompt actual, `gemini-2.5-flash` (sin thinking), `3.5-flash` y `3.8-flash` NO son mejores que `2.5-flash-lite` (MAE 49–63 vs 43–50). El salto viene de prompt + modelo 3.x-lite juntos. | §4.1. |
| e | Temperatura | 0.1 → casi determinista: 13/15 platos idénticos entre dos corridas; los 2 que cambiaron oscilaron **210 kcal** (napolitana 890 ↔ 1100). Bajar a 0 no mejora precisión, solo consistencia. | `lite25|A` vs `lite25|A_rep`. |
| f | No usa historial/correcciones | **Verdadero.** El cache guarda la corrección solo para el texto EXACTO normalizado; "milanesa con pure" corregida no ayuda a "milanesa napolitana". El modelo nunca ve correcciones. | `resolveEstimate`, `buildRequestBody`. |
| g | El cache devuelve una estimación mala para siempre | **Verdadero si el usuario confirmó sin corregir.** Sin expiración ni versión; cambiar el prompt o el modelo no invalida nada. Mitigación existente: el botón "Re-estimar con IA" aparece en hits de cache. | `nutrition.ipc.ts:493-558`, `Today.tsx:1593-1598`. |

Hallazgos que NO estaban en la lista:

- **Los few-shot del prompt se devuelven literalmente.** "una milanesa de carne con puré" → **530 kcal en
  las 22 corridas de los 7 modelos** — es el ejemplo #1 del prompt. Y "2 empanadas" → 600 en casi todas (el
  ejemplo dice 3 → 900). Consecuencia doble: (1) los ejemplos son la palanca más fuerte que existe, más que el
  modelo; (2) el plato #1 del benchmark está contaminado y hay que leerlo así.
- **`gemini-2.5-flash` con thinking por defecto es inutilizable con este `maxOutputTokens`**: los
  "thoughts" (1 300–1 960 tokens) consumen el presupuesto de 2 048 y el JSON sale truncado (`MAX_TOKENS`,
  `unparseable`) en 4/15 (A) y 6/15 (D), con 8–10 s de latencia. Esto explicaría un "probé flash y era peor".
- **Referencias con ±15 % de ruido.** Las fuentes públicas discrepan entre sí (empanada al horno: 263 / 280 /
  310 kcal; tostado: 275 / 380 / 456). Un MAE de 30–50 kcal ya está en el piso de ruido de la referencia:
  por debajo de ~30 kcal el benchmark no distingue modelos.
- **[H] El benchmark usa entradas limpias.** Lo que el usuario tipea en la vida real ("2 tostados y un
  cortado", "restos de la pasta de ayer, poco", "medialunas") puede rendir peor. La mejor forma de saberlo es
  armar un segundo set con **sus** descripciones reales y valores corregidos (están en `food_log` con
  `source='ai_estimate'` y en `nutrition_ai_cache`).

---

## 3. Qué es gratis (precios y límites con URL)

Fuente: https://ai.google.dev/gemini-api/docs/pricing (página fechada 2026-09-02) [V] y
https://ai.google.dev/gemini-api/docs/rate-limits [V].

| Modelo | Free tier | Pago (USD / 1M tokens, in / out) | Apagado anunciado (https://ai.google.dev/gemini-api/docs/deprecations) |
|---|---|---|---|
| gemini-2.5-flash-lite (actual) | Sí, "Free of charge" | 0.10 / 0.40 | Ninguno |
| gemini-2.5-flash | Sí | 0.30 / 2.50 | Ninguno |
| gemini-2.5-pro | Sí | 1.25 / 10.00 | Ninguno |
| gemini-3.1-flash-lite | Sí | 0.25 / 1.50 | **2027-05-07** |
| gemini-3.5-flash-lite | Sí | 0.30 / 2.50 | Ninguno |
| gemini-3.5-flash | Sí | 1.50 / 9.00 | Ninguno |
| gemini-3.6 / 3.7 / 3.8-flash | Sí | 0.75 / 3.75 (hasta 2026-12-31; después 1.50 / 7.50) | Ninguno |
| gemini-3.1-pro-preview | **No** | 2.00 / 12.00 | — |

Nota: una búsqueda web devolvió "2.5-flash-lite se retira el 16/10/2026"; la página oficial de
deprecaciones dice "No shutdown date announced". Ignorar la fuente terciaria.

**Cómo se decide el tier** (rate-limits): Free = "Active project or free trial"; Tier 1 = "Set up and link an
active billing account". Es **por proyecto de Google Cloud**, no por key. Google ya no publica los RPM/RPD
fijos en la página: remite a https://aistudio.google.com/rate-limit (requiere login). Cifras de terceros
para el free tier de 2.5-flash-lite: 15 RPM / 1 000 RPD (no oficiales).

**Qué tier tiene Hubtify [H fuerte]:** `hubtify-ab4ab` está en plan Blaze (Cloud Functions v1 con
`secrets:` exige facturación). Si la key `AIzaSy…` fue creada en ese proyecto, la API se cobra (Tier 1). A
favor de "pago": 330 llamadas hoy a ~1/s y 60 en paralelo en la corrida anterior sin un solo 429, algo
incompatible con 15 RPM. **Cómo confirmarlo en 1 minuto:** AI Studio → "API keys" muestra el proyecto y el
plan de cada key; o Cloud Console → Billing → informe filtrado por "Generative Language API".

**Costo real a escala de UNA persona** (30 llamadas/día, ~2 000 tokens in + ~150 out por llamada, medido):

| Modelo | USD / llamada | USD / mes |
|---|---|---|
| 2.5-flash-lite | 0.00026 | **0.23** |
| 3.1-flash-lite | 0.00073 | 0.65 |
| 3.5-flash-lite | 0.00098 | **0.88** |
| 2.5-flash (thinking 0) | 0.00098 | 0.88 |
| 3.8-flash (thinking low) | 0.0023 | 2.0 |
| 3.5-flash | 0.0048 | 4.3 |

Si el proyecto está en free tier, todo esto es 0. Si está en Tier 1, "no gastar plata extra" significa
"menos de un dólar por mes" para cualquier flash-lite.

**Grounding con Google Search:** free tier 2.5 = 1 500 RPD gratis; 3.x = 5 000 búsquedas/mes gratis; pago
= US$ 35 / 1 000 (2.5) o US$ 14 / 1 000 (3.x) — es decir **US$ 0,014–0,035 por llamada, 60–150× el costo
del modelo**. Además agrega latencia y el error que medimos es de **porción**, no de "no sabe cuántas
calorías tiene un chorizo". **No conviene.**

---

## 4. Benchmark

### 4.1 Diseño [V]

- 15 platos (lista pedida), un texto por plato, tal cual lo tipearía el usuario.
- Prompt A = **el de producción**, leído del archivo `functions/src/index.ts` en tiempo de ejecución.
- Variantes: **B** = A + tabla de 10 "porciones estándar argentinas de platos completos" (cubre 9 de los
  15 platos → se reporta aparte "en tabla" vs "fuera de tabla" para medir generalización vs memorización);
  **C** = A + "escribí `reasoning` con la porción en gramos ANTES de los items; macros deben cerrar";
  **D** = B + C.
- `generationConfig` idéntica a producción (`temperature 0.1`, JSON mode, `maxOutputTokens 2048`), más
  `thinkingConfig` donde se indica. Parser = réplica de `parseEstimate`.
- 1 llamada por (modelo, variante, plato), secuencial, ≥1.2 s entre llamadas. `_rep` = segunda pasada
  idéntica para medir varianza.
- Métricas: MAE (kcal), error relativo mediano, % dentro del rango de referencia, sesgo medio, latencia
  mediana/p95, tokens de thinking.

### 4.2 Resultados: modelo × variante [V]

| modelo | variante | ok/n | MAE kcal | APE mediana | % en rango | sesgo | lat. mediana | lat. p95 | thoughts/req | tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|
| **2.5-flash-lite (prod)** | **A (prod)** | 15/15 | **50** | 12 % | **87 %** | −25 | **708 ms** | 1330 ms | 0 | 1993/116 |
| 2.5-flash-lite | A_rep | 15/15 | 43 | 11 % | 87 % | −12 | 660 ms | 1325 ms | 0 | 1993/116 |
| 2.5-flash-lite | B | 15/15 | 43 | 9 % | 87 % | −6 | 679 ms | 1444 ms | 1 | 2324/117 |
| 2.5-flash-lite | B_rep | 15/15 | 38 | 8 % | 93 % | −11 | 737 ms | 1746 ms | 1 | 2324/116 |
| 2.5-flash-lite | C | 15/15 | **102** | 14 % | **67 %** | +47 | 995 ms | 1728 ms | 2 | 2175/223 |
| 2.5-flash-lite | D | 15/15 | 55 | 11 % | 87 % | +7 | 908 ms | 1789 ms | 2 | 2506/227 |
| 3.5-flash-lite | A | 15/15 | 69 | 13 % | 80 % | +30 | 983 ms | 1692 ms | 0 | 1993/193 |
| 3.5-flash-lite | A_rep | 15/15 | 79 | 11 % | 80 % | +27 | 1068 ms | 1779 ms | 0 | 1993/195 |
| **3.5-flash-lite** | **B** | 15/15 | **30** | **4 %** | **100 %** | +7 | 961 ms | 1555 ms | 0 | 2324/146 |
| **3.5-flash-lite** | **B_rep** | 15/15 | **33** | 5 % | **100 %** | +4 | 966 ms | 1453 ms | 0 | 2324/153 |
| 3.5-flash-lite | C | 15/15 | 64 | 12 % | 87 % | 0 | 1098 ms | 1878 ms | 0 | 2175/215 |
| 3.5-flash-lite | D | 15/15 | 48 | 12 % | 87 % | +15 | 1142 ms | 1979 ms | 0 | 2506/227 |
| 3.1-flash-lite | A | 15/15 | 69 | 12 % | 80 % | +9 | 1186 ms | 1908 ms | 0 | 1993/181 |
| 3.1-flash-lite | B | 15/15 | 30 | 8 % | 100 % | −16 | 1178 ms | 1835 ms | 0 | 2324/148 |
| 2.5-flash (thinking default) | A | **11/15** | 77 | 12 % | 53 % | +26 | **8093 ms** | 9740 ms | 1427 | 1993/147 |
| 2.5-flash (thinking default) | D | **9/15** | 63 | 9 % | 53 % | +33 | 8431 ms | 9838 ms | 1455 | 2506/169 |
| 2.5-flash (thinkingBudget 0) | A | 15/15 | 63 | 12 % | 87 % | +1 | 1173 ms | 2831 ms | 0 | 1993/175 |
| 2.5-flash (thinkingBudget 0) | D | 15/15 | 65 | 10 % | 80 % | +31 | 1467 ms | 2584 ms | 0 | 2506/231 |
| 3.5-flash (thinking minimal) | A | 15/15 | 49 | 12 % | 100 % | −27 | 1471 ms | 2636 ms | 0 | 1993/213 |
| 3.5-flash (thinking minimal) | D | 15/15 | 75 | 15 % | 73 % | −17 | 1697 ms | 2419 ms | 0 | 2506/249 |
| 3.8-flash (thinking low) | A | 15/15 | 61 | 13 % | 93 % | −10 | 1114 ms | 2583 ms | 17 | 1993/205 |
| 3.8-flash (thinking low) | B | 15/15 | 38 | 6 % | 100 % | −21 | 1306 ms | **7987 ms** | 0 | 2324/200 |

Los fallos de `2.5-flash` con thinking son todos `finishReason: MAX_TOKENS` con JSON cortado.
`gemini-3.8-flash` rechaza `thinkingLevel: minimal` (HTTP 400: "Thinking level MINIMAL is not supported
for this model"); se usó `low`.

**Memorización vs generalización** (variante B ancla 9 platos; los otros 6 quedan fuera):

| modelo | variante | MAE en tabla (9) | % rango en tabla | MAE fuera (6) | % rango fuera |
|---|---|---|---|---|---|
| 2.5-flash-lite | A | 49 | 78 % | 50 | 100 % |
| 2.5-flash-lite | B / B_rep | 45 / 36 | 78 / 89 % | 40 / 40 | 100 % |
| 2.5-flash-lite | C | 111 | 56 % | 90 | 83 % |
| 3.5-flash-lite | A / A_rep | 74 / 75 | 67 % | 60 / 85 | 100 % |
| 3.5-flash-lite | B / B_rep | **11 / 12** | **100 %** | 59 / 63 | 100 % |
| 3.1-flash-lite | B | 12 | 100 % | 58 | 100 % |
| 3.8-flash | B | 18 | 100 % | 66 | 100 % |

Lectura honesta: las anclas de plato arreglan **lo que está en la tabla** (MAE 11–18) y **no empeoran** lo
que no está (58–66, igual que sin anclas). O sea: la tabla no "enseña a estimar", pero sí garantiza los 20–30
platos que una persona repite el 80 % del tiempo. Los platos fuera de tabla quedan en ±60 kcal, que es el
ruido de la referencia.

### 4.3 Detalle por plato (kcal; ✗ = fuera de rango) [V]

| # | plato | ref [rango] | 2.5-lite A | 2.5-lite B | 3.5-lite A | 3.5-lite B | 3.1-lite B | 2.5-flash nt A | 3.5-flash A | 3.8-flash B |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | una milanesa de carne con puré (†) | 600 [500–700] | 530 | 530 | 530 | 530 | 530 | 530 | 530 | 530 |
| 2 | 2 empanadas de carne | 580 [520–650] | 600 | 600 | 600 | 600 | 580 | 600 | 600 | 580 |
| 3 | un choripán | 480 [430–580] | 458 | 480 | 593 ✗ | 529 | 549 | 468 | 488 | 504 |
| 4 | medialuna con café con leche | 280 [220–340] | 250 | 305 | 250 | 270 | 305 | 250 | 250 | 250 |
| 5 | un plato de fideos con tuco | 480 [380–600] | 442 | 442 | 471 | 461 | 442 | 484 | 401 | 449 |
| 6 | asado: 2 costillas + chorizo | 1000 [800–1200] | 990 | 990 | 1195 | 1195 | 945 | 1110 | 880 | 850 |
| 7 | una porción de pizza muzzarella | 300 [230–380] | 375 | 300 | 325 | 300 | 300 | 375 | 298 | 300 |
| 8 | un sándwich de miga jamón y queso | 220 [150–300] | 254 | 165 | 215 | 220 | 220 | 170 | 201 | 233 |
| 9 | un mate con 3 bizcochitos | 85 [60–120] | 137 ✗ | 94 | 120 | 89 | 95 | 202 ✗ | 108 | 89 |
| 10 | una manzana | 95 [70–120] | 78 | 78 | 78 | 78 | 78 | 78 | 78 | 78 |
| 11 | un yogur con granola | 310 [230–400] | 317 | 255 | 270 | 285 | 255 | 270 | 270 | 279 |
| 12 | milanesa napolitana con papas fritas | 1050 [850–1250] | 890 | 1100 | 1020 | 1020 | 940 | 920 | 970 | 952 |
| 13 | una porción de tarta de jamón y queso | 430 [330–550] | 375 | 430 | 630 ✗ | 430 | 430 | 450 | 402 | 490 |
| 14 | un tostado | 380 [280–480] | **238 ✗** | **256 ✗** | 294 | 380 | 380 | **261 ✗** | 295 | 368 |
| 15 | una hamburguesa completa | 600 [480–750] | 586 | 770 ✗ | 756 ✗ | 614 | 595 | 732 | 713 | 623 |

(†) Plato #1 es literalmente el ejemplo few-shot del prompt: los 7 modelos lo repiten. "una manzana" → 78 en
todos = 150 g × 52 kcal/100 g de la tabla del prompt (USDA Foundation da 60–65 kcal/100 g para
manzanas con cáscara → 90–97 kcal; la tabla del prompt usa el valor viejo de SR Legacy). Tabla completa con
las 22 columnas en `summary-all.md` del scratchpad.

### 4.4 Referencias por plato (fuente y cálculo)

Los valores de referencia son el punto medio de un rango construido con las fuentes de abajo. Ninguna
tabla oficial argentina publica "platos completos"; Argenfoods (UNLu, https://www.argenfood.unlu.edu.ar/)
tiene ingredientes por 100 g. Donde el valor es composición propia se marca [H].

| # | plato | ref | fuentes |
|---|---|---|---|
| 1 | milanesa de carne con puré | 600 | Milanesa de ternera frita 310 kcal/100 g (tabla Diquecito, derivada de Argenfoods, https://diquecito.com.ar/tabla-de-calorias/) × 150 g = 465; Nutrola "milanesa de carne, porción" 440 (https://nutrola.app/es/blog/calorias-en-comida-argentina-asado-empanadas-milanesa); puré con leche 81–100 kcal/100 g (FatSecret) × 200 g. Rango 500–700. |
| 2 | 2 empanadas de carne | 580 | Por unidad al horno: FatSecret AR 263 (https://www.fatsecret.com.ar/calorías-nutrición/genérico/empanada-de-carne), Infobae 280, Nutrola 310. ×2 = 526–620. |
| 3 | choripán | 480 | Nutrola 480; Fitia 478 (https://fitia.app/calories-nutritional-information/choripan-1001186/); LeanMate 558 con chimichurri (https://leanmate.app/calorias/choripan). |
| 4 | medialuna + café con leche | 280 | Medialuna 332 kcal/100 g (Diquecito) × 45 g = 150; café con leche 200 ml leche entera (61 kcal/100 ml, tabla del prompt) + 1 sobre azúcar ≈ 130. [H] en la composición del café. |
| 5 | fideos con tuco | 480 | [H] Composición: fideos cocidos 200 g × 131 (tabla prompt / USDA) = 262 + tuco 150 g ≈ 120 + queso rallado 10 g ≈ 42 + aceite. Rango amplio 380–600 a propósito. |
| 6 | asado 2 costillas + chorizo | 1000 | Nutrola: tira de asado 295 kcal/100 g, chorizo criollo 320 kcal/100 g. 2 costillas ≈ 250 g → 740 + chorizo 80 g → 256. |
| 7 | porción pizza muzzarella | 300 | Nutrola 340; Fitia Don Carlos 192 (63 g, https://fitia.app/calories-nutritional-information/pizza-con-muzzarella-12008097/); La Famiglia 200–300 (1/8). |
| 8 | sándwich de miga J&Q | 220 | Buen Pan 137 (50 g), Coto 244 kcal/100 g (Fitia); 1 unidad de 2 triángulos ≈ 90 g → 220. |
| 9 | mate + 3 bizcochitos | 85 | Don Satur salados: 6 u (30 g) = 155 kcal (FatSecret AR https://www.fatsecret.com.ar/calorías-nutrición/don-satur/bizcochos-salados/6-bizcochos) → 3 u = 78; mate ≈ 5. |
| 10 | manzana | 95 | USDA FoodData Central, Foundation: Fuji 64.7, Gala 61, Honeycrisp 60 kcal/100 g (FDC 1750340/1750341/1750343, https://fdc.nal.usda.gov/) × 150 g. |
| 11 | yogur con granola | 310 | [H] Yogur entero 200 g ≈ 150 + granola 40 g ≈ 180. Rango 230–400. |
| 12 | milanesa napolitana con papas fritas | 1050 | Nutrola "milanesa napolitana, porción" 680 + papas fritas 120–150 g (≈ 310 kcal/100 g, USDA) ≈ 370–450. |
| 13 | porción tarta J&Q | 430 | Frizzio 384 (175 g), Cookpad 435, Fitia 492 (https://fitia.app/calories-nutritional-information/tarta-de-jamon-y-queso-1002834/). |
| 14 | tostado | 380 | Fitia 456 (https://fitia.app/calories-nutritional-information/tostadas-con-jamon-y-queso-1001440/); Queso Destrabilla 300–400; Arise 275 (chico). |
| 15 | hamburguesa completa | 600 | Fitia casera 761; DosLunas "completa con queso" 640, "simple" 550 (https://doslunas.com.ar/cuantas-calorias-tiene-una-hamburguesa-con-papas-fritas/); Paty medallón 187 (80 g). El rango 480–750 podría estar bajo para una "completa" con huevo y jamón. |

---

## 5. Propuesta priorizada (impacto / costo cero)

### P1 — Prompt: anclas de platos completos + 3 arreglos puntuales · **S · riesgo bajo · impacto alto**

Qué: agregar al `SYSTEM_PROMPT` una sección "Porciones estándar argentinas de platos completos" con
~25–30 platos y su kcal por unidad/porción (los 10 de la variante B + tostado, tarta, asado por corte, fideos
con tuco/salsa, ñoquis, ravioles, pollo al horno con papas, tortilla de papa, locro, guiso de lentejas,
alfajor, factura, tostadas con dulce de leche, cortado, cerveza 500 ml, vino copa, fernet con coca, empanada
frita, pizza fugazzeta, milanesa de pollo, ensalada César, sushi 10 piezas). Y tres correcciones:
(1) el límite de sanidad "Sándwich/sanguche simple 150–350" debe excluir el tostado de bar (350–450);
(2) manzana 60 kcal/100 g (USDA Foundation) en vez de 52; (3) bizcochito de grasa 5–6 g / 28 kcal.
**No** adoptar "razonamiento antes del número" (C): −35 % de precisión en el modelo actual, +90 % tokens de
salida. **No** reintroducir `responseSchema` (loop documentado).
Archivos: `functions/src/index.ts` (solo la constante). Redeploy de functions (lo hace el workflow del tag).
Medir: el script de §5.7 antes/después; criterio ≥ 90 % en rango y MAE ≤ 45 en `2.5-flash-lite`.
Costo: +330 tokens de entrada por llamada (≈ +US$ 0,03/mes).

### P2 — Modelo: `gemini-3.5-flash-lite` · **S · riesgo bajo · impacto medio-alto (solo junto con P1)**

Medido: con P1 pasa a 100 % en rango y MAE 30 (dos corridas), +250 ms de latencia mediana, sin thinking
que configurar (no reporta `thoughtsTokenCount`). Costo 3.8× el actual, o sea < US$ 1/mes si el proyecto
está en Tier 1; 0 si está en free tier. Sin fecha de apagado. Alternativa equivalente: `3.1-flash-lite`
(mismo MAE, más barato, pero apagado 2027-05-07 — no vale la pena). **Nunca** `gemini-2.5-flash` sin
`thinkingConfig.thinkingBudget = 0`, y con él no es mejor que lite. `3.8-flash`: igual precisión, 8× costo,
un outlier de 8 s.
Archivos: `functions/src/gemini.ts` (`GEMINI_MODEL`), `tests/functions/gemini.test.ts` si asserta el nombre.
Medir: mismo script. Riesgo: salida ~30 % más larga (146 vs 116 tokens) — irrelevante con cap 2048; y
cualquier modelo nuevo puede cambiar el comportamiento en JSON mode → correr el bench antes de subir.

### P3 — Aprendizaje del usuario: few-shot personal desde correcciones · **M · riesgo medio · impacto alto para ESTE usuario** [H, no medido]

Hoy `nutrition_ai_cache` guarda lo que el usuario confirmó pero no sabe si lo corrigió. Propuesta:
1. Migración: `ALTER TABLE nutrition_ai_cache ADD COLUMN source TEXT` (`'ai'` | `'user'`), poblado desde el
   flag `corrected` que `cacheEstimate` ya recibe (`nutrition.ipc.ts:540`). Opcional: `prompt_version`.
2. Nuevo handler `nutrition:getEstimateExamples(description, limit=8)`: devuelve entradas con
   `source='user'` (y, si faltan, las de más `hits`) ordenadas por solapamiento de palabras normalizadas con
   la descripción nueva (Jaccard sobre `description_norm` — sin embeddings, sin red).
3. `estimate-service.ts` manda `{ description, examples: [{ description, calories }] }`; la Function valida
   (máx. 8, texto ≤ 80 chars sin saltos de línea, kcal entero 1–5000) y los agrega como bloque
   "Registros previos de ESTE usuario (misma cocina y porciones; usalos como ancla)" en el **user turn**, no
   en el system prompt — así un texto raro del usuario no puede reescribir las reglas.
4. `NutritionDashboardWidget` pasa a usar `resolveEstimate` + `cacheEstimate` para que también aprenda.
Archivos: `nutrition.schema.ts`, `shared-logic/modules/nutrition.ipc.ts`, `shared/api-channels.ts`,
`shared/types.ts`, `src/modules/nutrition/estimate-service.ts`, `estimate-with-cache.ts`,
`functions/src/index.ts` + `gemini.ts` (`buildRequestBody(description, prompt, examples)`),
`NutritionDashboardWidget.tsx`, tests de `parseEstimate`/`buildRequestBody` y de ranking.
Por qué funciona (evidencia indirecta): el modelo repite los few-shot al pie de la letra (§2), así que un
ejemplo "milanesa con pure → 700" del propio usuario va a dominar la próxima "milanesa con pure y ensalada".
Medir: extender el bench con un set "con ejemplos" (corregir 5 platos, pedir 5 platos parientes) y verificar
que los parientes se mueven hacia la corrección y los no parientes no cambian. Riesgo: sobre-anclar platos
distintos que comparten palabras ("tarta de jamón" vs "sándwich de jamón") — mitigar exigiendo ≥ 2 palabras
en común o un plato "cabeza" igual.

### P4 — Cache: versión y origen · **S · riesgo bajo · impacto medio**

Con P3 (columna `source`) sumar `prompt_version INTEGER` (constante exportada desde `functions` y copiada al
cliente, o simplemente `GEMINI_MODEL + hash del prompt` devuelto por la Function en la respuesta). Regla en
`getCachedEstimate`: si `source='ai'` y `prompt_version` ≠ actual → tratar como miss (y sobrescribir al
confirmar); si `source='user'` → siempre hit. Así P1/P2 no quedan enterrados por el cache para los platos
más frecuentes, y las correcciones humanas sobreviven. Archivos: `nutrition.schema.ts`,
`nutrition.ipc.ts:493-558`, `estimate-with-cache.ts`, `tests/modules/nutrition/history-ipc.test.ts`.

### P5 — UI: porción rápida en el flujo de IA · **S–M · riesgo bajo · impacto medio**

Tres chips bajo el input ("chica · normal · grande"), que **agregan la palabra al texto** que se manda
("… porción chica") en vez de escalar localmente: el prompt ya define chico = 50–70 %, grande = 140–170 % y
así la clave del cache es distinta para cada tamaño (correcto: son platos distintos). Sin cambios de backend.
Opcional: un cuarto chip "gramos…" que abre un input numérico y agrega "(N g)". Archivos: `Today.tsx`
(`handleEstimate`), CSS `nutri-*`, i18n es/en. Medir: bench con los 15 platos × {chico, grande} verificando
ratios 0.5–0.7 y 1.4–1.7 respecto de la versión sin modificador.

### P6 — Grounding con Google Search · **descartado**

60–150× el costo por llamada en Tier 1 (US$ 14–35 / 1 000), latencia extra, y el error medido es de tamaño
de porción, no de conocimiento. Reevaluar solo si aparece un caso "no reconoce el plato".

### P7 — Regresión: el benchmark como test · **S**

Mover `bench.mjs` a `scripts/bench-estimate.mjs` + `scripts/bench-estimate.references.json` (los 15 platos,
rango y fuente de §4.4), leyendo el prompt de `functions/src/index.ts` y la key de `GEMINI_API_KEY` en env.
No entra en `npm test` (red + costo); se corre a mano antes de tocar prompt o modelo y falla si
`% en rango < 85` o `MAE > 50`. Sumar 10 platos "sucios" reales del usuario cuando P3 exista.

### Orden sugerido

P1 → P7 (para poder medir P1) → P2 → P4 → P3 → P5. P1+P2 son un cambio de dos constantes y un redeploy;
todo lo demás es opcional.

---

## 6. Límites de esta investigación

- 15 platos, entradas limpias, 1 muestra por celda (2 en las repetidas). Suficiente para separar "bien" de
  "mal" y para detectar fallos sistemáticos; insuficiente para ordenar modelos que difieren en < 30 kcal.
- Las referencias tienen ±15 % de ruido entre fuentes; no hay tabla oficial argentina de platos completos.
- No se midió P3 (few-shot personal) ni P5 (modificadores) — quedan como hipótesis con plan de medición.
- El tier (free vs pago) del proyecto se infirió; confirmar en AI Studio.
