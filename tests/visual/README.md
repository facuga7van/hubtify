# Visual / UI tests

Two complementary layers for catching UI regressions **without manual testing**.

## A. Component visual tests (fast — default)

Mounts React components in a real headless **Chromium** via Vitest Browser Mode,
with `AuthContext` mocked so nothing touches Firebase/`window.api`. Captures a PNG
per UI state. Runs in seconds.

```bash
npm run test:visual          # run once, regenerate screenshots
npm run test:visual:watch    # watch mode
```

Screenshots land in `tests/visual/screens/*.png` (gitignored). Open them — or have
the assistant read them — to verify layout across states (login, register, forgot,
link-sent, errors, password reveal, add-account).

To control a backend response, pass an override to `renderAuth`:

```tsx
renderAuth({ forgotPassword: async () => ({ success: true }) });
```

## B. End-to-end Electron (faithful — heavier)

Launches the **real packaged Electron app** (preload, IPC, native deps) with
Playwright and screenshots the actual window.

```bash
npm run package      # build the Electron app first (slow)
npm run test:e2e     # launches out/<name>/<exe>, captures e2e/screens/*.png
```

`e2e/auth.electron.spec.ts` auto-skips with a clear message if no packaged build
exists yet.

## When to use which

| | A. Browser Mode | B. Playwright Electron |
|---|---|---|
| Speed | Seconds | Minutes (needs package) |
| Fidelity | DOM + CSS in Chromium | Real Electron window |
| Use for | Iterating UI, layout/state checks | Smoke test of real flows |

Start with **A** for day-to-day UI work; reach for **B** before a release.
