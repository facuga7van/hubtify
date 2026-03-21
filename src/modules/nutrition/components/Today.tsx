import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../../shared/components/PageHeader';
import CalorieProgressBar from './CalorieProgressBar';
import FoodLogItem from './FoodLogItem';
import NutritionOnboarding from './NutritionOnboarding';
import { getLocalDateString } from '../../../../shared/rpg-engine';

interface FoodEntry {
  id: number; date: string; time: string; description: string;
  calories: number; source: string; frequentFoodId: number | null; aiBreakdown: string | null;
}

interface FrequentFood { id: number; name: string; calories: number; timesUsed: number; }
interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; }
interface DailyMetrics { date: string; steps: number | null; gym: boolean; }

export default function Today() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [date, setDate] = useState(() => getLocalDateString());
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

  // AI Estimation
  const [estimateDesc, setEstimateDesc] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimateResult, setEstimateResult] = useState<{ totalCalories: number; breakdown: string; matches: Array<{ name: string; calories: number }> } | null>(null);

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

  const handleEstimate = async () => {
    if (!estimateDesc.trim() || estimating) return;
    setEstimating(true);
    setEstimateResult(null);
    try {
      const result = await window.api.nutritionEstimate(estimateDesc);
      setEstimateResult(result as typeof estimateResult);
    } catch (err) {
      console.error('Estimation failed:', err);
    } finally {
      setEstimating(false);
    }
  };

  const handleConfirmEstimate = async () => {
    if (!estimateResult) return;
    await window.api.nutritionLogFood({
      date, description: estimateDesc, calories: estimateResult.totalCalories,
      source: 'ai_estimate', aiBreakdown: estimateResult.breakdown,
    });
    await window.api.processRpgEvent({
      type: 'MEAL_LOGGED', moduleId: 'nutrition',
      payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
    });
    setEstimateDesc('');
    setEstimateResult(null);
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


  return (
    <div>
      <PageHeader
        title={t('nutrify.title')}
        subtitle={t('nutrify.subtitle')}
        actions={
          <button className="rpg-button" onClick={() => navigate('/nutrition/dashboard')}
            style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="1" y="7" width="3" height="6"/><rect x="5.5" y="4" width="3" height="9"/><rect x="10" y="1" width="3" height="12"/>
            </svg>
            {' '}{t('nutrify.charts')}
          </button>
        }
      />

      {/* Date navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="rpg-button" onClick={() => goDay(-1)} style={{ padding: '6px 10px' }}>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 1L1 6l5 5M1 6h14"/>
          </svg>
        </button>
        <h3 style={{ textAlign: 'center' }}>{date}</h3>
        <button className="rpg-button" onClick={() => goDay(1)} style={{ padding: '6px 10px' }}>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 1l5 5-5 5M15 6H1"/>
          </svg>
        </button>
      </div>

      <CalorieProgressBar consumed={consumed} target={target} />

      {/* Food log */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('nutrify.foodLog')}</div>
        {foods.length === 0 && <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('nutrify.noFood')}</p>}
        {foods.map((f) => <FoodLogItem key={f.id} entry={f} onDelete={handleDelete} />)}
      </div>

      {/* Manual entry */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('nutrify.logFood')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" placeholder="Description" value={manualDesc}
            onChange={(e) => setManualDesc(e.target.value)} className="rpg-input" style={{ flex: 1 }} />
          <input type="number" placeholder="kcal" value={manualCals}
            onChange={(e) => setManualCals(e.target.value)} className="rpg-input" style={{ width: 80 }}
            onKeyDown={(e) => e.key === 'Enter' && handleManualLog()} />
          <button className="rpg-button" onClick={handleManualLog}>Log</button>
        </div>
      </div>

      {/* AI Estimation */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/>
          </svg>
          {t('nutrify.aiEstimate')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder={t('nutrify.aiPlaceholder')}
            value={estimateDesc}
            onChange={(e) => setEstimateDesc(e.target.value)}
            className="rpg-input"
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && !estimating && handleEstimate()}
          />
          <button className="rpg-button" onClick={handleEstimate} disabled={estimating || !estimateDesc.trim()}>
            {estimating ? t('common.loading') : t('nutrify.estimate')}
          </button>
        </div>

        {estimateResult && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed var(--rpg-gold-dark)', borderRadius: 'var(--rpg-radius)' }}>
            <div style={{ fontFamily: 'Fira Code, monospace', fontSize: '1.2rem', fontWeight: 'bold', marginBottom: 8 }}>
              {estimateResult.totalCalories} kcal
            </div>
            {estimateResult.matches.map((m, i) => (
              <div key={i} style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span>{m.name}</span>
                <span style={{ fontFamily: 'Fira Code, monospace' }}>{m.calories} kcal</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="rpg-button" onClick={() => handleConfirmEstimate()} style={{ flex: 1 }}>
                {t('nutrify.confirmLog')}
              </button>
              <button className="rpg-button" onClick={() => setEstimateResult(null)} style={{ opacity: 0.7 }}>
                {t('questify.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Frequent foods */}
      {frequentFoods.length > 0 && (
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title">{t('nutrify.frequentFoods')}</div>
          <input type="text" placeholder="Search..." value={frequentSearch}
            onChange={(e) => setFrequentSearch(e.target.value)} className="rpg-input" style={{ width: '100%', marginBottom: 8 }} />
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
        <div className="rpg-card-title">{t('nutrify.dailyMetrics')}</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('nutrify.steps')}:
            <input type="number" value={metrics.steps ?? ''} placeholder="0"
              onChange={(e) => handleMetrics('steps', e.target.value ? parseInt(e.target.value) : null)}
              className="rpg-input" style={{ width: 80 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={metrics.gym}
              onChange={(e) => handleMetrics('gym', e.target.checked)} />
            {t('nutrify.gym')}
          </label>
        </div>
      </div>
    </div>
  );
}
