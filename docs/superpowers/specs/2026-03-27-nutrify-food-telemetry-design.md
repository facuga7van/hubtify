# Nutrify: Food Estimation Telemetry

## Summary

When a user confirms an AI-estimated food entry, each individual item from the estimation is upserted into a shared Firestore collection `foods`. Calories are averaged incrementally across all users. This data feeds future model retraining.

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

The `breakdown` string field is replaced by `items` — an array of `{name: string, calories: number}`.

### System Prompt

Update in `ollama.ts` to request structured items:
```
Formato EXACTO:
{"calories": <total 10-5000>, "items": [{"name": "<ingrediente>", "calories": <número>}, ...]}
```

### Parser

`parseAiResponse` returns `{ calories: number; items: Array<{ name: string; calories: number }> }` instead of `{ calories: number; breakdown: string }`.

Fallback: if the model returns `breakdown` as string (old format), parse it with regex (`/([^~+]+)~(\d+)\s*kcal/g`) to extract items.

### Display

The estimation result in `Today.tsx` renders items from the array. Each item shown as a row: `name — calories kcal`. The `ai_breakdown` column in SQLite stores the items as JSON string for local history.

---

## 2. Firestore Upsert

### Collection

`foods` — root-level Firestore collection. Not nested under users.

### Document Structure

Document ID: normalized food name (lowercase, trimmed, single spaces).

```
{
  name: "milanesa",
  calories: 280,
  count: 15,
  updatedAt: "2026-03-27T10:00:00.000Z"
}
```

### Upsert Logic

When inserting item `{name: "milanesa", calories: 300}`:

1. Normalize name: `name.toLowerCase().trim().replace(/\s+/g, ' ')`
2. Use normalized name as document ID
3. Read existing doc
4. If not exists → create `{name, calories: 300, count: 1, updatedAt: now}`
5. If exists with `{calories: 280, count: 15}`:
   - New average: `Math.round((280 * 15 + 300) / 16)` = 281
   - Update: `{calories: 281, count: 16, updatedAt: now}`

### When it Executes

In `Today.tsx` `handleConfirmEstimation`, after logging to SQLite. For each item in the estimation result, call the upsert. Only if user is logged in (has Firebase UID).

### Offline Handling

Firestore SDK handles offline writes automatically. Writes queue locally and sync when connection returns. No additional code needed.

---

## 3. Files to Modify

### Backend
- `electron/modules/nutrition/ollama.ts` — Change system prompt, update `estimateWithAi` return type, update `parseAiResponse` to return items array, update cache types, update `normalizeBreakdown` → `parseItemsFromBreakdown` fallback
- `electron/modules/nutrition/estimator.ts` — Update `EstimationMatch` usage to work with new items format

### Frontend
- `src/modules/nutrition/components/Today.tsx` — Update estimation display to render items array, add Firestore upsert on confirm, adapt `handleConfirmEstimation`
- `src/shared/firebase.ts` — Already configured, import `doc`, `getDoc`, `setDoc`, `getFirestore` as needed

### Types
- `shared/types.ts` — Change `EstimationResult`: replace `breakdown: string` with `items: Array<{name: string; calories: number}>`. Add `EstimationItem` type.

### Not Modified
- `nutrition.schema.ts` — No schema changes. `ai_breakdown` column stores items as JSON string
- `electron/modules/nutrition.ipc.ts` — `logFood` handler unchanged, receives `aiBreakdown` as string (JSON.stringify of items)
- `sync.ipc.ts` — No changes, telemetry goes direct to Firestore from renderer
- `electron/preload.ts` — No new IPC channels needed (Firestore accessed from renderer)

---

## 4. Out of Scope

- Using the `foods` collection for estimation lookup (future feature)
- Model retraining pipeline
- Auto-update of model when new version pushed
- Analytics/dashboard for telemetry data
- Admin interface for reviewing submitted foods
