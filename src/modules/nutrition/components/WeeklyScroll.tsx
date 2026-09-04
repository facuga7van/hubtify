import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import HelpBubble from '../../../shared/components/HelpBubble';
import { Scroll, Book, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Checkmark } from '../../../shared/components/icons';
import { sealWeek } from '../weekly-api';
import { weekEndOf } from '../../../../shared/week-report';
import type { WeekReport } from '../../../../shared/week-report';

/** DD/MM — mismo formato que `shortDate` en NutritionCharts.tsx, que no lo exporta. */
function shortDate(dateStr: string): string {
  return dateStr.slice(8, 10) + '/' + dateStr.slice(5, 7);
}

function weekRangeLabel(weekStart: string, weekEnd: string): string {
  return `${shortDate(weekStart)} – ${shortDate(weekEnd)}`;
}

/**
 * El veredicto de una semana: mismos números esté pendiente o ya sellada.
 * `onSeal` presente = pendiente (muestra el botón y el XP en modo "pagaría");
 * ausente = archivo, solo lectura.
 */
function ScrollDetail({
  report,
  onSeal,
  sealing,
}: {
  report: WeekReport;
  onSeal?: () => void;
  sealing?: boolean;
}) {
  const { t } = useTranslation();
  const hasWeight = report.weightStart != null && report.weightEnd != null;
  const weightDelta = hasWeight
    ? Math.round((report.weightEnd! - report.weightStart!) * 10) / 10
    : null;

  return (
    <div className="nutri-scroll-detail">
      <div className="nutri-scroll-stats">
        <div className="nutri-scroll-stat">
          <div className="nutri-scroll-stat-label">
            {t('nutrify.weeklyCompliance', 'Días dentro del objetivo')}
            <HelpBubble
              variant="inline"
              text={t(
                'nutrify.weeklyComplianceHelp',
                'Cuenta los días que cumplieron el objetivo exacto, sin indulto. La racha, en cambio, perdona un día por semana — por eso pueden no coincidir.',
              )}
            />
          </div>
          <div className="nutri-scroll-stat-val">{report.daysCompliant} / 7</div>
        </div>

        <div className="nutri-scroll-stat">
          <div className="nutri-scroll-stat-label">
            {t('nutrify.streak', 'Streak')}
            <HelpBubble variant="inline" text={t('nutrify.weeklyStreakHelp', 'Racha de días cerrados al terminar la semana.')} />
          </div>
          <div className="nutri-scroll-stat-val">
            {report.streakEnd} <span className="nutri-scroll-stat-unit">{t('nutrify.days', 'days')}</span>
          </div>
        </div>

        <div className="nutri-scroll-stat">
          <div className="nutri-scroll-stat-label">{t('nutrify.weeklyAvgIntake', 'Consumo promedio')}</div>
          <div className="nutri-scroll-stat-val">
            {Math.round(report.avgConsumed).toLocaleString()}{' '}
            <span className="nutri-scroll-stat-unit">/ {Math.round(report.avgTarget).toLocaleString()} kcal</span>
          </div>
        </div>

        <div className="nutri-scroll-stat">
          <div className="nutri-scroll-stat-label">{t('nutrify.weeklyWeightDelta', 'Variación de peso')}</div>
          <div className="nutri-scroll-stat-val">
            {hasWeight ? (
              // Sin color: el juicio de valor (subir es bueno/malo) depende del objetivo
              // vigente, y ese objetivo lo conoce la tira de KPIs de NutritionCharts, no
              // este pergamino. Un WeekReport queda sellado con el objetivo de la semana
              // en que se cerró — pintarlo hoy recolorearía una semana pasada con el
              // objetivo de HOY (ej. un aumento de junio se vería "bien" si hoy estás
              // en déficit). La flecha es solo dirección, nunca veredicto.
              <span>
                {weightDelta! > 0 ? (
                  <ArrowUp width={12} height={12} />
                ) : weightDelta! < 0 ? (
                  <ArrowDown width={12} height={12} />
                ) : null}{' '}
                {Math.abs(weightDelta!)} kg
              </span>
            ) : (
              <span className="nutri-scroll-stat-muted">{t('nutrify.weeklyNoWeight', 'Sin pesaje esta semana')}</span>
            )}
          </div>
        </div>

        <div className="nutri-scroll-stat nutri-scroll-stat--wide">
          <div className="nutri-scroll-stat-label">{t('nutrify.weeklyHabits', 'Pasos y gimnasio')}</div>
          <div className="nutri-scroll-stat-val">
            {t('nutrify.weeklyHabitsDetail', '{{steps}} días con pasos, {{gym}} de gimnasio', {
              steps: report.daysSteps,
              gym: report.daysGym,
            })}
          </div>
        </div>
      </div>

      <div className="nutri-scroll-xp-row">
        {report.xpTotal === 0 ? (
          <span className="nutri-scroll-stat-muted">{t('nutrify.weeklyZeroXp', 'Esta semana no otorgó XP')}</span>
        ) : (
          <span className="nutri-green nutri-scroll-xp-val">
            {onSeal
              ? t('nutrify.weeklyXpPreview', '+{{xp}} XP al sellar', { xp: report.xpTotal })
              : `+${report.xpTotal} XP`}
          </span>
        )}
      </div>

      {onSeal && (
        <button type="button" className="rpg-button nutri-scroll-seal-btn" disabled={sealing} onClick={onSeal}>
          {sealing ? t('common.loading', 'Cargando...') : t('nutrify.weeklySeal', 'Sellar la Semana')}
        </button>
      )}

      {report.sealed && report.closedAt && (
        <div className="nutri-scroll-sealed-note">
          <Checkmark width={12} height={12} />{' '}
          {t('nutrify.weeklySealedOn', 'Sellada el {{date}}', { date: shortDate(report.closedAt.slice(0, 10)) })}
        </div>
      )}
    </div>
  );
}

/**
 * El pergamino semanal: un ritual de cierre por encima de los gráficos del
 * Códice. Pendientes = pergamino lacrado que se despliega y se sella; selladas
 * = archivo de solo lectura.
 *
 * Sin datos (ni pendientes ni archivo) no pinta nada — no es un hueco vacío
 * que llenar, es un momento que todavía no llegó.
 */
export default function WeeklyScroll() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [pendingWeeks, setPendingWeeks] = useState<string[]>([]);
  const [closedWeeks, setClosedWeeks] = useState<WeekReport[]>([]);
  const [reportCache, setReportCache] = useState<Record<string, WeekReport>>({});
  const [expandedPending, setExpandedPending] = useState<string | null>(null);
  const [expandedClosed, setExpandedClosed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sealing, setSealing] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([window.api.nutritionGetPendingWeeks(), window.api.nutritionGetClosedWeeks(10)])
      .then(([pending, closed]) => {
        setPendingWeeks(pending);
        setClosedWeeks(closed);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[Nutrition] WeeklyScroll load error:', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      // Cambiar de cuenta cambia los datos por completo: una preview cacheada
      // de la cuenta anterior no sirve para la nueva.
      setReportCache({});
      load();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);

  const togglePending = async (weekStart: string) => {
    if (expandedPending === weekStart) {
      setExpandedPending(null);
      // Al colapsar se descarta la preview: si algo cambió en esta semana
      // mientras estaba plegada (otro día cerrado, etc.), reabrirla debe
      // pedirla de nuevo en vez de mostrar un XP/promedio que el sello
      // podría no pagar.
      setReportCache((prev) => {
        const { [weekStart]: _discard, ...rest } = prev;
        return rest;
      });
      return;
    }
    setExpandedPending(weekStart);
    if (!reportCache[weekStart]) {
      try {
        const report = await window.api.nutritionGetWeekReport(weekStart);
        if (report) setReportCache((prev) => ({ ...prev, [weekStart]: report }));
      } catch (err) {
        console.error('[Nutrition] getWeekReport error:', err);
      }
    }
  };

  const toggleClosed = (weekStart: string) => {
    setExpandedClosed((prev) => (prev === weekStart ? null : weekStart));
  };

  const handleSeal = async (weekStart: string) => {
    const ok = await confirm({
      title: t('nutrify.weeklySeal', 'Sellar la Semana'),
      message: t('nutrify.weeklySealConfirm', '¿Sellar esta semana y cobrar tu bonus de constancia? No se puede deshacer.'),
      confirmText: t('nutrify.weeklySeal', 'Sellar la Semana'),
    });
    if (!ok) return;

    setSealing(weekStart);
    try {
      const result = await sealWeek(weekStart);
      if (!result.ok) {
        switch (result.error) {
          case 'Waiting for weigh-in':
            toast({
              type: 'info',
              message: t('nutrify.weeklyWaitingWeighIn', 'Todavía falta tu pesaje de esta semana. Registralo y volvé a intentar.'),
            });
            break;
          case 'Already closed':
            toast({ type: 'info', message: t('nutrify.weeklyAlreadyClosed', 'Esta semana ya estaba sellada.') });
            break;
          case 'No profile':
            toast({ type: 'warning', message: t('nutrify.weeklyNoProfile', 'Necesitás un perfil de nutrición para sellar la semana.') });
            break;
          case 'No closed days':
            toast({ type: 'warning', message: t('nutrify.weeklyNoClosedDays', 'Esta semana no tiene ningún día cerrado.') });
            break;
          case 'Week not finished':
            toast({ type: 'warning', message: t('nutrify.weeklyNotFinished', 'Esta semana todavía no terminó.') });
            break;
        }
        // El estado pudo cambiar bajo nuestros pies (otro dispositivo, sync):
        // recargar deja la lista consistente con lo que el backend acaba de decir.
        load();
        return;
      }

      // El toast SIEMPRE muestra xpGained (lo que pagó el motor), nunca
      // report.xpTotal (lo que el sello declaró) — pueden divergir.
      if (result.rpgFailed) {
        toast({ type: 'warning', message: t('nutrify.weeklyRpgFailed', 'La semana quedó sellada, pero el bonus no se pudo registrar.') });
      } else if (result.xpGained === 0) {
        toast({ type: 'info', message: t('nutrify.weeklyZeroXp', 'Esta semana no otorgó XP') });
      } else {
        toast({ type: 'xp', message: `+${result.xpGained} XP` });
      }

      setExpandedPending(null);
      window.dispatchEvent(new Event('rpg:statsChanged'));
      load();
    } catch (err) {
      console.error('[Nutrition] sealWeek error:', err);
      toast({ type: 'warning', message: t('nutrify.weeklySealError', 'No se pudo sellar la semana') });
    } finally {
      setSealing(null);
    }
  };

  if (loading) return null;
  if (pendingWeeks.length === 0 && closedWeeks.length === 0) return null;

  return (
    <>
      {pendingWeeks.length > 0 && (
        <div className="nutri-card medieval nutri-scroll-card">
          <h3 className="nutri-card-title">
            <span className="t-ico"><Scroll width={18} height={18} /></span>{' '}
            {t('nutrify.weeklyTitle', 'Pergamino Semanal')}
          </h3>
          <div className="nutri-scroll-list">
            {pendingWeeks.map((weekStart) => {
              const isExpanded = expandedPending === weekStart;
              const report = reportCache[weekStart];
              return (
                <div key={weekStart} className="nutri-scroll-item nutri-scroll-item--pending">
                  <button
                    type="button"
                    className="nutri-scroll-item-head"
                    onClick={() => togglePending(weekStart)}
                    aria-expanded={isExpanded}
                  >
                    <span className="nutri-scroll-item-range">{weekRangeLabel(weekStart, weekEndOf(weekStart))}</span>
                    {isExpanded ? <ChevronUp width={14} height={14} /> : <ChevronDown width={14} height={14} />}
                  </button>
                  {isExpanded &&
                    (report ? (
                      <ScrollDetail report={report} onSeal={() => handleSeal(weekStart)} sealing={sealing === weekStart} />
                    ) : (
                      <div className="nutri-scroll-loading">{t('common.loading', 'Cargando...')}</div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {closedWeeks.length > 0 && (
        <div className="nutri-card medieval nutri-scroll-card">
          <h3 className="nutri-card-title">
            <span className="t-ico"><Book width={18} height={18} /></span>{' '}
            {t('nutrify.weeklyArchive', 'Archivo de Semanas Selladas')}
          </h3>
          <div className="nutri-scroll-list">
            {closedWeeks.map((report) => {
              const isExpanded = expandedClosed === report.weekStart;
              return (
                <div key={report.weekStart} className="nutri-scroll-item">
                  <button
                    type="button"
                    className="nutri-scroll-item-head"
                    onClick={() => toggleClosed(report.weekStart)}
                    aria-expanded={isExpanded}
                  >
                    <span className="nutri-scroll-item-range">{weekRangeLabel(report.weekStart, report.weekEnd)}</span>
                    <span className="nutri-scroll-item-xp">+{report.xpTotal} XP</span>
                    {isExpanded ? <ChevronUp width={14} height={14} /> : <ChevronDown width={14} height={14} />}
                  </button>
                  {isExpanded && <ScrollDetail report={report} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
