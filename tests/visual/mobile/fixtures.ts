/**
 * Stubs de window.api para las páginas de módulo en el arnés browser-mobile.
 * Formas copiadas de tests/visual/audit-*.browser.test.tsx (validadas ahí);
 * menos filas, textos largos a propósito.
 */
type Row = Record<string, unknown>;

export function isoDay(offsetDays: number, time?: string): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return time ? `${day}T${time}` : day;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const DAY = 24 * 60 * 60 * 1000;

export const LONG_TITLE =
  'Reorganizar el archivo completo de facturas del estudio, ordenarlas por proveedor y por mes, ' +
  'y después escanear las que faltan del ejercicio anterior antes de que cierre el balance';

// ── Questify ─────────────────────────────────────────────────────────────────

const baseTask = (over: Row): Row => ({
  description: '', status: false, category: '', projectId: null, dueDate: null,
  order: 0, completedAt: null, repeatRule: null, repeatOf: null,
  createdAt: '2026-08-01', updatedAt: '2026-08-01', tier: 2, ...over,
});

export const QUEST_PROJECTS: Row[] = [
  { id: 'p1', name: 'Hubtify', color: '#8b7355', order: 0, createdAt: '2026-01-01' },
  { id: 'p2', name: 'Reforma integral de la cocina y el lavadero del departamento', color: '#6b7c5e', order: 1, createdAt: '2026-01-01' },
];

export const QUEST_TASKS: Row[] = [
  baseTask({ id: 't1', name: 'Pagar el alquiler', tier: 3, dueDate: isoDay(-3), category: 'Hogar', order: 0 }),
  baseTask({ id: 't2', name: LONG_TITLE, tier: 2, dueDate: isoDay(-1), category: 'Trabajo', projectId: 'p2', order: 1 }),
  baseTask({
    id: 't3', name: 'Entrenar', tier: 1, dueDate: isoDay(0, '07:30'), category: 'Salud',
    repeatRule: '{"freq":"days","days":[1,3,5]}', order: 2,
  }),
  baseTask({ id: 't4', name: 'Llamar al contador', tier: 2, dueDate: isoDay(0, '16:00'), projectId: 'p1', order: 3 }),
  baseTask({ id: 't5', name: 'Backup mensual del servidor', tier: 3, repeatRule: '{"freq":"monthly"}', dueDate: isoDay(9), order: 4, category: 'Trabajo' }),
  baseTask({ id: 't6', name: 'Idea suelta sin fecha', tier: 2, order: 5 }),
  baseTask({ id: 'tc1', name: 'Mandar el presupuesto', tier: 3, status: true, completedAt: isoDay(0, '11:00'), projectId: 'p1', order: 6 }),
];

const habit = (over: Row): Row => ({
  frequency: 'daily', timesPerWeek: 1, createdAt: '2026-01-01', specificDays: null,
  streak: 0, weekStreak: 0, checkedToday: false, checkedYesterday: true, skippedToday: false,
  checksThisPeriod: 0, targetThisPeriod: 1, pendingToday: true, shieldCount: 0, shieldUsed: false,
  ...over,
});

export const QUEST_HABITS: Row[] = [
  habit({ id: 'h1', name: 'Meditar', streak: 128, checkedToday: true, checksThisPeriod: 1, pendingToday: false, shieldCount: 3 }),
  habit({ id: 'h2', name: 'Gimnasio', frequency: 'weekly', timesPerWeek: 3, specificDays: [1, 3, 5], streak: 12, checksThisPeriod: 2, targetThisPeriod: 3, shieldUsed: true }),
  habit({ id: 'h3', name: 'Leer veinte páginas antes de dormir aunque sea de un libro que ya leí', streak: 4, shieldCount: 1 }),
];

const HEATMAP_DAYS = Array.from({ length: 30 }, (_, i) => ({ date: isoDay(i - 29), count: i % 4, skipCount: i % 7 === 0 ? 1 : 0 }));

export const QUESTS_API: Record<string, unknown> = {
  questsGetTasks: () => Promise.resolve(QUEST_TASKS),
  questsGetProjects: () => Promise.resolve(QUEST_PROJECTS),
  questsGetAllDrawingCounts: () => Promise.resolve([]),
  questsGetDrawings: () => Promise.resolve([]),
  questsGetSubtasks: () => Promise.resolve([]),
  questsGetHabits: () => Promise.resolve(QUEST_HABITS),
  questsGetCategories: () => Promise.resolve(['Hogar', 'Trabajo', 'Salud']),
  questsGetHabitHeatmap: () => Promise.resolve({ days: HEATMAP_DAYS, totalHabits: 3 }),
  questsGetHabitHistory: (_id: string, days = 91) => Promise.resolve({
    days: Array.from({ length: days }, (_, i) => ({ date: isoDay(i - (days - 1)), checked: i % 3 !== 0 })),
    bestStreak: 41,
  }),
  questsGetPendingCount: () => Promise.resolve(6),
  questsGetCompletedTodayCount: () => Promise.resolve(1),
  cauldronGetPresets: () => Promise.resolve([{ id: 'cp1', name: 'Clásico', focusMin: 25, quickStart: 1 }]),
  cauldronSetSessionTask: () => Promise.resolve(true),
  processRpgEvent: () => Promise.resolve({ xpGained: 15, bonusMultiplier: 1, comboMultiplier: 1, milestoneXp: 0 }),
};

// ── Coinify ──────────────────────────────────────────────────────────────────

export const COIN_ACCOUNTS: Row[] = [
  { id: 'a1', name: 'Efectivo', kind: 'cash', currency: 'ARS', initialBalance: 0, accountOrder: 0, balance: 128_450, movements: 24 },
  { id: 'a2', name: 'Banco Galicia — Caja de ahorro en pesos', kind: 'bank', currency: 'ARS', initialBalance: 0, accountOrder: 1, balance: 214_780_310, movements: 312 },
  { id: 'a3', name: 'Cuenta en dólares', kind: 'bank', currency: 'USD', initialBalance: 0, accountOrder: 2, balance: 12_450.75, movements: 9 },
];

const COIN_CATS = ['Comida', 'Hogar', 'Transporte', 'Salud', 'Suscripciones y servicios digitales del estudio'];

export const COIN_CATEGORIES: Row[] = [
  { category: 'Comida', ARS: 184_300_000, USD: 0 },
  { category: 'Hogar', ARS: 92_150_000, USD: 0 },
  { category: 'Transporte', ARS: 41_000_000, USD: 0 },
  { category: 'Suscripciones y servicios digitales del estudio', ARS: 8_400_000, USD: 0 },
  { category: 'Software', ARS: 0, USD: 240 },
];

export const COIN_BUDGETS = {
  month: '2026-09', totalLimit: 300_000_000, totalSpent: 365_150_000,
  categories: [
    { category: 'Comida', limit: 150_000_000, spent: 184_300_000, pct: 122.9 },
    { category: 'Hogar', limit: 100_000_000, spent: 92_150_000, pct: 92.2 },
    { category: 'Viajes', limit: 30_000_000, spent: 0, pct: 0 },
  ],
};

export const COIN_UPCOMING = {
  from: '2026-09-01', to: '2026-10-01', totals: { ARS: 987_654_321, USD: 240 },
  items: [
    { kind: 'recurring', date: '2026-09-02', label: 'Alquiler del departamento de Palermo', amount: 480_000_000, currency: 'ARS', refId: 'r1' },
    { kind: 'installment', date: '2026-09-05', label: LONG_TITLE, amount: 128_400_000, currency: 'ARS', refId: 'i1', detail: '(3/6)' },
    { kind: 'card_due', date: '2026-09-12', label: 'Visa Galicia', amount: 214_780_310, currency: 'ARS', refId: 'c1' },
    { kind: 'recurring', date: '2026-09-20', label: 'Software', amount: 240, currency: 'USD', refId: 'r3' },
  ],
};

const PMS = ['cash', 'debit', 'credit', 'transfer'];

export const COIN_TX: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`,
  type: i % 7 === 0 ? 'income' : 'expense',
  amount: i === 3 ? 214_780_310 : 1_000 * (i + 1) * (i % 5 + 1),
  currency: 'ARS',
  category: COIN_CATS[i % COIN_CATS.length],
  description: i === 1 ? LONG_TITLE : `Movimiento ${i + 1}`,
  date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
  paymentMethod: PMS[i % PMS.length],
  source: i % 5 === 0 ? 'import' : 'manual',
  impactsBalance: i % 4 === 3 ? 0 : 1,
  accountId: 'a1',
}));

const bal = {
  ARS: { income: 987_654_321, expenses: 365_150_000, balance: 622_504_321 },
  USD: { income: 3_200, expenses: 240, balance: 2_960 },
};

/** Formas de audit-coin-managers.browser.test.tsx:53-58. */
export const COIN_LOANS: Row[] = [
  { id: 'l1', personName: 'Victoria Fernández de la Vega', direction: 'lent', type: 'single', amount: 214_780_310, currency: 'ARS', date: '2026-05-12', description: 'Adelanto para la reforma completa del departamento de Palermo', settled: 0 },
  { id: 'l2', personName: 'Victoria Fernández de la Vega', direction: 'lent', type: 'installment', amount: 8_000_000, currency: 'ARS', date: '2026-06-01', description: 'Notebook', settled: 0, installmentGroupId: 'g1' },
  { id: 'l4', personName: 'Juan', direction: 'lent', type: 'single', amount: 1_250, currency: 'USD', date: '2026-08-02', description: '', settled: 0 },
];

/** Un grupo de tres cuotas (Installments.tsx InstallmentRow), en el mes corriente. */
export const COIN_INSTALLMENTS: Row[] = [1, 2, 3].map((n) => ({
  id: `i${n}`, description: `Heladera (Cuota ${n}/3)`, amount: 10_000, currency: 'ARS', category: 'Hogar',
  installments: 3, installmentCount: 3, installmentNumber: n, installmentGroupId: 'g1', forThirdParty: 0,
  date: isoDay(0),
}));

/** Doce meses a partir del que viene, con el primer rótulo en la primera barra. */
export const COIN_PROJECTION: Row[] = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1 + i);
  return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, total: i < 2 ? 10_000 : 0 };
});

export const FINANCE_API: Record<string, unknown> = {
  financeGetInstallmentsForMonth: () => Promise.resolve(COIN_INSTALLMENTS),
  financeGetInstallmentProjection: () => Promise.resolve(COIN_PROJECTION),
  financeGetLoans: (opts: { settled?: boolean } = {}) =>
    Promise.resolve(opts.settled ? [] : COIN_LOANS),
  financeGetLoanPayments: () => Promise.resolve([]),
  financeGetMonthlyBalance: () => Promise.resolve(bal),
  financeGetBalanceForRange: () => Promise.resolve(bal),
  financeGetCategoryBreakdown: () => Promise.resolve(COIN_CATEGORIES),
  financeGetCategoryBreakdownForRange: () => Promise.resolve(COIN_CATEGORIES),
  financeGetExpenseBreakdown: () => Promise.resolve({
    ARS: { total: 365_150_000, direct: 180_000_000, installments: 125_150_000, pendingCard: 60_000_000, cardPayments: 0 },
    USD: { total: 240, direct: 240, installments: 0, pendingCard: 0, cardPayments: 0 },
  }),
  financeGetMonthlyExpenses: () => Promise.resolve([280_000_000, 310_000_000, 295_000_000, 340_000_000, 352_000_000, 365_150_000]),
  financeGetProjection: () => Promise.resolve([]),
  financeGetInstallmentGroups: () => Promise.resolve([{}, {}, {}]),
  financeGetCreditCardStatements: () => Promise.resolve([]),
  financeGetActiveLoanSummary: () => Promise.resolve({
    ARS: { lent: 90_000_000, borrowed: 500_000_000, lentPending: 45_120_000, borrowedPending: 312_900_000 },
    USD: { lent: 0, borrowed: 0, lentPending: 1_250, borrowedPending: 0 },
    lent: 90_000_000, borrowed: 500_000_000,
  }),
  financeGetBudgetStatus: () => Promise.resolve(COIN_BUDGETS),
  financeSetBudget: () => Promise.resolve({ ok: true }),
  financeGetAccounts: () => Promise.resolve(COIN_ACCOUNTS),
  financeSaveAccount: () => Promise.resolve({ ok: true, id: 'x' }),
  financeDeleteAccount: () => Promise.resolve({ ok: true }),
  financeGetAccountsOverview: () => Promise.resolve({ accounts: COIN_ACCOUNTS, totalArs: 0, totalUsd: 0 }),
  financeGetUpcoming: () => Promise.resolve(COIN_UPCOMING),
  financeGetValuedView: () => Promise.resolve(null),
  financeGetInflationSeries: () => Promise.resolve({ ok: false, series: null }),
  financeGenerateRecurringForMonth: () => Promise.resolve({ created: 0 }),
  financeGetRecurring: () => Promise.resolve([]),
  financeGetTransactions: () => Promise.resolve(COIN_TX),
  financeGetCategories: () => Promise.resolve(COIN_CATS),
  financeGetCreditCards: () => Promise.resolve([]),
  financeGetCategoryAverages: () => Promise.resolve([]),
  financeGetImportBatches: () => Promise.resolve([]),
  financeUndoImportBatch: () => Promise.resolve({ ok: true, deleted: 0 }),
  financeExportCsv: () => Promise.resolve({ canceled: true }),
  dollarGetRates: () => Promise.resolve({ success: false, rates: [] }),
};

// ── Nutrify ──────────────────────────────────────────────────────────────────

export const NUTRI_LONG_DESC =
  'Milanesa napolitana de ternera con jamón crudo, muzzarella, salsa de tomate casera, ' +
  'papas fritas a la provenzal y ensalada mixta de lechuga, tomate, cebolla y zanahoria rallada';

const MEALS = ['breakfast', 'lunch', 'lunch', 'merienda', 'dinner', 'snack'];

export const NUTRI_FOODS: Row[] = Array.from({ length: 7 }, (_, i) => ({
  id: i + 1,
  date: '2026-06-26',
  time: `${String(7 + i * 2).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
  description: i === 3 ? NUTRI_LONG_DESC : `Comida número ${i + 1} del día`,
  calories: 120 + i * 137,
  source: i % 3 === 0 ? 'ai_estimate' : i % 3 === 1 ? 'manual' : 'favorite',
  frequentFoodId: null,
  aiBreakdown: i === 0 ? JSON.stringify([{ name: 'Avena', calories: 180 }, { name: 'Frutas', calories: 90 }]) : null,
  meal: MEALS[i % MEALS.length],
  proteinG: i % 2 === 0 ? 12 + i : null,
  ...(i === 5 ? { isEvent: 1, eventKcalMin: 1200, eventKcalMax: 1600, calories: 1400 } : {}),
}));

const daysAgo = (n: number) => isoDay(-n);

export const NUTRITION_API: Record<string, unknown> = {
  nutritionGetFoodByDate: async () => NUTRI_FOODS,
  nutritionGetSummary: async () => ({
    date: '2026-06-26', totalCaloriesIn: 3740, bmr: 1760, tdee: 2400, balance: -1740,
    activityLevel: 'moderate', proteinG: 232, carbsG: 431, fatG: 158,
  }),
  nutritionGetDailyMetrics: async () => ({ date: '2026-06-26', steps: 6200, gym: true }),
  nutritionGetFrequentFoods: async () => [
    { id: 1, name: 'Café con leche', calories: 120, timesUsed: 22, proteinG: 6, carbsG: 12, fatG: 5 },
    { id: 2, name: 'Yogur con granola y frutos rojos del bosque', calories: 260, timesUsed: 14, proteinG: 12, carbsG: 34, fatG: 8 },
    { id: 3, name: 'Sandwich de milanesa completo', calories: 720, timesUsed: 7, proteinG: 38, carbsG: 62, fatG: 28 },
  ],
  nutritionGetProfile: async () => ({
    age: 31, sex: 'M', heightCm: 178, initialWeightKg: 80, activityLevel: 'moderate', deficitTargetKcal: 400,
    dateOfBirth: '1995-03-12', weightCheckDay: 1, weightPopupEnabled: 1, mealSchedule: null, dayCutoffHour: 4,
    proteinTargetG: null, carbsTargetG: null, fatTargetG: null,
  }),
  nutritionGetTodayTarget: async () => 2000,
  nutritionIsDayClosed: async () => null,
  nutritionGetFavoriteFoods: async () => [
    { id: 'fav1', description: 'Milanesa napolitana con papas fritas y ensalada', calories: 980, source: 'ai_estimate', proteinG: 48, carbsG: 40, fatG: 32, createdAt: '2026-06-01' },
    { id: 'fav2', description: 'Tostadas con palta', calories: 310, source: 'manual', proteinG: 8, carbsG: 30, fatG: 18, createdAt: '2026-06-07' },
  ],
  nutritionGetMealSchedule: async () => null,
  nutritionGetMacroTargets: async () => ({ proteinG: 150, carbsG: 220, fatG: 60, auto: true }),
  nutritionGetPendingDays: async () => [],
  nutritionShouldAskWeight: async () => ({ shouldAsk: false }),
  nutritionGetRecentLoggedDays: async () => [
    { date: daysAgo(1), meals: 4, calories: 1980 },
    { date: daysAgo(2), meals: 3, calories: 1740 },
  ],
  nutritionGetWeights: async () => [
    { date: daysAgo(18), weightKg: 81.6 }, { date: daysAgo(11), weightKg: 82.1 }, { date: daysAgo(4), weightKg: 80.9 },
  ],
  nutritionGetSummaryRange: async () => Array.from({ length: 14 }, (_, i) => ({
    date: daysAgo(13 - i), totalCaloriesIn: 1700 + (i % 5) * 260, bmr: 1760, tdee: 2400, balance: 0,
    proteinG: 110 + (i % 3) * 18, carbsG: 210 + (i % 4) * 25, fatG: 55 + (i % 3) * 9,
  })),
  nutritionGetStreak: async () => ({ streak: 9, todayPending: true }),
  nutritionGetEventDays: async () => [],
  nutritionSearchHistory: async () => [],
  nutritionGetCachedEstimate: async () => null,
  nutritionCacheEstimate: async () => ({ cached: true }),
  nutritionGetAdaptiveTdee: async () => ({
    tdee: 2280, confidence: 'high', windowDays: 28, sampleDays: 25, weightSamples: 4, intakeAvg: 2000, deltaKg: -1,
  }),
  nutritionRepeatDay: async () => ({ copied: 3 }),
  nutritionCloseDay: async () => ({ success: false, alreadyClosed: false }),
  nutritionGetTodayCalories: async () => 1650,
  nutritionGetWeekCalories: async () => [1800, 2100, 1600, 2400, 1900, 2000, 1650],
};

// ── Cauldron ─────────────────────────────────────────────────────────────────

export const CAULDRON_PRESETS: Row[] = [
  { id: 'p1', name: 'Clásico', workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cyclesBeforeLong: 4, autoStartBreak: 1, autoStartWork: 0, isDefault: 1 },
  { id: 'p2', name: 'Maratón de cierre contable de fin de trimestre', workMinutes: 50, breakMinutes: 10, longBreakMinutes: 30, cyclesBeforeLong: 3, autoStartBreak: 0, autoStartWork: 0, isDefault: 0 },
  { id: 'p3', name: 'Corto', workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10, cyclesBeforeLong: 5, autoStartBreak: 1, autoStartWork: 1, isDefault: 0 },
];

export const CAULDRON_SESSIONS: Row[] = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`, presetId: 'p1', presetName: 'Clásico', sessionType: 'work',
  startedAt: new Date(Date.now() - Math.floor(i / 3) * DAY - i * 3600_000).toISOString(),
  completedAt: new Date(Date.now() - Math.floor(i / 3) * DAY - i * 3600_000 + 25 * 60_000).toISOString(),
  durationMinutes: 25, completed: 1, abandoned: i === 3, retroactive: i === 5, elapsedMinutes: i === 3 ? 9 : null,
  taskId: i % 2 === 0 ? 't1' : null,
  taskName: i % 2 === 0 ? 'Cerrar el balance del trimestre y conciliar las cuentas del estudio' : null,
  projectId: i % 2 === 0 ? 'pr1' : null, projectName: i % 2 === 0 ? 'Estudio contable' : null, projectColor: i % 2 === 0 ? '#7a1e1e' : null,
}));

export const CAULDRON_IDLE = { status: 'idle', remainingMs: 0, totalMs: 0, sessionType: 'work', presetId: 'p1', round: 1, currentCycle: 1, totalCycles: 4 };

export const CAULDRON_RUNNING = {
  status: 'work', remainingMs: 14 * 60_000 + 37_000, totalMs: 25 * 60_000, sessionType: 'work', presetId: 'p1',
  round: 2, currentCycle: 2, totalCycles: 4, taskId: 't1',
  taskName: 'Cerrar el balance del trimestre y conciliar las cuentas del estudio contable de Vicky',
  taskProjectId: 'pr1', taskProjectColor: '#7a1e1e',
};

export function cauldronApi(state: unknown = CAULDRON_IDLE): Record<string, unknown> {
  return {
    cauldronGetPresets: () => Promise.resolve(CAULDRON_PRESETS),
    cauldronGetStats: () => Promise.resolve({ today: 6, week: 23, total: 481, streak: 12, longestStreak: 31, totalMinutes: 12_025 }),
    cauldronGetState: () => Promise.resolve(state),
    cauldronGetSessions: () => Promise.resolve({ sessions: CAULDRON_SESSIONS, hasMore: false }),
    cauldronGetWeeklyFocusTime: () => Promise.resolve([
      { label: 'Lun', value: 125 }, { label: 'Mar', value: 75 }, { label: 'Mié', value: 200 },
      { label: 'Jue', value: 50 }, { label: 'Vie', value: 175 }, { label: 'Sáb', value: 0 }, { label: 'Dom', value: 25 },
    ]),
    cauldronGetInterruptedSession: () => Promise.resolve(null),
    cauldronPause: () => Promise.resolve(CAULDRON_IDLE),
    cauldronStop: () => Promise.resolve(CAULDRON_IDLE),
    cauldronStart: () => Promise.resolve(state),
    cauldronSetSessionTask: () => Promise.resolve(state),
    cauldronGetWeekByProject: () => Promise.resolve([
      { taskId: 't1', taskName: 'Cerrar el balance', projectId: 'pr1', projectName: 'Estudio contable', projectColor: '#7a1e1e', sessions: 9, minutes: 225 },
      { taskId: null, taskName: null, projectId: null, projectName: null, projectColor: null, sessions: 1, minutes: 25 },
    ]),
    cauldronLogPastSession: () => Promise.resolve({ id: 'x', minutes: 30, startedAt: '', completedAt: '' }),
    questsGetTasks: () => Promise.resolve(Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, name: i === 0 ? 'Cerrar el balance del trimestre y conciliar las cuentas del estudio contable de Vicky' : `Misión ${i}`,
      status: 0, projectId: i % 2 === 0 ? 'pr1' : 'pr2',
    }))),
    questsGetProjects: () => Promise.resolve([
      { id: 'pr1', name: 'Estudio contable', color: '#7a1e1e' },
      { id: 'pr2', name: 'Facultad', color: '#556b3c' },
    ]),
    onCauldronTick: () => () => undefined,
    onCauldronSessionEnd: () => () => undefined,
  };
}

export { minutesAgo };
