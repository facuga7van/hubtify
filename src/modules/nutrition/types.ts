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
