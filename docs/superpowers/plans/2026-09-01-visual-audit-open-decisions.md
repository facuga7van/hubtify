# Auditoría visual — decisiones abiertas

Estado: **la 1 resuelta (2026-09-02), la 2 resuelta (2026-09-03); 3–6
pendientes**. Anotado el 2026-09-01, después de publicar la v0.8.2.

Lo que sigue NO son bugs sin arreglar: son las seis cosas que la auditoría visual
dejó sobre la mesa porque la decisión es de diseño, no técnica, y tomarla solo
hubiera sido inventar criterio. Cada una trae el número medido, el archivo y la
propuesta, para poder resolverlas mañana sin volver a investigarlas.

Orden sugerido: el **1** primero. Es una sola definición que arrastra a todas las
demás superficies, y varias de las otras dejan de existir si se resuelve.

---

## 1. `--ink-faded` no cumple AA sobre `--parch-2`

`src/hub/styles/theme.css:31` — `--ink-faded: #6b5535; /* ~6:1 on parchment */`

El comentario es cierto **sólo sobre `--parch-0`**. Sobre `--parch-2`, que es
donde termina el degradé de un cartucho o de una tarjeta, cae a **3.80:1**.

Ya hay dos parches locales que existen por esto: `.rpg-card` corta su degradé en
`--parch-1`, y `.auth-card` lo mismo. Es decir, el sistema ya está compensando el
token a mano, en cada lugar, de a uno.

**Las dos salidas:**

| | Qué implica |
|---|---|
| **Oscurecer el token** | `--ink-faded` pasa a cumplir en las cuatro superficies. Un solo cambio, pero el tercer nivel de tinta se acerca al segundo y el sistema pierde un escalón de jerarquía. |
| **Techar las superficies** | Ninguna superficie de texto llega a `--parch-2`; se corta cada degradé en `--parch-1`, como ya hacen dos. Conserva la escala de tinta, pero hay que barrer los módulos. |

Lo que NO se puede dejar es el estado actual, donde el token promete una cosa y
la mitad de las superficies cobra otra.

**RESUELTA (2026-09-02): se oscureció el token.** `--ink-faded: #5a4428`.
Ratios WCAG medidos (fórmula 2.x, script en el scratchpad de la sesión):

| sobre | `--parch-0` | `--parch-1` | `--parch-2` | `--parch-3` |
|---|---|---|---|---|
| `--ink-faded` viejo `#6b5535` | 5.74 | 4.86 | **3.80** | 2.64 |
| `--ink-faded` nuevo `#5a4428` | 7.45 | 6.32 | **4.94** | 3.43 |
| `--ink-soft` `#4a3520` (sin cambios) | 9.37 | 7.95 | 6.21 | 4.32 |

Por qué oscurecer y no techar: techar era barrer cada degradé de cada módulo y
seguir dependiendo de que nadie vuelva a usar `--parch-2` de fondo; el token es
una línea y el test `tests/shared/theme-contrast.test.ts` lo vigila. El costo
que la tabla anticipaba —el tercer nivel se acerca al segundo— se pagó: la
distancia con `--ink-soft` bajó de 1.63:1 a 1.26:1. Se eligió el valor MÁS
CLARO que cumple 4.5:1 sobre `--parch-2` con margen, justamente para conservar
el escalón. `--parch-3` no pasa ni con `--ink-soft`: queda documentado como
superficie de profundidad (scrollbar, pista de gauge), no de texto.

Además, dentro de una fila de datos (libro mayor, misión, comida) la meta
secundaria pasó a `--ink-soft`; `--ink-faded` queda para pistas, vacíos y
deshabilitados.

## 2. `.rpg-button` está al filo de AA

`src/hub/styles/components.css:87`

El botón declara `color: var(--gold-light)` con el comentario «6.21:1 on
leather» — y sobre `--leather` plano es cierto. El auditor midió **4.36:1**
porque el fondo es un degradé y la **parada peor** es `--leather-light`, arriba.

Arrancar el degradé en `--leather` da 7.07:1, y le saca el brillo al botón firma
de la app. **Decisión estética.** Alternativa intermedia: mover la primera parada
apenas, hasta cruzar 4.5:1 sin apagar el relieve.

**RESUELTA (2026-09-03): el degradé arranca en `--leather` y el relieve vuelve
por el filo, no por el fondo.**

```css
background: linear-gradient(180deg, var(--leather) 0%, var(--leather-dark) 100%);
color: var(--gold-light);
box-shadow: inset 0 1px 0 rgba(245, 231, 192, 0.14), 0 2px 4px rgba(42,29,14,.3);
```

Ratios WCAG 2.x medidos sobre CADA parada del degradé, que es lo que ve el ojo:

| `--gold-light` `#c4a84e` sobre | ratio | veredicto |
|---|---|---|
| `--leather-light` `#5c3a1e` (parada vieja) | **4.36** | fallaba |
| `--leather` `#3a2513` (parada nueva, la peor) | **6.23** | cumple |
| `--leather-dark` `#2a1d0e` (parada de abajo) | **7.07** | cumple |

Por qué no la «alternativa intermedia»: se midió. El punto MÁS CLARO de la
rampa `--leather → --leather-light` que cruza 4.5:1 es `#59381d` con **4.511:1**
— 92.6 % del camino hacia `--leather-light`, indistinguible a ojo del valor que
fallaba y con 0.011 de margen. Un token nuevo para eso es deuda, no diseño.

El relieve —lo que la decisión temía perder— no vivía en la parada clara del
degradé: vive en el filo de arriba. Un `inset 0 1px 0` de pergamino al 14 % lo
devuelve, y no es fondo de texto (el texto tiene 8 px de padding), así que no
entra en la cuenta del contraste. El `:hover` y el `:active` pisan el
`box-shadow` completo, o sea que el filo se apaga al apretar: el botón se hunde.

Mismo tratamiento en `.rpg-btn-sm`, `.player-card__level-badge` y
`.notif-action-go`, que copiaban el degradé viejo.

**Vigilado por** `tests/shared/theme-contrast.test.ts`: lee el degradé real de
`.rpg-button` y de `.rpg-btn-sm` en `components.css`, resuelve cada `var()`
contra `theme.css` y exige 4.5:1 en TODAS las paradas. Si alguien vuelve a
arrancar en `--leather-light`, el test lo caza.

Corolario que salió de la misma medición: **el oro no es tinta.** `--gold` sobre
pergamino da 2.68 / 2.27 / 1.78 (`--parch-0/1/2`) y `--gold-dark` 3.84 / 3.26 /
2.55; el punto de la rampa dorada que cumple sobre `--parch-2` ya es un marrón
oliva indistinguible de `--ink-soft`. El oro queda para bordes, íconos y
ornamento; el texto usa `--ink-soft` o `--ink-faded`. Y al revés: sobre oro, la
parada peor de `--gold → --gold-dark` es `--gold-dark` (3.47:1 con `--ink`), así
que las superficies doradas CON texto arrancan en `--gold-light` y terminan en
`--gold` (4.97:1).

## 3. ¿Ajustes centrado, o pegado a la izquierda como el resto?

`src/hub/styles/shell.css:70-75`

`.settings-page` tenía `max-width: 860px` sin centrar: en maximizada quedaba
contra el borde con ~520 px de pergamino vacío al lado, como si la página se
hubiera cargado a medias. **Ya está centrada** — es la única decisión estética
que un agente tomó solo, y el resto de las páginas usa el ancho completo.

Se revierte borrando el `margin-inline: auto`. Definir si la app tiene columna
centrada para las páginas de lectura, o si todo va al ancho completo.

## 4. El denominador del estante de logros cambia de significado

`src/hub/AchievementsPage.tsx:224-227`

```
{groupItems.filter((a) => a.unlocked).length}/{groupItems.length}
```

`groupItems` es la lista **ya filtrada**. Con el filtro en Pendientes dice
«0 / 1» (cero obtenidos de uno pendiente) y con Todos dice «2 / 2». El numerador
significa lo mismo siempre; el denominador cambia de «cuántos hay» a «cuántos
pasan el filtro».

Propuesta: calcular el contador sobre la lista **completa** del grupo, no sobre
la filtrada, para que el «/ N» sea siempre el total de la sección. El contador
de la cabecera (`unlockedCount / total`) ya se comporta así y no cambia.

## 5. Onboarding habla dos idiomas de «elegido»

En la misma pantalla, el idioma seleccionado se marca con **cuero** y el tamaño
de fuente seleccionado con **pergamino tostado**. Son dos convenciones visuales
para el mismo concepto, a diez centímetros una de otra.

Elegir una y aplicarla a las dos. El cuero es el que ya usa el resto de la app
para «activo».

## 6. El hueco de la crónica

La crónica del dashboard quedó con las columnas alineadas (antes cada `<li>` era
su propia grilla y el XP bailaba ±7 px entre filas), pero entre el texto del
hecho y su columna de XP quedan ~250 px de pergamino. Con las columnas alineadas
ya se lee como libro mayor.

Si molesta, la solución de imprenta es un **puntillado guía** entre el hecho y su
cifra — lo que hace un índice de libro. No es un bug; es si querés el puntillado.

---

Contexto completo de la auditoría (arnés, las dos clases transversales, la
recursión publicada en la 0.8.1) en la memoria: `ui_audit_progress.md`.
