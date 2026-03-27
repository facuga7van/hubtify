# Nutrify: Food Estimation Telemetry

## Summary

When a user confirms an AI-estimated food entry, each individual item from the estimation is upserted into a shared Firestore collection `foods`. Calories are accumulated atomically using `FieldValue.increment()`. Average is computed at read time (`totalCalories / count`). This data feeds future model retraining.

---

## 1. Structured AI Response

### Prompt Change

Current format:
```json
{"calories": 400, "breakdown": "milanesa ~280kcal + puré ~120kcal"}
```

New format:
```json
{"calories": 400, "items": [{"name": "milanesa", "calories": 280}, {"name": "puré", "calories": 120}]}
```

The `breakdown` string field and `matches` array are both replaced by `items` — an array of `{name: string, calories: number}`.

### System Prompt

Update in `ollama.ts` to request structured items:
```
Formato EXACTO:
{"calories": <total 10-5000>, "items": [{"name": "<ingrediente>", "calories": <número>}, ...]}

Reglas:
- Estimá porciones típicas argentinas
- Redondeá hacia arriba si hay duda
- Cada ingrediente en un item separado con sus calorías individuales
- La suma de items debe ser cercana al total
- SOLO JSON, sin texto adicional, sin explicaciones
- Si no reconocés la comida, estimá lo más cercano
```

### Parser

`parseAiResponse` returns `{ calories: number; items: Array<{ name: string; calories: number }> }`.

Fallback strategies (in order):
1. Direct JSON parse for `{calories, items}` format
2. If model returns `breakdown` string: parse with regex (best-effort, handle `"ingrediente ~280kcal"` patterns and `{"ingrediente": 280}` object format)
3. If model returns only `calories`: create single item `[{name: description, calories}]`

### Type Changes

`EstimationResult` in `shared/types.ts`:
- Remove `breakdown: string`
- Remove `matches: EstimationMatch[]`
- Add `items: Array<{ name: string; calories: number }>`
- Keep `totalCalories`, `ollamaMissing`, `aiError`

`estimator.ts` maps `estimateWithAi` result directly to `EstimationResult.items`.

### Display

The estimation result in `Today.tsx` renders items from the array. Each item shown as a row: `name — calories kcal`. The `ai_breakdown` column in SQLite stores the items as `JSON.stringify(items)` for local history.

---

## 2. Firestore Upsert

### Collection

`foods` — root-level Firestore collection. Not nested under users.

### Document Structure

Document ID: normalized food name (lowercase, trimmed, single spaces, `/` replaced with `-`).

```
{
  name: "milanesa",         // display name (from first insert)
  totalCalories: 4200,      // sum of all confirmed calories
  count: 15,                // number of confirmations
  updatedAt: Timestamp      // server timestamp
}
```

Average calories at read time: `Math.round(totalCalories / count)`.

### Upsert Logic — Atomic with `increment()`

For each item `{name: "milanesa", calories: 300}`:

```ts
const normalizedId = name.toLowerCase().trim().replace(/\s+/g, ' ').replace(/\//g, '-');
const ref = doc(firestore, 'foods', normalizedId);

await setDoc(ref, {
  name,
  totalCalories: increment(calories),
  count: increment(1),
  updatedAt: serverTimestamp(),
}, { merge: true });
```

No read needed. No transaction needed. `increment()` is atomic and queues offline.

### When it Executes

In `handleConfirmEstimation` in `Today.tsx`, after logging to SQLite. For each item in the estimation, fire the upsert. Only if user is logged in. Wrapped in try/catch — errors logged to console, never block the confirm flow. This is fire-and-forget telemetry.

### Offline Handling

`FieldValue.increment()` with `setDoc(merge: true)` queues offline and syncs when connection returns. Unlike transactions, this works offline. Best-effort — if the app closes before syncing, the write is lost. Acceptable for telemetry.

### Name Normalization Limitations

`"pure de papa"` and `"pure de papas"` are different documents. This is a known limitation — the data is still useful for training in aggregate. Fuzzy deduplication can be done offline when extracting the dataset.

### Firestore Security Rules

The `foods` collection needs rules deployed:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /foods/{foodId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.keys().hasAll(['name', 'totalCalories', 'count', 'updatedAt']);
      allow update: if request.auth != null;
    }
  }
}
```

Note: existing rules for `hubtify_users` collection must be preserved when deploying.

---

## 3. Files to Modify

### Backend
- `electron/modules/nutrition/ollama.ts` — Change system prompt to request items array, update `estimateWithAi` return type, rewrite `parseAiResponse` to return `{calories, items}`, update cache types, add fallback parsing for old breakdown format
- `electron/modules/nutrition/estimator.ts` — Map new `{calories, items}` to `EstimationResult` with items field

### Frontend
- `src/modules/nutrition/components/Today.tsx` — Update estimation display to render items array, add Firestore upsert in `handleConfirmEstimation`, import auth context for UID check
- `src/modules/nutrition/food-telemetry.ts` — **New file.** `upsertFoodItems(items, firestore)` utility. Keeps Firestore logic out of the component.

### Types
- `shared/types.ts` — Replace `matches` + `breakdown` with `items: Array<{name: string; calories: number}>` in `EstimationResult`

### Config
- Firestore security rules — deploy rules allowing authenticated read/write on `foods` collection

### Not Modified
- `nutrition.schema.ts` — No schema changes. `ai_breakdown` column stores items as JSON string
- `electron/modules/nutrition.ipc.ts` — `logFood` handler unchanged, receives `aiBreakdown` as string
- `sync.ipc.ts` — No changes, telemetry goes direct to Firestore from renderer
- `electron/preload.ts` — No new IPC channels needed
- `src/shared/firebase.ts` — Already exports `app`. `getFirestore(app)` initialized in new telemetry utility.

---

## 4. Out of Scope

- Using the `foods` collection for estimation lookup (future feature)
- Model retraining pipeline
- Auto-update of model when new version pushed
- Analytics/dashboard for telemetry data
- Admin interface for reviewing submitted foods
- Fuzzy name deduplication (offline task when extracting training data)
