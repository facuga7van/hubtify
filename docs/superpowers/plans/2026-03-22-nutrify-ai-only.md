# Nutrify AI-Only Estimation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the tokenizer/DB-matching step from calorie estimation and send all user input directly to the fine-tuned `nutrify` Ollama model.

**Architecture:** The estimator bypasses `searchFoodDatabase()` entirely. User input goes straight to `estimateWithAi()`. The `EstimationResult` type is simplified — `source` is always `'ai'`, `unmatchedTokens` is removed, `hasAiFallback` becomes `hasAiEstimation`. `food-db.ts` and `searchFoodDatabase` remain untouched for use by `learnFood` and the `nutrition:searchFoodDb` IPC handler.

**Tech Stack:** TypeScript, Electron IPC, Ollama API

---

## Chunk 1: Backend Changes

### Task 1: Simplify `EstimationResult` type

**Files:**
- Modify: `shared/types.ts:154-168`

- [ ] **Step 1: Update `EstimationMatch` — remove `'database'` source**

```typescript
// shared/types.ts:154-158
export interface EstimationMatch {
  name: string;
  calories: number;
  source: 'ai';
}
```

- [ ] **Step 2: Update `EstimationResult` — remove `unmatchedTokens`, rename `hasAiFallback`**

```typescript
// shared/types.ts:160-168
export interface EstimationResult {
  totalCalories: number;
  matches: EstimationMatch[];
  breakdown: string;
  ollamaMissing: boolean;
  aiError?: string;
}
```

- [ ] **Step 3: Remove `nutritionSearchFoodDb` from `HubtifyApi`**

Remove line 101 from `shared/types.ts`:
```typescript
// DELETE this line:
nutritionSearchFoodDb: (query: string) => Promise<{ matched: Array<{ name: string; calories: number; source: 'database' }>; unmatched: string[] }>;
```

---

### Task 2: Rewrite `estimator.ts` — AI-only flow

**Files:**
- Modify: `electron/modules/nutrition/estimator.ts`

- [ ] **Step 1: Replace the entire file with simplified AI-only estimator**

```typescript
import { ensureOllamaRunning, ensureModelPulled, estimateWithAi, isOllamaAvailable, lastAiDebug, stopOllama } from './ollama';
import type { EstimationMatch, EstimationResult } from '../../../shared/types';

export type ProgressCallback = (stage: string) => void;

export async function estimate(description: string, onProgress?: ProgressCallback): Promise<EstimationResult> {
  console.log('[Estimator] Input:', description);

  const available = isOllamaAvailable();
  console.log('[Estimator] Ollama available:', available);

  if (!available) {
    return {
      totalCalories: 0,
      matches: [],
      breakdown: '',
      ollamaMissing: true,
      aiError: 'Ollama no está instalado',
    };
  }

  try {
    onProgress?.('Iniciando Ollama...');
    await ensureOllamaRunning();

    onProgress?.('Verificando modelo de IA...');
    await ensureModelPulled(onProgress);

    onProgress?.('Estimando con IA...');
    const aiResult = await estimateWithAi(description);

    if (!aiResult) {
      console.log('[Estimator] AI returned null, debug:', lastAiDebug);
      return {
        totalCalories: 0,
        matches: [],
        breakdown: '',
        ollamaMissing: false,
        aiError: `La IA no pudo estimar. Respuesta: ${lastAiDebug}`,
      };
    }

    console.log('[Estimator] AI result:', aiResult);
    const matches: EstimationMatch[] = [{ name: aiResult.breakdown, calories: aiResult.calories, source: 'ai' }];

    return {
      totalCalories: aiResult.calories,
      matches,
      breakdown: aiResult.breakdown,
      ollamaMissing: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[Estimator] Error:', msg);
    return {
      totalCalories: 0,
      matches: [],
      breakdown: '',
      ollamaMissing: false,
      aiError: msg,
    };
  } finally {
    stopOllama();
    console.log('[Estimator] Ollama stopped after estimation');
  }
}
```

Key changes:
- Removed `searchFoodDatabase` import and call
- Removed `combineResults` function (no longer needed)
- Removed tokenization, unmatched logic
- Direct flow: check Ollama → start → pull model → estimate → stop
- Error handling returns proper `EstimationResult` instead of throwing

---

### Task 3: Remove `searchFoodDb` IPC handler

**Files:**
- Modify: `electron/modules/nutrition.ipc.ts:4,239-242`
- Modify: `electron/preload.ts:56`

- [ ] **Step 1: Remove `searchFoodDatabase` import from `nutrition.ipc.ts`**

Remove from the import line:
```typescript
// DELETE this import:
import { searchFoodDatabase } from './nutrition/food-db';
```

- [ ] **Step 2: Remove `nutrition:searchFoodDb` IPC handler**

Remove the handler (around line 239-242):
```typescript
// DELETE this handler:
ipcMain.handle('nutrition:searchFoodDb', async (_event, query: string) => {
  return searchFoodDatabase(query);
});
```

- [ ] **Step 3: Remove `nutritionSearchFoodDb` from preload.ts**

Remove from `electron/preload.ts:56`:
```typescript
// DELETE this line:
nutritionSearchFoodDb: (query: string) => ipcRenderer.invoke('nutrition:searchFoodDb', query),
```

---

## Chunk 2: Frontend Changes

### Task 4: Update `Today.tsx` — adapt to new `EstimationResult`

**Files:**
- Modify: `src/modules/nutrition/components/Today.tsx:19-25,111,267-284`

- [ ] **Step 1: Update local `EstimationResult` interface**

```typescript
// Replace lines 19-25
interface EstimationResult {
  totalCalories: number;
  breakdown: string;
  matches: EstimationMatch[];
  ollamaMissing: boolean;
  aiError?: string;
}
```

- [ ] **Step 2: Update `handleConfirmEstimation` source field**

Change line 111:
```typescript
// FROM:
source: estimation.hasAiFallback ? 'ai_estimate' : 'frequent',
// TO:
source: 'ai_estimate',
```

- [ ] **Step 3: Remove `(IA)` badge from match rendering**

Since all matches are now AI, remove the source badge (lines 276-278):
```typescript
// Remove this span:
{m.source === 'ai' && (
  <span style={{ fontSize: '0.7rem', opacity: 0.5, marginLeft: 4 }}>(IA)</span>
)}
```

---

### Task 5: Update `src/modules/nutrition/types.ts`

**Files:**
- Modify: `src/modules/nutrition/types.ts:54-59`

- [ ] **Step 1: Update types to match new `EstimationResult`**

```typescript
// Remove hasAiFallback, unmatchedTokens — add aiError
export interface EstimationResult {
  totalCalories: number;
  matches: EstimationMatch[];
  breakdown: string;
  ollamaMissing: boolean;
  aiError?: string;
}
```

---

### Task 6: Commit

- [ ] **Step 1: Stage and commit all changes**

```bash
git add shared/types.ts electron/modules/nutrition/estimator.ts electron/modules/nutrition.ipc.ts electron/preload.ts src/modules/nutrition/components/Today.tsx src/modules/nutrition/types.ts
git commit -m "refactor(nutrify): remove tokenizer/DB matching, send all input to AI model"
```
