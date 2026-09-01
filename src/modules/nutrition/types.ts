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
  /** Objetivo de proteína guardado, o null = auto (peso × 1.6 g/kg). */
  proteinTargetG?: number | null;
  /** Objetivo de proteína ya resuelto por el backend (guardado o peso × 1.6). */
  proteinTargetEffectiveG?: number | null;
}

export interface FrequentFood {
  id: number;
  name: string;
  calories: number;
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
}

export interface EstimationResult {
  totalCalories: number;
  items: Array<{ name: string; calories: number }>;
  aiError?: string;
}
