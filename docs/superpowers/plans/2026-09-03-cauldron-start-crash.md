# CAU-03 — el emulador se muere con el Caldero en pantalla

**Fecha:** 2026-09-03 · **Rama:** `fix/cauldron-start-crash` (desde `release/0.9.5`)
**Estado:** causa acotada con evidencia · efecto individual **NO** aislado · arreglo propuesto y verificado en emulador

---

## 1. El titular

CAU-03 no es el botón.

No es «tocar *Iniciar Poción* mata al emulador». Es **«tener la página del Caldero en pantalla mata al
emulador»**. Arrancar la sesión no lo causa: lo *acelera* — de ~90 s a ~10 s. Por eso durante dos
sesiones de QA pareció 3/3 y 6/6 culpa del botón: el botón es lo último que se toca, y a los pocos
segundos el emulador ya no estaba.

Y no se cae en un teléfono. Se cae el **proceso qemu del host**, que es quien rasteriza por software
(`-gpu swiftshader_indirect`).

## 2. Controles (cada uno con arranque en frío, mismo AVD, mismo APK)

| Qué corría | Cuánto aguantó | RAM libre del host (mínima) |
|---|---|---|
| Emulador solo, la app **nunca** se abre | **300 s vivo** | 6914 MB |
| App abierta, parada en el **Hub** (nunca `/cauldron`) | **302 s vivo** | 2426 MB |
| App en **`/cauldron`, sin sesión** (idle) | **murió a los 93 s** | ~3400 MB |
| App en **`/cauldron`, con sesión corriendo** | **murió a los 8 / 10 / 12 / 13 / 79 s** (5 corridas) | 7416 MB en la que murió a los 10 s |

Y el A/B más limpio, **dentro de un mismo arranque** (mismo build, misma instancia, lo único que
cambia es que se enciende la sesión):

```
A-idle   (150 s en /cauldron sin sesión) ......... sobrevive, qemu 3961 -> 4033 MB
B-running (se llama a cauldronStart) ............ MUERTO a los 10 s, con 7,4 GB libres en el host
```

## 3. Qué queda descartado, y con qué

- **El gesto / el botón.** Disparar con `window.api.cauldronStart()` por CDP —sin tocar la UI— mata
  el emulador igual (13 s, 12 s, 10 s), *siempre que la página del Caldero esté en pantalla*. La
  sesión de notificaciones lo vio «estable 2/2» porque estaba parada en otra ruta: sin
  `CauldronPage` montada no hay nada que dibujar.
- **El handler, el worker y el plugin de notificaciones.** Ya lo había descartado la sesión anterior,
  y ahora hay algo más fuerte: la página **idle** también lo mata, y ahí no corre ningún handler.
- **La RAM del host.** Murió con **7,4 GB libres** y sobrevivió corridas enteras con **436 MB**
  libres. No es agotamiento de memoria. (El host está muy peleado por otros agentes, y esa fue mi
  primera hipótesis: es falsa.)
- **El audio.** Ya estaba descartado stubeando Howler; además la corrida idle no reproduce nada.
- **Canvas / WebGL / PixiJS.** El Caldero no dibuja un solo canvas. `pixi.js` solo entra en
  `CharacterCanvas.tsx`, detrás de un `React.lazy`.

## 4. Cómo muere

En silencio. **Sin volcado, sin reporte de Windows Error Reporting, sin una línea en el stdout/stderr
del emulador** (los logs cortan en `Boot completed` y no dicen nada más). No hay evento en el visor
de sucesos ni en Application ni en System.

Eso es la firma de que **la biblioteca de rasterizado por software se lleva puesto el proceso**, no de
un `abort()` de qemu.

## 5. Por qué justo el Caldero

Es la única pantalla de la app que compone capas con desenfoque **de forma continua**. Con la sesión
encendida se multiplican:

| Efecto | Dónde | Cuántos |
|---|---|---|
| `filter: blur(5px)` sobre elementos animados en bucle | `.cauldron-steam` (`cauldron.css:471`) | 5 |
| `box-shadow` animado en bucle | `.cauldron-ember` (`cauldron.css:415`) | 8 |
| `<animate>` SMIL, `repeatCount="indefinite"` | `CauldronSVG.tsx` | 20 |
| `feGaussianBlur stdDeviation="4"` envolviendo un `<path>` con SMIL adentro | `CauldronSVG.tsx:122` | 1 |
| `mix-blend-mode: screen` | `.cauldron-liquid-glow` (`cauldron.css:499`) | 1 |
| motas GSAP en `repeat: -1` | `ambientOrbs()` | 8 |
| `filter: drop-shadow(...)` sobre el SVG entero | `.cauldron-svg` (`cauldron.css:157`) | 1 (también en idle) |

En idle quedan el `drop-shadow` del SVG y el `feGaussianBlur` de la sombra del piso — poco, pero
suficiente para matarlo en ~90 s. Encender la sesión suma ~40 animaciones infinitas y lo baja a ~10 s.

## 6. Lo que NO pude demostrar (importante)

**Cuál de esos efectos es el culpable.** Corrí una bisección completa (`no-visuals`, `half-svg`,
`no-svg-filter`, `no-filter-animated`, `no-filter-static`, `no-steam`) y todas «sobrevivieron» —
pero **el control `baseline` sobre esa misma instancia también sobrevivió**, así que esas corridas no
valen nada: el emulador había dejado de caerse por su cuenta. Una instancia que ya aguantó un rato
deja de ser sensible, y a partir de ahí todo «no crashea».

Aislar un efecto pide reiniciar el emulador en frío entre variante y variante (~4 min cada una) y
varias repeticiones por variante, porque el tiempo hasta la muerte va de 8 s a 93 s. No entró en esta
sesión. Lo dejo escrito para no vender una certeza que no tengo.

## 7. ¿Afecta a un teléfono real?

**No se cae.** El crash es exclusivo del emulador: se muere el rasterizador por software del host, y
un teléfono tiene GPU de verdad. No lo disfrazo de otra cosa.

Pero de acá salió **un bug real que sí afecta a todas las plataformas**:

> `prefers-reduced-motion: reduce` estaba respetado en el CSS (`cauldron.css:1385`), en GSAP
> (`gsap-setup.ts`), en `celebrate.ts`, en `epic.ts` y en `ambientOrbs()` — **y no llegaba al SVG del
> Caldero**. Ni el CSS ni GSAP pueden apagar SMIL. Quien le pide al sistema operativo que la pantalla
> se quede quieta seguía viendo 20 animaciones en bucle —llamas temblando, burbujas subiendo, el
> líquido ondulando— durante los 25 minutos enteros de la sesión.

Eso se arregla por derecho propio, no como parche del emulador. Y de paso son ~40 animaciones
infinitas menos de batería en un teléfono.

## 8. El arreglo

Un solo interruptor, `animated`, con dos motivos para apagarse:

1. **`usePrefersReducedMotion()`** (`src/shared/hooks/usePrefersReducedMotion.ts`, nuevo) — se
   suscribe al cambio en vivo, porque el ajuste del SO puede cambiar con la app abierta.
2. **`isVirtualDevice()`** (`src/shared/platform-detect.ts`) — `Device.getInfo().isVirtual`, que
   `readOsInfo()` ya pedía al arrancar. Default `false`: si el bridge no contesta (hay techo de 2 s
   en `install-api.ts`), se asume teléfono de verdad y no se degrada nada.

Con `animated={false}`, `CauldronSVG`:
- no renderiza **ningún** `<animate>` (el helper `<Anim on={…}>` los borra del árbol, no los pausa);
- no pone el `feGaussianBlur` sobre las llamas ni sobre el borde del líquido. La sombra del piso sí
  lo conserva: es estática y no cuesta nada.

Y `markVirtualDevice()` marca `[data-lowfx]` en el `<html>` para lo que solo el CSS puede apagar: el
vapor (`filter: blur(5px)`) y las brasas.

El caldero sigue dibujado: mismo líquido, mismo hierro, mismas llamas. Queda quieto, no vacío.

### Verificación en el emulador (APK con el arreglo, arranque en frío)

```
data-lowfx en <html> ............................. "true"   (Device.getInfo().isVirtual llegó)
DOM con la sesión encendida: smil=0, svgFilters=1, steam oculto por CSS
A-idle    (150 s en /cauldron) .................... VIVO    (antes: muerto a los 93 s)
B-running (150 s con la sesión corriendo) ......... VIVO    (antes: muerto a los 10 s)
```

Y aguantó con la RAM libre del host bajando a **238 MB**, la condición más dura de toda la sesión —
justo la que antes daba por muerto al emulador en segundos.

Queda dicho igual: son 2 fases de una corrida, no N repeticiones. El crash tarda entre 8 s y 93 s,
así que «sobrevivió 300 s» es evidencia fuerte pero no una prueba de que no pueda pasar nunca más.

### Archivos

| Archivo | Qué |
|---|---|
| `src/shared/hooks/usePrefersReducedMotion.ts` | nuevo |
| `src/shared/platform-detect.ts` | `markVirtualDevice()` / `isVirtualDevice()` + `[data-lowfx]` |
| `src/mobile/platform-host.ts` | `readOsInfo()` guarda `info.isVirtual` |
| `src/modules/cauldron/components/CauldronSVG.tsx` | prop `animated`, helper `<Anim>`, filtro condicional |
| `src/modules/cauldron/components/CauldronPage.tsx` | `stillCauldron` → `animated={!stillCauldron}` |
| `src/modules/cauldron/styles/cauldron.css` | bloque `[data-lowfx]` |
| `tests/visual/cauldron-still.browser.test.tsx` | nuevo (3 casos) |
| `tests/shared/prefers-reduced-motion.test.ts` | nuevo (5 casos) |

## 9. Cómo reproducirlo / el arnés

Todo vive en el scratchpad de la sesión
(`…/b1df5ef8-…/scratchpad/cau/`), no en el repo:

- `cdp.mjs` — cliente CDP mínimo sobre `ws`.
- `seed.mjs` — siembra un usuario falso en `firebaseLocalStorageDb` + bloqueador `Fetch.failRequest`.
- `run.mjs <variante> <tap|click|api|none>` — una corrida, veredicto en JSON.
- `variants.mjs` — las variantes (cada una apaga *una* cosa, sobreviviendo a los re-render con `MutationObserver`).
- `memphase.mjs` — fases idle vs running midiendo la memoria de qemu (es la que dio el A/B limpio).
- `control.sh <noapp|hub>` — los controles del punto 2.
- `watch.ps1` — vigila el pid de qemu y anota a qué segundo murió.

Notas de entorno (además de las de `2026-09-02-mobile-qa-0.9.0.md`):

- **El AVD `hubtify-qa` lo tenía otro agente.** Cloné un tercero, `hubtify-cau`
  (`~/.android/avd/hubtify-cau.{ini,avd}`, se puede borrar), en `-port 5600` con
  `ANDROID_ADB_SERVER_PORT=5038`. Le saqué `disk.dataPartition.path=<temp>`, así el login sembrado
  sobrevive a los reinicios — imprescindible cuando el emulador se te cae veinte veces.
- **Poné el emulador en modo avión** (`settings put global airplane_mode_on 1` + `svc wifi/data
  disable`) *antes* de sembrar. Si tiene red, al arrancar en frío Firebase intenta refrescar el token
  falso, se lo rechazan y **borra el registro de IndexedDB**: aparecés en la pantalla de login y
  perdés la corrida. Sin red el refresh falla por red y la sesión se mantiene.
- El watchdog tiene que mirar **al menos 90 s**. Con una ventana de 12 s conté como «no crashea»
  corridas que se murieron a los 79 s.

## 10. Qué sigue

1. Aislar el efecto con reinicio en frío por variante y N≥3 (sección 6). Mi apuesta, sin pruebas, es
   el `feGaussianBlur` sobre contenido con SMIL adentro y los 5 `filter: blur(5px)` del vapor.
2. Con el arreglo puesto, el emulador debería aguantar lo suficiente para cerrar **CAU-01** y probar
   pausar / saltar / detener y «Duplicar y editar» con sesión activa, que siguen sin verificarse.
