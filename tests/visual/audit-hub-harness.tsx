/**
 * Arnés común de la auditoría VISUAL del Hub / Shell.
 *
 * Un stub permisivo de `window.api` (Proxy) más un puñado de respuestas con
 * forma real, para poder montar pantallas enteras del shell sin que una
 * promesa sin manejar se lleve puesto el render.
 */
import type { PlayerStats } from '../../shared/types';

export const SCREENS = 'screens';

/** Ancho de ventana MAXIMIZADA — ahí viven los problemas de ancho. */
export const WIDE: [number, number] = [1640, 900];
/** Cerca del mínimo que permite Electron (minWidth 700 / minHeight 650). */
export const NARROW: [number, number] = [760, 640];

export const stats: PlayerStats = {
  userId: 'default', level: 12, xp: 4810, xpToNextLevel: 5200, hp: 84, maxHp: 100,
  title: 'Escudero', streak: 9, dailyCombo: 3, comboDate: null, streakLastDate: null,
  totalTasks: 143, totalMeals: 88, totalExpenses: 61, hpDate: null,
  pardonsMonth: null, pardonsUsed: 1, pardonsRemaining: 2, bestStreak: 21, innSince: null,
} as PlayerStats;

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);

export const DEFAULT_OVERRIDES: Record<string, unknown> = {
  getRpgStats: () => Promise.resolve(stats),
  rpgGetDashboardStats: () => Promise.resolve({
    xpToday: 148,
    eventsToday: 7,
    xpHistory: [6, 5, 4, 3, 2, 1, 0].map((b, i) => ({ date: day(b), xp: [40, 120, 85, 210, 60, 175, 148][i] })),
  }),
  getRpgHistory: () => Promise.resolve([
    { id: '1', moduleId: 'quests', eventType: 'TASK_COMPLETED', xpGained: 15, payload: JSON.stringify({ description: 'Terminar el informe trimestral de la cofradía' }), createdAt: iso(3) },
    { id: '2', moduleId: 'nutrition', eventType: 'MEAL_LOGGED', xpGained: 5, payload: JSON.stringify({ description: 'Almuerzo' }), createdAt: iso(95) },
    { id: '3', moduleId: 'finance', eventType: 'EXPENSE_LOGGED', xpGained: 3, payload: '{}', createdAt: iso(400) },
    { id: '4', moduleId: 'cauldron', eventType: 'POMODORO_COMPLETED', xpGained: 25, payload: '{}', createdAt: iso(1500) },
    { id: '5', moduleId: 'rpg', eventType: 'ACHIEVEMENT_UNLOCKED', xpGained: 50, payload: '{}', createdAt: iso(4300) },
  ]),
  questsGetOverdueCount: () => Promise.resolve(3),
  nutritionGetTodayMealsCount: () => Promise.resolve(0),
  rpgGetAchievements: () => Promise.resolve([]),
  rpgGetDaySummary: () => Promise.resolve(null),
  rpgGetSeals: () => Promise.resolve([]),
  notificationsGetUnreadCount: () => Promise.resolve(2),
  characterGetName: () => Promise.resolve('Facundo el Bravo'),
  rpgGetObolosBalance: () => Promise.resolve({ balance: 42, earned: 310, spent: 268 }),
  rpgGetRewards: () => Promise.resolve([
    { id: 'r1', name: 'Una tarde de videojuegos sin culpa', cost: 30, icon: 'chalice', createdAt: iso(9000), updatedAt: iso(9000), redeemedCount: 2 },
    { id: 'r2', name: 'Café', cost: 5, icon: 'potion', createdAt: iso(9000), updatedAt: iso(9000), redeemedCount: 11 },
    { id: 'r3', name: 'Comprar ese libro que estás mirando hace meses', cost: 120, icon: 'book', createdAt: iso(9000), updatedAt: iso(9000), redeemedCount: 0 },
  ]),
  rpgGetShopCatalog: () => Promise.resolve({
    balance: 42,
    equipped: { sealStyle: null, frame: null, background: null },
    items: [
      { id: 'seal_laurel', kind: 'seal_style', cost: 25, i18nKey: 'rpg.shop.items.seal_laurel', owned: true, equipped: true, purchasedAt: iso(9000) },
      { id: 'frame_laurel', kind: 'frame', cost: 60, i18nKey: 'rpg.shop.items.frame_laurel', owned: false, equipped: false, purchasedAt: null },
      { id: 'pardon_extra', kind: 'pardon', cost: 40, i18nKey: 'rpg.shop.items.pardon_extra', owned: false, equipped: false, purchasedAt: null },
      { id: 'bg_vellum', kind: 'background', cost: 80, i18nKey: 'rpg.shop.items.bg_vellum', owned: false, equipped: false, purchasedAt: null },
    ],
  }),
  rpgGetMasteries: () => Promise.resolve([
    { moduleId: 'quests', xp: 1200, level: 4, levelName: 'Veterano', levelKey: 'rpg.mastery.ranks.veterano', nextLevelXp: 1800, progress: 0.55 },
    { moduleId: 'nutrition', xp: 300, level: 2, levelName: 'Aprendiz', levelKey: 'rpg.mastery.ranks.aprendiz', nextLevelXp: 600, progress: 0.2 },
    { moduleId: 'finance', xp: 90, level: 1, levelName: 'Novato', levelKey: 'rpg.mastery.ranks.novato', nextLevelXp: 200, progress: 0.45 },
    { moduleId: 'cauldron', xp: 4200, level: 10, levelName: 'Maestro', levelKey: 'rpg.mastery.ranks.maestro', nextLevelXp: null, progress: 1 },
  ]),

  /* Widgets de módulo — no son pantallas mías, pero el dashboard los monta. */
  // Ocho hábitos a propósito: la lista del widget corta a los ~5 renglones y
  // ahí se ve si el corte se anuncia o parece un glitch.
  questsGetHabits: () => Promise.resolve([
    { id: 'h1', name: 'Meditar', streak: 128, doneToday: true, targetPerWeek: 7, icon: null },
    { id: 'h2', name: 'Leer veinte páginas antes de dormir a la noche', streak: 7, doneToday: false, targetPerWeek: 5, icon: null },
    { id: 'h3', name: 'Ritual 1', streak: 0, doneToday: false, targetPerWeek: 7, icon: null },
    { id: 'h4', name: 'Ritual 2', streak: 1, doneToday: false, targetPerWeek: 7, icon: null },
    { id: 'h5', name: 'Ritual 3', streak: 2, doneToday: false, targetPerWeek: 7, icon: null },
    { id: 'h6', name: 'Ritual 4', streak: 3, doneToday: false, targetPerWeek: 7, icon: null },
    { id: 'h7', name: 'Ritual 5', streak: 4, doneToday: false, targetPerWeek: 7, icon: null },
    { id: 'h8', name: 'Ritual 6', streak: 5, doneToday: false, targetPerWeek: 7, icon: null },
  ]),
  questsGetPendingCount: () => Promise.resolve(4),
  questsGetCompletedTodayCount: () => Promise.resolve(2),
  questsGetTasks: () => Promise.resolve([
    { id: 't1', name: 'Terminar el informe trimestral de la cofradía', description: '', status: false, tier: 2, category: '', projectId: null, dueDate: day(-1), order: 0, completedAt: null, createdAt: iso(600), updatedAt: iso(600) },
    { id: 't2', name: 'Afilar la espada', description: '', status: false, tier: 1, category: '', projectId: null, dueDate: null, order: 1, completedAt: null, createdAt: iso(900), updatedAt: iso(900) },
  ]),
  nutritionGetTodayCalories: () => Promise.resolve(1480),
  nutritionGetTodayTarget: () => Promise.resolve(2100),
  nutritionGetWeekCalories: () => Promise.resolve([1900, 2050, 1700, 2200, 1850, 1600, 1480]),
  nutritionGetMealSchedule: () => Promise.resolve([]),
  nutritionGetProfile: () => Promise.resolve(null),
  financeGetMonthlyTotal: () => Promise.resolve(184300),
  financeGetActiveLoansCount: () => Promise.resolve(1),
  financeGetMonthlyBalance: () => Promise.resolve({ income: 420000, expenses: 184300, balance: 235700 }),
  cauldronGetStats: () => Promise.resolve({ todaySessions: 2, todayMinutes: 50, streak: 3, totalSessions: 44 }),
  cauldronGetState: () => Promise.resolve(null),
  cauldronGetPresets: () => Promise.resolve([]),
};

/** Instala el stub. `extra` pisa (o agrega) métodos puntuales. */
export function installApi(extra: Record<string, unknown> = {}) {
  const table = { ...DEFAULT_OVERRIDES, ...extra };
  (window as unknown as { api: unknown }).api = new Proxy({}, {
    get: (_t, prop: string) => {
      if (prop in table) return table[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => undefined;
      return () => Promise.resolve(null);
    },
    has: () => true,
  });
}

/* ── encuadre de la captura ─────────────────────────
   El viewport del test SÍ llega a 1640x900 (window.innerWidth lo confirma), pero
   la pantalla del Chromium headless mide 1280x703: la captura sale recortada.
   Escalamos el <body> para que las 1640 columnas ENTREN en la captura. El
   layout se sigue calculando a 1640 —scrollWidth/clientWidth/offsetWidth no se
   ven afectados por transform—, sólo cambia el pixelado del PNG. */
export function fitCapture(opts: { full?: boolean } = {}) {
  const b = document.body;
  b.style.transform = '';
  const w = window.innerWidth;
  const h = opts.full ? Math.max(window.innerHeight, b.scrollHeight) : window.innerHeight;
  const avail = { w: Math.min(window.screen.width, 1280), h: Math.min(window.screen.height, 700) };
  const scale = Math.min(1, avail.w / w, avail.h / h);
  if (scale >= 1) return 1;
  b.style.transformOrigin = 'top left';
  b.style.transform = `scale(${scale})`;
  return scale;
}

export function resetCapture() {
  document.body.style.transform = '';
}

/** Suelta los contenedores que scrollean, para una captura de la página entera. */
export function unclip() {
  document.querySelectorAll<HTMLElement>('#audit-root, .app-layout, .main-content, .qb-page').forEach((el) => {
    el.style.height = 'auto';
    el.style.maxHeight = 'none';
    el.style.overflow = 'visible';
  });
}

/* ── mediciones ─────────────────────────────────────── */

/** Píxeles de scroll horizontal del nodo (0 = no desborda). */
export function hOverflow(el: Element): number {
  return el.scrollWidth - el.clientWidth;
}

/** Todos los nodos que desbordan horizontalmente a su contenedor. */
export function overflowingNodes(root: ParentNode = document.body) {
  const out: Array<{ sel: string; over: number }> = [];
  root.querySelectorAll('*').forEach((el) => {
    const over = el.scrollWidth - el.clientWidth;
    if (over > 1 && getComputedStyle(el).overflowX === 'visible') {
      out.push({ sel: describe(el), over });
    }
  });
  return out;
}

export function describe(el: Element): string {
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  return `${el.tagName.toLowerCase()}${cls}`;
}

/** Nodos con texto recortado por `text-overflow: ellipsis` o clip vertical. */
export function clippedText(root: ParentNode = document.body) {
  const out: Array<{ sel: string; text: string; over: number }> = [];
  root.querySelectorAll('*').forEach((el) => {
    if (el.children.length > 0) return;
    const txt = (el.textContent ?? '').trim();
    if (!txt) return;
    const over = el.scrollWidth - el.clientWidth;
    if (over > 1) out.push({ sel: describe(el), text: txt.slice(0, 60), over });
  });
  return out;
}

/** Botones sin nombre accesible (ni texto, ni aria-label, ni title). */
export function unlabelledButtons(root: ParentNode = document.body) {
  const out: string[] = [];
  root.querySelectorAll('button, [role="button"]').forEach((el) => {
    const label = (el.getAttribute('aria-label') ?? '')
      || (el.getAttribute('title') ?? '')
      || (el.textContent ?? '').trim();
    if (!label) out.push(describe(el));
  });
  return out;
}

/* ── contraste ──────────────────────────────────────── */

function parse(c: string): [number, number, number] {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0];
  const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
  return [r, g, b];
}

function lum([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(fg: string, bg: string): number {
  const a = lum(parse(fg)), b = lum(parse(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** El pergamino más OSCURO del degradé de las tarjetas: el caso peor. */
export const PARCH_WORST = 'rgb(212, 188, 130)';
/** El cuero del sidebar. */
export const LEATHER_WORST = 'rgb(42, 29, 14)';

/**
 * Superficie real sobre la que se pinta un texto. Casi todo en esta app tiene
 * fondo DEGRADADO (pergamino, cuero, oro), y en un degradé `backgroundColor`
 * computa `transparent`: comparar contra el fondo de la página daba falsos
 * positivos en cada botón de cuero con letra dorada. Devuelve TODAS las paradas
 * de color candidatas para quedarse después con la peor.
 */
function surfaceStops(el: Element, fallback: string): string[] {
  let node: Element | null = el;
  while (node) {
    const cs = getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [])
        .filter((c) => {
          const m = c.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
          return !m || parseFloat(m[1]) >= 0.6;
        });
      if (stops.length > 0) return stops;
    }
    const bc = cs.backgroundColor;
    if (bc && !/rgba\([^)]*,\s*0\)/.test(bc) && bc !== 'transparent') {
      const m = bc.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
      if (!m || parseFloat(m[1]) >= 0.85) return [bc];
    }
    node = node.parentElement;
  }
  return [fallback];
}

/**
 * Texto con poco contraste, medido contra la parada MÁS DESFAVORABLE del
 * degradé que tiene debajo. `bg` es sólo el respaldo para cuando no hay ningún
 * fondo opaco en la cadena de ancestros.
 */
export function lowContrastText(root: ParentNode, bg: string, min = 4.5) {
  const out: Array<{ sel: string; text: string; color: string; sobre: string; ratio: number; px: number }> = [];
  root.querySelectorAll('*').forEach((el) => {
    if (el.children.length > 0) return;
    const text = (el.textContent ?? '').trim();
    if (!text) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const px = parseFloat(cs.fontSize);
    const alpha = parseFloat(cs.opacity || '1');
    const stops = surfaceStops(el, bg);
    const worst = stops.reduce((a, b) => (contrast(cs.color, b) < contrast(cs.color, a) ? b : a));
    let ratio = contrast(cs.color, worst);
    if (alpha < 1) ratio = 1 + (ratio - 1) * alpha;
    // WCAG: 3:1 alcanza para texto grande (>=24px, o >=18.66px en negrita).
    const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    if (ratio < (large ? 3 : min)) {
      out.push({ sel: describe(el), text: text.slice(0, 44), color: cs.color, sobre: worst, ratio: Math.round(ratio * 100) / 100, px });
    }
  });
  return out;
}

/**
 * Texto INFORMATIVO por debajo del piso del sistema (`--fs-label`, 13 px).
 * Recorre las hojas con texto dentro de `root` y devuelve las que computan
 * menos de `minPx`. Los SVG (íconos, glifos ornamentales) no cuentan.
 * Nació de una captura del usuario: «las letras dentro de la tabla son muy
 * chicas» — el libro mayor iba a 12.5 px.
 */
export function smallText(root: ParentNode, minPx = 13) {
  return smallTextIn(root, minPx);
}

/**
 * Píxeles computados de un token de tamaño (`--fs-body`, `--fs-label`…).
 * `getPropertyValue` devuelve el `calc(15px * var(--font-scale))` literal,
 * así que se mide con una sonda en el DOM.
 */
export function tokenPx(token: string): number {
  const probe = document.createElement('span');
  probe.style.fontSize = `var(${token})`;
  probe.style.position = 'absolute';
  probe.textContent = 'x';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return px;
}

function smallTextIn(root: ParentNode, minPx: number) {
  const out: Array<{ sel: string; text: string; px: number }> = [];
  root.querySelectorAll('*').forEach((el) => {
    if (el.children.length > 0 || el instanceof SVGElement) return;
    const text = (el.textContent ?? '').trim();
    if (!text) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    const px = parseFloat(cs.fontSize);
    if (px < minPx - 0.01) out.push({ sel: describe(el), text: text.slice(0, 40), px });
  });
  return out;
}

/** Contraste efectivo de un elemento contra el primer ancestro con fondo opaco. */
export function contrastOf(el: Element): number {
  const cs = getComputedStyle(el);
  let bg = 'rgb(245, 231, 192)';
  let node: Element | null = el;
  while (node) {
    const c = getComputedStyle(node).backgroundColor;
    if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
    node = node.parentElement;
  }
  const alpha = parseFloat(cs.opacity || '1');
  const ratio = contrast(cs.color, bg);
  // La opacidad inline degrada el contraste real; lo aproximamos linealmente.
  return alpha >= 1 ? ratio : 1 + (ratio - 1) * alpha;
}
