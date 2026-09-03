# Rúbrica de diseño visual de Hubtify + baseline 2026-09-03

Rama `feat/codex-seal-modal` (v0.9.4). **Sólo análisis: no se tocó código de la app.**

Evidencia: 227 capturas de escritorio (`tests/visual/screens/`, regeneradas hoy,
216 tests verdes) + 45 de teléfono (`tests/visual/__screenshots__/mobile/`, 54
tests verdes) + un arnés de medición temporal que montó 10 pantallas a 1640×900
y 11 a 390×844 midiendo contraste, tamaño computado, caja de cada control y
longitud de línea + una captura real del emulador (`design-audit/android-01-arranque.png`).
La fórmula de contraste es la WCAG 2.x sobre la **parada peor del degradé**
(`lowContrastText` en `tests/visual/audit-hub-harness.ts`); la verifiqué a mano:
`--gold-light #c4a84e` sobre `--leather-light #5c3a1e` → L₁=0.4030, L₂=0.0539 →
(0.4030+0.05)/(0.0539+0.05) = **4.36:1**, igual que el arnés.

---

## Tarea 1 — La rúbrica

| # | Criterio | Qué mide | Cómo se verifica | 3 | 6 | 9 |
|---|---|---|---|---|---|---|
| C1 | **Piso tipográfico** | Que ningún texto informativo baje de `--fs-label` (13 px) | `smallText(root, 13)` sobre cada pantalla montada; `rg "font-size:\s*(0..12)px"` sobre los 21 CSS | >5 nodos bajo 13 px | 1–2 nodos, en zonas marginales | 0 nodos; ≥90 % de `font-size` vía `--fs-*` |
| C2 | **Contraste real** | AA (4.5:1 texto chico, 3:1 grande) contra la **parada peor** del degradé, no contra el fondo de página | `lowContrastText(root, PARCH_WORST)` por pantalla | Algún texto <2.5:1, o >10 fallos/pantalla | 3–6 fallos, todos ≥3.5:1 | ≤1 fallo por pantalla y ninguno <4.0:1 |
| C3 | **Jerarquía visual** | Que de un vistazo se distinga el dato principal, el secundario y el cromo | Mirar la captura tapando el texto: ¿los 3 niveles siguen leyéndose? Alineación de columnas y de tiras de tabs contra su contenido | El ojo no encuentra dónde empezar; ejes desalineados | Jerarquía clara pero con desalineaciones puntuales | 3 niveles claros y todo alineado a la misma grilla |
| C4 | **Densidad y uso del ancho** | Tinta vs pergamino vacío en la caja disponible | `inkSpan(contenedor)` → `ink/container`; y a ojo sobre la captura a 1640 | <45 % del ancho con contenido, o huecos >250 px dentro de una fila | 55–70 % | ≥75 %, o el vacío es deliberado (margen de lectura) |
| C5 | **Longitud de línea** | Caracteres por renglón en los bloques de texto corrido | `measures()`: `ancho_px / (font_px × 0.5)` | >120 ch | 90–110 ch | 45–80 ch, o hay un token de `max-width` de medida |
| C6 | **Consistencia del sistema** | Tokens vs valores sueltos | `rg` sobre los 21 CSS: `font-size` con `var(--fs-*)`, hex fuera de `theme.css`, `var()` usados sin definir, `--rpg-*` legacy | <70 % de tokens, o hay `var()` indefinidos (que borran la declaración entera) | 85–92 %, hex sueltos que duplican tokens | ≥95 %, 0 indefinidos, 0 duplicados de token |
| C7 | **Affordances** | Que se vea qué es clickeable antes de pasar el mouse | Contraste del ícono-botón; ¿un contenedor que scrollea avisa que scrollea? ¿un gesto de mantener-apretado tiene señal además de la leyenda? | Controles invisibles hasta el hover; scroll oculto | Se adivina, con dudas puntuales | Todo control tiene borde/fondo/contraste propio y los scrolls tienen borde difuminado |
| C8 | **Estados vacío / carga / error** | Que el hueco explique y ofrezca salida | Capturas `*-vacio.png`; `rg "skeleton"` por módulo | Pantalla en blanco o una frase suelta sin acción | Frase + a veces CTA; esqueletos en algunos módulos | Ilustración/ícono + frase + CTA a mano, y esqueleto en todos los módulos |
| C9 | **Feedback de acción** | Que cada acción con consecuencia RPG devuelva algo | `useToast` (6 tipos + detalle de XP/combo), animaciones de `src/shared/animations/` | Acciones mudas | Toast genérico | Toast tipado con el detalle + animación específica |
| C10 | **Paridad y adaptación** | Que la misma pantalla funcione a 1640 y a 390 sin desbordar | `docOverflowX()` / `mainOverflowX()` en el arnés móvil; `rg 'data-shell="mobile"'` por archivo | Desborde horizontal, u hojas base sin bloque móvil | Sin desborde pero adaptación desigual | 0 desborde y cada hoja con su bloque `[data-shell="mobile"]` |
| C11 | **Accesibilidad básica** | Nombre accesible, foco visible, área de toque ≥44 px | `unlabelledButtons()`, `rg ":focus-visible"` y `outline:none`, `getBoundingClientRect()` de todo control | Botones sin nombre, o `outline:none` sin reemplazo | Nombres OK, foco OK, toque flojo | Todo lo anterior + ≥80 % de controles con 44 px en teléfono |
| C12 | **Coherencia de la metáfora** | Que el códice medieval no cueste claridad, y que "lo mismo" se diga siempre igual | Comparar la convención de "seleccionado", de numerales y del cromo de página entre pantallas | Dos convenciones para el mismo concepto en la misma pantalla | Convención estable con excepciones aisladas | Una sola convención, y ninguna decisión estética que cueste legibilidad |
| C13 | **Calidad de la animación** | Que aporte y que se pueda apagar | `rg "prefers-reduced-motion"` en CSS y en JS/GSAP; contar animaciones `infinite` visibles a la vez | Movimiento perpetuo sin escape | Regla global, pero mucho loop simultáneo | Regla global `!important` + `gsap.matchMedia()` + guardas por animación |

---

## Tarea 2 — Baseline

| # | Criterio | Escritorio | Teléfono | Evidencia dura |
|---|---|---|---|---|
| C1 | Piso tipográfico | **9** | **6** | Escritorio: **0** nodos <13 px en las 10 pantallas medidas. Teléfono: **2 en todas** — `.sidebar-badge--count` 9 px (`layout.css:492`) y `.player-card__level-badge` 11 px (`layout.css:212`), ambos en el cajón. 531/561 (94.7 %) de `font-size` vía `--fs-*`; 11 hardcodes <13 px, 6 de ellos en `cauldron-window.css` (ventanita flotante, defendible) |
| C2 | Contraste real | **4** | **3** | Peor caso **1.21:1**: `.cauldron-shelf-day` (`cauldron.css:1247`) pinta `--ink-faded #5a4428` sobre el tablón `#6b4f2a→#2f2415`. Verificado a ojo en `audit-coin-cauldron-05-estante.png`: "Hoy/Ayer/lun, 31 ago" casi no se ven. **2.55:1** `.rwd-purse__label` (`rewards.css:47`, `--gold-dark` sobre `--parch-2`). **3.05** el toggle Gasto activo, **3.52** "Comparar con mes anterior", **3.84** `.qb-numeral`. Y **4.36:1 en `.rpg-button`** (`components.css:90`) — la decisión abierta nº2 de la auditoría de 09-01 **sigue sin resolver** y sale en las 10 pantallas. Fallos por pantalla (escritorio): Nutrify 13, Ajustes 12, Ledger 7, Recompensas 7, Personaje 5, Coinify 5, Caldero 4, Hub 3, Questify 1, Logros 0. En teléfono se suman en **todas**: `.player-card__eyebrow` "Guerrero" y `.sidebar-footer__combo-num` "×1.5" a **2.09:1** (`--rubric-light` sobre `--leather`) |
| C3 | Jerarquía | **6** | **7** | Personaje y el Códice son la referencia (`audit-hub-personaje-01-wide-a.png`, `audit-hub-codex-01-wide.png`): dos columnas, tres niveles claros. Pero en Questify "Hoy" a 1640 la tira de tabs arranca en x=20 y la lista en x=265: dos ejes que no se hablan, y "Agregar Quest" queda centrado mientras todo lo demás va a la izquierda. En el libro mayor los rótulos `CATEGORÍA`/`MONEDAS` no caen sobre sus columnas (una es dos columnas sin rótulo; la otra está alineada a la izquierda sobre datos alineados a la derecha). En teléfono la columna única resuelve sola la jerarquía, pero el título de página **repite textual** el del header de 56 px |
| C4 | Densidad / ancho | **3** | **8** | A 1640 el `qb-subtitle` mide **1584 px** en 5 pantallas. Recompensas usa el 55 % del ancho. Los tablones del estante del Caldero cruzan 1640 px con los frascos en los primeros ~200 (87 % vacío). En el libro mayor hay **~390 px** entre el concepto y el chip de categoría. Las tarjetas INGRESO/GASTO se estiran a la altura del Cofre y quedan 2/3 vacías. La crónica del hub sigue con el hueco de ~250 px (decisión abierta nº6, sin resolver). En teléfono, 390 px fuerzan la densidad correcta |
| C5 | Longitud de línea | **2** | **10** | Escritorio: `cauldron-shelf-summary` **244 ch**, `qb-subtitle` **198 ch** (×5 pantallas), `nutri-hint` **191 ch**, `quest-today-habit-name` 119 ch, `settings-row__desc` 118 ch. Sólo `nutri.css` tiene un token de medida (`--nutri-measure`). Teléfono: **0 renglones >60 ch** en las 11 pantallas |
| C6 | Consistencia | **7** | **7** | Fuerte: 94.7 % de `font-size` tokenizado, **0** `var()` usados sin definir (sólo los inyectados por Capacitor y dos de JS), `--rpg-*` legacy reducido a **2** usos. Flojo: **143** hex fuera de `theme.css`, muchos duplicando un token (`#8a7030`=`--gold-dark` ×9, `#2a1d0e` ×7, `#f5e7c0` ×4) y **866** `rgba()` crudos. Trampa activa: `nutri.css:2612,2619,2751` usan `var(--ink-faded, #6b5535)` — el respaldo es el valor **viejo que no cumplía AA** |
| C7 | Affordances | **5** | **4** | `.rwd-item__tool` (editar/borrar) son 24×24 a 3.84:1: en `audit-hub-recompensas-01-wide-a.png` casi no se ven. La fila de misión en "Pendientes" muestra **dos** checkboxes (x=61 y x=751) sin distinguir cuál completa. El sello del Códice es un círculo punteado y el "mantené apretado" vive sólo en una leyenda en itálica. En teléfono, la tira de tabs de Coinify **scrollea 696 px sin ningún borde difuminado**: el último tab queda cortado a mitad de palabra (`coinify-01-panel-a.png`) |
| C8 | Estados | **5** | **5** | 16 clases de vacío, una por módulo. Pero son una frase en itálica sin acción: `audit-quests-06-vacio.png` dice "No hay quests todavía. ¡Agregá una arriba!" flotando en un vacío de 770×400, y el botón al que apunta está 120 px arriba y 240 a la izquierda. Esqueletos sólo en coinify / nutri / quests / codex; **no hay** en hub, personaje, logros, recompensas ni caldero |
| C9 | Feedback | **8** | **7** | 6 tipos de toast con detalle de XP, `bonusTier` y multiplicador de combo; `xpPop`, `coinDrop`, `hpFlash`, `barGleam`, partículas. Es un punto fuerte real. En teléfono el toast es fijo abajo a la derecha con 20 px y `min-width: 240px`: entra, pero se sienta encima del contenido y no toma `--safe-bottom` |
| C10 | Paridad | **6** | **6** | 164 bloques `[data-shell="mobile"]`, bien repartidos (coinify 39, nutri 33, layout 32, quests 29). Pero **cero** en `components.css` — donde viven `.rpg-button`, `.rpg-input` y `.settings-toggle` — y cero en `shell.css`, `codex.css`, `charts.css`, `notifications.css` y `help-bubble.css`. Ese hueco es la causa raíz de C11 en teléfono. Un desborde real: `mainOverflowX = 696 px` en el panel de Coinify |
| C11 | Accesibilidad | **7** | **3** | Muy bien: **0 botones sin nombre accesible** en las 21 pantallas montadas (224 `aria-label` sobre 456 `<button>`), 49 reglas `:focus-visible` y sólo 3 `outline:none`. Mal: en teléfono el **84–100 % de los controles quedan bajo 44 px** (Questify 37/37, Recompensas 24/26, Ajustes 41/45, Ledger 58/64, Nutrify 59/70). Casos extremos: `.nutri-pill-portion` **26×11 px**, `.settings-toggle` 70×20, `.sidebar-nav-item` 286×**32**, `.qb-rune` (tabs) 48×**24**. Además sólo 1 `aria-modal` para muchos modales y 13 `onClick` sobre `div`/`span` |
| C12 | Metáfora | **7** | **7** | El códice se sostiene solo: `UnifrakturCook` en los títulos, cejas "TOMO N", cartuchos, sellos de lacre, estante de pociones, barras-castillo. Roces: el **onboarding sigue con dos convenciones de "elegido"** — idioma en cuero, tamaño de fuente en pergamino tostado, a diez centímetros (decisión abierta nº5, **sin resolver**, ver `audit-hub-onboarding-01-wide.png`); Ajustes es la única página que abandona el cromo del códice (sin ceja, sin `qb-rule`, sin escuadras); "ÚLTIMOS XIV DÍAS" en romano encabeza fichas en arábigo; y `.cauldron-shelf-day` sacrifica la legibilidad para no romper el tablón oscuro |
| C13 | Animación | **8** | **8** | Regla universal `prefers-reduced-motion` con `!important` (`theme.css:239`) **más** `gsap.matchMedia()` (`gsap-setup.ts:12`) y guardas propias en `seal.ts`, `epic.ts`, `celebrate.ts`, `cauldron.ts` y `MobileShell.tsx`. Cubierto de punta a punta. Lo único: 21 animaciones `infinite` y la página de Personaje muestra 12 barras rayadas en `bar-stripe-scroll` a la vez |
| | **Promedio** | **5.9** | **6.2** | |

### Las tres pantallas peor puntuadas

1. **Caldero (escritorio)** — el rótulo del día del estante a **1.21:1** (invisible), el resumen semanal a **244 ch**, y tablones de 1640 px con frascos en los primeros 200.
2. **Nutrify Hoy (escritorio)** — 13 fallos de contraste, 44 de 56 controles bajo 32 px, `nutri-hint` a 191 ch, "Cerrar el Día" flotando encima del borde de la tarjeta de favoritos, y toda la página metida en una franja centrada.
3. **Panel de Coinify (teléfono)** — 696 px de desborde horizontal en la tira de tabs sin ninguna señal de que scrollea; el último tab se corta a mitad de palabra.

*(Mención aparte: el **cajón lateral** no es una pantalla, pero arrastra a las once — "Guerrero" a 2.09:1, insignia de 9 px, filas de nav de 32 px.)*

---

## Tarea 3 — Mejoras priorizadas

Ordenadas por retorno (impacto × pantallas alcanzadas ÷ esfuerzo).

| # | Cambio | Dónde | Sube | S/M/L | Plat. |
|---|---|---|---|---|---|
| 1 | El día del estante deja de ser tinta oscura sobre tablón oscuro: `.cauldron-shelf-day { color: var(--parch-1) }` (7.6:1 sobre `#6b4f2a`) y sacarle el `position:absolute` del borde del tablón | `cauldron.css:1247-1253` | C2 4→6 | **S** | Ambas |
| 2 | Área de toque en las bases: bloque `[data-shell="mobile"]` en `components.css` con `min-height:44px` para `.rpg-button`, `.rpg-input`, `.rpg-select` y `.settings-toggle`; y `min-height:44px` en `.qb-rune` y `.sidebar-nav-item` | `components.css` (bloque nuevo al final), `codex.css` `.qb-rune`, `layout.css` `.sidebar-nav-item` | C11 3→7, C10 6→7 | **M** | Teléfono |
| 3 | Cerrar la decisión abierta nº2: mover la primera parada del degradé de `.rpg-button` de `--leather-light` a un punto que cruce 4.5:1 (o arrancar en `--leather`, 7.07:1) | `components.css:89-90` | C2 en las 10 pantallas | **S** | Ambas |
| 4 | Subir las dos insignias del cajón al piso de 13 px: `.sidebar-badge--count` 9→13 px (caja 14→18 px) y `.player-card__level-badge` 11→13 px | `layout.css:492`, `layout.css:212` | C1 tel. 6→9 | **S** | Teléfono |
| 5 | "Guerrero" y "×1.5" sobre cuero: cambiar `--rubric-light` por `--gold-light` (6.2:1) o `--parch-1` en `.player-card__eyebrow` y `.sidebar-footer__combo-num` | `layout.css:251`, `layout.css:572` | C2 tel. 3→5, en las 11 | **S** | Teléfono |
| 6 | Token de medida de lectura: `--measure: 68ch` en `theme.css` y aplicarlo a `.qb-subtitle`, `.settings-row__desc`, `.nutri-hint` y `.cauldron-shelf-summary` | `theme.css`, `codex.css` `.qb-subtitle`, `components.css` `.settings-row__desc`, `nutri.css`, `cauldron.css:1217` | C5 esc. 2→7 | **S** | Escritorio |
| 7 | Borde difuminado + `scroll-snap` en la tira de tabs de Coinify, para que se vea que sigue | `coinify.css` (`.coin-tabs`, bloque `[data-shell="mobile"]`) | C7 tel. 4→6, C10 6→8 | **S** | Teléfono |
| 8 | Alinear Questify "Hoy" a 1640: la tira de tabs y la lista al mismo eje izquierdo, y "Agregar Quest" a la derecha del encabezado en vez de centrado | `quests.css` (`.quest-tabs`, `.quest-add-btn`), `TaskList.tsx` | C3 esc. 6→8 | **M** | Escritorio |
| 9 | Rótulos del libro mayor sobre sus columnas: `CATEGORÍA` sólo sobre el chip, rótulo nuevo para el medio de pago, `MONEDAS` alineado a la derecha como sus datos | `coinify.css` (`.coin-tx-head`), `Transactions.tsx` | C3 esc. 6→8 | **M** | Escritorio |
| 10 | `.rwd-purse__label` y `.rwd-item__tool` a `--ink-soft` (7.95:1 sobre `--parch-1`) en vez de `--gold-dark` | `rewards.css:47` y la regla de `.rwd-item__tool` | C2 esc. 4→5, C7 5→6 | **S** | Ambas |
| 11 | Empatar el vacío de Questify con el resto: ícono del módulo + frase + botón "Agregar Quest" adentro del hueco | `quests.css` `.quest-empty`, `TaskList.tsx` | C8 5→7 | **M** | Ambas |
| 12 | Ajustes recupera el cromo del códice: ceja "TOMO VI", `qb-rule` y escuadras, como toda otra página | `SettingsPage.tsx`, `components.css` `.settings-page` | C12 7→8 | **S** | Ambas |
| 13 | Cerrar la decisión abierta nº5: el tamaño de fuente elegido en el onboarding pasa a cuero, igual que el idioma | `components.css` (`.onboarding-*` seleccionado) | C12 7→8 | **S** | Ambas |
| 14 | En teléfono, la página no repite el título del header de 56 px: ocultar `.qb-header-text > h1` bajo `[data-shell="mobile"]` y dejar sólo la ceja + subtítulo | `layout.css` (bloque móvil de `.qb-header`) | C3 tel. 7→8, C4 tel. 8→9 | **S** | Teléfono |
| 15 | Cortar la deriva del ancho a 1640: `.coin-stat-card` con `align-self:start` (dejan de estirarse a la altura del Cofre) y el estante del Caldero con `max-width` de tablón | `coinify.css`, `cauldron.css:1239` | C4 esc. 3→5 | **M** | Escritorio |
| 16 | Toast con `bottom: calc(20px + var(--safe-bottom))` en teléfono | `components.css` (contenedor de toasts) | C9 tel. 7→8 | **S** | Teléfono |
| 17 | Limpiar el respaldo obsoleto `var(--ink-faded, #6b5535)` — el valor viejo que no cumplía AA | `nutri.css:2612, 2619, 2751` | C6 7→8 | **S** | Ambas |
| 18 | `aria-modal="true"` + `role="dialog"` en los modales que hoy no lo tienen | modales de `src/shared/components/` y de módulos | C11 esc. 7→8 | **M** | Ambas |
| 19 | Reemplazar los 143 hex sueltos que duplican un token existente (`#8a7030`, `#2a1d0e`, `#f5e7c0`, `#e8d5a3`) por su `var()` | los 21 CSS | C6 7→9 | **L** | Ambas |
| 20 | Una sola caja de completar por fila de misión: quitar el segundo checkbox o distinguirlo visualmente (selección múltiple ≠ completar) | `quests.css`, `TaskList.tsx` | C7 5→7 | **M** | Ambas |

**Si sólo entran seis:** 1, 2, 3, 4, 5, 6. Cierran los dos fallos de contraste
graves, la decisión abierta que arrastra las diez pantallas, el piso tipográfico
del teléfono y la longitud de línea del escritorio — todo con esfuerzo S salvo la
2 — y suben el promedio de escritorio a ~6.7 y el de teléfono a ~7.0.

---

## Notas de método

- El arnés móvil monta el `Sidebar` del cajón en el DOM aunque esté fuera de
  pantalla, así que sus medidas cuentan como UI real de teléfono (el cajón se
  abre con el hamburguesa).
- Dos de los peores números de Nutrify (1.75:1 y 2.00:1) son botones
  **deshabilitados** (opacidad 0.3–0.4); WCAG los exceptúa. El fallo real de
  Nutrify es el habilitado: `--gold` sobre `--ink-soft` = **3.50:1**.
- `under44` cuenta el fallo en cualquiera de los dos ejes, así que un botón de
  390×26 falla sólo por alto. El alto es justamente lo que importa para el pulgar.
- El emulador `hubtify` ya estaba encendido cuando llegué: lo usé para una
  captura del arranque y lo devolví al lanzador **sin apagarlo**.

---

# Segunda medición — 2026-09-03, rama `feat/design-improvements`

Sobre `release/0.9.5`. **Mismo método, mismo arnés, mismos umbrales**: las 10
pantallas montadas a 1640×900 y las 11 a 390×844 (el cajón incluido), la
fórmula WCAG 2.x contra la **parada peor** del degradé, `smallText(root, 13)`,
`ancho_px / (font_px × 0.5)` para la longitud de línea y `getBoundingClientRect()`
para la caja de cada control. El arnés de medición es temporal, igual que el de
la primera vuelta: se montó, se leyó y se borró. Lo que queda vigilando en el
repo es `tests/shared/theme-contrast.test.ts`, ahora también sobre el degradé de
`.rpg-button` y `.rpg-btn-sm`.

## Los números duros, antes → después

### C2 — fallos de contraste por pantalla

| Escritorio | antes | después | | Teléfono | antes | después |
|---|---|---|---|---|---|---|
| Nutrify Hoy | 13 | **2** ᵈ | | Ajustes | 16 | **0** |
| Ajustes | 12 | **0** | | Nutrify Hoy | 16 | **2** ᵈ |
| Libro mayor | 8 | **0** | | Libro mayor | 11 | **0** |
| Recompensas | 6 | **1** ᵈ | | Recompensas | 9 | **1** ᵈ |
| Panel Coinify | 6 | **0** | | Panel Coinify | 9 | **0** |
| Personaje | 5 | **0** | | Personaje | 8 | **0** |
| Caldero | 5 | **0** | | Caldero | 8 | **0** |
| Hub | 3 | **0** | | Hub | 6 | **0** |
| Questify | 1 | **0** | | Questify | 4 | **0** |
| Logros | 0 | **0** | | Logros / Cajón | 3 / 3 | **0 / 0** |
| **Total** | **59** | **3** | | **Total** | **93** | **3** |

ᵈ Los tres que quedan son **controles deshabilitados** (`opacity` 0.3–0.5), que
WCAG excepta explícitamente: `.nutri-day-btn` 2.19, `.nutri-btn` «Estimar» 2.59
y `.rwd-item__redeem` 3.62. **Contraste real de texto habilitado: 0 fallos en
las 21 pantallas.** El peor de toda la app pasó de **1.21:1** a **6.21:1**.

### C1 — piso tipográfico

| | antes | después |
|---|---|---|
| Escritorio, nodos <13 px | 0 | **0** |
| Teléfono, nodos <13 px (en las 11) | 2 | **0** |
| `font-size` vía `--fs-*` | 531/561 (94.7 %) | **534/562 (95.0 %)** |
| Hardcodes <13 px en CSS | 11 | **9** (6 siguen en `cauldron-window.css`) |

### C5 — longitud de línea (escritorio)

| Nodo | antes | después |
|---|---|---|
| `.cauldron-shelf-summary` | 244 ch | **56 ch** (`--measure`) |
| `.qb-subtitle` (×5 pantallas) | 198 ch | **68 ch** (`--measure`) |
| `.nutri-hint` | 191 ch | **68 ch** (la clase no tenía NINGUNA regla; ahora existe) |
| `.nutri-status-message` | 190 ch | **68 ch** |
| `.settings-row__desc` (×5 filas) | 118 ch | **68 ch** |
| Nodos ≥90 ch en las 10 pantallas | 17 | **3** |

Los 3 que sobreviven no son texto corrido: `.quest-today-habit-name` (119 ch) y
`.nutri-meal-name` (116 ch) son rótulos de fila con `white-space: nowrap` +
`text-overflow: ellipsis` —nunca producen un segundo renglón, la métrica los
cuenta igual— y `.coin-category-legend__usd-note` (95 ch) es de Coinify, que
está siendo rediseñado en paralelo y no se tocó.

### C11 — área de toque en el teléfono (controles bajo 44 px)

| Pantalla | antes | después |
|---|---|---|
| Ajustes | 41 / 45 | **0 / 45** |
| Libro mayor | 59 / 67 | **6 / 67** |
| Nutrify Hoy | 59 / 70 | **5 / 70** |
| Questify | 30 / 32 | **3 / 32** |
| Hub | 30 / 33 | **9 / 33** |
| Panel Coinify | 26 / 36 | **7 / 36** |
| Recompensas | 24 / 26 | **0 / 26** |
| Caldero | 18 / 24 | **1 / 24** |
| Personaje | 15 / 17 | **0 / 17** |
| Logros | 15 / 17 | **0 / 17** |
| Cajón lateral | 12 / 12 | **0 / 12** |
| **Total** | **329 / 379 (13 % pasaba)** | **31 / 379 (91.8 % pasa)** |

De los 31 que quedan: 9 son `.qb-check` de 24×24, que **sí** tienen los 44 px
—se los presta un `::before` que no ocupa layout, y `getBoundingClientRect()`
no lo ve—; 13 son de Coinify (territorio del rediseño en curso); 5 son
`.nutri-pill-portion`, que fallan **sólo de ancho** (26×44): son un segmento
dentro de la pastilla del favorito y ensancharlos la deformaría, y el alto es lo
que importa para el pulgar.

## La rúbrica, segunda medición

| # | Criterio | Escritorio | Teléfono | Qué cambió |
|---|---|---|---|---|
| C1 | Piso tipográfico | 9 → **9** | 6 → **9** | `.sidebar-badge--count` 9→13 px (caja 14→18) y `.player-card__level-badge` 11→13 px (caja 24→26). 0 nodos bajo el piso en las 21 pantallas |
| C2 | Contraste real | 4 → **9** | 3 → **9** | 152 fallos → 6, y los 6 son deshabilitados. El peor de la app: 1.21 → 6.21 |
| C3 | Jerarquía | 6 → **7** | 7 → **7** | El estante del Caldero pasó a leerse como libro mayor (el rótulo del día encabeza su renglón) y `--measure` le da eje de lectura a cada página. Siguen abiertas la tira de tabs de Questify y los rótulos del libro mayor |
| C4 | Densidad / ancho | 3 → **5** | 8 → **8** | Los tablones de 1640 px del Caldero ahora miden 640; `.qb-subtitle` bajó de 1584 a ~700 px. Siguen: Recompensas al 55 %, el hueco de la crónica, las tarjetas INGRESO/GASTO estiradas |
| C5 | Longitud de línea | 2 → **8** | 10 → **10** | Token `--measure: 68ch` aplicado a los cinco bloques de texto corrido. 17 nodos ≥90 ch → 3, y los 3 son falsos positivos o de Coinify |
| C6 | Consistencia | 7 → **8** | 7 → **8** | 143 → 128 hex sueltos (los 7 `#c23a3a` del lacre son un token), 3 respaldos obsoletos `var(--ink-faded, #6b5535)` borrados, 95.0 % de `font-size` tokenizado, 0 `var()` indefinidos, y `.nutri-hint` dejó de ser una clase sin regla |
| C7 | Affordances | 5 → **6** | 4 → **5** | `.rwd-item__tool` 24→32 px y de `--ink-faded` a `--ink-soft`; `.nutri-breakdown-toggle` de 18×12 a 24×24. El borde difuminado de la tira de Coinify queda para el rediseño de ese módulo |
| C8 | Estados | 5 → **5** | 5 → **5** | Sin tocar |
| C9 | Feedback | 8 → **8** | 7 → **7** | Sin tocar |
| C10 | Paridad | 6 → **7** | 6 → **7** | `components.css` pasó de **0** a 15 bloques `[data-shell="mobile"]` y `codex.css` de 0 a 6 — el hueco que la primera medición señaló como causa raíz del C11 del teléfono. Siguen sin bloque `shell.css`, `charts.css`, `notifications.css` y `help-bubble.css` |
| C11 | Accesibilidad | 7 → **7** | 3 → **8** | 87 puntos porcentuales de los controles del teléfono pasaron a 44 px (13 % → 91.8 %). Sin cambios en nombres accesibles (ya eran 0 fallos) ni en `aria-modal`, que sigue siendo el techo |
| C12 | Metáfora | 7 → **8** | 7 → **8** | El estante dejó de sacrificar legibilidad por el tablón oscuro, y «oro = ornamento, tinta = texto» pasó a ser una regla escrita en `DESIGN_SYSTEM.md` en vez de una decisión por archivo. Siguen abiertas la del onboarding, el cromo de Ajustes y los numerales romanos |
| C13 | Animación | 8 → **8** | 8 → **8** | Sin tocar |
| | **Promedio** | **5.9 → 7.3** | **6.2 → 7.6** | |

## Qué se hizo, en orden

1. **El texto invisible del Caldero.** `.cauldron-shelf-day` salió del
   `position: absolute` colgado del borde del tablón y es un rótulo de renglón
   en el flujo, a la izquierda, en `--ink-soft`: **1.21 → 6.21:1** (peor caso,
   sobre `--parch-2`). De paso deja de estar a 1580 px de sus propios frascos.
   Mientras estaba ahí: `.cauldron-shelf-row` con `max-width: 640px` (los
   tablones cruzaban 1640 px con los frascos en los primeros 200),
   `.cauldron-shelf-summary` con `--measure` (244 → 56 ch) y
   `.cauldron-kv-value.gold` de `--gold` (2.68) a `--ink-soft`.
2. **Área de toque en el teléfono.** Bloque `[data-shell="mobile"]` nuevo en
   `components.css` (`.rpg-button`, `.rpg-btn-sm`, `.rpg-input`, `.rpg-select`,
   `.rpg-stepper-btn`, `.settings-toggle`, `textarea`, `.tap-target`, casillas
   nativas) y en `codex.css` (`.qb-rune`, `.qb-check`, `.qb-module-card-nav`);
   más el cajón en `layout.css` y las pastillas propias de cada módulo. Todo con
   `min-height: var(--touch-min)` — nunca `height` — así que nada se estira ni
   se recorta, y **el escritorio no cambia una sola caja**.
3. **Decisión abierta nº2, cerrada.** Ver
   `2026-09-01-visual-audit-open-decisions.md`, que ahora trae los ratios de las
   tres paradas y por qué se descartó la «parada intermedia» (el punto más claro
   que cruza 4.5:1 es `#59381d`, con 0.011 de margen). Vigilada por
   `tests/shared/theme-contrast.test.ts`, que lee el degradé real del CSS.
4. **Insignias y etiquetas del cajón.** Las dos insignias al piso de 13 px y
   `.player-card__eyebrow` / `.sidebar-footer__combo-num` de `--rubric-light`
   (2.09:1 sobre cuero) a `--gold-light` (6.23:1). Alcanza a las 11 pantallas.
5. **Longitud de línea.** Token `--measure: 68ch` en `theme.css`, aplicado a
   `.qb-subtitle`, `.settings-row__desc`, `.nutri-hint`, `.nutri-status-message`
   y `.cauldron-shelf-summary`.
6. **Nutrify Hoy.** El fallo real (`--gold` sobre `--ink-soft`, 3.50:1) pasó a
   `--gold-light` (4.97:1) en `.nutri-btn`, `.nutri-action-bar` y
   `.nutri-day-btn`; `.nutri-macro-pct.is-over` de `--gold-dark` (3.84) a
   `--rubric` (5.57–8.40), que además es el color con el que el códice advierte;
   las siete superficies doradas con texto arrancan en `--gold-light`; y los
   controles chicos (`.nutri-pill-portion` 26×11, `.nutri-breakdown-toggle`
   18×12, `.nutri-day-btn` 28×28, `.nutri-btn-sm` de 26 de alto) subieron al piso
   de 32 px en escritorio y 44 en teléfono.

Y de yapa, porque salieron de la misma medición: `.rwd-purse__label`,
`.rwd-item__cost` y `.codex-link__count` de `--gold-dark` a `--ink-soft`;
`.rpg-btn-active` («Gasto» en el libro mayor, 3.05:1) y `.rpg-btn-sm:hover` con
la parada dorada corregida; `.qb-banner--gold`, que heredaba `--parch-0` sobre
oro; `.notif-action-go`; y el lacre (`#c23a3a` → `var(--rubric-light)`) en las 7
hojas que lo repetían, que además sube el sello de 4.31 a 5.61:1.

## Qué NO se hizo, y por qué

- **Todo `src/modules/finance/`.** Coinify entero está siendo rediseñado en
  paralelo. Los ítems 7, 9 y 15 de la lista de mejoras y el desborde de 696 px
  de la tira de tabs son de ese trabajo, no de éste. Los números de Coinify de
  esta tabla se midieron sin tocar una línea del módulo (bajaron igual, porque
  Coinify usa `.rpg-button`, `.rpg-input` y `.qb-*`).
- **Ítems 8, 11, 12, 13, 18 y 20** (alinear Questify a 1640, el vacío de
  Questify, el cromo del códice en Ajustes, la decisión nº5 del onboarding,
  `aria-modal` en los modales, el doble checkbox de la fila de misión). Son
  cambios de **JSX**, no de CSS: tocan la estructura de la página, no su
  pintura. Este trabajo se mantuvo del lado de la hoja de estilos a propósito —
  es donde estaban los seis retornos más altos y donde el riesgo de romper algo
  es acotado y medible.
- **Ítem 19** (los 128 hex sueltos que quedan). Es una L, y la parte que
  importaba —los que se repetían en 7 archivos y encima costaban contraste— ya
  está hecha.
- **`.qb-check` y las casillas nativas a 44 px reales.** Un cuadro de 44 px deja
  de parecer una casilla. Se les dio 22–24 px de dibujo y los 44 de toque por
  `::before`. La métrica no puede verlo y los sigue contando como fallo: queda
  anotado para que la próxima medición no lo lea como una regresión.

## Nota de método

Los dos asserts de `mobile-hub.browser.test.tsx` que medían `height <= 40` como
atajo de «el rótulo no se parte en dos renglones» se volvieron falsos: con el
piso de toque, un botón de un solo renglón mide 44. Pasaron a contar las **cajas
de línea** del texto (`Range.getClientRects().length === 1`), que es lo que la
prueba siempre quiso decir, y ahora además exigen los 44 px.
