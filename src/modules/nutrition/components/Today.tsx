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

interface EstimationMatch { name: string; calories: number; source: string; }
interface EstimationResult {
  totalCalories: number;
  breakdown: string;
  matches: EstimationMatch[];
  hasAiFallback: boolean;
}

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

  // Unified food input
  const [foodInput, setFoodInput] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimation, setEstimation] = useState<EstimationResult | null>(null);
  const [editCalories, setEditCalories] = useState('');
  const [frequentSearch, setFrequentSearch] = useState('');
  const [logMessage, setLogMessage] = useState('');

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

  // ── Unified estimation flow ──────────────────────
  const handleEstimate = async () => {
    if (!foodInput.trim() || estimating) return;
    setEstimating(true);
    setEstimation(null);
    try {
      const result = await window.api.nutritionEstimate(foodInput.trim());
      const est = result as EstimationResult;
      setEstimation(est);
      setEditCalories(String(est.totalCalories));
    } catch (err) {
      console.error('Estimation failed:', err);
    } finally {
      setEstimating(false);
    }
  };

  const handleConfirmEstimation = async () => {
    if (!estimation) return;
    const calories = parseInt(editCalories) || estimation.totalCalories;

    // Log the food
    await window.api.nutritionLogFood({
      date,
      description: foodInput.trim(),
      calories,
      source: estimation.hasAiFallback ? 'ai_estimate' : 'frequent',
      aiBreakdown: estimation.breakdown,
    });

    // Learn food for next time (save per-unit calories to local DB)
    try {
      await window.api.nutritionLearnFood({
        description: foodInput.trim(),
        calories,
        breakdown: estimation.breakdown,
      });
    } catch { /* best effort */ }

    // RPG event
    await window.api.processRpgEvent({
      type: 'MEAL_LOGGED', moduleId: 'nutrition',
      payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
    });

    showToast(`+${calories} kcal`);
    setFoodInput('');
    setEstimation(null);
    setEditCalories('');
    loadData(date);
  };

  // ── Quick log (frequent food) ────────────────────
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
    showToast(`+${food.calories} kcal`);
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

  const showToast = (msg: string) => {
    setLogMessage(msg);
    setTimeout(() => setLogMessage(''), 2000);
  };

  if (hasProfile === null) return <div style={{ padding: 24, opacity: 0.5 }}>{t('common.loading')}</div>;
  if (!hasProfile) return <NutritionOnboarding onComplete={() => loadData(date)} />;

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button className="rpg-button" onClick={() => goDay(-1)} style={{ padding: '6px 10px' }}>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 1L1 6l5 5M1 6h14"/>
          </svg>
        </button>
        <button className="rpg-button" onClick={() => setDate(getLocalDateString())}
          style={{ padding: '4px 8px', fontSize: '0.75rem', opacity: date === getLocalDateString() ? 0.5 : 1 }}>
          {t('nutrify.today')}
        </button>
        <h3 style={{ flex: 1, textAlign: 'center' }}>{date}</h3>
        <button className="rpg-button" onClick={() => goDay(1)} style={{ padding: '6px 10px' }}>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 1l5 5-5 5M15 6H1"/>
          </svg>
        </button>
      </div>

      <CalorieProgressBar consumed={consumed} target={target} />

      {/* ── Unified food input ──────────────────────── */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1c-1 2-4 4-4 7a4 4 0 008 0c0-3-3-5-4-7z"/>
          </svg>
          {t('nutrify.logFood')}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder={t('nutrify.foodInputPlaceholder')}
            value={foodInput}
            onChange={(e) => setFoodInput(e.target.value)}
            className="rpg-input"
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && !estimating && handleEstimate()}
          />
          <button className="rpg-button" onClick={handleEstimate}
            disabled={estimating || !foodInput.trim()}>
            {estimating ? t('common.loading') : t('nutrify.estimate')}
          </button>
        </div>

        {/* Estimation result */}
        {estimation && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed var(--rpg-gold-dark)', borderRadius: 'var(--rpg-radius)', background: 'rgba(201,168,76,0.05)' }}>
            {/* Match breakdown */}
            {estimation.matches.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {estimation.matches.map((m, i) => (
                  <div key={i} style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--rpg-parchment-dark)' }}>
                    <span>
                      {m.name}
                      {m.source === 'ai' && (
                        <span style={{ fontSize: '0.7rem', opacity: 0.5, marginLeft: 4 }}>(IA)</span>
                      )}
                    </span>
                    <span style={{ fontFamily: 'Fira Code, monospace' }}>{m.calories} kcal</span>
                  </div>
                ))}
              </div>
            )}

            {/* Editable total */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.9rem' }}>{t('nutrify.totalCalories')}:</span>
              <input
                type="number"
                value={editCalories}
                onChange={(e) => setEditCalories(e.target.value)}
                className="rpg-input"
                style={{ width: 80, fontFamily: 'Fira Code, monospace', fontWeight: 'bold', fontSize: '1rem', textAlign: 'center' }}
              />
              <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>kcal</span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="rpg-button" onClick={handleConfirmEstimation} style={{ flex: 1 }}>
                {t('nutrify.confirmLog')}
              </button>
              <button className="rpg-button" onClick={() => { setEstimation(null); setEditCalories(''); }}
                style={{ opacity: 0.6 }}>
                {t('questify.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Food log */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('nutrify.foodLog')}</div>
        {foods.length === 0 && <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('nutrify.noFood')}</p>}
        {foods.map((f) => <FoodLogItem key={f.id} entry={f} onDelete={handleDelete} onUpdate={async (id, fields) => {
          await window.api.nutritionUpdateFood(id, fields);
          loadData(date);
        }} />)}
      </div>

      {/* Frequent foods */}
      {frequentFoods.length > 0 && (
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title">{t('nutrify.frequentFoods')}</div>
          <input type="text" placeholder={t('common.search')} value={frequentSearch}
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

      {/* Log confirmation toast */}
      {logMessage && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, padding: '8px 16px',
          background: 'var(--rpg-wood)', color: 'var(--rpg-gold-light)',
          border: '1px solid var(--rpg-gold)', borderRadius: 'var(--rpg-radius)',
          fontFamily: 'Fira Code, monospace', fontSize: '0.9rem',
          animation: 'contentFadeIn 0.2s ease', zIndex: 1000,
          boxShadow: 'var(--rpg-shadow)',
        }}>
          {logMessage}
        </div>
      )}
    </div>
  );
}
