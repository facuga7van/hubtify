export interface NutritionProfile {
  age: number;
  sex: 'M' | 'F';
  heightCm: number;
  initialWeightKg: number;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active';
  deficitTargetKcal: number;
  gymCalories: number;
  stepCaloriesFactor: number;
}

export interface FoodLogEntry {
  id: number;
  date: string;
  time: string;
  description: string;
  calories: number;
  source: 'ai_estimate' | 'frequent' | 'manual';
  frequentFoodId: number | null;
  aiBreakdown: string | null;
}

export interface FrequentFood {
  id: number;
  name: string;
  calories: number;
  aiBreakdown: string | null;
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
  matches: Array<{ name: string; calories: number; source: 'database' | 'ai' }>;
  breakdown: string;
  hasAiFallback: boolean;
  ollamaMissing: boolean;
  unmatchedTokens: string[];
  aiError?: string;
}
