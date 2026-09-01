export interface NutritionProfile {
  age: number;
  sex: 'M' | 'F';
  heightCm: number;
  initialWeightKg: number;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active';
  deficitTargetKcal: number;
  dateOfBirth: string;
  weightCheckDay: number;
  weightPopupEnabled: number;
  mealSchedule?: import('../../../shared/meal-utils').MealSchedule | null;
  /** Hour the nutritional day flips (0-23, default 4). 0 = strict midnight. */
  dayCutoffHour?: number;
  /** Macro target overrides in grams; null means "use the auto calculation". */
  proteinTargetG?: number | null;
  carbsTargetG?: number | null;
  fatTargetG?: number | null;
}

export interface FrequentFood {
  id: number;
  name: string;
  calories: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  timesUsed: number;
  createdAt: string;
}

export interface DailyMetrics {
  date: string;
  steps: number | null;
  gym: boolean;
}

export interface WeeklyMetrics {
  date: string;
  weightKg: number | null;
  waistCm: number | null;
}

export interface DailySummary {
  date: string;
  totalCaloriesIn: number;
  bmr: number;
  tdee: number;
  balance: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

export interface MacroTargets {
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** true when the targets came from the auto helper, false when the user overrode them. */
  auto: boolean;
}

export interface EstimationResult {
  totalCalories: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  items: Array<{ name: string; calories: number; proteinG?: number | null; carbsG?: number | null; fatG?: number | null }>;
  aiError?: string;
}
