export interface ChangelogChange {
  category: 'feat' | 'fix' | 'refactor' | 'chore';
  scope?: string;
  text: { es: string; en: string };
}

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  changes: ChangelogChange[];
}

export const changelog: ChangelogEntry[] = [
  // newest first
  {
    version: '0.9.5',
    date: '2026-09-03',
    changes: [
      {
        category: 'feat',
        scope: 'mobile',
        text: {
          es: 'Los avisos ahora te llegan con Hubtify cerrada: el final del Pomodoro y los recordatorios de tus hábitos suenan igual aunque no tengas la app abierta. La primera vez Android puede pedirte permiso para los avisos puntuales — se lo das una vez y listo',
          en: 'Notifications now reach you with Hubtify closed: the end of a Pomodoro and your habit reminders ring even when the app is not open. The first time, Android may ask you to allow exact alarms — grant it once and you are done',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'Coinify se rehizo alrededor de importar el resumen en vez de tipear: de seis pestañas quedaron tres, y cargar un mes pasó de unas 200 interacciones a unas 16. Del resumen salen solas las cuotas con las que te faltan, lo que pagaste en el mes, el cierre y el vencimiento de la tarjeta — y ahora también podés importarlo desde el teléfono',
          en: 'Coinify was rebuilt around importing your statement instead of typing it in: six tabs became three, and logging a month went from roughly 200 interactions to about 16. The statement now fills in your installments with how many are left, what you paid during the month, and the card closing and due dates — and you can import it from your phone too',
        },
      },
      {
        category: 'feat',
        scope: 'hub',
        text: {
          es: 'Los espacios vacíos dejaron de ser carteles que te mandan a otro lado: crean ahí mismo la primera misión, el primer ritual o la primera comida, sin navegar. Y si volvés después de dos días o más, un parte de regreso te cuenta qué pasó mientras no estabas y por dónde seguir, sin reproches',
          en: 'Empty spaces stopped being signs that send you elsewhere: they now create your first quest, first ritual or first meal right there, no navigating. And if you come back after two days or more, a return briefing tells you what happened while you were away and where to pick up, no guilt trip',
        },
      },
      {
        category: 'feat',
        scope: 'hub',
        text: {
          es: 'Ya hay en qué gastar los óbolos: un puñado de recompensas para canjear, y el saldo a la vista justo donde los ganás. Antes se te acumulaban sin destino',
          en: 'Your obols finally have somewhere to go: a handful of rewards to redeem, with your balance in sight right where you earn them. Before, they just piled up with nowhere to spend them',
        },
      },
      {
        category: 'feat',
        scope: 'hub',
        text: {
          es: 'Un solo ritual para cerrar el día. Antes había dos que no se conocían entre sí y te hacían despedirte del día dos veces',
          en: 'A single ritual to close out your day. Before there were two that did not know about each other, so you ended up saying goodnight twice',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'Repetir una comida es un toque: tenés favoritos y «repetir lo de ayer» a mano en el hub, sin pasar por la IA ni volver a escribir todo',
          en: 'Repeating a meal takes one tap: favorites and a "same as yesterday" shortcut right on the hub, without going through the AI or typing it all again',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'Texto que no se leía: el día del estante del Caldero era prácticamente invisible y había avisos en Nutrify que se perdían contra el fondo. Ahora se lee todo',
          en: 'Text you could not read: the day label on the Cauldron shelf was practically invisible and some notices in Nutrify blended into the background. Now it all reads clearly',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'Si le pedís al sistema reducir las animaciones, el caldero ahora también se queda quieto. Antes seguía burbujeando como si nada',
          en: 'If you ask your system to reduce motion, the cauldron now stays still too. Before it kept bubbling away as if nothing had happened',
        },
      },
      {
        category: 'fix',
        scope: 'mobile',
        text: {
          es: 'En el teléfono los botones y controles chicos crecieron al tamaño que el pulgar necesita, así dejás de errarle. Y el ícono de Android quedó con un solo círculo — tenía dos, uno encima del otro',
          en: 'On the phone, small buttons and controls grew to the size your thumb actually needs, so you stop missing them. And the Android icon now has a single circle — it used to have two, stacked on top of each other',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'En Windows, el ícono que aparece en «Agregar o quitar programas» ya no es el genérico, y si te quedó uno viejo de una actualización anterior se repone solo al abrir la app',
          en: 'On Windows, the icon shown under "Add or remove programs" is no longer the generic one, and if an old one was left behind by a previous update it now restores itself when you open the app',
        },
      },
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: 'La pestaña «Hoy» ahora también te muestra las misiones sin fecha, que antes quedaban invisibles ahí, y al crear una te sugiere hoy',
          en: 'The "Today" tab now also shows quests with no date, which used to stay invisible there, and creating one suggests today by default',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'Tres cosas del dinero que no cerraban: los consumos en dólares se sumaban como si fueran pesos, las compras en cuotas no guardaban con qué tarjeta las hiciste, y el campo de monto no aclaraba si esperaba la cuota o el total. Las tres, resueltas',
          en: 'Three money things that did not add up: purchases in dollars were counted as if they were pesos, installment purchases did not remember which card you used, and the amount field never said whether it wanted the installment or the total. All three sorted',
        },
      },
    ],
  },
  {
    version: '0.9.4',
    date: '2026-09-02',
    changes: [
      {
        category: 'feat',
        scope: 'ui',
        text: {
          es: 'Si Hubtify quedó instalado dos veces en tu Windows —pasa si alguna vez abriste el instalador como administrador—, ahora te avisa apenas abrís la app y te explica cómo dejar una sola copia. Antes las dos convivían calladitas y el desinstalador terminaba apuntando a la equivocada',
          en: 'If Hubtify ended up installed twice on your Windows — that happens if you ever opened the installer as administrator — it now warns you as soon as you open the app and explains how to keep a single copy. Before, the two lived side by side in silence and the uninstaller ended up pointing at the wrong one',
        },
      },
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: 'Un hábito de varias veces por semana (gimnasio 3 veces, por ejemplo) que ya habías marcado hoy seguía apareciendo sin marcar en Inicio y en la pestaña Hoy de Questify. Ahora se ve hecho donde corresponde, y tu progreso de la semana se sigue mostrando igual',
          en: 'A habit you do several times a week (gym three times, say) that you had already checked today kept showing up unchecked on Home and on the Today tab in Questify. Now it shows as done where it should, and your weekly progress still reads the same',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'El ícono que Windows mostraba en «Agregar o quitar programas» era el genérico de Electron y no el libro de Hubtify. Ahora es el nuestro',
          en: 'The icon Windows showed under "Add or remove programs" was the generic Electron one instead of the Hubtify book. Now it is ours',
        },
      },
    ],
  },
  {
    version: '0.9.3',
    date: '2026-09-02',
    changes: [
      {
        category: 'feat',
        scope: 'mobile',
        text: {
          es: 'Actualizar en Android ya no te saca de Hubtify: tocás «Actualizar» y la descarga corre ahí mismo, con la barra de progreso a la vista, hasta que el teléfono te pide confirmar la instalación con un toque. La primera vez te va a pedir permitir instalaciones desde Hubtify, una sola vez y listo',
          en: 'Updating on Android no longer kicks you out of Hubtify: tap "Update" and the download runs right there, progress bar and all, until your phone asks you to confirm the install with one tap. The first time it will ask you to allow installs from Hubtify — just once, and you are done',
        },
      },
    ],
  },
  {
    version: '0.9.2',
    date: '2026-09-02',
    changes: [
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'La estimación con IA aprendió a comer como argentino: ahora conoce las porciones reales de una milanesa, un asado, un pastel de papa, una hamburguesa de local, un tostado o una medialuna con jamón y queso. En las comidas que cargás de verdad el error medio bajó de unas 200 kcal a unas 60, y ya no te inventa ingredientes que no nombraste',
          en: 'AI estimation learned to eat like an Argentine: it now knows the real portions of a milanesa, an asado, a pastel de papa, a burger-joint burger, a tostado or a ham-and-cheese medialuna. On the meals you actually log, the average error dropped from around 200 kcal to around 60, and it no longer makes up ingredients you never mentioned',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'La IA aprende de vos: cuando corregís una estimación, la próxima vez que cargues algo parecido usa TU porción como referencia en vez de la del manual. Tus correcciones viajan con tu cuenta, así que lo que le enseñás en la compu también lo sabe en el teléfono',
          en: 'The AI learns from you: when you correct an estimate, the next time you log something similar it uses YOUR portion as the reference instead of the textbook one. Your corrections travel with your account, so what you teach it on the computer it also knows on the phone',
        },
      },
      {
        category: 'feat',
        scope: 'mobile',
        text: {
          es: 'El ícono de Android por fin es el libro de Hubtify, con el splash a juego sobre cuero. Ahora se lo reconoce de un vistazo en el cajón de apps',
          en: 'The Android icon is finally the Hubtify book, with a matching splash on leather. You can now spot it at a glance in the app drawer',
        },
      },
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'Si tenías comidas duplicadas en el historial —y los totales del día al doble de lo real— se arregla solo al abrir la app. Era un cruce entre una versión vieja de escritorio y el teléfono, y ya no puede volver a pasar',
          en: 'If you had duplicate meals in your history — and daily totals at twice the real amount — it fixes itself when you open the app. It was a mix-up between an old desktop version and the phone, and it cannot happen again',
        },
      },
      {
        category: 'fix',
        scope: 'mobile',
        text: {
          es: 'Al abrir la app en Android ya no hay un flash blanco entre el splash y la pantalla. La espera ahora es sobre el mismo cuero del splash, de punta a punta',
          en: 'Opening the app on Android no longer shows a white flash between the splash and the screen. The wait now stays on the same leather as the splash, end to end',
        },
      },
      {
        category: 'fix',
        scope: 'character',
        text: {
          es: 'La Bitácora de XP y el resumen del Códice mostraban el doble de eventos en algunos días —el mismo cruce con la versión vieja de escritorio. Tu XP y tu nivel siempre estuvieron bien: lo que se duplicaba era el registro, y se limpia solo al abrir la app',
          en: 'The XP Log and the Codex summary showed twice the events on some days — the same mix-up with the old desktop version. Your XP and level were always right: it was the record that got duplicated, and it cleans itself up when you open the app',
        },
      },
    ],
  },
  {
    version: '0.9.1',
    date: '2026-09-02',
    changes: [
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'La estimación con IA se colgaba con ciertos platos —«una manzana», por ejemplo— hasta rendirse con «IA no disponible». Lo arreglamos del lado del servidor, así que también funciona en la versión anterior sin actualizar, y la app ya no dispara tres consultas por un solo toque',
          en: 'AI estimation hung on certain dishes — "an apple", for instance — until giving up with "AI unavailable". We fixed it on the server side, so it works on the previous version without updating too, and the app no longer fires three requests for a single tap',
        },
      },
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'Editar una comida ahora tiene botones de Guardar y Cancelar como corresponde (antes había una sola estrella que en realidad disparaba la IA). Al cerrar el día la pantalla queda en modo lectura al instante, la barra «Cerrar el Día» ya no tapa lo que estás editando con el teclado abierto, y el aviso de peso semanal no salta el mismo día que hiciste el setup',
          en: 'Editing a meal now has proper Save and Cancel buttons (before there was a lone star that actually triggered the AI). Closing the day switches the screen to read-only right away, the "Close the Day" bar no longer covers what you are editing with the keyboard open, and the weekly weight prompt does not pop up the same day you did the setup',
        },
      },
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'Cerrar el día con el campo de Pasos vacío fallaba siempre — y justo era el primer intento de cualquiera que recién empezaba. Ahora podés cerrar la jornada sin cargar pasos; si no los contaste, no pasa nada',
          en: 'Closing the day with the Steps field empty always failed — and it was precisely the first attempt of anyone just getting started. You can now close the day without logging steps; if you did not count them, no harm done',
        },
      },
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'La barra «Cerrar el Día» dejó de ser un rectángulo blanco plano pegado sobre el pergamino. Ahora es solo el botón flotando con su sombra y un velo sutil por detrás, como corresponde',
          en: 'The "Close the Day" bar is no longer a flat white rectangle slapped onto the parchment. Now it is just the button floating with its shadow and a subtle veil behind it, the way it should be',
        },
      },
      {
        category: 'fix',
        scope: 'mobile',
        text: {
          es: 'El botón Atrás del teléfono cierra menús y desplegables antes de navegar, cada sección arranca arriba, el menú de cuenta entra en el cajón y el hub se lee en una sola columna. Los widgets ya no muestran controles de arrastre de escritorio, y el Caldero se queda sin el chip flotante encima ni las opciones de ventana que solo tienen sentido en la compu',
          en: 'The phone\'s Back button closes menus and dropdowns before navigating, every section opens at the top, the account menu fits inside the drawer and the hub reads in a single column. Widgets no longer show desktop drag controls, and the Cauldron loses the floating chip sitting on top of it and the window options that only make sense on the computer',
        },
      },
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: 'Las notas dibujadas ya se pueden trazar con el dedo: antes el scroll te cortaba el trazo a los pocos milímetros. Una nota vacía ya no queda guardada, y los formularios de misión y hábito tienen el nombre a lo ancho en vez de apretado entre los demás campos',
          en: 'Drawn notes can finally be traced with your finger: the scroll used to cut the stroke short after a few millimeters. An empty note is no longer saved, and the quest and habit forms give the name its full width instead of squeezing it between the other fields',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'El gráfico de reparto con una sola categoría mostraba un anillo vacío aunque la leyenda tuviera el monto. Ahora dibuja el anillo completo, el botón de eliminar grupo de cuotas se ve, y el toggle de préstamo y el eje de la proyección quedaron acomodados en la pantalla del teléfono',
          en: 'The breakdown chart with a single category showed an empty ring even though the legend had the amount. It now draws the full ring, the delete button for an installment group is visible, and the loan toggle and the projection axis fit properly on the phone screen',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'El botón de pausar/reanudar de Recurrentes tenía el ícono corrido y del mismo color que el fondo — había que adivinar dónde estaba. Ahora está centrado, con contraste, y muestra ‖ o ▶ según el estado del recurrente',
          en: 'The pause/resume button in Recurring had its icon off-center and in the same color as the background — you had to guess where it was. It is now centered, with proper contrast, and shows ‖ or ▶ depending on the recurring item\'s state',
        },
      },
      {
        category: 'fix',
        scope: 'auth',
        text: {
          es: 'Recuperar la contraseña ahora acepta tu nombre de usuario, igual que el inicio de sesión. No hace falta acordarse del mail exacto',
          en: 'Password recovery now accepts your username, just like login does. No need to remember the exact email',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: '«1 comida» y «1 día» en singular, fechas y meses en el idioma de la app, las recetas del Caldero con su nombre traducido, y los selectores de fecha aplican el valor visible al tocar OK en vez de cerrarse sin guardar nada',
          en: '"1 meal" and "1 day" in the singular, dates and months in the app\'s language, Cauldron recipes with their translated name, and the date pickers apply the visible value when you tap OK instead of closing without saving anything',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'En la compu las páginas por fin usan todo el ancho de la ventana. El Libro de Misiones, el libro de Coinify y el Caldero ya no dejan un tercio de pantalla vacío a la derecha cuando colapsás la barra lateral',
          en: 'On the computer the pages finally use the full width of the window. The Quest Book, the Coinify ledger and the Cauldron no longer leave a third of the screen empty on the right when you collapse the sidebar',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'Se acabó entrecerrar los ojos: el texto de tablas y filas en toda la app —libro mayor, misiones, comidas, crónica, bitácora— creció al tamaño de lectura del sistema y la tinta secundaria dejó de ser semitransparente. La tinta «apagada» ahora se lee con contraste accesible sobre todas las superficies de pergamino',
          en: 'No more squinting: the text in tables and rows across the whole app — ledger, quests, meals, chronicle, log — grew to the system\'s reading size and the secondary ink is no longer semi-transparent. The "faded" ink now reads with accessible contrast on every parchment surface',
        },
      },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-09-02',
    changes: [
      {
        category: 'feat',
        scope: 'mobile',
        text: {
          es: 'Hubtify llega a Android. Es la misma app —Questify, Coinify, Nutrify, el Caldero, tu Personaje, los Logros y las Recompensas— con la misma cuenta, así que lo que cargás en el teléfono aparece en la compu y al revés. Se instala con el APK que viene en cada versión, el menú vive en un cajón lateral, el botón atrás del teléfono hace lo que esperás y cada pantalla se rearmó para entrar en la mano',
          en: 'Hubtify comes to Android. It is the same app — Questify, Coinify, Nutrify, the Cauldron, your Character, Achievements and Rewards — with the same account, so what you log on the phone shows up on the computer and back. It installs from the APK shipped with every release, the menu lives in a side drawer, the phone\'s back button does what you expect, and every screen was rebuilt to fit in your hand',
        },
      },
      {
        category: 'feat',
        scope: 'mobile',
        text: {
          es: 'En el teléfono la app te avisa por las notificaciones del sistema: cuando una racha está por vencerse y cuando el Pomodoro termina con la app abierta. Por ahora el Caldero necesita la app en pantalla — todavía no corre en segundo plano',
          en: 'On the phone the app reaches you through system notifications: when a streak is about to expire, and when the Pomodoro ends with the app open. For now the Cauldron needs the app on screen — it does not run in the background yet',
        },
      },
      {
        category: 'feat',
        scope: 'mobile',
        text: {
          es: 'Desde Ajustes podés exportar la base de datos completa como un archivo que compartís a donde quieras, y volver a importarla en otro teléfono o después de reinstalar. El CSV de Coinify también se exporta. Lo que todavía no está en Android es importar resúmenes PDF de Coinify: la app te lo dice en lugar de fallar en silencio',
          en: 'From Settings you can export the whole database as a file you share wherever you want, and import it back on another phone or after a reinstall. Coinify\'s CSV export works too. What is not on Android yet is importing Coinify PDF statements: the app tells you so instead of failing quietly',
        },
      },
      {
        category: 'feat',
        scope: 'mobile',
        text: {
          es: 'Cuando sale una versión nueva, el teléfono te avisa solo y te lleva a descargar el APK. Nada de andar revisando a mano si hay algo nuevo',
          en: 'When a new version comes out, the phone lets you know on its own and takes you to download the APK. No more checking by hand whether there is something new',
        },
      },
      {
        category: 'fix',
        scope: 'hub',
        text: {
          es: 'El Cierre del Códice decía «XP DEL DÍA +NaN» en vez del número que te ganaste. Ahora muestra el XP real de la jornada, en la compu y en el teléfono. Y en el teléfono las cartelas de stats de la Tabla del Aventurero se acomodan en 2×2 para que se lean sin achicar los ojos',
          en: 'The Codex Closing read "XP OF THE DAY +NaN" instead of the number you earned. It now shows the day\'s real XP, on the computer and on the phone. And on the phone the stat cards of the Adventurer\'s Table settle into a 2×2 grid so you can read them without squinting',
        },
      },
      {
        category: 'refactor',
        scope: 'cauldron',
        text: {
          es: 'Una sesión del Caldero se acredita con la hora exacta en que tenía que terminar, no con el momento en que volviste a mirar la app. Si el temporizador cerró a las 15:25, el registro dice 15:25',
          en: 'A Cauldron session is credited at the exact time it was due to end, not at the moment you looked back at the app. If the timer closed at 15:25, the record says 15:25',
        },
      },
    ],
  },
  {
    version: '0.8.2',
    date: '2026-09-01',
    changes: [
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'Un ingreso en dólares ya se puede cargar en dólares. Elegís la casa de cambio —oficial, blue, MEP, cripto— y Coinify lo pasa a pesos con la cotización que trae la API, sin que tengas que abrir la calculadora',
          en: 'Income in dollars can finally be entered in dollars. You pick the exchange house — official, blue, MEP, crypto — and Coinify converts it to pesos with the rate from the API, no calculator needed',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'Una compra en cuotas se piensa por el total, no por la cuota. Ahora ponés los 900 mil de la heladera y las 12 cuotas, y Coinify saca cuánto te queda por mes — repartiendo los centavos para que la suma dé exacto',
          en: 'You think about a financed purchase by its total, not by the monthly payment. Enter the 900k for the fridge and the 12 installments, and Coinify works out the monthly amount — spreading the cents so the sum comes out exact',
        },
      },
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: 'Completar una misión fallaba antes de poder avisar de nada: la lista no se refrescaba, la racha no se movía y el XP no aparecía hasta recargar. Era un error nuestro de la versión anterior y ya está corregido',
          en: 'Completing a quest crashed before it could announce anything: the list did not refresh, the streak did not move, and the XP did not show until you reloaded. That was ours from the previous version, and it is fixed',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'El gráfico de proyección crecía con la ventana: maximizada se dibujaba de mil píxeles de alto con las cifras pisándose. Ahora mide su tarjeta y se queda del alto que le corresponde, con los números legibles',
          en: 'The projection chart grew with the window: maximized, it drew a thousand pixels tall with the figures overlapping. It now measures its card and stays the height it should be, with readable numbers',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'Al asignarle una categoría a una cuota el desplegable salía vacío, y borrar una categoría en uso tiraba un error en inglés. Ahora el desplegable muestra todas las categorías hasta que empezás a escribir, y si la categoría está en uso te dice cuántos movimientos la tienen',
          en: 'Assigning a category to an installment showed an empty dropdown, and deleting a category in use threw a raw English error. The dropdown now shows every category until you start typing, and if the category is in use it tells you how many movements have it',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'Las flechitas de los campos numéricos eran una placa de cuero pegada encima del número y se veían mal en toda la app. Ahora son parte del campo, discretas, y no se meten en el camino cuando tabulás',
          en: 'The little arrows on numeric fields were a leather slab glued on top of the number and looked wrong across the whole app. They are now part of the field, discreet, and stay out of the way when you tab',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'Las pantallas de Cuotas y Recurrentes estaban diseñadas para una tarjeta angosta y a pantalla completa quedaban con el nombre contra un borde y el monto contra el otro. Se rearmaron para que se lean como una planilla, con los botones a la vista',
          en: 'The Installments and Recurring screens were laid out for a narrow card, so at full width the name sat against one edge and the amount against the other. They were rebuilt to read like a ledger, with the buttons in plain sight',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'El título que desbloqueás al subir de nivel se cortaba en la ficha del jugador —«Nv.6 · Es…»—, justo la parte que es el premio. El nivel ahora vive en el medallón y el título se lee entero',
          en: 'The title you unlock on levelling up was cut off on the player card — "Lv.6 · Sq…" — precisely the part that is the reward. The level now lives on the medallion and the title reads in full',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'Repasamos la app entera pantalla por pantalla: textos que no se llegaban a leer sobre el pergamino, botones de borrar invisibles, carteles que quedaban debajo del pliegue, ventanitas de ayuda que se abrían fuera de la pantalla y rótulos que se pisaban entre sí. Un montón de arreglos chicos que se notan todos juntos',
          en: 'We went over the whole app screen by screen: text you could not quite read on the parchment, invisible delete buttons, notices sitting below the fold, help popups opening off-screen, and labels colliding with each other. A pile of small fixes you feel all at once',
        },
      },
    ],
  },
  {
    version: '0.8.1',
    date: '2026-09-01',
    changes: [
      {
        category: 'fix',
        scope: 'rpg',
        text: {
          es: 'En el estante de los logros no se distinguía cuál habías ganado y cuál no: todo era casi el mismo pergamino traslúcido. Ahora un logro obtenido es una medalla acuñada en oro que sobresale del estante, y uno pendiente es un engarce vacío hundido en la madera, con su candado. Se ve de un vistazo',
          en: 'On the achievements shelf you could not tell what you had earned from what you had not — it was all nearly the same translucent parchment. An earned achievement is now a medal struck in gold sitting proud of the shelf, and a pending one is an empty setting sunk into the wood, with its padlock. You see it at a glance',
        },
      },
      {
        category: 'feat',
        scope: 'rpg',
        text: {
          es: 'El estante gana filtro —Todos, Obtenidos, Pendientes— con la cuenta de cada uno, y una barra arriba que te dice cuánto llevás. Los grupos que quedan vacíos con el filtro puesto desaparecen en vez de dejar títulos colgando',
          en: 'The shelf gains a filter — All, Earned, Pending — with a count for each, plus a bar up top telling you how far along you are. Groups left empty by the filter disappear instead of leaving headings hanging over nothing',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'Tocar el cofre del tesoro te corría toda la columna de abajo de golpe. Ahora la lista de cuentas flota por encima y no mueve nada, y se cierra clickeando afuera o con Escape',
          en: 'Tapping the treasure chest shoved the whole column below it down. The account list now floats above the content without moving anything, and closes on an outside click or Escape',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'El cofre mostraba una cuenta «Efectivo» que nunca creaste, en cero y sin historia detrás — un saldo que no se podía rastrear y que hacía imposible entender para qué servía el cofre. Una cuenta sin usar y en cero ya no se muestra; una que usaste y volvió a cero sí, porque ese cero sí te dice algo',
          en: 'The chest was showing an "Efectivo" account you never created, at zero with no history behind it — a balance you could not trace, and the reason the whole chest made no sense. An unused account at zero is now hidden; one you used that came back to zero still shows, because that zero actually tells you something',
        },
      },
      {
        category: 'fix',
        scope: 'rpg',
        text: {
          es: 'En la crónica del panel aparecían renglones en mayúsculas tipo ACHIEVEMENT_UNLOCKED en medio de una lista en castellano. Faltaban siete nombres: logros, días sellados, meses dentro del presupuesto, hábitos salteados, movimientos borrados, calderos abandonados y quests creadas',
          en: 'The dashboard chronicle printed raw lines like ACHIEVEMENT_UNLOCKED in the middle of a Spanish list. Seven names were missing: achievements, sealed days, months within budget, skipped habits, deleted movements, abandoned brews and created quests',
        },
      },
      {
        category: 'fix',
        scope: 'rpg',
        text: {
          es: 'El logro «Segunda Oportunidad» era imposible de conseguir: esperaba un evento que la app había dejado de emitir, así que reabrir un día cerrado nunca lo desbloqueaba. Ya se puede ganar',
          en: 'The "Second Chance" achievement could never be earned: it was waiting on an event the app had stopped emitting, so reopening a closed day never unlocked it. It can be won now',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: 'Al menú lateral ya no le entraban todas las secciones y aparecía un scroll que cortaba «Recompensas» por la mitad. Ahora se acomoda según el alto de la ventana —no sólo el ancho— y entra completo hasta en la ventana más chica que la app permite',
          en: 'The sidebar had run out of room for all its sections and a scrollbar was slicing "Rewards" in half. It now adapts to the window height — not just its width — and fits in full down to the smallest window the app allows',
        },
      },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-09-01',
    changes: [
      {
        category: 'feat',
        scope: 'rpg',
        text: {
          es: 'El Códice del día: pasadas las 21 se abre la página de hoy con lo que hiciste como marginalia, mantenés apretado dos segundos y cae el lacre. Sellar el día te da óbolos, avanza la racha y a veces destapa un logro — es salteable, se puede sellar al día siguiente y nunca te castiga',
          en: 'The Codex of the day: after 9pm today opens as a page with what you did in the margins, you hold for two seconds and the wax falls. Sealing the day pays obolos, advances the streak and sometimes uncovers an achievement — skippable, sealable the next day, and never punishing',
        },
      },
      {
        category: 'feat',
        scope: 'rpg',
        text: {
          es: 'Cuarenta logros repartidos por los cuatro módulos, con estante propio para mirarlos. Arrancás con varios ya desbloqueados por lo que venías haciendo: nada de «completá 2000 tareas»',
          en: 'Forty achievements across the four modules, with their own shelf to browse. You start with several already unlocked from what you had been doing: none of that «complete 2000 tasks» nonsense',
        },
      },
      {
        category: 'feat',
        scope: 'rpg',
        text: {
          es: 'Los óbolos son la moneda que se gasta: se ganan al sellar el día y por logros, y los cambiás por recompensas que definís vos — «2 h de jueguito, 300 óbolos». Vos ponés el premio, la app lleva la cuenta',
          en: 'Obolos are the coin you spend: earned by sealing the day and by achievements, traded for rewards you define yourself — «2 hours of gaming, 300 obolos». You set the prize, the app keeps count',
        },
      },
      {
        category: 'feat',
        scope: 'rpg',
        text: {
          es: 'Abrió la tienda: seis lacres coleccionables para el Códice, marcos y fondos para tu ficha, y un indulto extra por mes. Todo lo que ya tenías sigue siendo gratis para siempre — la tienda sólo vende cosas nuevas',
          en: 'The shop is open: six collectible seals for the Codex, frames and backgrounds for your character sheet, and one extra pardon a month. Everything you already had stays free forever — the shop only sells new things',
        },
      },
      {
        category: 'feat',
        scope: 'rpg',
        text: {
          es: 'Maestrías por módulo: el nivel global pasa a ser una insignia de leyenda y en su lugar aparecen cuatro barras, una por cada parte de tu vida. El día 180 se siente distinto del día 30',
          en: 'Per-module masteries: the global level becomes a legend badge and four bars take its place, one for each part of your life. Day 180 feels different from day 30',
        },
      },
      {
        category: 'feat',
        scope: 'rpg',
        text: {
          es: 'Se acabó la deuda de vida: el Vigor arranca en 100 todas las mañanas, así que un mal día muere con el día. Sumamos dos indultos por mes que salvan la racha en silencio y el Modo Posada, para congelarla sin culpa cuando te vas unos días',
          en: 'No more health debt: Vigor starts at 100 every morning, so a bad day dies with the day. Plus two pardons a month that quietly save your streak, and Inn Mode to freeze it guilt-free while you are away',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'Cada gasto guarda la cotización del día en que lo cargaste, y el chip del dólar deja de ser un adorno para volverse el control maestro: tocalo y todo el tablero se re-expresa en dólares —cada gasto con SU cotización, no la de hoy— o en pesos de hoy ajustados por el IPC del INDEC',
          en: 'Every expense freezes the exchange rate of the day you logged it, and the dollar chip stops being decoration to become the master control: tap it and the whole board re-expresses in dollars — each expense at ITS rate, not today rate — or in today pesos adjusted by official inflation',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'Cuentas y billeteras: efectivo, banco y billetera virtual, cada una con su saldo. El cofre se abre en filas y el total por fin coincide con lo que ves en Mercado Pago y el homebanking, sin cuentas mentales. Con transferencias entre cuentas que no te ensucian los gastos del mes',
          en: 'Accounts and wallets: cash, bank and digital wallet, each with its own balance. The chest opens into rows and the total finally matches what your bank app shows, no mental math. With transfers between accounts that never pollute the month spending',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'La agenda de la plata: las tarjetas ganan día de vencimiento con aviso tres días antes, los recurrentes soportan frecuencias bimestrales, cuatrimestrales, semestrales y anuales —el aguinaldo entra sin trucos— y «Próximas batallas» pasa a ser una línea de tiempo de 30 días',
          en: 'The money agenda: cards gain a due day with a three-day heads-up, recurring items support bimonthly, four-monthly, semiannual and annual cadences — the yearly bonus fits with no tricks — and «Upcoming battles» becomes a 30-day timeline',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'Ponele un límite mensual a cada categoría y la app te avisa cuando te pasaste — justo al cargar el gasto, que es el momento en el que todavía podés hacer algo',
          en: 'Set a monthly limit per category and the app warns you when you blow past it — right as you log the expense, the moment you can still do something about it',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'Macros completos: proteínas, carbohidratos y grasas con objetivos editables, barras de progreso e historial en el panel. Y cuando te pasaste del objetivo se nota de un vistazo, sin tener que leer números',
          en: 'Full macros: protein, carbs and fat with editable targets, progress bars and history on the dashboard. And when you go over target it shows at a glance, without reading a single number',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'La app aprende tu gasto energético real cruzando lo que comés con lo que pesás, y te muestra la tendencia de peso suavizada en vez del ruido de la balanza de cada mañana',
          en: 'The app learns your real energy expenditure by crossing what you eat with what you weigh, and shows a smoothed weight trend instead of the daily noise of the scale',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'El asado del domingo ya no te rompe nada: un botón registra el evento con una banda honesta —«~1.200-1.600 kcal»—, el día no te castiga y la racha sigue viva. Registrar es presentarse, y presentarse es lo que cuenta',
          en: 'Sunday barbecue no longer breaks anything: one button logs the event with an honest range — «~1,200-1,600 kcal» — the day does not punish you and the streak stays alive. Logging is showing up, and showing up is what counts',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'Registrar es mucho más rápido: repetir el día anterior, multiplicador de porción, corregir a mano lo que estimó la IA, y sugerencias sacadas de lo que ya comiste antes. La estimación además reintenta sola y guarda lo que ya calculó, así que repetir un plato es instantáneo y gratis',
          en: 'Logging is much faster: repeat yesterday, portion multiplier, hand-correct whatever the AI estimated, and suggestions drawn from what you have eaten before. Estimation also retries on its own and caches what it computed, so repeating a meal is instant and free',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'La merienda existe: quinta comida entre las 16 y las 19, cena hasta tarde, y el día nutricional que corta a las 4 de la mañana — el postre de las 00:30 cuenta para la cena de ayer, no arruina el desayuno de mañana',
          en: 'The afternoon snack exists: a fifth meal between 4 and 7pm, late dinner, and a nutritional day that rolls over at 4am — the 00:30 dessert counts toward last night dinner instead of ruining tomorrow breakfast',
        },
      },
      {
        category: 'feat',
        scope: 'quests',
        text: {
          es: '«Pagar el alquiler» se carga una vez y vuelve sola todos los meses, con la fecha corrida desde el vencimiento original y no desde el día que la completaste. Cada instancia queda en el historial',
          en: '«Pay the rent» is created once and comes back on its own every month, with the date shifted from the original due date rather than the day you ticked it. Every instance stays in your history',
        },
      },
      {
        category: 'feat',
        scope: 'quests',
        text: {
          es: 'Ctrl+K entiende castellano: escribí «mañana 9am pagar la luz #hogar !alta» y la tarea sale con fecha, hora, proyecto y prioridad, sin tocar un solo desplegable',
          en: 'Ctrl+K speaks plain language: type «tomorrow 9am pay the power bill #home !high» and the task lands with date, time, project and priority, without touching a single dropdown',
        },
      },
      {
        category: 'feat',
        scope: 'quests',
        text: {
          es: 'Los hábitos ganan mapa de calor propio con el récord de tu mejor racha, la posibilidad de saltear un día a propósito sin que cuente como falla, y escudos que te cubren un tropiezo',
          en: 'Habits gain their own heatmap with your best-streak record, the option to deliberately skip a day without it counting as a miss, and shields that cover a stumble',
        },
      },
      {
        category: 'feat',
        scope: 'cauldron',
        text: {
          es: 'El Caldero se ata a tus misiones: arrancalo sobre una tarea concreta desde la propia lista y al final de la semana mirá el estante para ver en qué se te fue el tiempo. El descanso ahora arranca solo, y si trabajaste sin el caldero podés registrar esa sesión a mano',
          en: 'The Cauldron ties into your quests: start it on a specific task straight from the list, then check the shelf at the end of the week to see where your time went. Breaks now start on their own, and if you worked without the cauldron you can log that session by hand',
        },
      },
      {
        category: 'feat',
        scope: 'ui',
        text: {
          es: 'Completar una misión ahora se siente: una lluvia corta de partículas doradas desde el casillero. Si tenés activadas las animaciones reducidas del sistema, queda un destello suave en su lugar',
          en: 'Completing a quest now feels like something: a short burst of golden particles from the checkbox. If you have reduced motion enabled, a gentle glow takes its place',
        },
      },
      {
        category: 'fix',
        scope: 'sync',
        text: {
          es: '¿Volviste a entrar y faltaban cosas? Cerramos varias vías por las que la sincronización podía perder o pisar datos: días del Códice que se colapsaban a uno solo en la nube, ediciones de comidas que nunca viajaban al otro dispositivo, hábitos que perdían sus escudos al sincronizar, y una sola fila corrupta que podía frenar TODA la bajada de datos para siempre',
          en: 'Came back and things were missing? We closed several paths where sync could lose or clobber your data: Codex days collapsing into a single one in the cloud, meal edits that never travelled to the other device, habits losing their shields on sync, and one corrupt row that could jam the ENTIRE download forever',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'El importador de resúmenes descartaba las cuotas 2 a 12 de una misma compra: el banco imprime la fecha original en todas y parecían duplicadas — una heladera en 12 cuotas perdía $275.000. Además, ahora las cuotas caen en el resumen que elegís y no en el del mes de compra',
          en: 'The statement importer was discarding installments 2 through 12 of the same purchase: the bank prints the original date on all of them and they looked like duplicates — a fridge in 12 installments lost $275,000. Installments now land on the statement you pick, not the month of purchase',
        },
      },
      {
        category: 'fix',
        scope: 'rpg',
        text: {
          es: 'Cerramos varios agujeros por los que se podía inflar la experiencia sin hacer nada: sellar «ayer» todos los días daba racha infinita, la Posada resucitaba rachas ya muertas, y completar y descompletar una tarea —o cargar y borrar un gasto— pagaba de nuevo cada vez',
          en: 'We closed several holes that let you inflate XP without doing anything: sealing «yesterday» every day gave an infinite streak, the Inn resurrected long-dead streaks, and completing then un-completing a task — or logging then deleting an expense — paid out all over again',
        },
      },
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: 'El historial de un hábito pintaba de dorado los días que habías salteado a propósito y los contaba para tu récord de mejor racha. La válvula de escape se había vuelto una forma de fabricar rachas',
          en: 'A habit history painted the days you deliberately skipped in gold and counted them toward your best-streak record. The escape hatch had become a way to manufacture streaks',
        },
      },
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'Reabrir un día cerrado devolvía mal la experiencia: buscaba el registro comparando horarios guardados en dos formatos distintos y nunca lo encontraba. Ahora la reversión es exacta, y podés reabrir tranquilo',
          en: 'Reopening a closed day gave back the wrong XP: it looked for the record by comparing timestamps stored in two different formats and never found it. The reversal is exact now, so reopen away',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'Un gasto cargado después de las nueve de la noche quedaba fechado al día siguiente — y a fin de mes, en el mes siguiente. Ahora usa tu hora local, como corresponde',
          en: 'An expense logged after 9pm was dated to the next day — and at month end, to the next month. It now uses your local time, as it should',
        },
      },
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'Un doble click apurado registraba dos veces la misma comida, y pagaba la experiencia dos veces. Los botones ahora se bloquean mientras el registro está en camino',
          en: 'A hurried double click logged the same meal twice, and paid XP twice. Buttons now lock while the entry is on its way',
        },
      },
      {
        category: 'fix',
        scope: 'ui',
        text: {
          es: '¿Abrías un cuadro de diálogo, empezabas a escribir y no aparecía nada? El foco se lo quedaba el botón de cerrar. Ahora escribís donde esperás escribir, y Escape te devuelve donde estabas',
          en: 'Opened a dialog, started typing, and nothing appeared? The close button was stealing the focus. Now you type where you expect to type, and Escape returns you where you were',
        },
      },
      {
        category: 'fix',
        scope: 'cauldron',
        text: {
          es: '«Retomar» descartaba tu sesión interrumpida antes de intentar arrancarla: si la receta ya no existía perdías los minutos cumplidos y el cartel no se iba más. Ahora no se descarta nada hasta que la sesión arrancó de verdad',
          en: '«Resume» discarded your interrupted session before trying to start it: if the recipe was gone you lost the minutes you had earned and the banner never went away. Nothing is discarded now until the session truly starts',
        },
      },
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: 'Creabas una tarea con Ctrl+K o desde el Caldero y la lista no se enteraba hasta que recargabas la pantalla',
          en: 'You created a task with Ctrl+K or from the Cauldron and the list did not notice until you reloaded the screen',
        },
      },
    ],
  },
  {
    version: '0.7.5',
    date: '2026-06-26',
    changes: [
      {
        category: 'feat',
        scope: 'updater',
        text: {
          es: 'El aviso de nueva versión se renovó: ahora aparece como un cartelito discreto que no te interrumpe, te muestra QUÉ hay de nuevo antes de actualizar, y vos elegís cuándo reiniciar. Y en Ajustes podés decidir si querés que se actualice solo, que solo te avise, o que no moleste',
          en: 'The update prompt got a makeover: it now shows up as a discreet little banner that stays out of your way, tells you WHAT\'s new before you update, and lets you choose when to restart. And in Settings you decide whether it updates on its own, just notifies you, or stays quiet',
        },
      },
      {
        category: 'feat',
        scope: 'auth',
        text: {
          es: '¿Escribiste mal la contraseña y no sabés dónde? Ahora podés mostrarla u ocultarla con un toque al iniciar sesión',
          en: 'Typed your password wrong and can\'t tell where? You can now show or hide it with one tap when logging in',
        },
      },
    ],
  },
  {
    version: '0.7.4',
    date: '2026-06-26',
    changes: [
      {
        category: 'fix',
        scope: 'updater',
        text: {
          es: '¿Cada actualización te borraba el acceso directo o te rompía el ícono fijado en la barra de tareas? Se terminó. Ahora las actualizaciones respetan tus accesos directos, y de paso bajan mucho más livianas y rápidas — solo lo que cambió, no toda la app de nuevo',
          en: 'Every update wiping your shortcut or breaking the icon you pinned to the taskbar? Done with that. Updates now leave your shortcuts alone, and they download much lighter and faster too — only what changed, not the whole app again',
        },
      },
    ],
  },
  {
    version: '0.7.3',
    date: '2026-06-16',
    changes: [
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: '¿Una tarea con título largo te empujaba los hábitos fuera de pantalla? Solucionado. Ahora los títulos largos se recortan prolijos en la lista y el panel de hábitos siempre queda en su lugar — y si querés leer el título completo, desplegá la tarea y aparece entero',
          en: 'A task with a long title shoving your habits off the screen? Fixed. Long titles now trim neatly in the list and the habits panel stays put — and when you want the full title, expand the task and it shows in full',
        },
      },
    ],
  },
  {
    version: '0.7.2',
    date: '2026-06-15',
    changes: [
      {
        category: 'fix',
        scope: 'sync',
        text: {
          es: '¿Creaste tareas en otro dispositivo y no aparecían? Resuelto. Un hábito marcado el mismo día desde dos lados podía trabar la sincronización de TODAS tus tareas, proyectos y hábitos — existían en la nube pero nunca llegaban a la app. Ahora entra todo, sin frenarse',
          en: 'Made tasks on another device and they never showed up? Sorted. A habit checked on the same day from two places could jam the sync of ALL your tasks, projects, and habits — they lived in the cloud but never reached the app. Now everything lands, no stalling',
        },
      },
    ],
  },
  {
    version: '0.7.1',
    date: '2026-06-11',
    changes: [
      {
        category: 'feat',
        scope: 'quests',
        text: {
          es: 'Tus hábitos ahora te avisan — recordatorios configurables cuando todavía no marcaste el día. Y si ayer cumpliste pero te olvidaste de marcarlo, ahora podés marcarlo retroactivamente con un toque',
          en: 'Your habits now remind you — configurable notifications when you haven\'t checked in yet. And if you did the thing yesterday but forgot to log it, you can now check it retroactively with one tap',
        },
      },
      {
        category: 'feat',
        scope: 'quests',
        text: {
          es: 'Questify más cómodo: buscá tareas al instante y el formulario de crear se colapsa para dejarte más espacio en pantalla',
          en: 'Questify got comfier: search your tasks instantly and the create form now collapses to give you more screen space',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'La IA ahora estima calorías pensando en gramos primero, con porciones argentinas de referencia — se acabaron las estimaciones infladas en porciones chicas',
          en: 'The AI now estimates calories thinking in grams first, with reference portions — no more inflated estimates on small servings',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'Nutrify pulido de punta a punta: botón de cerrar día siempre a mano, registro de peso accesible cuando quieras, ayuda sobre tu TDEE, y avisos claros cuando un día ya está cerrado o una comida quedó sin resolver',
          en: 'Nutrify polished end to end: close-day button always within reach, weight check-in whenever you want, TDEE help bubble, and clear badges when a day is closed or a meal is unresolved',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'El cofre de Coinify se ordenó: encabezados para ordenar tus movimientos, estados vacíos que te guían, y botones más fáciles de tocar',
          en: 'The Coinify chest got organized: sortable headers for your transactions, empty states that guide you, and easier-to-tap buttons',
        },
      },
      {
        category: 'feat',
        scope: 'ui',
        text: {
          es: 'El hub es más accesible y honesto: validación de contraseña con aviso claro, errores que se muestran en vez de fallar en silencio, y mejor soporte de lectores de pantalla',
          en: 'The hub is more accessible and honest: password validation with clear feedback, errors that show up instead of failing silently, and better screen reader support',
        },
      },
      {
        category: 'fix',
        scope: 'sync',
        text: {
          es: 'Arreglamos una pérdida de datos grave: lo que creabas desde otro dispositivo o integración podía ser pisado al sincronizar. Ahora cada registro se compara individualmente y siempre gana la versión más nueva — nada se pierde',
          en: 'Fixed a serious data loss bug: things created from another device or integration could get overwritten on sync. Now every record is compared individually and the newest version always wins — nothing gets lost',
        },
      },
      {
        category: 'fix',
        scope: 'finance',
        text: {
          es: 'Los préstamos borrados ya no resucitan al sincronizar, y el formulario de préstamos ya no crea duplicados si tocás dos veces',
          en: 'Deleted loans no longer come back from the dead when syncing, and the loan form no longer creates duplicates on double-tap',
        },
      },
      {
        category: 'fix',
        scope: 'nutrify',
        text: {
          es: 'Las comidas y datos que borrabas podían volver después de sincronizar — ya no. Y si la IA falla, ahora podés cargar la comida a mano sin perder lo que escribiste',
          en: 'Deleted foods and entries could reappear after syncing — not anymore. And if the AI fails, you can now log the meal manually without losing what you typed',
        },
      },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-05-01',
    changes: [
      {
        category: 'feat',
        scope: 'cauldron',
        text: {
          es: 'El Caldero ahora tiene ventana flotante — un mini-timer que flota encima de todas tus apps para que puedas ver el tiempo sin volver a Hubtify. Se abre automáticamente al iniciar una poción y podés moverlo a donde quieras',
          en: 'The Cauldron now has a floating window — a mini-timer that stays on top of all your apps so you can track time without switching back to Hubtify. Opens automatically when you start a brew and you can drag it wherever you want',
        },
      },
      {
        category: 'feat',
        scope: 'cauldron',
        text: {
          es: 'Cuando termina un segmento ya no avanza solo — ahora te pregunta si querés continuar, extender el tiempo (+N min configurable por receta), o parar. Se acabó perder descansos porque no estabas mirando',
          en: 'When a segment ends it no longer auto-advances — now it asks if you want to continue, extend the time (+N min configurable per recipe), or stop. No more missing breaks because you weren\'t looking',
        },
      },
      {
        category: 'feat',
        text: {
          es: 'Los widgets del dashboard ahora se pueden reordenar arrastrándolos — organizá tu pantalla principal como más te guste',
          en: 'Dashboard widgets are now drag-and-drop reorderable — organize your main screen however you like',
        },
      },
      {
        category: 'feat',
        scope: 'cauldron',
        text: {
          es: 'La racha del Caldero ahora cuenta días consecutivos de verdad, no solo las pociones de hoy. ¡Mantené el fuego encendido!',
          en: 'The Cauldron streak now counts real consecutive days, not just today\'s brews. Keep the fire burning!',
        },
      },
      {
        category: 'fix',
        scope: 'sync',
        text: {
          es: 'Se corrigió un problema donde subir de nivel y volver a la app podía revertir tu XP — ahora los datos locales se sincronizan antes de traer los de la nube',
          en: 'Fixed an issue where leveling up and returning to the app could revert your XP — local data now syncs before pulling from the cloud',
        },
      },
      {
        category: 'fix',
        scope: 'cauldron',
        text: {
          es: 'La XP del Caldero se otorga correctamente sin importar en qué pantalla estés — ya no necesitás estar mirando la página del Caldero para ganar experiencia',
          en: 'Cauldron XP is now granted correctly regardless of which screen you\'re on — you no longer need to be looking at the Cauldron page to earn experience',
        },
      },
      {
        category: 'fix',
        scope: 'cauldron',
        text: {
          es: 'Las notificaciones del sistema ahora aparecen en español con info del ciclo, la próxima fase y el nombre de la receta',
          en: 'System notifications now show in Spanish with cycle info, next phase, and recipe name',
        },
      },
      {
        category: 'fix',
        scope: 'quests',
        text: {
          es: 'Si tenés muchos hábitos, ahora se paginan para que la lista no se haga interminable',
          en: 'If you have lots of habits, they\'re now paginated so the list doesn\'t go on forever',
        },
      },
    ],
  },
  {
    version: '0.6.6',
    date: '2026-04-30',
    changes: [
      {
        category: 'fix',
        text: {
          es: 'Las notas del parche ya no aparecen la primera vez que abrís la app — solo se muestran cuando actualizás a una versión nueva',
          en: 'Patch notes no longer pop up the first time you open the app — they only show when you update to a new version',
        },
      },
    ],
  },
  {
    version: '0.6.5',
    date: '2026-04-30',
    changes: [
      {
        category: 'feat',
        text: {
          es: 'El dashboard ahora es tu centro de operaciones — completá tareas, marcá hábitos, estimá comidas con IA y registrá gastos, todo sin salir de la pantalla principal. Cada módulo tiene su widget interactivo con acceso rápido a lo más importante',
          en: 'The dashboard is now your command center — complete tasks, check habits, estimate meals with AI, and log expenses, all without leaving the main screen. Every module has its own interactive widget with quick access to what matters most',
        },
      },
      {
        category: 'feat',
        scope: 'quests',
        text: {
          es: 'Questify se divide en dos widgets: uno para tus tareas pendientes (con checkbox que da XP al instante) y otro para hábitos con racha y progreso del día',
          en: 'Questify splits into two widgets: one for pending tasks (with checkboxes that give XP instantly) and one for habits with streaks and daily progress',
        },
      },
      {
        category: 'feat',
        scope: 'nutrify',
        text: {
          es: 'Estimación rápida con IA directo desde el dashboard — escribí lo que comiste, Gemini te calcula las calorías al toque, confirmás y listo',
          en: 'Quick AI estimation right from the dashboard — type what you ate, Gemini calculates the calories on the spot, confirm and done',
        },
      },
      {
        category: 'feat',
        scope: 'finance',
        text: {
          es: 'Mini formulario de gasto/ingreso en el dashboard — elegí el tipo, poné el monto y una descripción, y registralo en un toque',
          en: 'Mini expense/income form on the dashboard — pick the type, enter the amount and a description, and log it in one tap',
        },
      },
      {
        category: 'feat',
        text: {
          es: 'Notas del parche automáticas — cuando actualizás la app, te recibe un pergamino con todo lo nuevo de la versión. También podés verlas desde Ajustes',
          en: 'Automatic patch notes — when you update the app, a scroll greets you with everything new in the version. You can also check them from Settings anytime',
        },
      },
      {
        category: 'feat',
        text: {
          es: 'El changelog ahora habla tu idioma — las notas se muestran en español o inglés según tu configuración',
          en: 'The changelog now speaks your language — notes are shown in Spanish or English based on your settings',
        },
      },
      {
        category: 'fix',
        scope: 'cauldron',
        text: {
          es: 'El temporizador ahora suena cuando cambia de etapa (trabajo → descanso). El botón de detener ya no dispara la alarma innecesariamente',
          en: 'The timer now plays a sound when switching stages (work → break). The stop button no longer triggers the alarm unnecessarily',
        },
      },
      {
        category: 'fix',
        text: {
          es: 'El XP del día ya no muestra "+-86" cuando es negativo — ahora muestra "-86" como corresponde',
          en: 'Daily XP no longer shows "+-86" when negative — now displays "-86" as it should',
        },
      },
    ],
  },
  {
    version: '0.6.4',
    date: '2026-04-29',
    changes: [
      { category: 'feat', text: { es: 'Modal de changelog en la página de ajustes', en: 'Changelog modal in settings page' } },
      { category: 'feat', scope: 'ci', text: { es: 'Flujo de release con extracción de changelog en notas', en: 'Release workflow with changelog extraction in release notes' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Usar zona horaria local en vez de UTC para comparaciones de fechas', en: 'Use local timezone instead of UTC for date comparisons' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Lógica de período de gracia para días de nutrición sin cerrar', en: 'Grace period logic for unclosed nutrition days' } },
      { category: 'chore', scope: 'updater', text: { es: 'Apuntar releases y updater al repo hubtify-releases', en: 'Point releases and updater to hubtify-releases repo' } },
    ],
  },
  {
    version: '0.6.3',
    date: '2026-04-28',
    changes: [
      { category: 'fix', scope: 'sync', text: { es: 'Correcciones de pérdida de datos en sincronización', en: 'Sync data loss fixes' } },
      { category: 'fix', scope: 'auth', text: { es: 'Flujo de contraseña olvidada', en: 'Forgot password flow' } },
      { category: 'fix', scope: 'ui', text: { es: 'Mejoras de pulido visual', en: 'UI polish improvements' } },
    ],
  },
  {
    version: '0.6.2',
    date: '2026-04-27',
    changes: [
      { category: 'feat', text: { es: 'Sistema de feedback', en: 'Feedback system' } },
      { category: 'fix', scope: 'nutrify', text: { es: 'Corrección de z-index del selector de comidas', en: 'Meal picker z-index fix' } },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-04-27',
    changes: [
      { category: 'fix', scope: 'ui', text: { es: 'Comportamiento del HelpBubble al pasar el mouse', en: 'HelpBubble hover behavior' } },
      { category: 'fix', scope: 'ui', text: { es: 'Animaciones del sidebar', en: 'Sidebar animations' } },
      { category: 'fix', scope: 'ui', text: { es: 'Correcciones de z-index', en: 'Z-index corrections' } },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-04-26',
    changes: [
      { category: 'feat', text: { es: 'Rediseño visual Codex UI', en: 'Codex UI overhaul' } },
      { category: 'feat', scope: 'cauldron', text: { es: 'Módulo de temporizador Pomodoro con temática RPG', en: 'Pomodoro timer module with RPG theme' } },
      { category: 'feat', scope: 'cauldron', text: { es: 'Efectos de sonido para eventos del temporizador', en: 'Sound effects for timer events' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Sistema de notificaciones con motor, centro y ajustes', en: 'Notification system with engine, center, and settings' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Componente NotificationBell', en: 'NotificationBell component' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Drawer del centro de notificaciones', en: 'NotificationCenter drawer component' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Toggles duales de notificaciones en ajustes', en: 'Dual notification toggles in settings' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Handlers de sincronización y entrada en USER_DATA_TABLES', en: 'Sync handlers and USER_DATA_TABLES entry' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Handlers IPC y ciclo de vida del motor', en: 'IPC handlers and engine lifecycle' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Motor de notificaciones con evaluadores y tests', en: 'Notification engine with evaluators and tests' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Migración de tabla de notificaciones', en: 'Notifications table migration' } },
      { category: 'feat', scope: 'notifications', text: { es: 'Claves i18n para centro de notificaciones y ajustes', en: 'i18n keys for notification center and settings' } },
      { category: 'fix', scope: 'ui', text: { es: 'Campana de notificaciones en línea con título del jugador', en: 'Notification bell inline with player title' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Auto-resolver nutri_no_meals cuando pasa el día', en: 'Auto-resolve nutri_no_meals when day passes' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Cálculo del día de cierre de tarjeta en límites de mes', en: 'Credit card closing day calculation at month boundaries' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Limitar quest_stale a tareas activas recientes', en: 'Limit quest_stale to recently active tasks' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Parseo UTC de timeAgo para fechas SQLite', en: 'timeAgo UTC parsing for SQLite dates' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Actualización del conteo del badge al descartar y posponer', en: 'Badge count update on dismiss and snooze' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Verificación de auto-resolución de cuotas para ventana próxima', en: 'Installment auto-resolve check for upcoming window' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Soporte i18n para mensajes del motor de notificaciones', en: 'i18n support for notification engine messages' } },
      { category: 'fix', scope: 'notifications', text: { es: 'Estado descartado incluido en verificación de dedup', en: 'Dismissed status included in dedup check' } },
      { category: 'fix', text: { es: 'Manejo de errores en Dashboard, handleCloseDayConfirm, saveRecurringEdit', en: 'Error handling in Dashboard, handleCloseDayConfirm, saveRecurringEdit' } },
      { category: 'fix', scope: 'finance', text: { es: 'Eliminar CSS muerto, extraer helper nextMonthFirstDay', en: 'Remove dead CSS, extract nextMonthFirstDay helper' } },
      { category: 'refactor', scope: 'notifications', text: { es: 'Eliminar sistema de recordatorios deprecado', en: 'Remove deprecated reminders system' } },
    ],
  },
  {
    version: '0.5.11',
    date: '2026-04-04',
    changes: [
      { category: 'fix', text: { es: 'Pase de QA integral — 65+ bugs corregidos en todos los módulos', en: 'Comprehensive QA pass — 65+ bugs fixed across all modules' } },
      { category: 'feat', scope: 'finance', text: { es: 'Búsqueda de transacciones por descripción y categoría', en: 'Transaction search by description and category' } },
      { category: 'feat', scope: 'finance', text: { es: 'Diálogo de confirmación antes de eliminar transacciones', en: 'Confirmation dialog before deleting transactions' } },
      { category: 'feat', scope: 'finance', text: { es: 'Fecha y método de pago en edición de transacciones', en: 'Date and payment method in transaction edit' } },
      { category: 'feat', scope: 'finance', text: { es: 'Total pendiente de tarjeta de crédito en dashboard', en: 'Pending credit card total in dashboard' } },
      { category: 'feat', scope: 'finance', text: { es: 'Auto-generar estados de CC al montar dashboard', en: 'Auto-generate CC statements on dashboard mount' } },
      { category: 'feat', scope: 'sync', text: { es: 'Despachar finance:dataChanged en todas las mutaciones de finanzas', en: 'Dispatch finance:dataChanged on all finance mutations' } },
      { category: 'fix', scope: 'finance', text: { es: 'Achicar barras de proyección y prevenir desborde en tarjeta de próximas batallas', en: 'Shrink projection bars and prevent value overflow in next battles card' } },
      { category: 'fix', scope: 'ui', text: { es: 'Preservar posición de scroll en cubierta de volteo de página', en: 'Preserve scroll position in page flip cover' } },
      { category: 'fix', scope: 'sync', text: { es: 'Deshabilitar foreign keys durante clearUserData para evitar errores de constraint', en: 'Disable foreign keys during clearUserData to avoid constraint errors' } },
      { category: 'fix', scope: 'ui', text: { es: 'Prevenir estiramiento de tarjetas fijando dimensiones de cubierta', en: 'Prevent card stretching during page flip by fixing cover dimensions' } },
      { category: 'fix', scope: 'finance', text: { es: 'Cambiar step del input de monto de 100 a 1', en: 'Amount input step changed from 100 to 1' } },
      { category: 'fix', scope: 'finance', text: { es: 'RpgNumberInput en monto de pago de StatementDetail', en: 'RpgNumberInput in StatementDetail pay amount' } },
      { category: 'fix', scope: 'finance', text: { es: 'Restaurar CategorySelect con opción __manage__ y CategoryManager', en: 'Restore CategorySelect with __manage__ option and CategoryManager' } },
      { category: 'fix', scope: 'finance', text: { es: 'Mover sección de recurrentes debajo de transacciones', en: 'Move recurring section below transactions' } },
      { category: 'fix', scope: 'finance', text: { es: 'Traducción faltante de detalles y RpgNumberInput para inputs de día', en: 'Missing details translation and RpgNumberInput for day inputs' } },
    ],
  },
  {
    version: '0.5.10',
    date: '2026-04-02',
    changes: [
      { category: 'feat', scope: 'finance', text: { es: 'Componente CategoryManager', en: 'CategoryManager component' } },
      { category: 'feat', scope: 'finance', text: { es: 'Creación de cuotas desde tab, edición inline y soporte account:switched', en: 'Installment creation from tab, inline editing, and account:switched support' } },
      { category: 'feat', scope: 'sync', text: { es: 'Sincronización de subcolección de finanzas y despacho de account:switched', en: 'Finance subcollection sync and account:switched event dispatch' } },
      { category: 'feat', scope: 'finance', text: { es: 'Secciones acordeón para transacciones recurrentes vs normales', en: 'Accordion sections for recurring vs normal transactions' } },
      { category: 'feat', scope: 'finance', text: { es: 'Auto-generar recurrentes al montar dashboard', en: 'Auto-generate recurring on dashboard mount' } },
      { category: 'feat', scope: 'finance', text: { es: 'Día de facturación en formulario y lista de recurrentes', en: 'Billing day in recurring form and list' } },
      { category: 'feat', scope: 'finance', text: { es: 'Traducciones i18n del rediseño de recurrentes', en: 'Recurring redesign i18n translations' } },
      { category: 'feat', scope: 'finance', text: { es: 'Soporte de día de facturación en handlers IPC de recurrentes', en: 'Billing day support in recurring IPC handlers' } },
      { category: 'feat', scope: 'finance', text: { es: 'Migración v6 para billing_day de recurrentes', en: 'Migration v6 for recurring billing_day' } },
      { category: 'feat', scope: 'finance', text: { es: 'Toggle para última cuota personalizada con animación', en: 'Toggle for custom last installment with animation' } },
      { category: 'feat', scope: 'finance', text: { es: 'Selector de tarjeta de crédito en formulario de cuotas', en: 'Credit card select in installment form' } },
      { category: 'feat', scope: 'finance', text: { es: 'Badge de seguimiento CC en lista de transacciones', en: 'CC tracking badge in transaction list' } },
      { category: 'feat', scope: 'finance', text: { es: 'Tab y ruta de tarjetas de crédito', en: 'Credit cards tab and route' } },
      { category: 'feat', scope: 'finance', text: { es: 'Página de CreditCards con vista de estados', en: 'CreditCards page with statements view' } },
      { category: 'feat', scope: 'finance', text: { es: 'Componente modal StatementDetail', en: 'StatementDetail modal component' } },
      { category: 'feat', scope: 'finance', text: { es: 'Selector de tarjeta de crédito en QuickAddForm', en: 'Credit card select in QuickAddForm' } },
      { category: 'feat', scope: 'finance', text: { es: 'Componente dropdown CreditCardSelect', en: 'CreditCardSelect dropdown component' } },
      { category: 'feat', scope: 'finance', text: { es: 'Componente modal CreditCardManager', en: 'CreditCardManager modal component' } },
      { category: 'feat', scope: 'finance', text: { es: 'Traducciones i18n de tarjetas de crédito', en: 'Credit card i18n translations' } },
      { category: 'feat', scope: 'finance', text: { es: 'Llamadas IPC de tarjetas de crédito en preload y types', en: 'Credit card IPC calls in preload and types' } },
      { category: 'feat', scope: 'finance', text: { es: 'Actualizar queries existentes para lógica de dos capas de tarjeta', en: 'Update existing queries for credit card two-layer logic' } },
      { category: 'feat', scope: 'finance', text: { es: 'Generación de estados y handlers IPC de pago', en: 'Statement generation and payment IPC handlers' } },
      { category: 'fix', scope: 'ui', text: { es: 'Mejoras en PlayerCard, layout, RpgNumberInput y Toast', en: 'PlayerCard, layout, RpgNumberInput, and Toast improvements' } },
      { category: 'fix', scope: 'sync', text: { es: 'Falta credit_card_id, impacts_balance, billing_day en handlers de sync', en: 'Missing credit_card_id, impacts_balance, billing_day in sync handlers' } },
      { category: 'fix', scope: 'finance', text: { es: 'Reemplazar window.confirm con useConfirm en liquidación de préstamo', en: 'Replace window.confirm with useConfirm in loan settle' } },
      { category: 'fix', scope: 'finance', text: { es: 'Eliminar default incorrecto en verificación isCreditCard', en: 'Remove incorrect default in isCreditCard check' } },
      { category: 'fix', scope: 'finance', text: { es: 'Alinear tipo impactsBalance a number para SQLite INTEGER', en: 'Align impactsBalance type to number for SQLite INTEGER' } },
    ],
  },
  {
    version: '0.5.8',
    date: '2026-04-02',
    changes: [
      { category: 'fix', scope: 'updater', text: { es: 'Verificación activa al montar React y verificación pasiva demorada', en: 'Active check on React mount and delayed passive check' } },
    ],
  },
  {
    version: '0.5.6',
    date: '2026-04-02',
    changes: [
      { category: 'fix', scope: 'updater', text: { es: 'Esperar carga del renderer y logs de debug', en: 'Wait for renderer load and debug logs' } },
    ],
  },
  {
    version: '0.5.4',
    date: '2026-04-02',
    changes: [
      { category: 'feat', text: { es: 'Sistema de animaciones GSAP, transiciones de volteo de página y toasts unificados', en: 'GSAP animation system, page flip transitions, and unified toasts' } },
    ],
  },
  {
    version: '0.5.3',
    date: '2026-03-30',
    changes: [
      { category: 'feat', scope: 'quests', text: { es: 'Estados de carga, categorías de fecha de vencimiento y animaciones', en: 'Loading states, due date categories, and animations' } },
      { category: 'feat', scope: 'nutrify', text: { es: 'Sistema de toasts, animaciones y skeleton loaders', en: 'Toast system, animations, and skeleton loaders' } },
      { category: 'feat', scope: 'coinify', text: { es: 'Rediseño del módulo de finanzas con temática RPG', en: 'RPG-themed finance module redesign' } },
      { category: 'fix', scope: 'nutrify', text: { es: 'Re-verificar popup de peso después de que sync restaure perfil', en: 'Re-check weight popup after sync restores profile' } },
    ],
  },
  {
    version: '0.5.2',
    date: '2026-03-29',
    changes: [
      { category: 'feat', scope: 'nutrify', text: { es: 'Tarjeta de balance semanal en gráficos de nutrición', en: 'Weekly balance stat card in nutrition charts' } },
      { category: 'fix', scope: 'nutrify', text: { es: 'Recargar después de sync, eliminar campos de gym/pasos del UI', en: 'Reload after sync, remove gym/step fields from UI' } },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-03-29',
    changes: [
      { category: 'feat', text: { es: 'Coinify v2 — rediseño completo del módulo de finanzas', en: 'Coinify v2 — complete finance module redesign' } },
      { category: 'feat', scope: 'finance', text: { es: 'FinanceLayout con navegación interna por tabs', en: 'FinanceLayout with internal tab navigation' } },
      { category: 'feat', scope: 'finance', text: { es: 'Página de Dashboard y widget actualizado', en: 'Dashboard page and updated widget' } },
      { category: 'feat', scope: 'finance', text: { es: 'Página de transacciones con quick-add y filtros', en: 'Transactions page with quick-add and filters' } },
      { category: 'feat', scope: 'finance', text: { es: 'Página de recurrentes con historial de montos', en: 'Recurring page with amount history' } },
      { category: 'feat', scope: 'finance', text: { es: 'Página de cuotas con proyección', en: 'Installments page with projection' } },
      { category: 'feat', scope: 'finance', text: { es: 'Página de préstamos con compras de terceros', en: 'Loans page with third-party purchases' } },
      { category: 'feat', scope: 'finance', text: { es: 'Página de importación para PDF de Galicia VISA', en: 'Import page for Galicia VISA PDF' } },
      { category: 'feat', scope: 'finance', text: { es: 'Auto-generar transacciones recurrentes al iniciar la app', en: 'Auto-generate recurring transactions on app start' } },
      { category: 'feat', scope: 'finance', text: { es: 'Bridge de preload con métodos IPC de Coinify v2', en: 'Preload bridge with Coinify v2 IPC methods' } },
      { category: 'feat', text: { es: 'Subtareas visibles en tab de completadas al expandir', en: 'Subtasks visible in completed tab when expanded' } },
      { category: 'fix', scope: 'coinify', text: { es: 'Navegación book-tab, bug de dirección de préstamos, validación de edición', en: 'Book-tab nav, loans direction bug, edit validation' } },
      { category: 'fix', text: { es: 'Ruta home mostrando Dashboard de Finanzas en vez de Hub', en: 'Home route showing Finance dashboard instead of Hub dashboard' } },
      { category: 'fix', scope: 'character', text: { es: 'Envolver índices de pelo/color en vez de clampear', en: 'Wrap hair/color indices instead of clamping' } },
      { category: 'fix', scope: 'nutrify', text: { es: 'Mensajes de estado conscientes del objetivo en barra de progreso de calorías', en: 'Goal-aware status messages in calorie progress bar' } },
      { category: 'fix', scope: 'finance', text: { es: 'Habilitar Coinify en navegación del sidebar', en: 'Enable Coinify in sidebar navigation' } },
      { category: 'refactor', scope: 'finance', text: { es: 'Reescribir definición de módulo con nuevos eventos RPG', en: 'Rewrite module definition with new RPG events' } },
    ],
  },
  {
    version: '0.4.2',
    date: '2026-03-28',
    changes: [
      { category: 'fix', text: { es: 'Cambiar cloud function a callable v1 para auth confiable en Electron', en: 'Switch cloud function to v1 callable for reliable auth in Electron' } },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: { es: 'API de Gemini detrás de Firebase Cloud Function con errores de auth personalizados', en: 'Gemini API behind Firebase Cloud Function with custom auth errors' } },
      { category: 'fix', scope: 'updater', text: { es: 'Confiabilidad y manejo de errores del auto-updater', en: 'Auto-updater reliability and error handling' } },
      { category: 'fix', text: { es: 'Auth de Firebase cargado antes de request de callable function', en: 'Firebase auth loaded before callable function request' } },
    ],
  },
  {
    version: '0.3.4',
    date: '2026-03-28',
    changes: [
      { category: 'fix', text: { es: 'Auto-instalar actualización después de descargar, sin paso manual', en: 'Auto-install update after download, no manual step needed' } },
    ],
  },
  {
    version: '0.3.3',
    date: '2026-03-28',
    changes: [
      { category: 'feat', scope: 'ui', text: { es: 'Versión de la app mostrada en footer del sidebar', en: 'App version displayed in sidebar footer' } },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: { es: 'Popup de actualización al iniciar la app en vez de banner en ajustes', en: 'Update popup on app start instead of settings banner' } },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: { es: 'Auto-updater in-app via GitHub Releases API', en: 'In-app auto-updater via GitHub Releases API' } },
      { category: 'fix', text: { es: 'Ruta absoluta para ícono del packager para asegurar que rcedit lo embeba', en: 'Absolute path for packager icon to ensure rcedit embeds it' } },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: { es: 'API key de Gemini via variable de entorno', en: 'Gemini API key via environment variable' } },
      { category: 'feat', scope: 'nutrify', text: { es: 'Cambiar de Ollama a Gemini API para estimación de calorías', en: 'Switch from Ollama to Gemini API for calorie estimation' } },
      { category: 'feat', scope: 'ui', text: { es: 'Componente Tooltip con estilo RPG para items próximamente', en: 'RPG-styled Tooltip component for coming soon items' } },
      { category: 'fix', scope: 'questify', text: { es: 'Checkbox de subtarea un click y layout de toggle completado', en: 'Subtask checkbox single-click and completed toggle layout' } },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-03-28',
    changes: [
      { category: 'feat', scope: 'ui', text: { es: 'Deshabilitar Coinify, agregar Logros y Villa como próximamente', en: 'Disable Coinify, add Achievements and Village as coming soon' } },
      { category: 'feat', scope: 'sync', text: { es: 'Exportar/importar masivo de nutrición y fuentes de ingreso de finanzas', en: 'Nutrition bulk export/import and finance income sources' } },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-03-27',
    changes: [
      { category: 'feat', text: { es: 'Versión inicial', en: 'Initial release' } },
    ],
  },
];
