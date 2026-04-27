export interface TourStep {
  id: string;
  target: string; // data-tour attribute value, will query [data-tour="value"]
  route?: string; // navigate here before showing step
  titleKey: string; // i18n key for title
  descKey: string; // i18n key for description
  position: 'top' | 'bottom' | 'left' | 'right';
}

export const tourSteps: TourStep[] = [
  { id: 'welcome', target: 'welcome', route: '/', titleKey: 'tour.welcome.title', descKey: 'tour.welcome.desc', position: 'bottom' },
  { id: 'sidebar', target: 'sidebar', route: '/', titleKey: 'tour.sidebar.title', descKey: 'tour.sidebar.desc', position: 'right' },
  { id: 'player-card', target: 'player-card', route: '/', titleKey: 'tour.playerCard.title', descKey: 'tour.playerCard.desc', position: 'right' },
  { id: 'quests', target: 'quests', route: '/quests', titleKey: 'tour.quests.title', descKey: 'tour.quests.desc', position: 'bottom' },
  { id: 'quests-add', target: 'quests-add', route: '/quests', titleKey: 'tour.questsAdd.title', descKey: 'tour.questsAdd.desc', position: 'bottom' },
  { id: 'nutrition', target: 'nutrition', route: '/nutrition', titleKey: 'tour.nutrition.title', descKey: 'tour.nutrition.desc', position: 'bottom' },
  { id: 'nutrition-log', target: 'nutrition-log', route: '/nutrition', titleKey: 'tour.nutritionLog.title', descKey: 'tour.nutritionLog.desc', position: 'bottom' },
  { id: 'finance', target: 'finance', route: '/finance', titleKey: 'tour.finance.title', descKey: 'tour.finance.desc', position: 'bottom' },
  { id: 'finance-add', target: 'finance-add', route: '/finance', titleKey: 'tour.financeAdd.title', descKey: 'tour.financeAdd.desc', position: 'top' },
  { id: 'cauldron', target: 'cauldron', route: '/cauldron', titleKey: 'tour.cauldron.title', descKey: 'tour.cauldron.desc', position: 'bottom' },
  { id: 'character', target: 'character', route: '/character', titleKey: 'tour.character.title', descKey: 'tour.character.desc', position: 'bottom' },
  { id: 'settings', target: 'settings', route: '/', titleKey: 'tour.settings.title', descKey: 'tour.settings.desc', position: 'right' },
  { id: 'done', target: 'welcome', route: '/', titleKey: 'tour.done.title', descKey: 'tour.done.desc', position: 'bottom' },
];
