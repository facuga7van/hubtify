# Fase 3 — Shell mobile: reporte de ejecución

**Rama:** `feature/mobile` · **Commits:** 24 (`b3376d2..2e7264b`) · **Estado: COMPLETA**

## Estado por chunk

| Chunk | Tasks | Estado | Commits |
|---|---|---|---|
| 1 Fundaciones | 1–5 | DONE | `2191fa3` `094aac1` `2013c86` `4bf155d` |
| 2 El shell | 6–9 | DONE | `920a993` `5b5034d` `18075c2` `1257c40` |
| 3 Transversal | 10–12 | DONE | `f1f7c94` `24a22d2` `bee2841` |
| 4 Questify + Coinify | 13–14 | DONE | `83e9d1e` `11fd0ae` `d52cd7d` |
| 5 Nutrify + Caldero | 15–16 | DONE | `9f01f52` `979512a` |
| 6 Emulador y docs | 17–18 | DONE_WITH_CONCERNS | `b3ba669` `519d4f1` `a8588ba` `1327dc9` |
| Revisión 1 (chunks 1–3) | Approved, 5 menores aplicados | DONE | `3625e7a` `23df442` |
| Revisión 2 (chunks 4–6) | Approved, 6 menores aplicados | DONE | `b2da8c0` `2e7264b` |

## Verificación final (HEAD `2e7264b`, árbol limpio)

`npx tsc --noEmit` 0 · `npm run typecheck:shared-logic` 0 · `npm test` **108 archivos / 1363 tests** (baseline 106/1357: +2 archivos, +6 tests) · `npm run test:visual` **30/209 sin cambios** · `npm run test:visual:mobile` **6 archivos / 28 tests** · `npm run lint` 0 errores.

## Smoke en el emulador (APK debug, Pixel 7 / Android 15, WebView 124)

Capturas en `docs/superpowers/plans/2026-09-02-mobile-phase3-{hub,questify,coinify,nutrify,cauldron,drawer}.png`. En las seis: barra de estado en cuero con iconos claros y sin franja blanca, cabecera de 56 px pegada a ella, sin TitleBar de escritorio, sin desborde horizontal ni texto ilegible. Drawer abre por hamburguesa y cierra por scrim, por botón atrás y por ítem de navegación; atrás navega el historial y en la raíz minimiza la app. Camino (b) del desvío 1 confirmado (`--safe-area-inset-top` = 0, la franja la pinta `windowBackground`).

## Hallazgos y desvíos que importan

1. **`styles.xml` rompía el build del APK** (`b3ba669`): un `--` dentro de un comentario XML es ilegal y `:app:mergeDebugResources` fallaba — el APK no se había podido construir desde la Task 9. Es el hallazgo más valioso del smoke.
2. **Bug preexistente, NO arreglado (afecta también a escritorio):** el Cierre del Códice muestra `XP DEL DÍA +NaN`. `src/hub/codex/codexApi.ts:43` declara `xpTotal` pero el handler devuelve `totalXp` (`shared-logic/modules/rpg-handlers.ts:1222`). TS no lo ve porque `codexApi.ts` define su propia interfaz en vez de importar la compartida. Rompe `CodexSealModal.tsx:339` y `useSealInvite.ts:60,62`. **Decisión tuya.**
3. **`.coin-book .qb-page` era selector muerto** (`coinify.css:56` y `:2141`): `BookPage.tsx` pone ambas clases en el mismo div. Se dejaron intactas (arreglarlas metería 80 px de padding al escritorio) y en mobile se usa `.qb-page.coin-book`.
4. Reglas fuera del plan, ambas justificadas y scopeadas: `z-index: auto` en `.qb-content:has(...)` (modales de Questify quedaban bajo el header del códice) y 3 reglas para que los cartuchos de la Tabla no corten su ícono (hallazgo del emulador).
5. `--xp-toast` mobile quedó a 12 px del piso (decisión del pase de Questify), no a 24 como sugería la revisión.
6. Para ver el hub sin credenciales se sembró un usuario ficticio (`smoke@local.test`) en el IndexedDB **del emulador**, con modo avión. No se creó ninguna cuenta real ni se escribió en Firestore. Se limpia con `adb shell pm clear com.hubtify.app`.

## Pendientes menores (no bloquean)

Los cartuchos del hub quedan densos a 412 px (2–3 renglones por cartucho, legible). El AVD da 412 px, no 390: el arnés `browser-mobile` sigue siendo el caso más angosto. Chips de «Comidas frecuentes» al filo del borde en Nutrify. Follow-ups ya anotados en el plan (Tooltip/HelpBubble sin apertura táctil, anchos inline en px, QuickAdd sin disparador táctil) siguen abiertos.
