# Pixi.js Page Curl — Proposal

## Intent

Replace the flat CSS 3D `rotateY` page transition with a realistic page curl using Pixi.js `MeshPlane` vertex deformation. The current animation works but feels stiff — a conical deformation (iBooks-style) gives the RPG adventure book theme a premium, tactile feel.

## Scope

### In Scope

- Replace `pageTurnExit()` in `transitions.ts` with a Pixi.js-based page curl
- Modify `AnimatedOutlet` to manage a Pixi canvas overlay during transitions
- New `pageCurl.ts` module with conical deformation algorithm for vertex manipulation
- GSAP drives the animation parameters (curl angle, curl radius) — Pixi renders the deformation
- Fallback to current CSS rotation if WebGL context creation fails

### Out of Scope

- Crossfade transitions (stay as-is)
- Book open animation (stays as-is)
- Touch/drag interactive page turning (future enhancement)
- GLSL shader optimization (JS vertex updates first, shader pass later if needed)

## Approach

1. **Snapshot**: Capture current page as image using `html-to-image` (DOM → canvas → Pixi Texture)
2. **Pixi setup**: Create on-demand `Application` with `MeshPlane` (20×15 vertex grid) sized to viewport
3. **Deformation**: Apply conical deformation algorithm per-frame — GSAP animates `curlAngle` (0→π) and `curlRadius` parameters, a tick callback updates vertex positions
4. **Overlay**: Mount Pixi canvas in the existing transition overlay div (same one used today)
5. **Cleanup**: Destroy Pixi `Application`, textures, and mesh after animation completes — no resource leaks

## Performance Budget

| Phase | Target | Notes |
|-------|--------|-------|
| Screenshot capture | <35ms | `html-to-image` toCanvas, single frame |
| Pixi init + mesh | <15ms | On-demand Application, no persistent renderer |
| Per-frame deform | <4ms | 300 vertices (20×15), JS math only |
| Total transition | ~600ms | Matches current page turn duration |

## Files Affected

| File | Change |
|------|--------|
| `src/shared/animations/pageCurl.ts` | **NEW** — Conical deformation math, Pixi mesh setup, GSAP-driven animation |
| `src/shared/animations/transitions.ts` | Replace `pageTurnExit` internals to call page curl pipeline |
| `src/shared/components/AnimatedOutlet.tsx` | Use Pixi canvas overlay instead of DOM snapshot + CSS 3D rotation |

## Risks

| Risk | Mitigation |
|------|------------|
| Screenshot timing adds 20-50ms latency | Acceptable within budget; can optimize with `OffscreenCanvas` later |
| WebGL context creation failure (low-end devices) | Fallback to current CSS `rotateY` — graceful degradation |
| Memory leak from Pixi resources | Explicit destroy sequence in cleanup; verified with DevTools memory snapshots |
| `html-to-image` fidelity (shadows, gradients) | Test with current UI; switch to `dom-to-image-more` if issues arise |

## Dependencies

- `pixi.js` v8 — already installed (used in `Character.tsx`)
- `html-to-image` — new dependency (~4KB gzipped)
- `gsap` — already installed
