# Nutrify Deep Improvements — Plan escalonado (funcionalidad)

**Date:** 2026-06-26
**Status:** Draft
**Branch/Worktree:** `worktree-nutrify-deep-improvements`

## Contexto

Iniciativa para mejorar Nutrify **en profundidad**, enfocada en **funcionalidad nueva** (no UX).
La UX ya fue auditada y mayormente ejecutada en `2026-05-02-nutrify-ux-audit` (15 items: soft-deletes,
empty states, sticky footer, touch targets, badges, dedup, help bubbles). Aquella auditoría dejó
explícitamente **sin tocar**: las fórmulas RPG (XP/HP), el servicio de estimación IA, y el schema más
allá de soft-deletes. Este plan ataca justamente eso.

### Insumos
- Auditoría interna del módulo (features, schema V1-V9, IPC, RPG).
- Research de producto sobre MyFitnessPal, Cronometer, Yazio, Lifesum, MacroFactor (2024-2026).
- Precedente RPG: Questify y Coinify dan `hp: 0` (solo recompensan). Nutrify es el único que castiga
  con HP negativo (-20 máx) al cerrar el día → se difiere a una revisión RPG transversal.

### Regla de oro (del research, evidencia académica 2024-2025)
Gamificar la **acción de registrar** y el **balance**, NUNCA el déficit ni la restricción. La culpa/vergüenza
es el driver #1 de abandono en apps de nutrición. Castigar con HP por comer replica el daño de los avisos
rojos de MyFitnessPal y el sistema de colores de Noom.

---

## FASE 0 — Fundación: Macros en el backend `[P0 · habilita F1/F4]`

El gran faltante. Hoy solo se trackean calorías totales; `ai_breakdown` guarda un JSON que nunca expone
proteína/carbo/grasa. Sin macros, Nutrify no sirve para optimizar composición corporal.

- **Migración V10**: agregar `protein_g`, `carbs_g`, `fat_g` (REAL, nullable) a `food_log`,
  `favorite_foods`, `frequent_foods`. Agregar a `nutrition_daily_summary` para histórico.
  Agregar objetivos de macros a `nutrition_profile` (ver decisiones de diseño abajo).
- **Cloud Function** (`functions/src/index.ts`): que la estimación devuelva macros, no solo calorías.
- **estimate-service** (`src/modules/nutrition/estimate-service.ts`): parsear y validar macros.
- **IPC** (`electron/modules/nutrition.ipc.ts`): `logFood` persiste macros; `getFoodByDate` /
  `getSummary` / `getSummaryRange` los devuelven; `recalcSummary` los suma.
- **Sync** (`electron/modules/sync.ipc.ts`): incluir macros en get/merge de las 3 tablas + summary.
- **Types/Preload**: actualizar interfaces en `shared/types.ts`.
- **Tests**: V10 columnas presentes + suma de macros excluyendo soft-deleted.

> Decisiones de diseño pendientes de confirmar antes de tocar el schema (caro de cambiar):
> 1. ¿Set de macros? (proteína/carbo/grasa base, o + fibra/azúcar)
> 2. ¿Objetivos de macros? (auto desde split %, o proteína por kg + resto split)

## FASE 1 — Macros visibles: barras de atributo RPG `[P0 · depende de F0]`

- UI en `Today.tsx`: anillo de calorías + 3 barras de macros como **atributos del personaje**
  (proteína/carbo/grasa). Objetivo vs consumido por macro.
- Objetivos de macros en `NutritionSettings.tsx`.
- Mostrar `ai_breakdown` como ingredientes **editables** (no caja negra).
- Dashboard (`NutritionCharts.tsx`): histórico de macros.

## FASE 2 — Robustez IA + fricción de registro `[P1 · depende de F0]`

- **Robustez IA**: retry + caché local de estimaciones + fallback elegante (hoy se rompe sin internet).
- **Favoritos con porción memorizada**: un clic "consume" el item con su cantidad.
- **Repetir día/comida anterior** ("Repetir el festín de ayer").

## FASE 3 — Correcciones funcionales `[P1]`

- **Reabrir/editar día cerrado** (corregir errores post-cierre, recalcular XP/HP).
- Resolver **overlap de horarios** de comida (hoy asigna meal incorrecto en silencio).
- **Tests** para XP, TDEE y merge de sync (hoy solo hay test de soft-delete).

## FASE 4 — Diferenciadores `[P2 · depende de F0/F1]`

- **Suavizado de tendencia de peso**: promedio móvil ponderado, anti-desánimo (MacroFactor).
- **Micronutrientes como buffs/debuffs**: hierro/zinc/vit C como pociones/resistencias (Cronometer, gamificado).
- **TDEE adaptativo**: el objetivo se recalibra solo según intake vs peso real. Foso defensivo del rubro.

## FASE RPG — Revisión global del sistema (transversal, diferida) `[no en este plan]`

- Alinear filosofía de castigo de HP. Precedente: Questify/Coinify = solo recompensa.
- Nutrify es el único outlier (-20 HP). **Hasta definir esto, NO se toca la lógica de HP de Nutrify.**

---

## Orden de ejecución

F0 → F1 (destraban el valor estrella) → F2/F3 (en paralelo, independientes) → F4 (diferenciadores).

## Ya cubierto por la auditoría 2026-05-02 (NO re-hacer)

Soft-deletes (V9), empty states, sticky footer, touch targets, badge de comida sin resolver,
dedup case-insensitive de frecuentes, help bubble de TDEE, labels XP/HP descriptivos, fallback
manual en el widget.
