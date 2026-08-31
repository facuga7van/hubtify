# Nutrify Food Telemetry — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user confirms an AI food estimation, upsert each item into a shared Firestore `foods` collection with atomic calorie averaging, and change the AI to return structured items instead of a breakdown string.

**Architecture:** Change AI prompt to return `{calories, items[]}` instead of `{calories, breakdown}`. Rewrite parser to handle new format with fallback. On confirmation, fire-and-forget upsert each item to Firestore using `increment()`. New `food-telemetry.ts` utility handles Firestore writes.

**Tech Stack:** Electron, React, Ollama (local AI), Firebase Firestore, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-27-nutrify-food-telemetry-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `shared/types.ts` | Replace `EstimationMatch` + `breakdown` with `items` array |
| Modify | `electron/modules/nutrition/ollama.ts` | New prompt, new parser, new return type, update cache |
| Modify | `electron/modules/nutrition/estimator.ts` | Map new AI result to updated `EstimationResult` |
| Create | `src/modules/nutrition/food-telemetry.ts` | Firestore upsert utility |
| Modify | `src/modules/nutrition/components/Today.tsx` | Render items, call telemetry on confirm |

---

## Task 1: Update types

**Files:**
- Modify: `shared/types.ts:178-190`

- [ ] **Step 1: Replace EstimationMatch and EstimationResult**

Replace lines 178-190:

```ts
export interface EstimationItem {
  name: string;
  calories: number;
}

export interface EstimationResult {
  totalCalories: number;
  items: EstimationItem[];
  ollamaMissing: boolean;
  aiError?: string;
}
```

Remove `EstimationMatch` interface entirely.

- [ ] **Step 2: Verify TypeScript shows expected errors**

Run: `npx tsc --noEmit`
Expected: errors in `estimator.ts`, `ollama.ts`, `Today.tsx` referencing old types. This confirms the type change propagated.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "refactor(nutrify): replace EstimationMatch+breakdown with EstimationItem array"
```

---

## Task 2: Update AI prompt, parser, and cache in ollama.ts

**Files:**
- Modify: `electron/modules/nutrition/ollama.ts:240-380`

- [ ] **Step 1: Update SYSTEM_PROMPT**

Replace the SYSTEM_PROMPT constant (lines 240-250) with:

```ts
const SYSTEM_PROMPT = `Sos un estimador preciso de calorías. Respondé SOLO con JSON válido.

Formato EXACTO:
{"calories": <total 10-5000>, "items": [{"name": "<ingrediente>", "calories": <número>}, ...]}

Reglas:
- Estimá porciones típicas argentinas
- Redondeá hacia arriba si hay duda
- Cada ingrediente en un item separado con sus calorías individuales
- La suma de items debe ser cercana al total
- SOLO JSON, sin texto adicional, sin explicaciones
- Si no reconocés la comida, estimá lo más cercano`;
```

- [ ] **Step 2: Update cache types**

Replace cache type (lines 261-278). Change `{ calories: number; breakdown: string }` to `{ calories: number; items: Array<{ name: string; calories: number }> }` everywhere in cache functions:

```ts
type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

const estimationCache = new Map<string, { result: AiResult; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCached(desc: string): AiResult | null {
  const key = desc.toLowerCase().trim();
  const entry = estimationCache.get(key);
  if (!entry || Date.now() - entry.ts > CACHE_TTL) { estimationCache.delete(key); return null; }
  return entry.result;
}

function setCache(desc: string, result: AiResult): void {
  const key = desc.toLowerCase().trim();
  estimationCache.set(key, { result, ts: Date.now() });
  if (estimationCache.size > 500) {
    const oldest = [...estimationCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) estimationCache.delete(oldest[0]);
  }
}
```

- [ ] **Step 3: Update estimateWithAi return type**

Change the function signature (line 280):

```ts
export async function estimateWithAi(description: string): Promise<AiResult | null> {
```

- [ ] **Step 4: Replace normalizeBreakdown with parseItems**

Remove `normalizeBreakdown` (lines 321-331). Add:

```ts
function parseItems(items: unknown, totalCals: number, description: string): Array<{ name: string; calories: number }> {
  // New format: items array
  if (Array.isArray(items)) {
    const valid = items.filter((it: any) => typeof it.name === 'string' && typeof it.calories === 'number' && it.calories > 0);
    if (valid.length > 0) return valid.map((it: any) => ({ name: it.name.trim(), calories: Math.round(it.calories) }));
  }
  // Old format: breakdown string "milanesa ~280kcal + puré ~120kcal"
  if (typeof items === 'string') {
    const parsed: Array<{ name: string; calories: number }> = [];
    const regex = /([^~+]+?)~(\d+)\s*kcal/gi;
    let m;
    while ((m = regex.exec(items)) !== null) {
      parsed.push({ name: m[1].trim(), calories: parseInt(m[2]) });
    }
    if (parsed.length > 0) return parsed;
  }
  // Old format: object {"carne magra": 80}
  if (typeof items === 'object' && items !== null && !Array.isArray(items)) {
    const entries = Object.entries(items as Record<string, number>);
    if (entries.length > 0) return entries.map(([name, cals]) => ({ name, calories: Math.round(cals) }));
  }
  // Fallback: single item with total
  return [{ name: description, calories: totalCals }];
}
```

- [ ] **Step 5: Rewrite parseAiResponse**

Replace `parseAiResponse` (lines 337-380):

```ts
export function parseAiResponse(raw: string, description: string): AiResult | null {
  const cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();

  // Try direct parse
  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj.calories === 'number' && isValidCalories(obj.calories)) {
      const items = parseItems(obj.items ?? obj.breakdown, obj.calories, description);
      return { calories: obj.calories, items };
    }
  } catch { /* fall through */ }

  // Try to find JSON object in the response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (typeof obj.calories === 'number' && isValidCalories(obj.calories)) {
        const items = parseItems(obj.items ?? obj.breakdown, obj.calories, description);
        return { calories: obj.calories, items };
      }
    } catch { /* fall through */ }
  }

  // Regex extraction
  const match = raw.match(/"calories"\s*:\s*(\d+)/);
  if (match) {
    const cals = parseInt(match[1]);
    if (isValidCalories(cals)) return { calories: cals, items: [{ name: description, calories: cals }] };
  }

  // Last resort
  const calMatch = raw.match(/\b(\d{2,4})\s*(?:kcal|cal|calorias|calorías)/i);
  if (calMatch) {
    const cals = parseInt(calMatch[1]);
    if (cals >= 10 && cals <= 5000) {
      return { calories: cals, items: [{ name: description, calories: cals }] };
    }
  }

  return null;
}
```

Note: `parseAiResponse` now takes `description` as second parameter for fallback item naming.

- [ ] **Step 6: Update the call to parseAiResponse in estimateWithAi**

In `estimateWithAi`, the call to `parseAiResponse` (around line 310) needs the description:

```ts
const result = parseAiResponse(data.response, sanitized);
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: errors only in `estimator.ts` and `Today.tsx` (not in ollama.ts)

- [ ] **Step 8: Commit**

```bash
git add electron/modules/nutrition/ollama.ts
git commit -m "feat(nutrify): structured items prompt, parser, and cache"
```

---

## Task 3: Update estimator.ts

**Files:**
- Modify: `electron/modules/nutrition/estimator.ts`

- [ ] **Step 1: Rewrite the file**

```ts
import { ensureOllamaRunning, ensureModelPulled, estimateWithAi, isOllamaAvailable, lastAiDebug, stopOllama, downloadAndInstallOllama } from './ollama';
import type { EstimationResult } from '../../../shared/types';

export type ProgressCallback = (stage: string) => void;

export async function estimate(description: string, onProgress?: ProgressCallback): Promise<EstimationResult> {
  try {
    if (!isOllamaAvailable()) {
      onProgress?.('Instalando motor de estimación por primera vez...');
      await downloadAndInstallOllama(onProgress);
    }

    onProgress?.('Iniciando motor de estimación...');
    await ensureOllamaRunning();

    onProgress?.('Verificando modelo de IA...');
    await ensureModelPulled(onProgress);

    onProgress?.('Estimando con IA...');
    const aiResult = await estimateWithAi(description);

    if (!aiResult) {
      return {
        totalCalories: 0,
        items: [],
        ollamaMissing: false,
        aiError: `La IA no pudo estimar. Respuesta: ${lastAiDebug}`,
      };
    }

    return {
      totalCalories: aiResult.calories,
      items: aiResult.items,
      ollamaMissing: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      totalCalories: 0,
      items: [],
      ollamaMissing: false,
      aiError: msg,
    };
  } finally {
    stopOllama();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: errors only in `Today.tsx`

- [ ] **Step 3: Commit**

```bash
git add electron/modules/nutrition/estimator.ts
git commit -m "feat(nutrify): estimator uses items array from AI result"
```

---

## Task 4: Create food-telemetry.ts

**Files:**
- Create: `src/modules/nutrition/food-telemetry.ts`

- [ ] **Step 1: Create the utility**

```ts
import { doc, setDoc, increment, serverTimestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from '../../shared/firebase';

const firestore = getFirestore(app);

function normalizeId(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ').replace(/\//g, '-');
}

export async function upsertFoodItems(items: Array<{ name: string; calories: number }>): Promise<void> {
  for (const item of items) {
    if (!item.name || item.calories <= 0) continue;
    const id = normalizeId(item.name);
    if (!id) continue;
    try {
      const ref = doc(firestore, 'foods', id);
      await setDoc(ref, {
        name: item.name.trim(),
        totalCalories: increment(item.calories),
        count: increment(1),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.error('[food-telemetry]', item.name, err);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: errors only in `Today.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/modules/nutrition/food-telemetry.ts
git commit -m "feat(nutrify): food telemetry utility with atomic Firestore upsert"
```

---

## Task 5: Update Today.tsx

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx`

- [ ] **Step 1: Update EstimationResult interface**

Replace the local `EstimationResult` interface (lines 22-28) with:

```ts
interface EstimationResult {
  totalCalories: number;
  items: Array<{ name: string; calories: number }>;
  ollamaMissing: boolean;
  aiError?: string;
}
```

- [ ] **Step 2: Add imports**

Add at the top:

```ts
import { upsertFoodItems } from '../food-telemetry';
import { useAuthContext } from '../../../shared/AuthContext';
```

Inside the component, get the auth user:

```ts
const { user: authUser } = useAuthContext();
```

Check if `useAuthContext` is already imported and `authUser` is already available. If so, skip this.

- [ ] **Step 3: Update handleConfirmEstimation**

Replace `handleConfirmEstimation` (lines 148-182):

```ts
const handleConfirmEstimation = async () => {
  if (!estimation) return;
  const calories = parseInt(editCalories) || estimation.totalCalories;

  // Log the food
  await window.api.nutritionLogFood({
    date,
    description: foodInput.trim(),
    calories,
    source: 'ai_estimate',
    aiBreakdown: JSON.stringify(estimation.items),
  });

  // Learn food for next time
  try {
    await window.api.nutritionLearnFood({
      description: foodInput.trim(),
      calories,
      breakdown: estimation.items.map(it => `${it.name} ~${it.calories}kcal`).join(' + '),
    });
  } catch { /* best effort */ }

  // Telemetry: upsert items to Firestore (fire-and-forget, only if logged in)
  if (authUser) {
    // Scale item calories proportionally if user edited total
    const ratio = calories / estimation.totalCalories;
    const scaledItems = estimation.items.map(it => ({
      name: it.name,
      calories: Math.round(it.calories * ratio),
    }));
    upsertFoodItems(scaledItems).catch(() => {});
  }

  // RPG event
  await window.api.processRpgEvent({
    type: 'MEAL_LOGGED', moduleId: 'nutrition',
    payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
  });

  showToast(`+${calories} kcal`);
  setFoodInput('');
  setEstimation(null);
  setEditCalories('');
  loadData(date);
  window.dispatchEvent(new Event('rpg:statsChanged'));
};
```

Note the proportional scaling: if AI estimated 400 total and user edited to 500, each item is scaled by 500/400 = 1.25x. This keeps the telemetry accurate to what the user confirmed.

- [ ] **Step 4: Update estimation display JSX**

Replace the estimation matches rendering (lines 359-370) — change `estimation.matches` to `estimation.items`:

```tsx
{estimation.items.length > 0 && (
  <div style={{ marginBottom: 10 }}>
    {estimation.items.map((item, i) => (
      <div key={i} style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--rpg-parchment-dark)' }}>
        <span>{item.name}</span>
        <span style={{ fontFamily: 'Fira Code, monospace' }}>{item.calories} kcal</span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/nutrition/components/Today.tsx
git commit -m "feat(nutrify): render items array, upsert to Firestore on confirm"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Search for stale references**

Search for any remaining references to `EstimationMatch`, `breakdown`, or `matches` in the nutrition module that need updating:

```bash
rg "EstimationMatch|\.breakdown|\.matches" --type ts --type tsx
```

Fix any found.

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A
git commit -m "fix(nutrify): clean up stale references to old estimation types"
```
