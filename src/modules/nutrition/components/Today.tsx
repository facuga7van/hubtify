import { useState, useEffect, useCallback } from 'react';
import CalorieProgressBar from './CalorieProgressBar';
import FoodLogItem from './FoodLogItem';
import NutritionOnboarding from './NutritionOnboarding';

interface FoodEntry {
  id: number; date: string; time: string; description: string;
  calories: number; source: string; frequentFoodId: number | null; aiBreakdown: string | null;
}

interface FrequentFood { id: number; name: string; calories: number; timesUsed: number; }
interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; }
interface DailyMetrics { date: string; steps: number | null; gym: boolean; }

export default function Today() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [metrics, setMetrics] = useState<DailyMetrics>({ date: '', steps: null, gym: false });
  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [target, setTarget] = useState(0);

  // Manual entry
  const [manualDesc, setManualDesc] = useState('');
  const [manualCals, setManualCals] = useState('');
  const [frequentSearch, setFrequentSearch] = useState('');

  const loadData = useCallback(async (d: string) => {
    const [foodList, sum, met, freq, prof, tgt] = await Promise.all([
      window.api.nutritionGetFoodByDate(d),
      window.api.nutritionGetSummary(d),
      window.api.nutritionGetDailyMetrics(d),
      window.api.nutritionGetFrequentFoods(),
      window.api.nutritionGetProfile(),
      window.api.nutritionGetTodayTarget(),
    ]);
    setFoods(foodList as FoodEntry[]);
    setSummary(sum as DailySummary | null);
    setMetrics(met as DailyMetrics);
    setFrequentFoods(freq as FrequentFood[]);
    setHasProfile(!!prof);
    setTarget(tgt as number ?? 0);
  }, []);

  useEffect(() => { loadData(date); }, [date, loadData]);

  const goDay = (offset: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + offset);
    setDate(d.toLocaleDateString('en-CA'));
  };

  const handleManualLog = async () => {
    if (!manualDesc.trim() || !manualCals) return;
    await window.api.nutritionLogFood({
      date, description: manualDesc.trim(), calories: parseInt(manualCals), source: 'manual',
    });

    // Emit RPG event
    await window.api.processRpgEvent({
      type: 'MEAL_LOGGED', moduleId: 'nutrition',
      payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
    });

    setManualDesc(''); setManualCals('');
    loadData(date);
  };

  const handleLogFrequent = async (food: FrequentFood) => {
    await window.api.nutritionLogFood({
      date, description: food.name, calories: food.calories, source: 'frequent',
      frequentFoodId: food.id,
    });
    await window.api.nutritionIncrementFrequentUsage(food.id);
    await window.api.processRpgEvent({
      type: 'MEAL_LOGGED', moduleId: 'nutrition',
      payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
    });
    loadData(date);
  };

  const handleDelete = async (id: number) => {
    await window.api.nutritionDeleteFood(id);
    loadData(date);
  };

  const handleMetrics = async (field: string, value: unknown) => {
    const updated = { ...metrics, [field]: value, date };
    await window.api.nutritionSaveDailyMetrics(updated);
    loadData(date);
  };

  if (hasProfile === null) return <div style={{ padding: 24, opacity: 0.5 }}>Loading...</div>;

  // Show onboarding inline if no profile
  if (!hasProfile) {
    return <NutritionOnboarding onComplete={() => loadData(date)} />;
  }

  const consumed = summary?.totalCaloriesIn ?? foods.reduce((s, f) => s + f.calories, 0);
  const filteredFrequent = frequentFoods.filter((f) =>
    !frequentSearch || f.name.toLowerCase().includes(frequentSearch.toLowerCase())
  );

  const inputStyle = {
    padding: '6px 10px', border: '1px solid var(--rpg-wood)',
    borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-parchment)',
    fontFamily: 'inherit', fontSize: '0.9rem',
  };

  return (
    <div>
      {/* Date navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="rpg-button" onClick={() => goDay(-1)}>&larr;</button>
        <h3 style={{ flex: 1, textAlign: 'center' }}>{date}</h3>
        <button className="rpg-button" onClick={() => goDay(1)}>&rarr;</button>
      </div>

      <CalorieProgressBar consumed={consumed} target={target} />

      {/* Food log */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">Food Log</div>
        {foods.length === 0 && <p style={{ opacity: 0.5, fontStyle: 'italic' }}>No food logged yet</p>}
        {foods.map((f) => <FoodLogItem key={f.id} entry={f} onDelete={handleDelete} />)}
      </div>

      {/* Manual entry */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">Log Food</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="Description" value={manualDesc}
            onChange={(e) => setManualDesc(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          <input type="number" placeholder="kcal" value={manualCals}
            onChange={(e) => setManualCals(e.target.value)} style={{ ...inputStyle, width: 80 }}
            onKeyDown={(e) => e.key === 'Enter' && handleManualLog()} />
          <button className="rpg-button" onClick={handleManualLog}>Log</button>
        </div>
      </div>

      {/* Frequent foods */}
      {frequentFoods.length > 0 && (
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title">Frequent Foods</div>
          <input type="text" placeholder="Search..." value={frequentSearch}
            onChange={(e) => setFrequentSearch(e.target.value)} style={{ ...inputStyle, width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {filteredFrequent.slice(0, 12).map((f) => (
              <button key={f.id} className="rpg-button" onClick={() => handleLogFrequent(f)}
                style={{ fontSize: '0.8rem', padding: '4px 8px' }}>
                {f.name} ({f.calories})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Daily metrics */}
      <div className="rpg-card">
        <div className="rpg-card-title">Daily Metrics</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Steps:
            <input type="number" value={metrics.steps ?? ''} placeholder="0"
              onChange={(e) => handleMetrics('steps', e.target.value ? parseInt(e.target.value) : null)}
              style={{ ...inputStyle, width: 80 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={metrics.gym}
              onChange={(e) => handleMetrics('gym', e.target.checked)} />
            Gym
          </label>
        </div>
      </div>
    </div>
  );
}
