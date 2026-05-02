import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RingGauge, Rune } from '../../../shared/components/codex';
import { SparklineChart } from '../../../shared/components/charts';
import { useToast } from '../../../shared/components/useToast';
import { estimateNutrition } from '../estimate-service';

export default function NutritionDashboardWidget() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [calories, setCalories] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [weekCalories, setWeekCalories] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Quick-estimate states
  const [showQuickLog, setShowQuickLog] = useState(false);
  const [foodInput, setFoodInput] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimation, setEstimation] = useState<{ totalCalories: number; items: Array<{ name: string; calories: number }> } | null>(null);
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [manualCalories, setManualCalories] = useState('');

  const loadData = useCallback(() => {
    Promise.all([
      window.api.nutritionGetTodayCalories(),
      window.api.nutritionGetTodayTarget(),
      window.api.nutritionGetWeekCalories(),
    ]).then(([c, t, wk]) => {
      setCalories(c);
      setTarget(t);
      setWeekCalories(wk);
      setLoading(false);
    }).catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadData]);

  // ── Quick-estimate handlers ──────────────────────
  const handleEstimate = async () => {
    if (!foodInput.trim() || estimating) return;
    setEstimating(true);
    setEstimation(null);
    try {
      const result = await estimateNutrition(foodInput.trim());
      setEstimation({ totalCalories: result.calories, items: result.items });
    } catch {
      setEstimation(null);
      setShowManualFallback(true);
    } finally {
      setEstimating(false);
    }
  };

  const handleConfirm = async () => {
    if (!estimation) return;
    try {
      await window.api.nutritionLogFood({
        date: new Date().toISOString().slice(0, 10),
        description: foodInput.trim(),
        calories: estimation.totalCalories,
        source: 'ai_estimate',
        aiBreakdown: estimation.items.length > 1 ? JSON.stringify(estimation.items) : undefined,
      });
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED',
        moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 },
        timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: `+${estimation.totalCalories} kcal` });
      setFoodInput('');
      setEstimation(null);
      setShowQuickLog(false);
      loadData();
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } catch {
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar') });
    }
  };

  const handleDismiss = () => {
    setEstimation(null);
    setFoodInput('');
    setShowQuickLog(false);
  };

  if (loading)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 10px' }}>
        <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'rgba(74,55,32,.1)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 10, background: 'rgba(74,55,32,.1)', marginBottom: 4 }} />
          <div style={{ height: 10, background: 'rgba(74,55,32,.08)', width: '70%' }} />
        </div>
      </div>
    );

  if (loadError)
    return (
      <p style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
        {t('common.somethingWentWrong', 'Something went wrong')}
      </p>
    );

  const effectiveTarget = target && target > 0 ? target : 2000;
  const pct = Math.round((calories / effectiveTarget) * 100);
  const isSetup = target && target > 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 10px' }}>
        <RingGauge
          value={calories}
          max={effectiveTarget}
          size={68}
          label="kcal"
        />
        <div style={{ flex: 1 }}>
          {isSetup ? (
            <>
              <div style={{ fontSize: 'var(--fs-label)', color: 'var(--ink)' }}>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-nav)' }}>{calories}</span>
                <span className="qb-hand" style={{ marginLeft: 4 }}>{t('nutrify.ofTarget', 'de')} {effectiveTarget} kcal</span>
              </div>
              <div className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginTop: 2 }}>
                {pct}% {t('nutrify.ofDailyTarget', 'del objetivo diario')}
              </div>
            </>
          ) : (
            <div className="nutri-empty" style={{ textAlign: 'center', padding: 16 }}>
              <p style={{ color: 'var(--ink-faded)', fontStyle: 'italic', margin: 0 }}>
                {t('nutrify.setupRequired', 'Configurá tu perfil nutricional')}
              </p>
            </div>
          )}
        </div>
        {weekCalories.length >= 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <SparklineChart data={weekCalories} width={80} height={24} color="var(--rpg-hp-red)" showArea />
            <span className="qb-hand" style={{ fontSize: 'calc(var(--fs-label) * 0.85)', color: 'var(--ink-faded)' }}>
              {t('nutrify.weekTrend', '7d trend')}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(74,55,32,.2)',
          fontSize: 'var(--fs-label)',
        }}
      >
        <span className="qb-hand">
          {calories > 0 ? `${calories} ${t('nutrify.kcalLogged', 'kcal registradas')}` : t('nutrify.noFood', 'Sin comidas registradas')}
        </span>
        {isSetup && (
          <Rune tone={pct >= 80 && pct <= 120 ? 'sage' : pct > 120 ? 'rubric' : undefined}>
            {pct >= 80 && pct <= 120
              ? t('nutrify.balanceFavorable', 'balance favorable')
              : pct > 120
                ? t('nutrify.excess', 'exceso')
                : t('nutrify.inProgress', 'en curso')}
          </Rune>
        )}
      </div>

      {/* Quick-estimate toggle */}
      <div className="nutri-dash-quick-toggle">
        <button
          className="rpg-button nutri-dash-quick-btn"
          onClick={() => { setShowQuickLog(prev => !prev); if (showQuickLog) { setEstimation(null); setFoodInput(''); } }}
        >
          {showQuickLog ? t('nutrify.closeEstimate', 'Cerrar') : t('nutrify.estimate', 'Estimar')}
        </button>
      </div>

      {/* Quick-estimate form */}
      {showQuickLog && (
        <div className="nutri-dash-quick-form">
          <div className="nutri-dash-quick-input-row">
            <input
              className="rpg-input nutri-dash-quick-input"
              type="text"
              placeholder={t('nutrify.estimatePlaceholder', 'milanesa con pure...')}
              value={foodInput}
              onChange={e => setFoodInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleEstimate(); }}
              disabled={estimating}
            />
            <button
              className="rpg-button nutri-dash-quick-submit"
              onClick={handleEstimate}
              disabled={estimating || !foodInput.trim()}
            >
              {estimating ? t('nutrify.estimating', 'Estimando...') : t('nutrify.estimate', 'Estimar')}
            </button>
          </div>

          {/* Estimation result */}
          {estimation && (
            <div className="nutri-dash-quick-result">
              {estimation.items.length > 1 && (
                <ul className="nutri-dash-quick-items">
                  {estimation.items.map((item, i) => (
                    <li key={i} className="nutri-dash-quick-item">
                      <span className="qb-hand">{item.name}</span>
                      <span className="qb-numeral">{item.calories} kcal</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="nutri-dash-quick-total">
                <span className="qb-hand">{t('nutrify.total', 'Total')}</span>
                <span className="qb-numeral">{estimation.totalCalories} kcal</span>
              </div>
              <div className="nutri-dash-quick-actions">
                <button className="rpg-button nutri-dash-quick-confirm" onClick={handleConfirm}>
                  {t('nutrify.confirm', 'Confirmar')}
                </button>
                <button className="nutri-dash-quick-cancel" onClick={handleDismiss}>
                  {t('common.cancel', 'Cancelar')}
                </button>
              </div>
            </div>
          )}

          {/* Manual fallback on AI error */}
          {showManualFallback && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                className="rpg-input"
                type="number"
                placeholder="kcal"
                value={manualCalories}
                onChange={(e) => setManualCalories(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="rpg-button"
                disabled={!manualCalories || Number(manualCalories) <= 0}
                onClick={async () => {
                  const cal = Number(manualCalories);
                  await window.api.nutritionLogFood({
                    date: new Date().toISOString().slice(0, 10),
                    description: foodInput.trim() || t('nutrify.manualEntry', 'Entrada manual'),
                    calories: cal,
                    source: 'manual',
                  });
                  const rpgResult = await window.api.processRpgEvent({
                    type: 'MEAL_LOGGED',
                    moduleId: 'nutrition',
                    payload: { xp: 5, hp: 0, calories: cal },
                    timestamp: Date.now(),
                  });
                  toast({ type: 'xp', message: `+${rpgResult.xpGained} XP` });
                  window.dispatchEvent(new Event('rpg:statsChanged'));
                  setShowManualFallback(false);
                  setManualCalories('');
                  setFoodInput('');
                  loadData();
                }}
              >
                {t('nutrify.confirm', 'Confirmar')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
