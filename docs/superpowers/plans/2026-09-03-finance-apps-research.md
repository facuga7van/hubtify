# Relevamiento de apps de finanzas personales — qué copiar, qué evitar, qué no existe en Argentina

> **Reconstruido el 2026-09-03 tras perderse el original sin commitear.** Lo verificado contra el
> código está marcado; el resto proviene de citas en la spec del rediseño
> (`docs/superpowers/specs/2026-09-03-coinify-redesign.md`) y en el resumen de la noche
> (`D:\hubtify-resumen\index.html`).
>
> **Particularidad de este documento:** es el único de los tres que se apoyaba en fuentes
> **externas**. Al reconstruirlo se **re-verificaron las URLs una por una** (2026-09-03). Cada
> afirmación lleva su estado real de verificación, y **lo que no se pudo leer de primera mano está
> marcado como no verificado** — incluso cuando el original lo daba por bueno. Hay un caso donde la
> re-verificación **corrige** lo que decía el original (§3, Prometeo) y uno donde **no encontró
> ninguna fuente citable** para una afirmación que el rediseño usó como criterio de producto
> (§5.1).

**Fecha del original:** 2026-09-03 · **Propósito:** decidir el modelo mental de cuotas, el
onboarding y la vía de ingesta de datos del rediseño de Coinify.

**Convención de marcas:**

| Marca | Significa |
|---|---|
| **[V]** | **Verificado**: se leyó la página, se cita la URL y lo que efectivamente dice |
| **[P]** | **Parcial**: parte se leyó, parte no fue accesible (403, JS-only, docs con contraseña) |
| **[NV]** | **No verificado en esta reconstrucción**: estaba en el original, no se pudo confirmar de primera mano. **No usar como evidencia.** |
| **[C]** | **Citado** en la spec del rediseño o en el resumen de la noche |
| **[R]** | **Reconstruido**: estaba en el original, sin fuente primaria sobreviviente |

---

## 0. Las tres preguntas que el relevamiento tenía que contestar

1. **¿Qué producto se parece más a lo que Coinify quiere ser, y en qué se equivoca Coinify?**
2. **¿Cuál es el modelo mental CORRECTO de una compra en cuotas?** (porque el de Coinify estaba mal:
   ver `2026-09-03-coinify-audit.md` §5)
3. **¿Hay forma de traer los datos sin tipear?** (API bancaria, open banking, archivos)

---

## 1. Qota (Argentina) — el producto más parecido

**[V]** https://qota.com.ar/

Es lo más cerca que hay de Coinify en el mercado argentino, y **su feature central es exactamente el
que Coinify hace peor**:

> *«Compras en cuotas: cargás una vez y Qota reparte el resto en los meses que vienen»*, con el
> progreso mostrado como **«3 de 12»**.

Tres cosas que confirma, y las tres importan:

1. **El problema es real y es específicamente argentino.** Un producto entero se justifica sólo con
   «llevar la cuenta de las cuotas». Acá el consumo en cuotas no es un caso borde: es el caso.
2. **La unidad mental correcta es el PLAN, no la fila.** Se carga **una vez** y el producto reparte.
   Coinify, en cambio, tenía **tres puertas** que armaban el plan a mano y de tres formas distintas
   (`2026-09-03-coinify-audit.md` §5).
3. **Ni siquiera Qota se conecta al banco.** La página lo dice explícitamente: **no** conecta con
   tu banco, la carga es manual. Es la confirmación de campo de todo lo que dice la §3 de este
   documento.

**[V]** Al momento de la lectura no estaba todavía en Google Play («próximamente»).

> **Advertencia de nombres, porque cuesta cara.** `qota.com.ar` se confunde muy fácil con
> **GOcuotas**, **Credicuotas** y **Cuota Simple**, que son productos de **préstamo / BNPL**, no
> de seguimiento. Son otro negocio. **[V]**

**La conclusión para Hubtify:** el diferencial de Coinify no puede ser «llevar las cuotas» —eso ya
existe—. Tiene que ser **que las cuotas se carguen solas desde el resumen** (que Qota no hace) y que
vivan dentro de un sistema que además tiene misiones, comida y XP.

---

## 2. Mobills (Brasil) — el modelo correcto de cuotas y factura

**[P]** https://www.mobills.com.br/blog/mobills/como-utilizar-o-mobills/ (leída) ·
https://mobills.zendesk.com/hc/pt-br/articles/44243003508123 (**403 al fetch automatizado**)

**Lo que sí se pudo leer** **[V]**: es brasileña (*«o aplicativo de controle financeiro mais baixado
do Brasil»*, referencias a la LGPD), maneja **tarjetas de crédito**, **ciclos de facturación
mensuales** y **«despesa parcelada»** (gasto en cuotas).

**Lo que el original citaba y NO se pudo re-verificar de primera mano** **[P]** — el centro de ayuda
devuelve 403 a cualquier fetch automatizado y sólo se ve por el índice del buscador:

- Las cuotas se reparten solas en las *faturas* futuras, rotuladas `1/10`, `2/10`, …
- La factura se ve por estado: **Aberta / Fechada**.
- Hay **tres actos de pago distintos**: Parcial, Antecipado, Total.
- **Pagar la factura NO elimina las cuotas futuras.**

**Es coherente con la página que sí se leyó, pero no es evidencia leída.** Tratarlo como **[P]**.

### 2.1 El modelo de tres capas, que es lo que hay que copiar

Con esa salvedad, el modelo que el original extrajo y que el rediseño adoptó es éste, y **se
sostiene por sí mismo aunque la fuente quede en [P]** — porque es simplemente cómo funciona una
tarjeta de crédito:

| Capa | Qué es | Regla |
|---|---|---|
| **La compra** | el hecho: un comercio, una fecha, un total | existe una sola vez |
| **El plan de cuotas** | el reparto de esa compra en N meses | se crea una vez, con la compra |
| **La factura / resumen** | el **contenedor** de lo que vence este mes | agrupa las cuotas cuyo mes le toca |

Tres consecuencias que Coinify violaba, y que la spec del rediseño convirtió en reglas:

1. **Las cuotas futuras NO consumen el mes actual.** Sólo consume la que cae en este resumen.
2. **Pagar la factura NO cancela las cuotas.** Son dos hechos distintos: el pago salda el
   contenedor, las cuotas siguen su curso. **[C]** spec §2.4 — *«`SU PAGO` sólo salda un resumen que
   ya existe y está `pending`»*.
3. **La factura es un objeto de primera clase**, con estado propio y con **los números del banco al
   lado de los calculados**. **[C]** spec §3: *«`calculated_amount` vs `statement_total_ars`
   conviven a propósito y no se pisan… Que sean dos números distintos ES el dato.»*

---

## 3. La conexión bancaria automática: no existe en Argentina

Ésta es la sección que decidió toda la arquitectura de ingesta. **Se re-verificó entera** y hay una
**corrección al original**.

| Proveedor | Qué dice su propia página | Estado |
|---|---|---|
| **Belvo** | Tres planes: **Sandbox** gratis (sólo evaluación), **Launch USD 1.000/mes** (el precio pagado más bajo publicado), **Growth** a medida. En instituciones disponibles figuran **sólo Brasil y México**. **Argentina no aparece.** | **[V]** [plans-and-pricing](https://belvo.com/plans-and-pricing/) · [instituciones](https://developers.belvo.com/developer_resources/resources-available-institutions) — ojo: `/pricing/` da 404 |
| **Pluggy** | *«Infraestrutura de Open Finance para o Brasil»*, +130 instituciones. **Argentina no se menciona.** | **[V]** https://pluggy.ai/ |
| **Fintoc** | *«…las instituciones disponibles para iniciación de pagos en **Chile y México**»*. **Argentina ausente.** | **[V]** https://docs.fintoc.com/docs/payment-initiation-countries-and-institutions |
| **Prometeo** | *«Ya estamos operativos en **México, Brasil y Perú**… Próximamente disponible en Estados Unidos, **Argentina** y Colombia.»* Sin precios: el CTA es «Solicitar una demo». | **[V]** https://prometeoapi.com/agentic-banking-infrastructure |

> ### Corrección al original
>
> El informe perdido —y el resumen de la noche que lo cita— decía que **Prometeo «dice cubrir»
> Argentina**. **La re-verificación del 2026-09-03 dice otra cosa:** en la página que se pudo leer,
> Argentina figura como **«próximamente disponible»**, no como operativa. La conclusión práctica
> **no cambia** (no hay precios públicos, es B2B con contrato, y de todos modos no está operativo),
> pero el matiz sí cambia y hay que dejarlo escrito.
>
> **[NV]** `prometeoapi.com/` devolvió HTTP 500, `/en/coverage/` dio error y `docs.prometeoapi.com`
> está **protegida con contraseña**: no se pudo verificar una lista banco por banco. Las cifras de
> prensa de terceros («283 instituciones, 11 países incluyendo Argentina») **no se verificaron y no
> deben citarse**.

### 3.1 Mercado Pago: un callejón sin salida para una persona física

**[V]** [OAuth de Mercado Pago](https://www.mercadopago.com.ar/developers/en/docs/checkout-api-payments/additional-content/security/oauth/introduction):
el OAuth está **explícitamente pensado para vendedores y marketplaces** — las aplicaciones obtienen
*«acceso limitado a la información privada de cuentas de Mercado Pago»* para *«solicitar acceso a
los recursos protegidos de los vendedores»*, sin las credenciales del vendedor. Es una herramienta
para plataformas que operan **en nombre de varios vendedores**.

**[NV]** El original afirmaba además que el endpoint de búsqueda de pagos
(`GET https://api.mercadopago.com/v1/payments/search`) devuelve *«los pagos donde tu cuenta cobra,
no tu extracto»*. **Esa afirmación semántica no se pudo re-verificar**: toda la referencia de API
(`/developers/*/reference/payments/_payments_search/get`, en AR/BR/MX, es y en) devuelve 404 a un
fetch automatizado — es JS-rendered. **Citarla como afirmación leída sería mentir.** Lo que sí se
puede afirmar: **no se encontró ningún endpoint público que devuelva el extracto de una cuenta
personal (no vendedora)**.

### 3.2 El open banking argentino existe en un decreto, no en una API

**[V]** [Decreto 353/2025](https://www.boletinoficial.gob.ar/detalleAviso/primera/325767/20250523),
Boletín Oficial, **23 de mayo de 2025**, vigente desde su publicación (art. 10).

- **Art. 5** crea el **Sistema de Finanzas Abiertas** (SFA): compartir datos de forma **voluntaria y
  con consentimiento expreso** con entidades registradas ante el BCRA.
- *«El BANCO CENTRAL DE LA REPÚBLICA ARGENTINA… será la autoridad de aplicación.»*
- **Art. 6 delega en el BCRA** la definición de *«los parámetros, estándares y requisitos»*.

> **O sea: el decreto NO fija estándar técnico ni plazo.** Delega.

**[P]** Sobre el estado a 2026, la única fuente que se pudo leer es un rastreador de terceros
—**no el BCRA**— https://www.fiskil.com/es/open-finance-tracker/argentina: *«A 2026, el BCRA
todavía no publicó los estándares técnicos»*, *«los estándares operativos y el cronograma del SFA
siguen pendientes»*, y el BCRA estaría *«conformando grupos técnicos para definir la
infraestructura»*. **Marcarlo como fuente secundaria.**

*(Detalle menor pero que evita una cita mal copiada: hay publicaciones —EY entre ellas— que citan el
decreto como **253**/2025. El número del Boletín Oficial es **353/2025**.)* **[V]**

### 3.3 La conclusión: el archivo es la vía, y es gratis

**[C]** resumen de la noche §7: de las **once fuentes digitales** relevadas, el denominador común es
**un PDF por período**; **sólo 2 de 11 dan CSV limpio** a una cuenta personal.

De ahí salen las dos decisiones de arquitectura del rediseño:

1. **El PDF es la vía viable y gratuita.** No cuesta USD 1.000 al mes, no depende de un contrato
   B2B, no espera un estándar del BCRA, y el banco está **legalmente obligado** a imprimirlo
   completo (Ley 25.065 art. 23 — ver `2026-09-03-pdf-import-potential.md` §1). El detalle de qué
   trae está en ese documento.
2. **El importador de tabla delimitada tiene que ser GENÉRICO, con mapeo de columnas** — no un
   parser por proveedor. **[C]** spec §5. Con 2 de 11 fuentes dando CSV y ninguna dando API, escribir
   un parser por banco es trabajo que envejece mal. Y **no se escribe un parser por banco antes de
   tener usuarios de ese banco** **[C]** resumen §7.

**[R]** El original listaba las once fuentes una por una con su formato de exportación. **Ese listado
no se recuperó**: sobrevive el agregado (11 fuentes, 2 con CSV limpio).

---

## 4. Monarch (Estados Unidos) — el mejor onboarding

**[V]** https://www.monarch.com/ *(ojo: `monarchmoney.com` redirige 301 acá — usar el dominio
nuevo)*

> *«Connect your accounts and Monarch will do the heavy lifting to categorize your finances. From
> there, you can track, budget, collaborate, and set goals.»*
> *«Connect all your bank accounts, credit cards, loans, real estate, and investments…»* · «13.000+
> instituciones financieras».

**Conectar una fuente de datos se presenta como el primer paso fundacional**, y todo lo demás
(«from there…») viene después.

**[NV]** El original decía que el onboarding **bloquea la navegación** hasta conectar una fuente.
**Eso no se pudo verificar**: lo leído es **copy de marketing**, no una especificación documentada
del flujo, y probar el onboarding requiere una cuenta. La afirmación fuerte («bloquea») queda como
**no verificada**; la débil («lo presenta como el primer paso y todo lo demás va después») está
**[V]**.

### 4.1 Los cuatro patrones de onboarding que el original recomendó

**[C]** para los dos primeros —están citados textual en la spec del rediseño §6—, **[R]** para los
dos últimos.

1. **Un solo camino visible por paso.** Un botón primario, y la salida («lo hago después») como
   secundaria. Nada más en la pantalla. **[C]** spec §6: *«Patrón Monarch: un botón, todo lo demás
   fuera del paso»*.
2. **El estado vacío ES el onboarding.** Con 0 movimientos y 0 tarjetas, el Panel se **reemplaza**
   por la pantalla de arranque, en vez de mostrar seis gráficos en cero. **[C]** spec §6.
   Y esto sí tiene fuente externa verificada: **[V]** NN/g,
   [«Designing Empty States in Complex Applications: 3 Guidelines»](https://www.nngroup.com/articles/empty-state-interface-design/)
   (Kate Kaplan, 19-09-2021). Las tres guías son: comunicar el estado del sistema, **dar señales de
   aprendizaje** (el vacío enseña en contexto) y **habilitar la acción directa** (*«direct pathways
   (i.e., links) to getting started with key tasks»*). Y la frase que resume el costo de no
   hacerlo: dejar los espacios vacíos *«ultimately creates confusion and decreases user confidence —
   and misses a goldmine of opportunities»*.
   *(Nota: la cita del «teachable moment» que circula atribuida a NN/g **no** está en ese artículo;
   viene de blogs secundarios. No citarla.)*
3. **No pedir lo que se puede inferir.** Nada de crear categorías, cuentas ni tarjetas en el
   onboarding: se infieren del historial o del archivo importado, o se piden **cuando hacen falta**.
   **[C]** spec §6 lo dice explícitamente; el mecanismo es `finance:getEntryDefaults` (spec §4).
4. **El usuario que YA tiene datos también necesita descubrir el camino nuevo**, y no va a ver
   ninguna pantalla de bienvenida. Por eso el camino principal tiene que estar **a la vista, en la
   cabecera**, no escondido en un modal. **[C]** spec §6: *«"Importar resumen" es un botón primario
   en la cabecera del Tomo»*.

---

## 5. Qué NO copiar

### 5.1 El semáforo rojo/verde del presupuesto

**La recomendación del original, que el rediseño adoptó:** el feedback binario «te pasaste /
no te pasaste», pintado de rojo y verde, produce **culpa** y la culpa produce **abandono**. La regla
que salió de acá y que la spec cita dos veces es:

> **«Datos con acción, no datos con culpa.»** **[C]** spec §2.3 — *«el ámbar no reta, dice qué
> mirar»* — y spec §10.5 — *«Bloquear convertiría un checksum informativo en una pared; la
> investigación es explícita sobre el ciclo de culpa.»*

> ### **[NV] — y hay que decirlo sin vueltas**
>
> **No se encontró ninguna fuente pública citable que respalde específicamente esta afirmación** en
> apps de finanzas. Lo que se revisó y se **descartó** al reconstruir:
>
> - **Kaye et al., «Money Talks: Tracking Personal Finances», CHI '14**
>   (https://dl.acm.org/doi/10.1145/2556288.2556975) — se extrajo el texto completo del PDF del
>   autor y se buscó: **cero apariciones de «shame», «guilt», «disengage» o «abandon»**, y ninguna
>   discusión de feedback rojo/verde. **No respalda la afirmación.**
> - Todo resultado que afirma «rojo = ciclo de culpa = abandono» —incluidas las cifras «67 % deja
>   la app en 30 días» y «43 % más de retención a día 30»— proviene de **blogs de marketing de apps
>   de presupuesto**. **No citables.**
> - **NN/g no tiene ningún artículo sobre esto.**
>
> Literatura *adyacente* que existe pero que **tampoco se pudo leer** (ScienceDirect devuelve 403),
> y que por lo tanto **no se cita como leída**: Gladstone, Jackson, Ly, Wilcox & Mazar, *«Financial
> shame spirals: How shame intensifies financial hardship»* (OBHDP), y Olafsson & Pagel, *«The
> Ostrich in Us: Selective Attention to Financial Accounts»* (NBER WP 23945).
>
> **Precedente interno, que sí existe y es el más honesto para apoyarse:**
> `docs/superpowers/plans/2026-06-26-nutrify-deep-improvements.md` ya había adoptado la misma regla
> para Nutrify, citando «evidencia académica 2024-2025»: *«La culpa/vergüenza es el driver #1 de
> abandono en apps de nutrición. Castigar con HP por comer replica el daño de los avisos rojos de
> MyFitnessPal y el sistema de colores de Noom.»* **[V]** (leído en el repo).
>
> **Cómo hay que tratar esto de acá en adelante:** es una **decisión de producto de Hubtify,
> coherente con el resto de la app y con su precedente interno**, y NO una conclusión respaldada por
> una fuente externa verificada. Si alguien la desafía, la respuesta honesta es «es nuestra postura,
> y la aplicamos parejo en los cuatro módulos», no «lo dice un paper».

**Lo que Coinify hace bien acá, y que la auditoría marcó para conservar:** el presupuesto se muestra
como **anillo que se llena**, no como semáforo. Un anillo informa sin juzgar.
`2026-09-03-coinify-audit.md` §9.

### 5.2 Tres cosas más que no se copian

**[R]** — el original las listaba; se conservan porque son coherentes con las decisiones tomadas y
con el resto de la documentación del repo.

1. **Conectar el banco como requisito.** Es el modelo de Monarch y es correcto **allá**. Acá no hay
   con qué conectarse (§3), así que copiar el requisito sin el mecanismo produce un muro sin puerta.
   Se copia la **forma** del onboarding (un solo camino), no su **contenido**.
2. **Categorizar automáticamente sin dejar corregir.** El mapeo de comercio → categoría tiene que
   ser **editable y recordado**, no mágico. Ya es lo que hace Coinify
   (`finance_category_mappings`).
3. **La proyección de gastos futuros como predicción propia.** Si el banco ya firmó una proyección
   («Cuotas a vencer»), inventar otra es agregar ruido. Se guarda la del banco como foto y se
   **contrasta**. `2026-09-03-pdf-import-potential.md` §2.

---

## 6. Lo que este relevamiento decidió, en cuatro líneas

1. **El modelo de cuotas de Mobills** (compra → plan → factura como contenedor) es el correcto, y
   Coinify tenía que adoptarlo. → spec §2.4, §3.
2. **La forma de onboarding de Monarch** (un camino por paso) es la correcta; su **contenido**
   (conectar el banco) es imposible acá. → spec §6.
3. **No hay API bancaria en Argentina a ningún precio razonable.** El **PDF** y el **CSV genérico**
   son la vía. → spec §5, §2.
4. **Informar, nunca retar.** La conciliación **avisa y no bloquea**. → spec §2.3, §10.5 — con la
   salvedad de la §5.1 sobre el estatus real de esa evidencia.

---

## 7. Lo que no se pudo recuperar del original

- **El listado de las once fuentes digitales** una por una con su formato de exportación (§3.3).
  Sobrevive sólo el agregado.
- **Las capturas de los flujos de onboarding** de Monarch y Mobills que acompañaban las §2 y §4.
- **La fuente concreta de la afirmación sobre el ciclo de culpa** (§5.1). La re-verificación
  encontró que probablemente **nunca hubo una citable**, y quedó documentado.
- **El relevamiento de precios** de Pluggy y Fintoc (el original comparaba los cuatro agregadores;
  hoy sólo Belvo publica precio).
- **Si el original evaluó apps argentinas además de Qota** (Fintual, Ualá, Wallbit y demás no
  aparecen citadas en ninguna fuente sobreviviente).
