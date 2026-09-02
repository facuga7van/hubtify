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

### A2. Mobile (Android shell)

`npm run test:visual:mobile` runs the `browser-mobile` project: same Chromium,
viewport **390×844**, touch emulated, and `__HUBTIFY_PLATFORM__ = "android"` so
`isNativeMobile()` is true without Capacitor and `Layout` mounts `MobileShell`.
Tests live in `tests/visual/mobile/` and mount each page **inside the real shell**
via `mountInShell()` (`mobile-harness.tsx`); stubs come from `fixtures.ts`.
Every page test asserts `document.documentElement.scrollWidth <= innerWidth`.
Screenshots land in `tests/visual/__screenshots__/mobile/` (gitignored); Vitest's
own failure screenshots go to `tests/visual/mobile/__screenshots__/`, also
gitignored.

The desktop tests pin their own viewport with `page.viewport(...)`, which is why
they are not reused here. Touch emulation is configured once, on the Playwright
provider (`playwright: { contextOptions: { hasTouch, isMobile } }` in
`vitest.config.ts`) — in Vitest 4 `contextOptions` is not accepted per entry of
`instances[]`.

Nothing in this project may import `src/mobile/native-shell.ts`: that module
imports `@capacitor/core`, which defines `window.Capacitor` and would make
`hasCapacitorBridge()` true for the whole run. The pure DOM helpers it needs
(`hasOpenDialog`, `closeTopDialog`) live in `src/mobile/dialog-dom.ts` and are
tested from there.

The real device is still the only place where the status bar, the safe areas and
the Android back button can be checked; the last run is written up under
«Resultado del smoke» in `docs/superpowers/plans/2026-09-02-mobile-phase3-shell.md`,
with screenshots next to it.

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
