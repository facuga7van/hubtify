import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Tick } from '../../../shared/components/codex';
import Skeleton from '../../../shared/components/Skeleton';
import ErrorState from '../../../shared/components/ErrorState';
import { useToast } from '../../../shared/components/useToast';
import type { HabitWithStreak } from '../types';
import { processHabitCheck, isHabitSettledToday, isHabitRelevantToday } from '../utils';
import WidgetQuickCreate from '../../../hub/widgets/WidgetQuickCreate';
import { subscribeQuickCreate, revealWidget } from '../../../hub/widgets/quick-create';

const MAX_WIDGET_HABITS = 8;

export default function HabitsDashboardWidget() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [allHabits, setAllHabits] = useState<HabitWithStreak[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Un fallo NO es un vacío. Esto era `console.error` + `finally setLoading` y
   * después caía en el hueco de «Sin hábitos configurados» con su botón «Creá
   * tu primer hábito»: la app le decía al usuario que no tenía rituales cuando
   * lo que había pasado es que la consulta se cayó, e invitaba a resolver un
   * problema inexistente. Ahora el hueco dice cuál de las dos cosas pasó.
   */
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const checkingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.questsGetHabits();
      setAllHabits(result as HabitWithStreak[]);
      setLoadError(false);
    } catch (e) {
      console.error('HabitsDashboardWidget load error', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('sync:questsUpdated', handler);
    window.addEventListener('quests:dataChanged', handler);
    return () => {
      window.removeEventListener('sync:questsUpdated', handler);
      window.removeEventListener('quests:dataChanged', handler);
    };
  }, [loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadData]);

  // Creating a habit used to require /quests → a tab that is not the default →
  // a section hidden behind it. Three walls for one text field.
  useEffect(() => subscribeQuickCreate('habit', () => {
    setCreating(true);
    revealWidget(rootRef.current);
  }), []);

  /**
   * Daily is the frequency that needs no explanation; the rest is editable.
   *
   * `timesPerWeek: 1`, no 7: el mismo gesto («creá un ritual diario») escribía
   * `times_per_week` distinto según por dónde entraras — 7 acá, 1 en el
   * formulario completo (`HabitTracker.tsx:246`). En la base real se ve el
   * cicatriz: **18 hábitos diarios con 1 y 3 con 7**, y los 3 son exactamente
   * los que salieron de este widget.
   *
   * Gana el 1 y no el 7 por tres razones, en este orden: (a) `computeHabits`
   * IGNORA `times_per_week` en la rama `daily` —la meta diaria es 1 por
   * definición—, así que el 7 nunca significó nada y sólo esperaba a hacer daño;
   * (b) el daño llega al convertirlo a semanal, porque `HabitTracker` precarga
   * el stepper con `h.timesPerWeek` y el ritual pasa a pedir 7 días por semana
   * sin que nadie lo haya pedido; (c) el formulario completo es la fuente de
   * verdad y ya escribía 1, igual que el `weeklyTarget()` que clampea al leer.
   */
  const handleQuickCreate = useCallback(async (name: string) => {
    await window.api.questsAddHabit({ name, frequency: 'daily', timesPerWeek: 1 });
    setCreating(false);
    await loadData();
    window.dispatchEvent(new Event('quests:dataChanged'));
    toast({ type: 'success', message: t('questify.habitCreated', 'Ritual anotado') });
  }, [loadData, toast, t]);

  const isSettledToday = isHabitSettledToday;
  // A Mon/Wed/Fri habit on a Tuesday is not today business: showing it unticked
  // invents a debt and quietly drags the "3/5 hoy" counter down every Tuesday.
  const habits = allHabits.filter(isHabitRelevantToday);

  const handleCheck = useCallback(async (habitId: string) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      await processHabitCheck(habitId, habits, { toast, t });
      await loadData();
    } finally {
      checkingRef.current = false;
    }
  }, [habits, loadData, toast, t]);

  /* Era `return null`: la tarjeta del tablero se esfumaba entera mientras
     cargaba y volvía a aparecer de golpe. Un esqueleto ocupa el mismo lugar que
     va a ocupar la lista. */
  if (loading && allHabits.length === 0) {
    return <Skeleton variant="line" count={3} />;
  }

  if (loadError) {
    return (
      <ErrorState
        compact
        message={t('questify.habitsLoadFailed', 'No se pudieron leer tus rituales.')}
        onRetry={loadData}
      />
    );
  }

  if (allHabits.length === 0 || habits.length === 0) {
    return (
      <div ref={rootRef}>
        <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', fontStyle: 'italic', margin: '4px 0' }}>
          {allHabits.length === 0
            ? t('questify.noHabits', 'Sin rituales configurados')
            : t('questify.noHabitsToday', 'Ningun ritual toca hoy')}
        </p>
        {creating ? (
          <WidgetQuickCreate
            placeholder={t('questify.widgetHabitPlaceholder', 'Tomar agua')}
            onSubmit={handleQuickCreate}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button type="button" className="widget-empty-cta" onClick={() => setCreating(true)}>
            + {t('questify.widgetCreateHabit', 'Creá tu primer ritual')}
          </button>
        )}
      </div>
    );
  }

  const checkedCount = habits.filter(h => isSettledToday(h)).length;
  // Same cap as the tasks widget — an unbounded list turned this card into a
  // permanent scroll well once you had a dozen habits.
  const displayHabits = habits.slice(0, MAX_WIDGET_HABITS);

  return (
    <div ref={rootRef}>
      {creating && (
        <WidgetQuickCreate
          placeholder={t('questify.widgetHabitPlaceholder', 'Tomar agua')}
          onSubmit={handleQuickCreate}
          onCancel={() => setCreating(false)}
        />
      )}
      <div className="widget-list-flow">
        {displayHabits.map((h) => (
          <div
            key={h.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 0',
              fontSize: 'var(--fs-label)',
              color: isSettledToday(h) ? 'var(--ink-faded)' : 'var(--ink)',
            }}
          >
            <Tick
              checked={isSettledToday(h)}
              onChange={() => handleCheck(h.id)}
              label={h.name}
            />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                textDecoration: isSettledToday(h) ? 'line-through' : undefined,
                opacity: isSettledToday(h) ? 0.6 : 1,
              }}
              title={h.name}
            >
              {h.name}
            </span>
            {h.streak > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  fontSize: 'var(--fs-label)',
                  color: h.streak >= 10 ? 'var(--gold)' : 'var(--ink-faded)',
                  // 'Cinzel' no se carga en ningún lado (theme.css importa
                  // UnifrakturCook, IM Fell English/SC, Cormorant y Fira Code):
                  // el contador de racha caía a un serif genérico del sistema,
                  // fuera del tono del resto. Es un número: va en Fira Code.
                  fontFamily: "'Fira Code', ui-monospace, monospace",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 14 14" fill={h.streak >= 10 ? 'var(--gold)' : 'var(--rubric)'} style={{ flexShrink: 0 }}>
                  <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
                </svg>
                {h.streak}d
              </span>
            )}
          </div>
        ))}
        {/* Was a dead <span>; its twin in the tasks widget navigates. */}
        {habits.length > MAX_WIDGET_HABITS && (
          <button type="button" className="qb-hand widget-more-link" onClick={() => navigate('/quests')}>
            +{habits.length - MAX_WIDGET_HABITS} {t('questify.showMore', 'más')}
          </button>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(74,55,32,.2)',
          fontSize: 'var(--fs-label)',
        }}
      >
        <span className="qb-hand">
          <b className="qb-numeral" style={{ fontSize: 'var(--fs-sub)' }}>{checkedCount}</b>/{habits.length}{' '}
          {t('questify.habitsToday', 'hoy')}
        </span>
      </div>
    </div>
  );
}
