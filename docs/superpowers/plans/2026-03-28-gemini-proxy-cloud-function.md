# Gemini Proxy Cloud Function — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Gemini API call behind a Firebase Cloud Function so the API key never reaches the client binary.

**Architecture:** A callable Cloud Function (`estimateNutrition`) receives a food description from authenticated users, calls Gemini server-side, and returns parsed results. The Electron client calls this function via `httpsCallable` instead of hitting Gemini directly.

**Tech Stack:** Firebase Functions v2, firebase-admin, Google Generative AI REST API, TypeScript.

---

## Task 1: Create Firebase project config files

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`

- [ ] **Step 1: Create `firebase.json`**

```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs22"
  }
}
```

- [ ] **Step 2: Create `.firebaserc`**

```json
{
  "projects": {
    "default": "hubtify-ab4ab"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add firebase.json .firebaserc
git commit -m "chore: add firebase project config"
```

---

## Task 2: Create Cloud Function

**Files:**
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`
- Create: `functions/src/index.ts`

- [ ] **Step 1: Create `functions/package.json`**

```json
{
  "name": "hubtify-functions",
  "private": true,
  "main": "lib/index.js",
  "engines": {
    "node": "22"
  },
  "scripts": {
    "build": "tsc",
    "serve": "npm run build && firebase emulators:start --only functions",
    "deploy": "firebase deploy --only functions"
  },
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.3.0"
  },
  "devDependencies": {
    "typescript": "~5.7.3"
  }
}
```

- [ ] **Step 2: Create `functions/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "lib",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `functions/src/index.ts`**

This is the Cloud Function. It takes the prompt + Gemini logic from `electron/modules/nutrition/gemini.ts` and wraps it in a callable function.

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const SYSTEM_PROMPT = `Sos un estimador preciso de calorías de comida argentina. Respondé SOLO con JSON válido.

Formato EXACTO:
{"items": [{"name": "<ingrediente>", "calories": <número>}, ...]}

Reglas:
- Estimá porciones típicas argentinas
- Redondeá hacia arriba si hay duda
- Cada ingrediente en un item separado con sus calorías individuales
- Si hay cantidad (ej: "2 milanesas"), las calorías deben reflejar TODAS las unidades
- SOLO JSON, sin texto adicional, sin explicaciones, sin markdown
- Si no reconocés la comida, estimá lo más cercano

Ejemplos:
Input: "milanesa con puré" → {"items": [{"name": "milanesa", "calories": 350}, {"name": "puré de papas", "calories": 200}]}
Input: "3 empanadas de carne" → {"items": [{"name": "empanada de carne x3", "calories": 900}]}
Input: "café con leche y 2 medialunas" → {"items": [{"name": "café con leche", "calories": 80}, {"name": "medialuna x2", "calories": 400}]}`;

export const estimateNutrition = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const description = request.data?.description;
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'Description is required');
    }

    const apiKey = geminiApiKey.value();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: description.trim() }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                items: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      name: { type: 'STRING' },
                      calories: { type: 'INTEGER' },
                    },
                    required: ['name', 'calories'],
                  },
                },
              },
              required: ['items'],
            },
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[gemini] API error:', response.status, errText.slice(0, 200));
        throw new HttpsError('internal', 'AI estimation failed');
      }

      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new HttpsError('internal', 'No response from AI');
      }

      const parsed = JSON.parse(text) as { items?: Array<{ name: string; calories: number }> };
      if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        throw new HttpsError('internal', 'Could not parse AI response');
      }

      const items = parsed.items
        .filter(it => typeof it.name === 'string' && typeof it.calories === 'number' && it.calories > 0)
        .map(it => ({ name: it.name.trim(), calories: Math.round(it.calories) }));

      if (items.length === 0) {
        throw new HttpsError('internal', 'No valid items in AI response');
      }

      const calories = items.reduce((sum, it) => sum + it.calories, 0);

      return { calories, items };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new HttpsError('deadline-exceeded', 'AI request timed out');
      }
      console.error('[gemini] Error:', err);
      throw new HttpsError('internal', 'AI estimation failed');
    } finally {
      clearTimeout(timeout);
    }
  }
);
```

- [ ] **Step 4: Install function dependencies**

```bash
cd functions && npm install
```

- [ ] **Step 5: Build to verify TypeScript compiles**

```bash
cd functions && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add functions/
git commit -m "feat: add estimateNutrition cloud function"
```

---

## Task 3: Update client — replace direct Gemini call with Cloud Function

**Files:**
- Delete: `electron/modules/nutrition/gemini.ts`
- Modify: `electron/modules/nutrition/estimator.ts`
- Modify: `src/shared/firebase.ts` (add functions export)

- [ ] **Step 1: Add functions export to `src/shared/firebase.ts`**

Add `getFunctions` and `connectFunctionsEmulator` imports. Export a `functions` instance.

```typescript
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyAXs0DtXOmjf2bdWce43vKY2fAeNi3hID8",
  authDomain: "hubtify-ab4ab.firebaseapp.com",
  projectId: "hubtify-ab4ab",
  storageBucket: "hubtify-ab4ab.firebasestorage.app",
  messagingSenderId: "792579152721",
  appId: "1:792579152721:web:e7cfe94e831605e3561170"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);
```

- [ ] **Step 2: Rewrite `electron/modules/nutrition/estimator.ts`**

Replace the Gemini import with a `httpsCallable` call to the Cloud Function. Note: `estimator.ts` runs in the Electron main process, which has access to `firebase` since it's bundled by Vite.

```typescript
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../src/shared/firebase';
import type { EstimationResult } from '../../../shared/types';

export type ProgressCallback = (stage: string) => void;

type AiResult = { calories: number; items: Array<{ name: string; calories: number }> };

const estimateNutrition = httpsCallable<{ description: string }, AiResult>(functions, 'estimateNutrition');

export async function estimate(description: string, onProgress?: ProgressCallback): Promise<EstimationResult> {
  try {
    onProgress?.('Estimando con IA...');
    const result = await estimateNutrition({ description });

    return {
      totalCalories: result.data.calories,
      items: result.data.items,
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
  }
}
```

- [ ] **Step 3: Delete `electron/modules/nutrition/gemini.ts`**

```bash
git rm electron/modules/nutrition/gemini.ts
```

- [ ] **Step 4: Commit**

```bash
git add electron/modules/nutrition/estimator.ts src/shared/firebase.ts
git commit -m "feat: call estimateNutrition cloud function instead of Gemini directly"
```

---

## Task 4: Remove API key from build pipeline

**Files:**
- Modify: `vite.main.config.ts`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Clean `vite.main.config.ts`**

Remove dotenv import and the `GEMINI_API_KEY` define:

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'adm-zip'],
    },
  },
});
```

- [ ] **Step 2: Remove `GEMINI_API_KEY` from CI workflow**

In `.github/workflows/release.yml`, remove the `env:` block from the "Build installers" step:

```yaml
      - name: Build installers
        run: npm run make
```

- [ ] **Step 3: Add deploy step to CI workflow**

Add a step after "Build installers" to deploy functions (so they stay in sync with releases):

```yaml
      - name: Deploy Cloud Functions
        run: cd functions && npm ci && npm run build && npx firebase deploy --only functions --token "$FIREBASE_TOKEN"
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}
```

Note: Requires `FIREBASE_TOKEN` secret in GitHub. Generate with `firebase login:ci`.

- [ ] **Step 4: Commit**

```bash
git add vite.main.config.ts .github/workflows/release.yml
git commit -m "chore: remove GEMINI_API_KEY from client build pipeline"
```

---

## Task 5: Set the Gemini secret and deploy

This is a manual step — cannot be automated in code.

- [ ] **Step 1: Set the secret in Firebase**

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

Enter the new API key when prompted (generate a fresh one from Google AI Studio first).

- [ ] **Step 2: Deploy the function**

```bash
cd functions && npm run deploy
```

- [ ] **Step 3: Verify in Firebase Console**

Check that `estimateNutrition` appears in the Functions tab of the Firebase Console.

- [ ] **Step 4: Generate `FIREBASE_TOKEN` for CI**

```bash
firebase login:ci
```

Copy the token and add it as `FIREBASE_TOKEN` secret in GitHub repo settings.

---

## Task 6: Remove `dotenv` dependency from root (cleanup)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Uninstall dotenv**

```bash
npm uninstall dotenv
```

- [ ] **Step 2: Delete `.env` file** (no longer needed)

```bash
rm .env
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove dotenv, no longer needed"
```
