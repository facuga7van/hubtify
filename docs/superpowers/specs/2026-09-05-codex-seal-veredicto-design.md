# Cierre del Códice — «un solo veredicto»

Rediseño de la página sellada de `CodexSealModal` (`src/hub/codex/CodexSealModal.tsx`,
`src/hub/styles/codex-seal.css`). Diseño aprobado por el usuario el 2026-09-05.

## Objetivo

La página del día dice cada cosa UNA vez, en cuatro zonas, y nada se sale del marco.

Hoy la página sellada repite: el XP del día en dos lugares (cartucho «XP DEL DÍA» y la
línea del sello), el XP del sello en dos o tres, el vigor dos veces (cartucho + «día vivo ×
vigor N»), los óbolos dos veces (línea del sello + la bolsa), la fecha tres veces (título,
«Sellado · fecha», tira), el módulo dos veces (runas + títulos de sección) y «sellado»
cuatro. Hay dos números héroe de 28 px en el mismo `--moss` (+149 del cartucho y +29 del
sello) compitiendo, y `.codex-unlocks` parece un botón sin serlo.

Además, tres problemas de layout medidos en el arnés (`tests/visual/audit-hub-modals.browser.test.tsx`):

| Problema | Causa | Dónde |
| --- | --- | --- |
| El ledger sale a TRES columnas de ~250 px en el marco de 880 px (816 de página). | `.codex-marginalia` es `repeat(auto-fit, minmax(240px, 1fr))` y `.qb-section` no tiene `min-width: 0`, así que la sección no cede: empuja la columna. | `codex-seal.css:140-144`, `codex.css:152-155` |
| La X pisa el título. | `.codex-modal__close` es `position: absolute` contra el marco y `.qb-header-text` no le reserva lugar. En el teléfono la X mide 40 px y `.qb-page` tiene 12 px de padding: 27 px de solape sobre el título. | `codex-seal.css:87-102`, `codex.css:64-82`, `layout.css:959` |
| Las media queries del shell no le llegan. | El modal se monta fuera de `.main-content` (`Layout.tsx:768`); la única regla responsive propia es `@media (max-width: 720px)` para los cartuchos. | `codex-seal.css:122-124` |

Los principios que gobiernan cada decisión:

1. **Un número por dato.** Si un número ya está en la barra lateral (vigor), en el título
   (fecha) o en la tira (sellado por día), no vuelve a aparecer en la página.
2. **Un solo héroe.** El único número a `--fs-hero` es el `+XP` del sello. Todo lo demás va
   en el registro de las filas: small caps a `--fs-label`.
3. **Un hecho es una fila.** El cierre de la jornada de comidas hecho desde acá no es un
   aviso: es una fila más del ledger, con su hora y el XP que pagó el motor, dentro de la
   sección de nutrición, con la misma etiqueta que tendrá al reabrir la página.
4. **Una sola salida escrita.** «Cerrar el libro» vive en el pie, después de la tira, en
   los dos estados (abierto y sellado). La X sigue siendo la salida rápida.

## Zonas

### Árbol de render resultante

```
.codex-overlay
└── .codex-modal [role=dialog]
    ├── button.codex-modal__close.tap-target        ← disco 32 px, fondo --parch-1, absoluto
    └── .codex-modal__scroll
        └── BookPage.qb-page.codex-book
            ├── .qb-header > .qb-header-text        ← padding-right 48 px (ZONA 1)
            │   ├── .qb-eyebrow   «CIERRE DEL CÓDICE — PÁGINA DE AYER»
            │   ├── .qb-title     «Sábado, 5 de septiembre»
            │   └── .qb-subtitle
            ├── .qb-rule
            └── .qb-content
                │                                    (ZONA 2: el ledger)
                ├── .codex-marginalia                ← grid, máx. 2 columnas
                │   └── Section.qb-section  ×N       ← min-width: 0
                │       ├── .qb-section-title  {icono} MISIONES  {.codex-marginalia__count}
                │       └── ul.codex-marginalia__list  [aria-live=polite sólo en nutrition]
                │           └── li.codex-marginalia__row  ×M
                │               ├── .qb-hand.codex-marginalia__time   09:12
                │               ├── .codex-marginalia__text           Misión completada
                │               └── .qb-numeral.codex-marginalia__xp  +15
                │           └── li.codex-marginalia__row[data-codex-row=nutrition-close]
                │               «17:05 · Resumen del día · +18» (sólo en nutrition, sólo
                │               si el cierre se hizo desde acá y hasta el próximo load())
                ├── p.qb-small-caps.codex-ledger-total
                │   └── span.codex-ledger-total__xp[title=«XP DEL DÍA»]  +149
                │       « XP · 12 hechos · combo ×2»
                ├── p.codex-phrase                    « frase de cierre »
                ├── QBDividerSection
                ├── .codex-nutri  (pasos + gimnasio; sin cambios, otra propuesta)
                │                                    (ZONA 3: el sello)
                ├── .codex-wax-zone
                │   ├── (abierto)  button.codex-wax + .codex-wax__hint    ← igual que hoy
                │   ├── (sellado)  .codex-sealed [ref=stageRef]
                │   │   ├── .codex-seal-halo [data-seal=halo]
                │   │   ├── .qb-seal.codex-seal-disc [data-seal=wax]
                │   │   │   └── span.codex-seal-mark [data-seal=stamp]
                │   │   └── .codex-sealed__text [data-seal=result]
                │   │       ├── p.codex-sealed__line
                │   │       │   ├── span.qb-small-caps          Sellado
                │   │       │   ├── span.codex-sealed__dot      ·
                │   │       │   ├── span.codex-sealed__xp       +29        ← el ÚNICO --fs-hero
                │   │       │   ├── span.qb-small-caps          XP
                │   │       │   └── (si obolosGranted > 0)
                │   │       │       span.codex-sealed__dot  ·
                │   │       │       span.qb-small-caps.codex-sealed__obolos  {Obolus} +15 óbolos
                │   │       └── (si hay logros)
                │   │           p.qb-small-caps.codex-unlocks   {SealRosette} Desbloqueaste · Memoria Tardía
                │   └── p.codex-problem [role=status]  (si hay problema)
                │                                    (ZONA 4: el pie)
                ├── QBDividerSection
                ├── Section «ÚLTIMOS XIV DÍAS»
                │   ├── .codex-strip > button.codex-strip__cell ×14
                │   └── .qb-hand.codex-strip__legend
                └── .codex-sealed__foot  (no durante phase === 'sealing')
                    └── button.codex-sealed__exit.tap-target   «Cerrar el libro»
```

### Zona 1 — Cabecera

Sin cambios de contenido: eyebrow, título con la fecha larga, subtítulo. Cambian dos cosas:

- `.codex-modal__close` pasa a ser un **disco**: 32 × 32, `border-radius: 50%`, fondo
  `--parch-1`, borde `--gold-dark`, sombra suave. Sigue `position: absolute` contra el
  marco (el test visual «la salida sigue a mano después de scrollear» exige que sea
  alcanzable tras el scroll y ≥ 32 px). Con fondo, aunque el contenido pase por debajo al
  scrollear, nunca se mezcla con el texto.
- `.codex-book .qb-header-text { padding-right: 48px }` reserva el lugar del disco, así el
  título nunca arranca debajo de la X. La regla va en `codex-seal.css` con el prefijo
  `.codex-book`: `.qb-header-text` es del sistema y en las páginas normales no hay X.

La regla `[data-shell="mobile"] .codex-modal__close` (40 px, `top/right: 8px`) se conserva.

### Zona 2 — Ledger

- `.codex-marginalia { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)) }`.
  Con 816 px de página como máximo (880 de marco − 2 de borde − 8 de scrollbar − 56 de
  padding) entran dos columnas de 320 y nunca tres, así que el `auto-fit` ya limita a dos
  sin hardcodear `repeat(2, …)`; y con un solo módulo la sección ocupa la página entera.
  Bajo 640 px de ventana, una columna (ver Responsive).
- `.qb-section { min-width: 0 }` en `codex.css`. Como ítem de grilla, el mínimo automático
  de una sección es el min-content de su contenido; con cero, la columna manda y el texto
  cede con los puntos suspensivos que `.codex-marginalia__text` ya tiene.
- **Se eliminan** las runas de módulo (`.codex-module-seals`, TSX 483-496): el módulo ya
  está en cada título de sección. Y los cuatro cartuchos (`.codex-cartouches`, TSX
  453-480): XP del día, combo, hechos y vigor.
- En su lugar, **una línea de cierre del ledger** `.codex-ledger-total`, después de la
  grilla y antes de la frase: `+149 XP · 12 hechos · combo ×2`. Small caps a `--fs-label`,
  `--ink-soft`; el `+149` en `--moss`. El vigor NO se muestra: ya está en la barra lateral.
  - Usa `summary.totalXp`, `summary.eventsCount`, `summary.maxCombo`. Si en esta sesión se
    cerró la jornada de comidas desde acá, el total suma lo que el MOTOR pagó y ese hecho
    (`summary.totalXp + nutriAward.xp`, `summary.eventsCount + (nutriAward.xp > 0 ? 1 : 0)`):
    la página no se recarga después de cerrar (nunca lo hizo) y la línea no puede
    contradecir la fila que tiene arriba.
  - **Contrato con `tests/ipc/rpg-codex-contract.test.ts:56-61`**: ese test lee el fuente
    del modal con `/rpg\.codexXpToday[\s\S]{0,200}?summary\.(\w+)/` para descubrir qué
    campo pinta el XP del día. La clave `rpg.codexXpToday` («XP DEL DÍA») se conserva como
    `title` del `span.codex-ledger-total__xp` —es el rótulo del número, visible al pasar el
    puntero— y `summary.totalXp` queda a menos de 60 caracteres. Ni la clave ni la regex
    cambian.
- **La fila de la jornada de comidas.** «Jornada de comidas cerrada · +N XP»
  (`.codex-nutri__award`, TSX 584-591) deja de ser un párrafo suelto. Cuando
  `runNutritionClose` paga, se guarda `{ xp, at: new Date().toISOString() }` y el ledger la
  renderiza como una fila más de la sección de nutrición: hora del cierre en
  `.codex-marginalia__time`, texto en `.codex-marginalia__text`, `+N` en
  `.codex-marginalia__xp`. Lleva `data-codex-row="nutrition-close"` (para el test). Si no
  existe la sección de nutrición en el ledger, se crea con esa única fila y se ordena según
  `MODULE_ORDER` (después de Misiones, antes de Arcas).
  - **El número es el que pagó el motor, no el crudo.** `nutritionCloseDay` devuelve
    `breakdown.xpTotal`, que es el XP base del payload; el motor lo pasa por
    `calculateXpGain(base, combo, bonus) + milestoneXp` (`rpg-handlers.ts:500,554`;
    `DAY_SUMMARY` no está en `FLAT_XP_EVENTS`, `:105`) y `processRpgEvent` devuelve ese
    `xpGained` (`:658`), que hoy `closeNutritionDay` descarta (`nutritionClose.ts:86-92`).
    Con el crudo, la fila diría «+12» y al reabrir el día «+18». Fix: `closeNutritionDay`
    agrega `xpGained` a `NutritionCloseBreakdown` (lo que devolvió el motor; si el motor no
    contesta un número, cae al crudo) y el modal guarda ESE número en `nutriAward.xp`.
  - **La etiqueta es la misma que al reabrir**: `t('events.DAY_SUMMARY', 'Resumen del día')`
    (`es.json:962`), que es lo que el ledger pinta cuando el summary ya trae el evento. NO
    se crea una clave `codexNutriClosedRow`: la fila de hoy y la de mañana tienen que decir
    lo mismo.
  - **Sin doble conteo tras `load()`.** `load()` se vuelve a llamar en `account:switched`
    (TSX 240-244) y cuando el sello rebota con `already_sealed` (`:273`); el summary
    recargado ya trae el `DAY_SUMMARY` real, y `nutriAward` sólo se reseteaba en
    `[date, dayHasNutrition]` (`:204-206`): la fila sintética y la real convivían. Fix:
    `setNutriAward(null)` dentro del `.then` de `load()` (la declaración de `nutriAward` se
    mueve arriba de `load`). Con test.
  - **Anuncio accesible**: `aria-live="polite"` va en el `<ul>` de la sección de nutrición
    (existe antes de que la fila entre, así se anuncia), no en el `<li>` (un nodo que se
    monta ya con contenido no se anuncia). Cuando la sección se CREA con la fila, el `ul`
    también nace con contenido y no se anuncia; es el caso teórico (`modules` sale de los
    eventos, `rpg-handlers.ts:1258`) y se acepta.
  - Ojo con el rótulo real: el título de sección sale de `dashboard.moduleNutrition`, que en
    `es.json` dice «Diario de Provisiones» (el fallback del TSX dice «Vituallas», pero el
    catálogo gana). Los tests buscan «PROVISIONES», no «VITUALLAS».

### Zona 3 — Sello

El disco rojo (`.qb-seal.codex-seal-disc`, 88 px) y la ceremonia GSAP quedan iguales; los
`data-seal` (`wax`, `stamp`, `halo`, `result`) se mantienen porque `sealCeremony` los busca.

Debajo, **una sola línea** `.codex-sealed__line`: `Sellado · +29 XP · +15 óbolos`.

- `flex` centrado, `align-items: baseline`, `gap: 0 8px`; cada tramo es un `span`.
- `.codex-sealed__xp`: `--ff-display`, `--fs-hero`, `--moss`, `line-height: 1`. Es el único
  número héroe de la página.
- El resto en `.qb-small-caps` (`--ff-accent`, `--fs-label`), `--ink-soft`; los puntos
  medios en `.codex-sealed__dot` (`--ink-faded`, `aria-hidden`).
- Los óbolos sólo si `award.obolosGranted > 0`: un `Obolus` de 13 px (ornamento en
  `--gold-dark`, con escape `contrast-ok`) y «+15 óbolos». Se elimina el bloque
  `.codex-obolos` con las tres monedas animadas.
- Al reabrir un día ya sellado (sin `award`), la línea es `Sellado · +N XP` con
  `thisSeal.xpAwarded`. Si no hay ni `award` ni `thisSeal` (imposible en la práctica: el
  día está `sealed` pero `getSeals` no lo trajo), la línea no se pinta.
- **Se elimina** `.codex-award__breakdown` («día vivo × vigor N»): el vigor está en la
  barra lateral. **Se elimina** `.codex-sealed__label` («Sellado · fecha»): la fecha está en
  el título; «Sellado» pasa a la línea.
- **Logros**: `.codex-unlocks` pasa a ser una línea en small caps sin borde ni fondo, debajo
  de la línea del sello: `{SealRosette} Desbloqueaste · Memoria Tardía · Otro logro`. Se
  eliminan `.codex-unlocks__title`, `__list`, `__item`.
- El estado `award` deja de guardar `vigor` (nadie lo lee).

Estado abierto: la misma zona lleva el lacre con hold (`.codex-wax`, `.codex-wax__hint`) tal
cual hoy. El bloque `.codex-nutri` (pasos + gimnasio + botón «Cerrar la jornada») queda
como está: lo resuelve otra propuesta.

### Zona 4 — Pie

- `QBDividerSection` + `Section` «ÚLTIMOS XIV DÍAS» con la tira y su leyenda, sin cambios.
- **UN solo botón** «Cerrar el libro»: `.codex-sealed__foot > button.codex-sealed__exit`. La
  clase `.codex-sealed__exit` se conserva (el test visual «la página ya sellada ofrece su
  propia salida» la busca y la clickea). Sale del bloque `[data-seal="result"]` y pasa al
  pie, después de la tira, en los dos estados; no se pinta durante `phase === 'sealing'`
  (el lacre se está estampando; nada invita a irse a mitad de la ceremonia).
- **Se elimina** `.codex-purse` completo (TSX 713-729): saldo, pista y «Ir al mostrador».
  Con él se van `purse`, `loadPurse`, `purseCopy`, los imports `getObolosBalance`,
  `getRewards`, `rewardsApiReady`, `useNavigate`, y el helper `purseHint`.
  `purseHint` (`src/hub/codex/purse.ts`) sólo lo usan el modal y `tests/hub/purse.test.ts`
  (verificado con `rg purseHint`): se borran los dos archivos.

## Cambios por archivo

### `src/hub/codex/CodexSealModal.tsx`

- Imports: quitar `useNavigate`, `Cartouche`, `Rune`, `Flame`, `Quill`, `getObolosBalance`,
  `getRewards`, `rewardsApiReady`, `purseHint`. Quedan `QBDividerSection`, `Section`,
  `Cauldron`, `Dagger`, `FloralHeart`, `Scroll`, `Sparkle`, `Sword`, `SealRosette`,
  `Obolus`, `titleKey`, `humanise`.
- Estado: `award` sin `vigor`; `nutriAward: { xp: number; at: string } | null` (declarado
  ANTES de `load`, que lo resetea en su `.then`); se van `purse` y `loadPurse`. El listener
  de `account:switched` sólo llama `load()`.
- Derivados: `grouped` se reemplaza por `ledger` (filas ya formateadas + la fila sintética
  de nutrición con `t('events.DAY_SUMMARY')`); `sealXp` y `obolos` para la línea del sello.
  `purseCopy` se va.
- El comentario JSX que acompaña a la línea del total NO escribe los literales
  `rpg.codexXpToday` ni `summary.totalXp`: la regex del contrato los matchearía en el
  comentario por accidente y el `rg` de verificación daría dos líneas.

### `src/hub/codex/nutritionClose.ts`

- `NutritionCloseBreakdown` suma `xpGained: number` (lo que devolvió `processRpgEvent`,
  con combo, bonus y milestone; si el motor no devuelve un número, cae a `xpTotal`).
  `xpTotal` y `hpChange` quedan como estaban. `tests/hub/nutrition-close.test.ts` fija el
  nuevo campo con un stub que devuelve un `xpGained` distinto del crudo.
- Render: zonas 1-4 como en el árbol de arriba. Se van cartuchos, runas, el primer
  `QBDividerSection`, `.codex-nutri__award`, `.codex-sealed__label`, `.codex-award`,
  `.codex-award__breakdown`, `.codex-obolos`, la lista de `.codex-unlocks`, `.codex-purse`.

### `src/hub/styles/codex-seal.css`

- `.codex-modal__close`: 32 × 32, `border-radius: 50%`, borde `--gold-dark`, sombra.
- Nuevo `.codex-book .qb-header-text { padding-right: 48px }`.
- `.codex-marginalia`: `minmax(320px, 1fr)`.
- Nuevos `.codex-ledger-total`, `.codex-ledger-total__xp`.
- `.codex-sealed__text { width: 100% }` (además de `text-align: center`).
- Nuevos `.codex-sealed__line`, `.codex-sealed__xp`, `.codex-sealed__dot`,
  `.codex-sealed__obolos` (+ `svg` con escape `contrast-ok`), `.codex-sealed__foot`.
- `.codex-unlocks` reescrita como línea (sin borde, sin fondo, `flex` centrado); `svg` con
  escape `contrast-ok`.
- `.codex-sealed__exit`: `margin-top: 0` (el margen lo pone `.codex-sealed__foot`).
- Nuevo bloque `@media (max-width: 640px)` (ver Responsive), ANTES del bloque
  `[data-shell="mobile"]` para que el teléfono siga ganando donde ya manda.
- Eliminados: ver «Qué se elimina».

### `src/shared/components/codex/codex.css`

- `.qb-section { min-width: 0 }` (con comentario). Es una regla del sistema: un ítem de
  grilla nunca debe poder empujar su columna.

### `src/i18n/es.json` y `src/i18n/en.json` (sección `rpg`, claves `codex*`)

Las claves del Códice viven en `rpg.codex*`, no en `codex.*`. Alfabético dentro de `rpg`.

Nuevas (con fallback en el TSX):

| Clave | es | en |
| --- | --- | --- |
| `rpg.codexLedgerCombo` | `combo ×{{n}}` | `combo ×{{n}}` |
| `rpg.codexLedgerDeeds_one` | `{{count}} hecho` | `{{count}} deed` |
| `rpg.codexLedgerDeeds_other` | `{{count}} hechos` | `{{count}} deeds` |
| `rpg.codexSealedObolos` | `+{{n}} óbolos` | `+{{n}} obols` |

La fila sintética de nutrición reutiliza `events.DAY_SUMMARY` («Resumen del día»); no hay
clave nueva para ella.

Huérfanas a borrar (verificar con `rg` antes; hoy sólo las usa `CodexSealModal.tsx`):
`codexAwardBreakdown`, `codexComboFoot`, `codexDeeds`, `codexDeedsFoot`, `codexMaxCombo`,
`codexNutriClosed`, `codexObolosGranted`, `codexPurseAffordable`, `codexPurseClosest`,
`codexPurseNoRewards`, `codexPurseSpend`, `codexPurseUnit`, `codexXpFoot`.

Se conservan: `codexXpToday` (title del total), `codexXpUnit`, `codexSealedOn`,
`codexUnlocked`, `codexCloseBook`, `rpg.vigor`, `rpg.streak` (otros usos).

Restricción del arnés de vocabulario (`tests/i18n/vocabulario-unico.test.ts`): paridad de
claves entre `es.json` y `en.json`, y ninguna cadena nueva puede decir «tarea», «meta»,
«ritual», «salud» ni «HP» suelto. Las cuatro cadenas nuevas cumplen.

### Tests

- `tests/visual/audit-hub-modals.browser.test.tsx`: un assert cambia, seis tests nuevos
  (ver «Tests»).
- `tests/hub/nutrition-close.test.ts`: el contrato de `closeNutritionDay` suma `xpGained`.
- `tests/hub/purse.test.ts`: se borra con `purse.ts`.
- `tests/ipc/rpg-codex-contract.test.ts`: la regex y el assert no cambian; sólo el
  comentario del helper y su nombre (`fieldReadByCodexXpCartouche` →
  `fieldReadByCodexLedgerTotal`) para que el ancla semántica no quede vieja. Debe seguir
  verde.

## Responsive

Nuevo bloque en `codex-seal.css`:

```css
@media (max-width: 640px) {
  .codex-book { padding: 16px; }
  .codex-marginalia { grid-template-columns: 1fr; }
  .codex-seal-disc { width: 72px; height: 72px; }
  .codex-sealed__exit { width: 100%; }
}
```

Por qué una media query de ventana vale acá y no en el shell: el modal es `position: fixed`
y mide `min(880px, 96vw)`; su ancho ES una función del viewport, no del espacio que deja
la barra lateral. El bloque cubre el teléfono (390 px) y una ventana de escritorio angosta
(el mínimo de Electron es 700, pero el arnés baja a 600). Se respetan las reglas
`[data-shell="mobile"]` existentes: la X de 40 px, el `.codex-sealed__exit` de 44 px de
alto, los campos de `.codex-nutri`. La regla `[data-shell="mobile"] .codex-cartouches`
desaparece con los cartuchos.

Nota: hoy `[data-shell="mobile"] .codex-sealed__exit { width: 100% }` no hace lo que dice:
el botón vive dentro de `.codex-sealed__text`, que es hijo de un flex column con
`align-items: center` y se encoge a su contenido. `width: 100%` de una caja encogida no es
ancho completo. Con el botón en `.codex-sealed__foot` (bloque normal) la regla vuelve a ser
cierta; `.codex-sealed__text { width: 100% }` arregla lo mismo para la línea del sello.

## Tipografía

Sólo tokens: `--ff-display` / `--ff-accent` / `--ff-body` y `--fs-hero` / `--fs-label`.

| Elemento | Familia | Tamaño | Color |
| --- | --- | --- | --- |
| `.codex-sealed__xp` | `--ff-display` | `--fs-hero` | `--moss` |
| `.codex-sealed__line` (resto) | `.qb-small-caps` (`--ff-accent`) | `--fs-label` | `--ink-soft` |
| `.codex-ledger-total` | `.qb-small-caps` | `--fs-label` | `--ink-soft`, XP en `--moss` |
| `.codex-unlocks` | `.qb-small-caps` | `--fs-label` | `--ink` |

Nada nuevo a 28 px fuera del `+XP` del sello. Las reglas nuevas no usan nombres literales
de fuente.

## Qué se elimina

**TSX** (`CodexSealModal.tsx`): bloque `.codex-cartouches` (453-480); bloque
`.codex-module-seals` (483-496); el `QBDividerSection` de 498; el párrafo
`.codex-nutri__award` (584-591); `.codex-sealed__label` (604-606); `.codex-award` y
`.codex-award__breakdown` (609-617 y 650-652); `.codex-obolos` (618-632); la lista de
`.codex-unlocks` (633-647, reemplazada por una línea); el botón de salida dentro de
`[data-seal="result"]` (658-666, se muda al pie); `.codex-purse` (713-729); el estado
`purse`, `loadPurse`, `purseCopy`; el campo `vigor` de `award`; imports `useNavigate`,
`Cartouche`, `Rune`, `Flame`, `Quill`, `getObolosBalance`, `getRewards`, `rewardsApiReady`,
`purseHint`.

**CSS** (`codex-seal.css`): `.codex-cartouches` + `@media (max-width: 720px)` (115-124);
`.codex-module-seals`, `.codex-module-seal` (126-136); `.codex-sealed__label` (324-326);
`.codex-award`, `.codex-award__breakdown` (328-339); `.codex-obolos`, `__coins`, `__coin`
(+ `nth-child`), `@keyframes codex-obolo-drop`, `__text`, su `prefers-reduced-motion`
(341-387); `.codex-unlocks__title`, `__list`, `__item`, `__item svg` (398-420);
`[data-shell="mobile"] .codex-cartouches` (1121-1124); `.codex-purse`, `__coin`,
`__balance`, `__balance .qb-numeral`, `__hint`, `__link`, `__link:hover/:focus-visible` y
sus dos reglas mobile (1164-1231); `.codex-nutri__award` (1280-1285).

**Archivos**: `src/hub/codex/purse.ts`, `tests/hub/purse.test.ts`.

**i18n** (las 13 claves listadas arriba, en los dos idiomas).

## Tests

### Visual existente que debe seguir verde (`audit-hub-modals.browser.test.tsx`)

- `la página del día entra en la ventana — wide/narrow` (169-236): sigue igual salvo el
  assert de 222-223, que cambia de `.codex-cartouches .qb-cartouche-value` → `'+148'` a
  `.codex-ledger-total__xp` → `'+148'`, más dos asserts nuevos: no queda ningún
  `.codex-cartouches, .codex-module-seals, .qb-cartouche`, y `.codex-ledger-total` dice
  «7 hechos».
- `la salida sigue a mano después de scrollear hasta el lacre` (244-275): sin cambios. La X
  sigue absoluta contra el marco, ≥ 32 px, dentro del viewport tras scrollear.
- `la página ya sellada ofrece su propia salida, al pie del lacre` (277-310): se conserva
  el assert de `.codex-sealed__exit` (existe, tiene texto, cierra al click) y se agregan:
  `.codex-sealed__line` compactada dice `Sellado·+20XP`; no hay `.codex-unlocks` ni
  `.codex-award*` ni `.codex-sealed__label`; el botón está DESPUÉS de `.codex-strip` en el
  documento.

### Tests nuevos (`audit-hub-modals.browser.test.tsx`)

1. **Overflow del ledger** (parametrizado a 900 × 720 con `--font-scale: 1`, 600 × 720 con
   `1` y 900 × 720 con `--font-scale: 1.3` —el usuario puede tener la escala configurada
   (`theme.css:13`) y eso explica la captura—, con un summary de cuatro módulos y tres filas
   cada uno): `scrollWidth <= clientWidth` de `.codex-modal__scroll`; `gridTemplateColumns`
   de `.codex-marginalia` tiene ≤ 2 tracks a 900 y 1 a 600; cada `.qb-section` tiene
   `min-width: 0px` computado (assert de implementación, a propósito: es la causa raíz y se
   quiere fijar) y su borde derecho no pasa el del ledger; `.codex-modal__close` tiene fondo
   no transparente y `border-radius: 50%`; el borde derecho de `.qb-title` queda a la
   izquierda del borde izquierdo de la X. Hoy falla por los tracks (3 a 900, 2 a 600) y por
   el radio (`3px`); el assert del título ya pasa hoy en escritorio (la reserva importa en el
   teléfono) y queda como guardia.
2. **Responsive 600** (página sellada): `.codex-book` con padding 16, `.codex-seal-disc`
   con `offsetWidth` 72 (no `getBoundingClientRect`: el sello está rotado −6°),
   `.codex-sealed__exit` tan ancho como el contenido de `.codex-book`, el diálogo dentro
   del viewport.
3. **Fila de nutrición**: summary con `canSeal: false` (para que exista el botón «Cerrar la
   jornada»), `modules: ['quests', 'nutrition']` y eventos sólo de Misiones —así se ejercita
   la rama que CREA la sección—; stubs `nutritionIsDayClosed → false`,
   `nutritionCloseDay → { success: true, breakdown: { xpTotal: 12, hpChange: 0 } }`,
   `processRpgEvent → { xpGained: 18 }` (el motor paga más que el crudo). Click en el
   botón; después: no existe `.codex-nutri__award`; existe
   `[data-codex-row="nutrition-close"]` dentro de una `.qb-section` cuyo título contiene
   «PROVISIONES», con texto «Resumen del día», `.codex-marginalia__xp` = `+18` (el del
   motor, NO `+12`) y una hora `HH:mm`; las secciones del ledger van «LIBRO DE MISIONES»,
   «DIARIO DE PROVISIONES» en ese orden; `.codex-ledger-total__xp` = `+166` (148 + 18) y el
   total dice «8 hechos».
3b. **Recargar no duplica**: mismo arranque; el stub de `rpgGetDaySummary` devuelve, a
   partir de la segunda llamada, el summary con el `DAY_SUMMARY` real (`totalXp: 166`,
   `eventsCount: 8`). Tras el cierre existe la fila sintética; se dispara
   `window.dispatchEvent(new Event('account:switched'))`; después: no existe
   `[data-codex-row="nutrition-close"]`, la sección de nutrición tiene UNA sola fila y dice
   «Resumen del día», el total sigue en `+166` / «8 hechos».
4. **Veredicto tras estampar**: stub `rpgSealDay → { ok: true, xpAwarded: 29, obolosGranted:
   15, achievementIds: ['late_memory'], … }`; se estampa con teclado (`keydown` de espacio
   sobre `.codex-wax` y 1,7 s de espera; la ceremonia dura ~1,6 s más). Después:
   `.codex-sealed__line` compactada es exactamente `Sellado·+29XP·+15óbolos`; el único nodo
   hoja de `.qb-content` con `font-size ≥ 24px` es `.codex-sealed__xp`; no existen
   `.codex-award`, `.codex-award__breakdown`, `.codex-obolos`, `.codex-sealed__label`;
   `.codex-unlocks` empieza con «Desbloqueaste · », sin borde ni fondo; `.codex-sealed__exit`
   está después de `.codex-strip`.

### Unitarios

- Nuevo `tests/i18n/codex-keys.test.ts`: toda clave `rpg.codex*` de valor string en los
  catálogos se lee desde algún `.ts`/`.tsx` de `src/` (`'rpg.<clave>'` literal; las
  `_one`/`_other` se leen por su base), y los dos catálogos tienen las mismas claves
  `rpg.codex*`. `codexPhrases` es un objeto (se lee por template literal en
  `codexPhrases.ts:60`) y queda fuera por construcción. Hoy falla con 13 huérfanas.
- `npm test -- tests/hub/nutrition-close.test.ts`: `closeNutritionDay` devuelve
  `xpGained` del motor (stub `processRpgEvent → { xpGained: 57 }` con `xpTotal: 42` →
  `{ xpTotal: 42, hpChange: 10, xpGained: 57 }`); si el motor no contesta un número, cae a
  `xpTotal`.
- `npm test -- tests/ipc/rpg-codex-contract.test.ts` (contrato de `summary.totalXp`).
- `npm test -- tests/i18n/vocabulario-unico.test.ts` (paridad de claves + vocabulario).
- `npm test -- tests/shared/css-ink-contrast.test.ts` (los dos `--gold-dark` nuevos en
  `svg` llevan escape `contrast-ok`; los escapes de los bloques borrados se van con ellos).
- `npm test -- tests/hub` (sin `purse.test.ts`).
- `npx tsc --noEmit`.

## Fuera de alcance

- El bloque `.codex-nutri` (pasos + gimnasio + botón «Cerrar la jornada»): otra propuesta.
- Recargar el summary después de cerrar la jornada de comidas o de sellar (la página nunca
  se recargó; la línea total se corrige localmente).
- **La fecha del evento de cierre de comidas.** El motor guarda el `DAY_SUMMARY` con
  `created_at = now` (`rpg-handlers.ts:561,576`), no con `payload.date`: cerrar las comidas
  de AYER desde la página de ayer anota el evento en HOY, así que la fila sintética se ve
  en la página de ayer sólo hasta el próximo `load()`, y al reabrir aparece en la de hoy. Es
  comportamiento del motor, previo a este rediseño; sólo se anota.
- Cambiar la regex del test de contrato o renombrar `rpg.codexXpToday`.
- La ceremonia GSAP (`src/shared/animations/seal.ts`) y los `data-seal`.
- La tira de 14 días y su leyenda.
- La bolsa de óbolos en otro lugar (Recompensas ya muestra el saldo).
- `DESIGN_SYSTEM.md`: no documenta clases `.codex-*`; no hay filas que tocar.
