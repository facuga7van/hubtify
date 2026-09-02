# Auditoría visual — decisiones abiertas

Estado: **pendiente**. Anotado el 2026-09-01, después de publicar la v0.8.2.

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

## 2. `.rpg-button` está al filo de AA

`src/hub/styles/components.css:87`

El botón declara `color: var(--gold-light)` con el comentario «6.21:1 on
leather» — y sobre `--leather` plano es cierto. El auditor midió **4.36:1**
porque el fondo es un degradé y la **parada peor** es `--leather-light`, arriba.

Arrancar el degradé en `--leather` da 7.07:1, y le saca el brillo al botón firma
de la app. **Decisión estética.** Alternativa intermedia: mover la primera parada
apenas, hasta cruzar 4.5:1 sin apagar el relieve.

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
