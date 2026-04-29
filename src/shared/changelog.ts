export interface ChangelogChange {
  category: 'feat' | 'fix' | 'refactor' | 'chore';
  scope?: string;
  text: string;
}

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  changes: ChangelogChange[];
}

export const changelog: ChangelogEntry[] = [
  // newest first
  {
    version: '0.6.4',
    date: '2026-04-29',
    changes: [
      { category: 'feat', text: 'Changelog modal in settings page' },
      { category: 'feat', scope: 'ci', text: 'Release workflow with changelog extraction in release notes' },
      { category: 'fix', scope: 'notifications', text: 'Use local timezone instead of UTC for date comparisons' },
      { category: 'fix', scope: 'notifications', text: 'Grace period logic for unclosed nutrition days' },
      { category: 'chore', scope: 'updater', text: 'Point releases and updater to hubtify-releases repo' },
    ],
  },
  {
    version: '0.6.3',
    date: '2026-04-28',
    changes: [
      { category: 'fix', scope: 'sync', text: 'Sync data loss fixes' },
      { category: 'fix', scope: 'auth', text: 'Forgot password flow' },
      { category: 'fix', scope: 'ui', text: 'UI polish improvements' },
    ],
  },
  {
    version: '0.6.2',
    date: '2026-04-27',
    changes: [
      { category: 'feat', text: 'Feedback system' },
      { category: 'fix', scope: 'nutrify', text: 'Meal picker z-index fix' },
    ],
  },
  {
    version: '0.6.1',
    date: '2026-04-27',
    changes: [
      { category: 'fix', scope: 'ui', text: 'HelpBubble hover behavior' },
      { category: 'fix', scope: 'ui', text: 'Sidebar animations' },
      { category: 'fix', scope: 'ui', text: 'Z-index corrections' },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-04-26',
    changes: [
      { category: 'feat', text: 'Codex UI overhaul' },
      { category: 'feat', scope: 'cauldron', text: 'Pomodoro timer module with RPG theme' },
      { category: 'feat', scope: 'cauldron', text: 'Sound effects for timer events' },
      { category: 'feat', scope: 'notifications', text: 'Notification system with engine, center, and settings' },
      { category: 'feat', scope: 'notifications', text: 'NotificationBell component' },
      { category: 'feat', scope: 'notifications', text: 'NotificationCenter drawer component' },
      { category: 'feat', scope: 'notifications', text: 'Dual notification toggles in settings' },
      { category: 'feat', scope: 'notifications', text: 'Sync handlers and USER_DATA_TABLES entry' },
      { category: 'feat', scope: 'notifications', text: 'IPC handlers and engine lifecycle' },
      { category: 'feat', scope: 'notifications', text: 'Notification engine with evaluators and tests' },
      { category: 'feat', scope: 'notifications', text: 'Notifications table migration' },
      { category: 'feat', scope: 'notifications', text: 'i18n keys for notification center and settings' },
      { category: 'fix', scope: 'ui', text: 'Notification bell inline with player title' },
      { category: 'fix', scope: 'notifications', text: 'Auto-resolve nutri_no_meals when day passes' },
      { category: 'fix', scope: 'notifications', text: 'Credit card closing day calculation at month boundaries' },
      { category: 'fix', scope: 'notifications', text: 'Limit quest_stale to recently active tasks' },
      { category: 'fix', scope: 'notifications', text: 'timeAgo UTC parsing for SQLite dates' },
      { category: 'fix', scope: 'notifications', text: 'Badge count update on dismiss and snooze' },
      { category: 'fix', scope: 'notifications', text: 'Installment auto-resolve check for upcoming window' },
      { category: 'fix', scope: 'notifications', text: 'i18n support for notification engine messages' },
      { category: 'fix', scope: 'notifications', text: 'Dismissed status included in dedup check' },
      { category: 'fix', text: 'Error handling in Dashboard, handleCloseDayConfirm, saveRecurringEdit' },
      { category: 'fix', scope: 'finance', text: 'Remove dead CSS, extract nextMonthFirstDay helper' },
      { category: 'refactor', scope: 'notifications', text: 'Remove deprecated reminders system' },
    ],
  },
  {
    version: '0.5.11',
    date: '2026-04-04',
    changes: [
      { category: 'fix', text: 'Comprehensive QA pass — 65+ bugs fixed across all modules' },
      { category: 'feat', scope: 'finance', text: 'Transaction search by description and category' },
      { category: 'feat', scope: 'finance', text: 'Confirmation dialog before deleting transactions' },
      { category: 'feat', scope: 'finance', text: 'Date and payment method in transaction edit' },
      { category: 'feat', scope: 'finance', text: 'Pending credit card total in dashboard' },
      { category: 'feat', scope: 'finance', text: 'Auto-generate CC statements on dashboard mount' },
      { category: 'feat', scope: 'sync', text: 'Dispatch finance:dataChanged on all finance mutations' },
      { category: 'fix', scope: 'finance', text: 'Shrink projection bars and prevent value overflow in next battles card' },
      { category: 'fix', scope: 'ui', text: 'Preserve scroll position in page flip cover' },
      { category: 'fix', scope: 'sync', text: 'Disable foreign keys during clearUserData to avoid constraint errors' },
      { category: 'fix', scope: 'ui', text: 'Prevent card stretching during page flip by fixing cover dimensions' },
      { category: 'fix', scope: 'finance', text: 'Amount input step changed from 100 to 1' },
      { category: 'fix', scope: 'finance', text: 'RpgNumberInput in StatementDetail pay amount' },
      { category: 'fix', scope: 'finance', text: 'Restore CategorySelect with __manage__ option and CategoryManager' },
      { category: 'fix', scope: 'finance', text: 'Move recurring section below transactions' },
      { category: 'fix', scope: 'finance', text: 'Missing details translation and RpgNumberInput for day inputs' },
    ],
  },
  {
    version: '0.5.10',
    date: '2026-04-02',
    changes: [
      { category: 'feat', scope: 'finance', text: 'CategoryManager component' },
      { category: 'feat', scope: 'finance', text: 'Installment creation from tab, inline editing, and account:switched support' },
      { category: 'feat', scope: 'sync', text: 'Finance subcollection sync and account:switched event dispatch' },
      { category: 'feat', scope: 'finance', text: 'Accordion sections for recurring vs normal transactions' },
      { category: 'feat', scope: 'finance', text: 'Auto-generate recurring on dashboard mount' },
      { category: 'feat', scope: 'finance', text: 'Billing day in recurring form and list' },
      { category: 'feat', scope: 'finance', text: 'Recurring redesign i18n translations' },
      { category: 'feat', scope: 'finance', text: 'Billing day support in recurring IPC handlers' },
      { category: 'feat', scope: 'finance', text: 'Migration v6 for recurring billing_day' },
      { category: 'feat', scope: 'finance', text: 'Toggle for custom last installment with animation' },
      { category: 'feat', scope: 'finance', text: 'Credit card select in installment form' },
      { category: 'feat', scope: 'finance', text: 'CC tracking badge in transaction list' },
      { category: 'feat', scope: 'finance', text: 'Credit cards tab and route' },
      { category: 'feat', scope: 'finance', text: 'CreditCards page with statements view' },
      { category: 'feat', scope: 'finance', text: 'StatementDetail modal component' },
      { category: 'feat', scope: 'finance', text: 'Credit card select in QuickAddForm' },
      { category: 'feat', scope: 'finance', text: 'CreditCardSelect dropdown component' },
      { category: 'feat', scope: 'finance', text: 'CreditCardManager modal component' },
      { category: 'feat', scope: 'finance', text: 'Credit card i18n translations' },
      { category: 'feat', scope: 'finance', text: 'Credit card IPC calls in preload and types' },
      { category: 'feat', scope: 'finance', text: 'Update existing queries for credit card two-layer logic' },
      { category: 'feat', scope: 'finance', text: 'Statement generation and payment IPC handlers' },
      { category: 'fix', scope: 'ui', text: 'PlayerCard, layout, RpgNumberInput, and Toast improvements' },
      { category: 'fix', scope: 'sync', text: 'Missing credit_card_id, impacts_balance, billing_day in sync handlers' },
      { category: 'fix', scope: 'finance', text: 'Replace window.confirm with useConfirm in loan settle' },
      { category: 'fix', scope: 'finance', text: 'Remove incorrect default in isCreditCard check' },
      { category: 'fix', scope: 'finance', text: 'Align impactsBalance type to number for SQLite INTEGER' },
    ],
  },
  {
    version: '0.5.8',
    date: '2026-04-02',
    changes: [
      { category: 'fix', scope: 'updater', text: 'Active check on React mount and delayed passive check' },
    ],
  },
  {
    version: '0.5.6',
    date: '2026-04-02',
    changes: [
      { category: 'fix', scope: 'updater', text: 'Wait for renderer load and debug logs' },
    ],
  },
  {
    version: '0.5.4',
    date: '2026-04-02',
    changes: [
      { category: 'feat', text: 'GSAP animation system, page flip transitions, and unified toasts' },
    ],
  },
  {
    version: '0.5.3',
    date: '2026-03-30',
    changes: [
      { category: 'feat', scope: 'quests', text: 'Loading states, due date categories, and animations' },
      { category: 'feat', scope: 'nutrify', text: 'Toast system, animations, and skeleton loaders' },
      { category: 'feat', scope: 'coinify', text: 'RPG-themed finance module redesign' },
      { category: 'fix', scope: 'nutrify', text: 'Re-check weight popup after sync restores profile' },
    ],
  },
  {
    version: '0.5.2',
    date: '2026-03-29',
    changes: [
      { category: 'feat', scope: 'nutrify', text: 'Weekly balance stat card in nutrition charts' },
      { category: 'fix', scope: 'nutrify', text: 'Reload after sync, remove gym/step fields from UI' },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-03-29',
    changes: [
      { category: 'feat', text: 'Coinify v2 — complete finance module redesign' },
      { category: 'feat', scope: 'finance', text: 'FinanceLayout with internal tab navigation' },
      { category: 'feat', scope: 'finance', text: 'Dashboard page and updated widget' },
      { category: 'feat', scope: 'finance', text: 'Transactions page with quick-add and filters' },
      { category: 'feat', scope: 'finance', text: 'Recurring page with amount history' },
      { category: 'feat', scope: 'finance', text: 'Installments page with projection' },
      { category: 'feat', scope: 'finance', text: 'Loans page with third-party purchases' },
      { category: 'feat', scope: 'finance', text: 'Import page for Galicia VISA PDF' },
      { category: 'feat', scope: 'finance', text: 'Auto-generate recurring transactions on app start' },
      { category: 'feat', scope: 'finance', text: 'Preload bridge with Coinify v2 IPC methods' },
      { category: 'feat', text: 'Subtasks visible in completed tab when expanded' },
      { category: 'fix', scope: 'coinify', text: 'Book-tab nav, loans direction bug, edit validation' },
      { category: 'fix', text: 'Home route showing Finance dashboard instead of Hub dashboard' },
      { category: 'fix', scope: 'character', text: 'Wrap hair/color indices instead of clamping' },
      { category: 'fix', scope: 'nutrify', text: 'Goal-aware status messages in calorie progress bar' },
      { category: 'fix', scope: 'finance', text: 'Enable Coinify in sidebar navigation' },
      { category: 'refactor', scope: 'finance', text: 'Rewrite module definition with new RPG events' },
    ],
  },
  {
    version: '0.4.2',
    date: '2026-03-28',
    changes: [
      { category: 'fix', text: 'Switch cloud function to v1 callable for reliable auth in Electron' },
    ],
  },
  {
    version: '0.4.0',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: 'Gemini API behind Firebase Cloud Function with custom auth errors' },
      { category: 'fix', scope: 'updater', text: 'Auto-updater reliability and error handling' },
      { category: 'fix', text: 'Firebase auth loaded before callable function request' },
    ],
  },
  {
    version: '0.3.4',
    date: '2026-03-28',
    changes: [
      { category: 'fix', text: 'Auto-install update after download, no manual step needed' },
    ],
  },
  {
    version: '0.3.3',
    date: '2026-03-28',
    changes: [
      { category: 'feat', scope: 'ui', text: 'App version displayed in sidebar footer' },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: 'Update popup on app start instead of settings banner' },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: 'In-app auto-updater via GitHub Releases API' },
      { category: 'fix', text: 'Absolute path for packager icon to ensure rcedit embeds it' },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-03-28',
    changes: [
      { category: 'feat', text: 'Gemini API key via environment variable' },
      { category: 'feat', scope: 'nutrify', text: 'Switch from Ollama to Gemini API for calorie estimation' },
      { category: 'feat', scope: 'ui', text: 'RPG-styled Tooltip component for coming soon items' },
      { category: 'fix', scope: 'questify', text: 'Subtask checkbox single-click and completed toggle layout' },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-03-28',
    changes: [
      { category: 'feat', scope: 'ui', text: 'Disable Coinify, add Achievements and Village as coming soon' },
      { category: 'feat', scope: 'sync', text: 'Nutrition bulk export/import and finance income sources' },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-03-27',
    changes: [
      { category: 'feat', text: 'Initial release' },
    ],
  },
];
