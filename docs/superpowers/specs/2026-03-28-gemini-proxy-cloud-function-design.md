# Gemini Proxy via Firebase Cloud Function

## Problem
The Gemini API key is baked into the Electron binary at build time. Google detected it as leaked and disabled it. Any distributed client binary exposes embedded keys.

## Solution
Move the Gemini API call behind a Firebase Cloud Function (callable, v2). The API key lives as a server-side secret, never reaches the client.

## Architecture

```
Electron App                    Firebase
─────────────                   ────────
estimator.ts                    Cloud Function
  │                              estimateNutrition
  ├─ httpsCallable() ──────────► │
  │   (auth token auto-sent)     ├─ verify auth (automatic)
  │                              ├─ call Gemini API (key from secret)
  │                              ├─ parse response
  ◄──────────────────────────────┤ return { calories, items }
```

## Cloud Function: `estimateNutrition`

- **Runtime:** Node.js 22, Firebase Functions v2
- **Auth:** callable = auth verified automatically, rejects unauthenticated
- **Input:** `{ description: string }`
- **Output:** `{ calories: number, items: Array<{ name: string, calories: number }> }`
- **Error:** throws HttpsError on failure
- **Secret:** `GEMINI_API_KEY` set via `firebase functions:secrets:set`
- **Timeout:** 60s (Gemini can be slow)
- **Region:** us-central1 (default)

## Client Changes

1. **Delete:** `electron/modules/nutrition/gemini.ts` (entire file)
2. **Update:** `estimator.ts` — call Cloud Function via `httpsCallable` instead of Gemini
3. **Update:** `vite.main.config.ts` — remove `GEMINI_API_KEY` define
4. **Update:** `.github/workflows/release.yml` — remove `GEMINI_API_KEY` env
5. **Add:** `firebase/functions` import in estimator

## Files Created

```
functions/
  src/index.ts        ← Cloud Function with Gemini logic + prompt
  package.json        ← firebase-functions, firebase-admin, node-fetch
  tsconfig.json
firebase.json         ← hosting/functions config
.firebaserc           ← project alias
```

## Security

- API key never leaves Firebase server
- Only authenticated Hubtify users can call the function
- No rate limiting needed initially (Firebase callable has built-in protections)
