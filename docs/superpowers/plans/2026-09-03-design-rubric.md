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

---

# Tercera medición — 2026-09-03, rama `feat/iteration-2`

Sobre `release/0.9.5`, 17 commits. **Mismo método, mismo arnés, mismos umbrales**:
las 10 pantallas montadas a 1640×900 y las 11 a 390×844 (el cajón incluido), la
fórmula WCAG 2.x contra la **parada peor** del degradé (`lowContrastText`),
`smallText(root, 13)`, `ancho_px / (font_px × 0.5)` para la longitud de línea y
`getBoundingClientRect()` para la caja de cada control. Cada pantalla se montó
**con el `mount()` de su propia suite** —`audit-hub-dashboard`, `audit-hub-pages`,
`audit-hub-settings`, `audit-quests-tasklist`, `audit-nutri-screens`,
`audit-coin-dashboard`, `audit-coin-ledger`, `audit-coin-cauldron` y, del lado
del teléfono, `mobile-harness` + `mobile/fixtures.ts`— para no inventar montajes
nuevos. El arnés de medición es **temporal**, igual que en las dos vueltas
anteriores: se montó (`tests/visual/zz-tercera-medicion.browser.test.tsx` y
`tests/visual/mobile/zz-tercera-medicion-mobile.browser.test.tsx`), se leyó y se
**borró**. Corrió con `--testTimeout=60000`.

Dos correcciones de método que hay que decir antes de los números, porque
cambian cómo se leen las columnas:

1. **La columna «2ª» no es la base de esta rama.** La segunda medición se
   commiteó en `198ec21`, sobre `feat/design-improvements`. Después de eso y
   antes de `release/0.9.5` entraron dos ramas más (`feat/coinify-redesign` y
   `feat/journey-improvements`). Verificado corriendo el mismo contador de CSS
   sobre los dos árboles: en `198ec21` da **534/562 de `font-size` tokenizado**,
   exactamente el número publicado en la segunda medición; en `release/0.9.5` da
   **574/602**. Así que cuando abajo aparece «2ª → 3ª», hay una base intermedia
   que no es de esta vuelta, y donde importa está separada en su propia columna.
2. **El censo de controles de C11 no es el mismo.** Mi arnés cuenta sólo
   controles **visibles** (descarta `display:none` / `visibility:hidden`); el de
   la segunda vuelta contaba 379 controles en el teléfono y el mío cuenta 240 —
   la diferencia son cosas como `.widget-controls`, que el shell móvil oculta.
   **El porcentaje no es comparable; el número absoluto de fallos sí**, y da 31
   en las dos.

Como control de que el arnés es el mismo: C2 devuelve **exactamente los tres
mismos nodos** que la segunda medición (`.nutri-day-btn` 2.19, `.nutri-btn`
«Estimar» 2.59, `.rwd-item__redeem` 3.62), con los mismos ratios al centésimo.

### Revisión del 04:45 — tres commits después de medir

Después de cerrar la medición entraron tres commits, y **volví a montar el arnés
entero** (las 10 + las 11 pantallas) sobre el árbol nuevo en vez de razonar sobre
el diff:

| Commit | Qué toca | Efecto medido |
|---|---|---|
| `90a0632` | merge de `release/0.9.5` (reduce-motion del Caldero) | Contadores de CSS **idénticos** (596/624, 135 hex, 894 `rgba()`, 258 bloques móviles) |
| `55aea72` | `DashboardWidget.tsx` de Coinify: select de moneda ARS/USD + `finance:getEntryDefaults` | **C4, C7 y C11 sin mover**, byte por byte: escritorio 3/0/4 y 327/335, teléfono 3/0/0 y 31/240. El control nuevo vive **dentro del formulario plegado**, que en el primer render está cerrado |
| `528b294` | vocabulario en `es.json`/`en.json` y en los respaldos `t()` | **Cierra el hallazgo de C12** (censo propio abajo) |

Del formulario abierto, lo que sí verifiqué del commit `55aea72`: el select de
moneda mide **72×44** y el de medio de pago **129×44** — los dos pasan el piso
de toque, y de los 22 controles del widget abierto **ninguno de los nuevos**
cae bajo 44 px (los 3 que fallan son los mismos de siempre: dos `.qb-check` y
el `toggle`). Cero desborde, `doc` y `main` en 0. La afirmación se sostiene.

Y al abrir ese mismo formulario —cosa que ninguna de las tres mediciones había
hecho— **apareció un fallo de contraste real que ninguna había visto**. Está en
C2, abajo, y me obliga a bajarme una nota a mí mismo.

### Revisión del 05:25 — el arreglo de C2, y el barrido que faltaba

Entró `0ee0540`, que corrige los tres hallazgos que había levantado (el gemelo
del par Gasto/Ingreso, el `.then()` sin `.catch()` de `CategorySelect`, y de
paso el censo de selectores muertos). **Volví a montar el arnés**, esta vez con
la disciplina que el propio hallazgo pedía: abrir lo plegado en las **diez**
pantallas, no sólo en la que se acababa de arreglar. Resultado en C2, abajo: el
arreglo se verifica, y el barrido ancho encuentra otros siete. Verifiqué también
por mi cuenta el censo de selectores muertos (12 + `.coin-stat-card`) y la
deriva de `DESIGN_SYSTEM.md`.

Gates de la rama, corridos para este informe **después de borrar el arnés**:
`npx tsc --noEmit` **0** · `npm run typecheck:shared-logic` **0** ·
`npm test` **1985/1985** (167 archivos) · `npm run test:visual` **327/327** (43)
· `npm run test:visual:mobile` **66/66** (13) · `npm run lint` **0 errores**
(13 avisos).

## Los números duros, antes → después

### C2 — fallos de contraste por pantalla

| Escritorio | base | 2ª | **3ª** | | Teléfono | base | 2ª | **3ª** |
|---|---|---|---|---|---|---|---|---|
| Nutrify Hoy | 13 | 2 ᵈ | **2** ᵈ | | Ajustes | 16 | 0 | **0** |
| Ajustes | 12 | 0 | **0** | | Nutrify Hoy | 16 | 2 ᵈ | **2** ᵈ |
| Libro mayor | 8 | 0 | **0** | | Libro mayor | 11 | 0 | **0** |
| Recompensas | 6 | 1 ᵈ | **1** ᵈ | | Recompensas | 9 | 1 ᵈ | **1** ᵈ |
| Panel Coinify | 6 | 0 | **0** | | Panel Coinify | 9 | 0 | **0** |
| Personaje | 5 | 0 | **0** | | Personaje | 8 | 0 | **0** |
| Caldero | 5 | 0 | **0** | | Caldero | 8 | 0 | **0** |
| Hub | 3 | 0 | **0** | | Hub | 6 | 0 | **0** |
| Questify | 1 | 0 | **0** | | Questify | 4 | 0 | **0** |
| Logros | 0 | 0 | **0** | | Logros / Cajón | 3 / 3 | 0 / 0 | **0 / 0** |
| **Total** | **59** | **3** | **3** | | **Total** | **93** | **3** | **3** |

ᵈ Los tres son **controles deshabilitados**, y esta vez está verificado en el
DOM en vez de deducido: `.rwd-item__redeem` `disabled=true opacity=0.5`,
`.nutri-day-btn` «›» `disabled=true opacity=0.3`, `.nutri-btn` «Estimar»
`disabled=true opacity=0.4`. WCAG los excepta. **Contraste real de texto
habilitado: 0 fallos en las 21 pantallas.**

**En estado por defecto C2 no se movió, y no podía moverse: ya estaba en el
piso.** Esa tabla sigue siendo comparable con las dos vueltas anteriores porque
mide lo mismo que ellas.

#### Y ahí está el problema: las tres mediciones midieron sólo el estado por defecto

Al revisar el commit `55aea72` abrí el formulario plegado del widget de Coinify
en el tablero —el único sitio donde se renderiza el control nuevo— y el arnés
devolvió **dos fallos que ninguna de las tres vueltas había visto**:

| Nodo | Ratio | `disabled` | `opacity` | ¿Excusable? |
|---|---|---|---|---|
| `.rpg-button` «Registrar» | 3.09:1 | **true** | 0.4 | Sí — deshabilitado, WCAG lo excepta |
| `.coin-dash-quick__type-btn` «Ingreso» | **3.62:1** | **false** | 0.5 | **No.** Está habilitado y es clickeable |

«Ingreso» es la mitad no elegida del par Gasto/Ingreso: `coinify.css:2036` la
apaga con `opacity: 0.5` y nada la deshabilita. Es **texto habilitado por debajo
de AA**, y el umbral de 9 de esta misma rúbrica pide «≤1 fallo por pantalla y
**ninguno <4.0:1**».

Consecuencias, sin maquillar:

1. **La frase «0 fallos de texto habilitado en las 21 pantallas» era cierta sólo
   para el estado por defecto.** Con formularios y desplegables abiertos hay más.
2. **Bajo C2 de 9 a 8 en las dos plataformas**, y el 9 de la segunda medición
   también estaba sobrevaluado: el control existe desde antes de esta rama, y
   esa vuelta tampoco abrió el formulario. No es una regresión de estos commits;
   es un agujero del método que arrastramos tres veces.
3. La tabla por pantalla de arriba **se queda como está**, con su alcance
   declarado: es lo único comparable con las vueltas anteriores.

#### Barrido de estados desplegados — el que faltaba

Con el fallo de «Ingreso» ya arreglado en `0ee0540` (verificado: **desaparece**,
y el Hub desplegado queda en **0 fallos habilitados**), rehice el barrido pero
**abriendo, en las diez pantallas, todo lo que se despliega**: formularios
plegados, menús de acciones, pestañas no activas, el popup de evento, el picker
de misión, el editor de recetas, el cofre y la comparativa. Cada fallo se
clasifica buscando el nodo hoja que lo produjo —el de **menor opacidad
efectiva**, porque tres «Canjear» comparten clase y texto y sólo el apagado
falla— y mirando si cuelga de un `[disabled]`/`[aria-disabled]`.

| Fase | Fallos habilitados |
|---|---|
| Estado por defecto, 10 pantallas | **0** |
| Estados desplegados, 10 pantallas | **7** |

Los 7, con su regla:

| Pantalla | Nodo | Ratio | Regla |
|---|---|---|---|
| Recompensas → Tienda | `.shop-item__state` «en uso» | 3.84:1 | `rewards.css:405` `color: var(--gold-dark)` |
| Recompensas → Tienda | `.qb-numeral` «40» (precio) | 3.84:1 | hereda `--gold-dark` del bloque de precio |
| Questify | `.quest-project-header-name` «Hoy» | 3.84:1 | `quests.css:546` |
| Questify | `.quest-due--today` «Hoy» ×2 | 3.84:1 | `quests.css:444`, `--parch-0` sobre chip `--gold-dark` |
| Nutrify Hoy → evento | `.nutri-event-midpoint` | 3.26:1 | `nutri.css:3242` `color: var(--gold-dark)` |
| Nutrify Hoy → evento | `.nutri-btn-primary` «Registrar evento» | 3.50:1 | `nutri.css:143`, degradé que arranca en `--ink-soft` |

**Los siete son enfermedades ya diagnosticadas y curadas en otro lado**: cinco
son `--gold-dark` sobre pergamino (3.84 / 3.26) y uno es el `--gold` sobre
`--ink-soft` de **3.50 exacto** que la segunda medición nombró como «el fallo
real de Nutrify» y arregló en `.nutri-btn`, `.nutri-action-bar` y
`.nutri-day-btn` — pero no en `.nutri-btn-primary`. Detalle en hallazgos.

**Por eso C2 se queda en 8 y no vuelve a 9**, aunque el arreglo de `0ee0540`
sea correcto y esté verificado. Lo que lo clava, concretamente: **Questify
muestra tres chips «Hoy» a 3.84:1 en una sola pantalla**, y el umbral de 9 pide
«≤1 fallo por pantalla y ninguno <4.0:1». Ninguno de los siete está en el
teléfono por separado: son reglas de color sin bloque `[data-shell="mobile"]`
que las pise, así que la misma cuenta vale para las dos plataformas.

#### Nota de método para la cuarta vuelta

**Medir sólo el primer render deja fuera la mitad de la app.** El arnés de la
próxima vuelta tiene que, en cada pantalla: (1) abrir todo formulario plegado,
menú y pestaña no activa; (2) clasificar cada fallo por el nodo de **menor
opacidad efectiva** y descartar sólo los que cuelgan de `[disabled]`; (3)
reportar «por defecto» y «desplegado» como dos columnas, no como una. Con esta
disciplina el estado por defecto da 0 y el desplegado da 7 — un criterio que se
puntuaba con la primera cifra estaba puntuando la mitad del trabajo.

### C1 — piso tipográfico

| | base | 2ª (`198ec21`) | base rama (`release/0.9.5`) | **3ª** |
|---|---|---|---|---|
| Escritorio, nodos <13 px (10 pantallas) | 0 | 0 | — | **0** |
| Teléfono, nodos <13 px (11 pantallas) | 2 | 0 | — | **0** |
| `font-size` vía `--fs-*` | 531/561 (94.7 %) | 534/562 (95.0 %) | 574/602 (95.3 %) | **596/624 (95.5 %)** |
| Hardcodes `font-size` <13 px en CSS | 11 | 9 | 9 | **9** |

Los 22 `font-size` que agregó esta rama están **los 22 tokenizados**: por eso el
porcentaje sube sin que nadie haya tocado una regla vieja. Los 9 hardcodes son
línea por línea los mismos de la segunda vuelta: `layout.css:199` (10 px),
`nutri.css:1274` (10 px), `charts.css:282` (10 px) y seis en
`cauldron-window.css` (56, 70, 89, 127, 272, 280), que es la ventanita flotante
y va aparte.

### C5 — longitud de línea

| | base | 2ª | **3ª** |
|---|---|---|---|
| Escritorio, nodos ≥90 ch en las 10 pantallas | 17 | 3 | **4** |
| Teléfono, nodos ≥60 ch en las 11 pantallas | 0 | 0 | **0** |

**Subió uno, y hay que decirlo.** Los cuatro son:

| Nodo | ch | ¿texto corrido? |
|---|---|---|
| `.quest-today-habit-name` | 119 | no — `white-space: nowrap` + `text-overflow: ellipsis` (`quests.css:1560-1562`) |
| `.nutri-meal-name` | 116 | no — ídem (`nutri.css:1290-1292`) |
| `.quest-row-title` | 114 | no — ídem (`quests.css:249-251`) |
| `.coin-category-legend__usd-note` | 95 | **sí**, y es el único |

El cuarto (`.quest-row-title`) **no es una regresión del CSS**: es un rótulo de
fila con puntos suspensivos, de la misma familia que los otros dos, que la
métrica cuenta igual porque mide la caja y no el renglón. Aparece ahora y no en
la vuelta anterior por un detalle del censo, no por un cambio de estilo: la
regla que lo gobierna es idéntica en `release/0.9.5` y en `HEAD`. El único
offensor real de texto corrido sigue siendo el de Coinify, sin tocar.

### C11 — área de toque en el teléfono (controles bajo 44 px)

| Pantalla | base | 2ª | **3ª (censo propio)** |
|---|---|---|---|
| Ajustes | 41 / 45 | 0 / 45 | **0 / 31** |
| Libro mayor | 59 / 67 | 6 / 67 | **6 / 52** |
| Nutrify Hoy | 59 / 70 | 5 / 70 | **5 / 56** |
| Questify | 30 / 32 | 3 / 32 | **9 / 27** |
| Hub | 30 / 33 | 9 / 33 | **3 / 14** |
| Panel Coinify | 26 / 36 | 7 / 36 | **7 / 20** |
| Recompensas | 24 / 26 | 0 / 26 | **0 / 12** |
| Caldero | 18 / 24 | 1 / 24 | **1 / 10** |
| Personaje | 15 / 17 | 0 / 17 | **0 / 3** |
| Logros | 15 / 17 | 0 / 17 | **0 / 3** |
| Cajón lateral | 12 / 12 | 0 / 12 | **0 / 12** |
| **Total** | **329 / 379** | **31 / 379** | **31 / 240** |

**El total de fallos es idéntico: 31.** El reparto por pantalla se movió
(Questify 3→9, Hub 9→3) pero **eso es el censo, no la app**: verifiqué con
`git grep` sobre `release/0.9.5` que **los 31 controles ya existían en la base
de la rama**, ninguno lo introdujo esta vuelta. Desglosados por causa:

| Causa | n | Detalle |
|---|---|---|
| Falso positivo del `::before` | 11 | 7 `input[type=checkbox]` (16–24 px) y 4 `.qb-check` (24 px). El blanco de 44 lo pone un `::before` que no ocupa layout (`components.css:1333-1338`, `codex.css:700-704`) y `getBoundingClientRect()` no lo ve. Ya estaba anotado al final de la segunda medición |
| Falla **sólo de ancho** (alto ≥44) | 9 | 5 `.nutri-pill-portion` (26–27 × 44/49) y 4 `.coin-month-nav__btn` (30 × 44). El alto es lo que importa para el pulgar |
| Falla de alto — **fallos reales** | 11 | `.coin-budget-pencil` ×5 (32×32), `.rpg-number__arrow` ×2 (23×21-22), `.coin-quick-add-form__repeat` (101×24), `.coin-quick-add-form__toggle` (82×28), `.coin-dash-quick__toggle` (104×24) y `.quest-project-header-btn` (346×**20**) |

De los 11 fallos reales, **10 son de Coinify** (o del `RpgNumberInput` dentro
del alta de Coinify, o de su widget en el tablero) y **1 es de Questify**: el
botón que pliega la sección de hábitos en «Hoy», 20 px de alto.

### C4 — densidad: `inkSpan` por pantalla a 1640×900

`inkSpan` = extensión horizontal de la tinta (nodos hoja con texto o SVG)
dividida por el ancho del contenedor. **Es la primera vuelta que lo publica por
pantalla**: las anteriores lo citaron sólo en prosa y para casos sueltos, así
que la columna «2ª» de abajo son los valores que esa medición nombró, no una
tabla completa.

| Pantalla | 2ª (lo que se dijo) | **3ª (medido)** |
|---|---|---|
| Hub | hueco de ~250 px en la crónica | **1369 / 1380 = 99 %** |
| Personaje | — | **1369 / 1380 = 99 %** |
| Logros | — | **1369 / 1380 = 99 %** |
| Recompensas | «al 55 %» | **1369 / 1380 = 99 %** |
| Questify | dos ejes a 1640 | **1629 / 1640 = 99 %** |
| Caldero | tablones 1640→640 | **1629 / 1640 = 99 %** |
| Panel Coinify | tarjetas estiradas | **1592 / 1640 = 97 %** |
| Nutrify Hoy | franja centrada | **1264 / 1380 = 92 %** |
| Libro mayor | ~390 px entre concepto y chip | **1086 / 1640 = 66 %** |
| Ajustes | — | **849 / 1380 = 62 %** |

Y las cuatro sondas puntuales sobre lo que los ejecutores dijeron haber movido:

| Sonda | Afirmación | **Medido a 1640** |
|---|---|---|
| Eje de Questify «Hoy» | desvío 312 px → 0 | tira de pestañas, tira de stats, lista, formulario y `.quest-columns--single` **todos en x=340, ancho 960, derecha 1300**. Desvío **0**. «Agregar Quest» fuera del flujo, a la derecha del encabezado (x=1463) |
| Tarjetas INGRESO/GASTO | 238 px → 127 | `.coin-summary-card` **462×127**, contra `.coin-chest-panel` **647×238**. Dejaron de estirarse |
| Crónica del hub | hueco 278–491 px → puntillado | `.dash-chronicle__row` de 713 px, **hueco máximo entre hijos = 8 px**, con `.dash-chronicle__leader` de 264 px cubriendo lo que era vacío. **0 estilos en línea** en la fila |
| Mostrador de Recompensas | techo de 880 px eliminado | `.rwd-page` `max-width: none`; `ul.rwd-list` de **1324 px** en `648px 648px` |

### C6 — tokens, hex, `rgba()`, `var()` indefinidos

| | base | 2ª (`198ec21`) | base rama (`release/0.9.5`) | **3ª (HEAD)** |
|---|---|---|---|---|
| `font-size` vía `--fs-*` | 531/561 (94.7 %) | 534/562 (95.0 %) | 574/602 (95.3 %) | **596/624 (95.5 %)** |
| Hex fuera de `theme.css` | 143 | 133 | 134 | **135** |
| `rgba()` crudos | 866 | 868 | 886 | **894** |
| `var(--rpg-*)` legacy fuera de `theme.css` | 2 | 2 | 2 | **2** |
| `var()` usados sin definir | 0 | 0 | 0 | **0** |

Nota sobre los hex: la segunda medición publicó **128** y mi contador da **133**
sobre el mismo árbol; la diferencia es de regex, no del CSS (yo cuento
`#[0-9a-fA-F]{3,8}\b` en todo el archivo, comentarios incluidos). Lo que importa
es el delta con la misma regla, y con la misma regla **esta rama suma un (1)
solo hex**: `#f5e7c0` en `states.css:15`, **dentro de un comentario** que
documenta que los `rgba(245,231,192,…)` del shimmer son `--parch-0`. **No hay ni
una declaración nueva con color literal.**

Los 8 `rgba()` nuevos: 6 en `states.css` (las alfas del shimmer y del borde —
una alfa no se puede expresar con el token, que es un color sólido), 3 en
`guest-mode.css`, 1 en `shell.css`, 2 en `dashboard-layouts.css`, y −4 en
`components.css`. Los 6 `var()` que figuran «sin definir» son los cuatro
`--safe-area-inset-*` que inyecta Capacitor —los cuatro **con respaldo**— y dos
que pone el JS de los gráficos: los mismos de siempre, ninguno rompe una
declaración.

### C10 — bloques `[data-shell="mobile"]` por hoja

| | base | 2ª (`198ec21`) | base rama | **3ª** |
|---|---|---|---|---|
| Total de bloques | 164 | **218** | 244 | **258** |

**Ojo con este número: 164 y la lista de «hojas sin bloque» de la baseline están
mal contados.** El `rg 'data-shell="mobile"'` original sólo veía la comilla
doble, y hay hojas que usan comilla simple. Con la regex agnóstica
(`\[data-shell=['"]mobile['"]\]`) el árbol de la segunda medición da 218, no lo
que se publicó. Las tres hojas que nacieron en esta rama tienen su bloque:

| Hoja nueva | Bloques | Comillas |
|---|---|---|
| `src/shared/styles/states.css` | 2 | dobles |
| `src/hub/guest-mode.css` | 3 | dobles |
| `src/shared/styles/sync-status-chip.css` | **6** | **simples** — invisible para la regex vieja |

Siguen **sin ningún bloque**: `charts.css`, `notifications.css`,
`help-bubble.css`, `tour.css`, `ChangelogModal.css` y `cauldron-window.css`
(esta última corre en su propia ventana y no aplica). `shell.css` tiene 1 (la
baseline decía 0). Y en las 11 pantallas del teléfono:
**`docOverflowX = 0` y `mainOverflowX = 0`, las once.**

## La rúbrica, tercera medición

| # | Criterio | Escritorio | Teléfono | Qué cambió (evidencia) |
|---|---|---|---|---|
| C1 | Piso tipográfico | 9 → 9 → **9** | 6 → 9 → **9** | 0 nodos <13 px en las 21 pantallas. 95.0 → **95.5 %** de `font-size` tokenizado: los 22 `font-size` nuevos de la rama son **los 22** con `var(--fs-*)`. Los 9 hardcodes <13 px son los mismos 9, línea por línea |
| C2 | Contraste real | 4 → 9 → **8** | 3 → 9 → **8** | **Baja, y no por estos commits.** Estado por defecto intacto: 3 y 3 fallos, los seis **deshabilitados**, y **0 fallos habilitados** en las 10 pantallas. `0ee0540` arregla «Ingreso» del widget (3.62 → 7.95) y lo verifiqué: desaparece. Pero al abrir **todo lo plegado** de las diez pantallas aparecen **7 fallos habilitados** que ninguna vuelta había visto, cinco de ellos `--gold-dark` sobre pergamino (3.84:1) y uno el `--gold`/`--ink-soft` de 3.50 que la 2ª ya había curado en sus hermanos. Lo que clava el 8: **tres chips «Hoy» a 3.84:1 en la misma pantalla de Questify** contra un umbral de «≤1 por pantalla y ninguno <4.0» |
| C3 | Jerarquía | 6 → 7 → **8** | 7 → 7 → **7** | Questify «Hoy» dejó de tener dos ejes: token `--quest-today-measure: 960px` (`quests.css:1639-1651`) tomado por tira de stats, tira de pestañas, formulario y lista — **medido: los cinco en x=340, ancho 960**. `.quest-add-toggle-wrapper` borrada; el botón vive en `headerExtra` (`TaskList.tsx:564-576`). Ajustes recuperó el cromo del códice, así que las 8 páginas se enmarcan igual. En teléfono no se movió nada medible, y encima apareció un roce nuevo (ver C12) |
| C4 | Densidad / ancho | 3 → 5 → **7** | 8 → 8 → **8** | 8 de 10 pantallas con `inkSpan` ≥92 %. `.coin-summary-card` 238→**127 px**; Recompensas sin el techo de 880 (`rwd-list` de 1324 px en dos columnas de 648); la crónica con hueco máximo de **8 px** y puntillado guía de 264 px, y **0 estilos en línea**. Quedan Ajustes al 62 % y el libro mayor al 66 % |
| C5 | Longitud de línea | 2 → 8 → **8** | 10 → 10 → **10** | 3 → **4** nodos ≥90 ch. El cuarto es `.quest-row-title`, `nowrap` + `ellipsis` como los otros dos falsos positivos; su regla es idéntica en la base. El único texto corrido largo sigue siendo `.coin-category-legend__usd-note` (95 ch), sin tocar |
| C6 | Consistencia | 7 → 8 → **8** | 7 → 8 → **8** | 95.5 % tokenizado, 0 `var()` indefinidos, 2 `--rpg-*` legacy (los mismos: `nutri.css:313` y `:1269`). Pero hex 134→**135** y `rgba()` 886→**894**. El hex nuevo está en un comentario y las alfas del shimmer no se pueden tokenizar — así que no es una regresión real, pero **tampoco es una mejora**: el ítem 19 (los 135 hex sueltos) sigue entero |
| C7 | Affordances | 5 → 6 → **7** | 4 → 5 → **6** | La casilla de lote de la fila de misión pasó de rectángulo con tilde a **disco** (`QuestRowActions.tsx:293-295`, `quests.css:375-390`): aro de tinta en reposo, oro macizo con aro `--gold-dark` al marcar. Era la ambigüedad que la baseline nombró («dos checkboxes en la misma fila sin distinguir cuál completa») y está cerrada por FORMA. Ver en hallazgos por qué la justificación escrita en el CSS no se sostiene |
| C8 | Estados | 5 → 5 → **8** | 5 → 5 → **8** | El movimiento grande de la vuelta. `Skeleton`/`EmptyState`/`ErrorState` + `states.css`; `ErrorBoundary` con `fallbackRender` y **uno por widget** (`DashboardWidgetWrapper.tsx:141-157`); **11 archivos** consumen las primitivas en **34 sitios de render**; los 3 casos de «error disfrazado de vacío» separados en tres ramas distintas (`HabitsDashboardWidget`, `AchievementsPage`, `CauldronPage` con sus 7 `.catch`). No es 9 por dos razones duras, abajo |
| C9 | Feedback | 8 → 8 → **8** | 7 → 7 → **8** | Nadie lo tocó en esta rama. Sube el teléfono porque **el ítem 16 ya estaba hecho y las dos mediciones anteriores lo arrastraron sin volver a mirar**: `layout.css:1043-1044` clava `bottom: calc(12px + var(--safe-bottom))` en `.xp-toast` desde el commit `bee2841`, anterior incluso a `198ec21`. El crédito no es de esta vuelta; el número sí es el que corresponde |
| C10 | Paridad | 6 → 7 → **7** | 6 → 7 → **7** | 0 desborde horizontal en las 11 pantallas del teléfono, y las 3 hojas nuevas nacieron con su bloque móvil (218 → 244 → **258**). No sube porque **la brecha es la misma**: `charts.css`, `notifications.css`, `help-bubble.css`, `tour.css` y `ChangelogModal.css` siguen sin un solo bloque |
| C11 | Accesibilidad | 7 → 7 → **8** | 3 → 8 → **8** | **`aria-modal` cerrado: 23 de 23 diálogos lo tienen, 0 faltantes** — era el techo que la segunda medición nombró. 22 llegan por el spread de `useModalA11y` (19 archivos, 22 sitios) y 1 a mano en `TourOverlay.tsx:197`. 0 botones sin nombre accesible en las 21 pantallas. El toque del teléfono **no se movió**: 31 fallos, los 31 preexistentes |
| C12 | Metáfora | 7 → 8 → **8** | 7 → 8 → **8** | Cerró el cromo (Ajustes con `BookPage` + ceja **TOMO VI — ORDINATIO CODICIS**, `qb-rule` y escuadras; `PageHeader.tsx` **borrado** con 0 consumidores) **y ahora también el vocabulario**: `528b294` cierra el hallazgo que yo había levantado, verificado con censo propio —`tarea/subtarea` 12→**0**, `task/subtask` 14→**0**, «ritual» en respaldos 9→**0**, `SALUD`/`VITA` 3→**0**, «meta» 10→**0**— y queda vigilado por `tests/i18n/vocabulario-unico.test.ts`. **Sigue en 8 igual**, porque el tope nunca fue el vocabulario: Nutrify es la única superficie de ruta sin `BookPage`, y «una sola convención» es literalmente lo que pide el 9 |
| C13 | Animación | 8 → 8 → **8** | 8 → 8 → **8** | Sin tocar. `prefers-reduced-motion` en CSS 14→16, `infinite` 22→**24**: los dos loops nuevos (el shimmer del esqueleto y la brújula del chip de sync) traen su propia guarda (`states.css:59-64`, `sync-status-chip.css` dentro de `@media (prefers-reduced-motion: no-preference)`). `outline: none` 3→4, pero el cuarto es `.update-dialog:focus` (`shell.css:234-236`) sobre un contenedor con `tabIndex={-1}`: es el patrón correcto para el foco programático de un modal, no un control sin anillo |
| | **Promedio** | **5.9 → 7.3 → 7.8** | **6.2 → 7.6 → 7.9** | |

El escritorio sube 0.5 por **C8** (+3), **C4** (+2) y **C3/C11** (+1 cada uno),
y devuelve 0.1 por la corrección de **C2** (−1). El teléfono sube 0.3: **C8**
(+3), **C7** (+1), un **C9** (+1) que ya correspondía desde antes, y el mismo
**C2** (−1). **Ocho de los trece criterios no se movieron**, y el único que se
movió para abajo lo hizo porque el método mejoró, no porque la app empeorara.

## Qué NO subió, y por qué

- **C2 (contraste) — BAJÓ, de 9 a 8 en las dos plataformas, y se queda en 8
  aunque el fallo que la bajó ya esté arreglado.** En estado por defecto está
  intacto: 3 fallos y 3, los seis deshabilitados, **0 habilitados**, ni una
  regresión. `0ee0540` corrigió el `.coin-dash-quick__type-btn` «Ingreso» que yo
  había encontrado (3.62 → 7.95, verificado: desaparece del barrido). Pero al
  abrir **todo lo plegado** de las diez pantallas —y no sólo el formulario que
  se acababa de arreglar— aparecieron **otros 7 fallos habilitados**. Volver a
  9 con ese barrido incompleto habría sido repetir el error por cuarta vez. Lo
  que lo clava, textual: **`.quest-due--today` y `.quest-project-header-name`
  ponen tres chips «Hoy» a 3.84:1 en la misma pantalla de Questify**, y el
  umbral de 9 pide «≤1 fallo por pantalla y ninguno <4.0:1». Para llegar a 9
  hay que mover los cinco `--gold-dark` a `--ink-soft` y el degradé de
  `.nutri-btn-primary` a `--gold-light`, que es exactamente lo que ya se hizo
  en sus hermanos.

- **C6 (consistencia) — no subió, y esta vez sí es una deuda.** El ítem 19 de la
  lista de mejoras («reemplazar los hex sueltos que duplican un token») es una
  **L** y sigue entero: 135 ocurrencias, con `#8a7030` (=`--gold-dark`) trece
  veces, `#2a1d0e` once y `#f5e7c0` (=`--parch-0`) siete. Los `rgba()` crudos
  pasaron de 886 a 894. Es verdad que los 6 nuevos son alfas del shimmer y que
  una alfa no se puede escribir con un token de color sólido — pero eso es un
  argumento para **inventar el token de alfa**, no para dejar el literal. Y los
  2 `var(--rpg-*)` legacy de `nutri.css` (líneas 313 y 1269) llevan tres
  mediciones ahí.

- **C10 (paridad) — no subió.** Las hojas nuevas hicieron lo correcto, pero el
  agujero que la primera medición señaló como causa raíz sigue abierto en cinco
  archivos: `charts.css`, `notifications.css`, `help-bubble.css`, `tour.css` y
  `ChangelogModal.css`, **cero bloques `[data-shell="mobile"]` entre los cinco**.
  Para llegar a 9 hace falta que cada hoja tenga el suyo; nadie las tocó.

- **C11 en el teléfono — no subió, aunque el escritorio sí.** Cerrar `aria-modal`
  en los 23 diálogos vale un punto de escritorio, pero el teléfono está limitado
  por el toque y **el toque no se movió: 31 fallos antes, 31 ahora, y los 31
  ya estaban en `release/0.9.5`** (verificado uno por uno con `git grep`). De
  los 11 fallos reales de alto, **10 son de Coinify** —que se rediseñó en la
  rama anterior y no volvió a mirar el piso de 44— y 1 es
  `.quest-project-header-btn`, un botón de **20 px de alto** que pliega la
  sección de hábitos en la pantalla que esta misma vuelta reordenó. Se le
  arreglaron los ejes y se le pasó por al lado el blanco de toque.

- **C12 (metáfora) — no subió, pero ahora el motivo es OTRO, y hay que decirlo
  con el mismo énfasis con que lo acusé.** En la primera pasada de esta medición
  escribí que la afirmación del commit `b8bc72f` —«una sola palabra por
  concepto»— no se sostenía, y di los números. El commit `528b294` la hizo
  cierta. Lo verifiqué con un censo propio (no con los números que me pasaron),
  aplanando `es.json`/`en.json` y extrayendo el 2.º argumento literal de cada
  `t()` bajo `src/`:

  | Regla | `50fd042` (es / en / respaldos) | **HEAD** |
  |---|---|---|
  | `tarea` / `subtarea` | 12 / 0 / 3 | **0 / 0 / 0** |
  | `task` / `subtask` | 1 / 13 / 1 | **0 / 0 / 0** |
  | «ritual» | 1 / 1 / 9 | **1 / 1 / 0** ᵃ |
  | `SALUD` / `VITA` (rótulo) | 0 / 0 / 3 | **0 / 0 / 0** |
  | «meta» (rótulo) | 7 / 0 / 3 | **0 / 0 / 0** |
  | `HP` | 11 / 11 / 5 | **7 / 7 / 3** ᵇ |

  ᵃ El único «ritual» que queda es `rpg.achievements.ritualist.title`
  («Ritualista»): nombre propio con id persistido en la base y en la sync.
  Excepción legítima. ᵇ Leí **los siete** enteros: los siete son el par
  abreviado «XP y HP» de los textos de cierre de Nutrify, donde «HP» no es
  rótulo suelto sino la mitad de un par. Los cuatro que **sí** eran rótulo
  suelto (`hpExplanation`, `scoringBands`, `status.deficit.over`,
  `tour.playerCard.desc`) pasaron a Vigor. Y el respaldo `'VITA'` de
  `Dashboard.tsx` ya no existe.

  De yapa, dos contradicciones que había señalado y que también cerraron:
  `first_quest.desc` ahora dice «Completaste tu primera **misión**» (su título
  siempre fue «Primera Misión»), y `onboarding.questifyDesc` pasó a «Misiones y
  hábitos», igual que `nav.questifyDesc`. La sub-unidad `subtarea` es ahora
  «paso». Todo vigilado por `tests/i18n/vocabulario-unico.test.ts`.

  **Entonces, ¿por qué sigue en 8?** Porque el vocabulario nunca fue el tope —
  era el argumento que yo había puesto para no subirlo, y el tope es otro:
  **Nutrify es la única superficie de ruta sin `BookPage`** (0 archivos bajo
  `src/modules/nutrition/components/` lo usan; las otras ocho superficies sí),
  y el 9 pide literalmente «**una sola** convención». Queda además, más chico:
  la cabecera del teléfono sigue diciendo **«Tabla del Aventurero»**
  (`MobileShell.tsx:16-30`, sin entrada para `'/'` en `SECTION_TITLES`) donde el
  cajón dice **«Inicio»** — aunque eso se atenuó, porque `nav.homeDesc` («Tu día
  de un vistazo — la Tabla del Aventurero») ahora se **pinta** como segundo
  renglón en el cajón, así que en el teléfono el puente se ve; en escritorio
  sigue viviendo sólo en `aria-label`/`title`. Y sobrevive la clave duplicada
  `rpg.vita` = `"VIGOR"` junto a `rpg.vigor` = `"Vigor"`: interna, sin efecto
  visible, pero son dos claves para una barra.

- **C8 no llegó a 9, y le faltó poco.** Dos razones, las dos duras:
  1. **La ficha de Personaje sigue con la brújula.** `CharacterPage.tsx:178`
     hace `if (!stats) return <Loading />;` y `Loading.tsx` es una rosa de los
     vientos que gira (`animation: spin 2s linear infinite`). De las cinco
     pantallas que la baseline marcó sin esqueleto (hub, personaje, logros,
     recompensas, caldero) se cerraron **cuatro**. La quinta, no.
  2. **Ahora hay CINCO dialectos de esqueleto, no uno.** Los cuatro viejos
     siguen definidos y **siguen usados en 37 elementos repartidos en 13
     archivos**: `.nutri-skeleton` 20 usos en 4 archivos, `.coin-skeleton` 11 en
     6, `.codex-skeleton` 4 en 1, `.quest-skeleton` 2 en 2. Nada de finance,
     nutrition, `TaskList` ni la página de Personaje importa las primitivas
     nuevas. El propio `states.css:9-10` lo admite («los cuatro dialectos siguen
     donde están»), y es una decisión defendible de alcance — pero la rúbrica
     pide esqueleto en todos los módulos **con una convención**, y hoy hay cinco.

- **C13 (animación) — no subió y no bajó.** La regla global y `gsap.matchMedia()`
  ya estaban; lo único que cambió es que hay dos animaciones `infinite` más
  (22 → 24), las dos con guarda propia. Para llegar a 9 habría que bajar el
  número de loops simultáneos, no agregarlos.

- **C5 — el número empeoró (3 → 4) y no es una regresión.** Está explicado
  arriba: el cuarto nodo es un rótulo con puntos suspensivos que la métrica
  cuenta mal, y su CSS es idéntico al de la base. Lo dejo con el número peor
  a la vista en vez de filtrarlo, porque el día que la métrica se arregle hay
  que poder ver que eran tres falsos positivos y no uno.

## Hallazgos nuevos

1. **La regex de C10 estaba mal desde la primera medición.** `rg
   'data-shell="mobile"'` no ve `[data-shell='mobile']` con comilla simple, y
   `sync-status-chip.css` usa comilla simple en sus **6** bloques. El total real
   nunca fue 164: con la regex agnóstica el árbol de la baseline da otro número
   y el de la segunda medición da **218**. Todas las cuentas de C10 publicadas
   hasta hoy están por debajo del valor real. La regex correcta es
   `\[data-shell=['"]mobile['"]\]`.

2. **`.coin-stat-card` ya era una regla muerta en `release/0.9.5`, no la mató
   esta rama.** La vuelta anterior escribió `align-self: start` sobre un
   selector que **ningún TSX renderiza** — y en el mismo commit el
   `Dashboard.tsx` ya usaba `.coin-summary-card`. La clase aparece hoy en un
   solo lugar de todo el árbol: el comentario que explica el error
   (`coinify.css:3534`). Es el precedente de esta lista repitiéndose: **una
   mejora medida por su diff y no por su efecto**. Ahora sí está sobre la clase
   real (`coinify.css:3540`) y se mide: 238 → 127 px.

3. **El arreglo del par Gasto/Ingreso se aplicó a uno de los dos gemelos.**
   `components.css:159-167` corrige `.rpg-btn-active` con un comentario que
   nombra el defecto exacto: «"Gasto" seleccionado en el libro mayor medía
   3.05:1». Su gemelo en el widget del tablero,
   `.coin-dash-quick__type-btn` (`coinify.css:2032-2052`), hace lo mismo con
   otra técnica —apaga la mitad no elegida con `opacity: 0.5`— y **nadie lo
   tocó**: «Ingreso» quedaba a **3.62:1, habilitado y clickeable**. Es la misma
   clase de error que el punto 2: **el arreglo se hizo donde la medición miraba,
   no donde estaba el patrón.** Dos sitios que pintan el mismo control con dos
   técnicas distintas es, además, lo que hace que un arreglo no se propague.
   **CERRADO en `0ee0540`**: los tres estados pasaron de `opacity` a superficie
   opaca + tinta (apagado `--ink-soft`/`--parch-1` = **7.95:1**, gasto
   `--rubric`/`--parch-0` = 8.40, ingreso `--moss`/`--parch-0` = 6.94), y lo
   verifiqué remontando el arnés: el nodo desaparece del barrido y el Hub
   desplegado queda en 0 fallos habilitados. Vigilado por 5 tests de
   `theme-contrast.test.ts` y 7 de `audit-coin-widget-open.browser.test.tsx`,
   que **abre el formulario antes de medir** — la nota de método de esta vuelta
   ahora tiene un guardián.

4. **«Se arregla donde mira la medición» es un patrón, no tres casualidades — y
   ésta es la cuarta vez.** Los siete fallos del barrido desplegado no son
   colores nuevos: son **las dos mismas familias** que las vueltas anteriores ya
   diagnosticaron y curaron en otros nodos.
   - `--gold-dark` sobre pergamino (3.84 / 3.26 / 2.55): la segunda medición lo
     arregló en `.rwd-purse__label`, `.rwd-item__cost` y `.codex-link__count`.
     Sobrevive en `.shop-item__state`, `.quest-due--today`,
     `.quest-project-header-name` y `.nutri-event-midpoint`. **El caso más
     desnudo está dentro del mismo archivo**: `rewards.css:69-72` escribe la
     regla —«`--gold-dark` sobre pergamino es 3.84 / 3.26 / 2.55: **el oro no es
     tinta**»— y la aplica a `.rwd-purse__label`; 333 líneas más abajo,
     `rewards.css:405`, `.shop-item__state` sigue en `var(--gold-dark)`. La
     regla y su violación conviven en la misma hoja.
   - `--gold` sobre `--ink-soft` = **3.50:1**: la segunda medición lo llamó «el
     fallo real de Nutrify» y lo movió a `--gold-light` en `.nutri-btn`,
     `.nutri-action-bar` y `.nutri-day-btn`. `.nutri-btn-primary`
     (`nutri.css:143`) quedó con el degradé viejo y mide 3.50 clavado.

   La causa mecánica es siempre la misma: **el arreglo se aplica a los nodos que
   la captura mostraba, no a la regla que los produce.** Mientras la unidad de
   trabajo sea el selector y no el token, cada vuelta va a encontrar hermanos.

5. **13 reglas de `coinify.css` apuntan a selectores que no existen.** Crucé las
   **360** clases `.coin-*` de la hoja (descontando comentarios) contra todos los
   `.tsx` de `src/`: **12 no aparecen en ningún JSX** —`.coin-as-of`,
   `.coin-section-slot`, `.coin-widget__number`, `.coin-widget__label`,
   `.coin-dollar-chip`, `.coin-dollar-chip__value`, `.coin-category-select`,
   `.coin-installment-form`, `.coin-quick-add-form__field`,
   `.coin-quick-add-form__installment-row`, `.coin-skeleton--number`,
   `.coin-import-preview-count`— más `.coin-stat-card`, que hoy sólo sobrevive
   en el comentario que documenta su propia muerte: **13 en total**. Revisé las
   doce una por una y **ninguna esconde un arreglo de legibilidad sin aplicar**:
   las cuatro que declaran color usan `--ink`, `--ink-soft` o `--ink-faded` para
   elementos que no se dibujan. Son restos de layout y tipografía, no deuda de
   contraste. Aparte, **tres que parecen muertas están vivas**:
   `.coin-upcoming__row--recurring/--installment/--card_due` se componen por
   template (`` `coin-upcoming__row--${kind}` ``), así que un censo por texto
   plano las mataría por error.

6. **`CategorySelect` tiene un `.then()` sin `.catch()`** —
   `src/modules/finance/components/shared/CategorySelect.tsx:35-39`:
   `window.api.financeGetCategories().then((cats) => setCategories(cats.filter(…)))`.
   Si el canal falla o devuelve `null`, es una promesa rechazada sin manejar y
   el selector se queda vacío sin decir nada. Lo levantó el propio arnés
   (`TypeError: Cannot read properties of null (reading 'filter')`) al abrir el
   formulario. Duele especialmente porque **es exactamente la clase de defecto
   que esta vuelta salió a cazar** en C8 (las 7 promesas sin `catch` del
   Caldero): quedó viva en un componente compartido de finance que el widget del
   tablero monta. **CERRADO en `0ee0540`**: `.catch()` + guarda
   `Array.isArray` (el fallo real era `null`, no un rechazo) y degradación a
   lista vacía con aviso `toast({ type: 'warning' })`.

7. **La justificación escrita del disco de selección (C7) no se sostiene, aunque
   el cambio sí sirva.** El comentario de `quests.css:364-365` dice que la
   casilla de lote tenía «el mismo dibujo y **los mismos colores**» que el
   `QuillCheckbox`. Los colores nunca fueron los mismos: el `QuillCheckbox` va
   en `--parch-0`/`--gold` con tilde `--ink-soft` (`QuillCheckbox.tsx:215-232`)
   y la casilla vieja iba `fill:none` con trazo `--ink-faded` y tilde
   `--rubric`. La confusión era **de forma**, y de forma se arregló. Segundo, el
   comentario le atribuye al aro en reposo «7.95:1 sobre el pergamino»: eso es
   el ratio de `--ink-soft` a alfa 1, pero `.quest-icon-btn` le clava
   `opacity: 0.6` (`quests.css:339`) y la regla nueva sólo la sube a 1 cuando
   está marcado. El contraste real del aro sin marcar es ≈**5.2:1** — sigue muy
   por encima del 3:1 que WCAG le pide a un gráfico, así que el control pasa,
   pero el número escrito en el archivo es falso.

8. **El `gap: 8px` de la crónica no es nuevo.** El comentario de la vuelta lo
   presenta como parte del arreglo; en realidad es un port literal del
   `gap: 8` que ya estaba en el `style={{}}` en línea de `release/0.9.5`. Lo
   que cierra el hueco de 278–491 px es el puntillado
   (`dashboard-layouts.css:329-335`) y el `gap: 6px` de
   `.dash-chronicle__fact`. El mérito es real; la atribución no.

9. **`.quest-columns--single` quedó fuera del token que la gobierna.** En
   `quests.css:1643-1651` el selector se lista **sin** el prefijo
   `.quest-page--today`, así que fuera de «Hoy» no toma
   `--quest-today-measure` sino el respaldo literal `960px`. Y quedó un bloque
   duplicado y muerto: `.quest-columns--single { grid-template-columns: 1fr }`
   aparece dos veces, en `:1506-1508` y en `:1653-1655`.

10. **Los comentarios nuevos de `coinify.css` citan líneas que ya no existen.**
   `coinify.css:3536` remite a «líneas 1127 y 1144» de `Dashboard.tsx` y
   `:3544` a la 1139 — son los números de `release/0.9.5`; hoy son 1158, 1175 y
   1170. Un comentario que apunta a una línea equivocada envejece peor que no
   tener comentario.

11. **`useModalA11y` es, de hecho, la razón por la que C11 cerró — y también por
   la que la métrica de `aria-modal` es invisible a `grep`.** De los 23
   diálogos, **22 reciben `role` y `aria-modal` por el spread `{...dialogProps}`**
   (`useModalA11y.ts:171-176`) y uno solo lo escribe literal. Un `grep
   'role="dialog"'` sobre `src/` devuelve **2** resultados, uno de ellos dentro
   de un comentario. Cualquier auditoría futura que cuente por texto va a
   reportar un desastre que no existe.

12. **`DESIGN_SYSTEM.md` documenta un token que ya no existe con ese valor.**
    La tabla de color dice `--moss` = `#556b3c` (`DESIGN_SYSTEM.md:50`), pero
    `theme.css:50` lo tiene en `#40522c` («darkened for WCAG AA across the
    parchment gradient»). El valor documentado es el viejo, el que no cumplía —
    la misma trampa que el respaldo `var(--ink-faded, #6b5535)` que la segunda
    vuelta borró, sólo que ahora en la documentación en vez de en el CSS.
    Cualquiera que copie el hex del doc reintroduce el fallo.

13. **La segunda medición dejó C9 del teléfono en 7 sin volver a medirlo.** El
   ítem 16 («toast con `bottom: calc(20px + var(--safe-bottom))`») ya estaba
   implementado —`layout.css:1043-1044`, commit `bee2841`— antes incluso del
   árbol que esa medición auditó. Es el riesgo del formato: un criterio que
   nadie tocó se copia con su número viejo. De acá en más conviene volver a
   medir **los trece**, aunque la vuelta no los haya tocado.
