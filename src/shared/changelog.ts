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
