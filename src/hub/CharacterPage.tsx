import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BookPage } from '../shared/components/codex';
import {
  Section,
  Gauge,
  StatBox,
  Banner,
  QBDividerSection,
} from '../shared/components/codex/CodexPrimitives';
import {
  Sword,
  Book,
  Scale,
  Bow,
  Coin,
  Flame,
  Crown,
  Scroll,
  Quill,
  Compass,
} from '../shared/components/icons';
import Tooltip from '../shared/components/Tooltip';
import HelpBubble from '../shared/components/HelpBubble';
import Loading from '../shared/components/Loading';
import Character from './Character';
import { xpThreshold, getTitle, getTitleKey } from '../../shared/rpg-engine';
import { TITLE_THRESHOLDS } from '../../shared/types';
import type { PlayerStats, RpgEventRecord } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import './styles/character.css';

/* ── helpers ─────────────────────────────────────── */

function toRoman(n: number): string {
  if (n <= 0 || n > 3999) return String(n);
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  let remaining = n;
  for (let i = 0; i < vals.length; i++) {
    while (remaining >= vals[i]) {
      result += syms[i];
      remaining -= vals[i];
    }
  }
  return result;
}

function formatNumber(n: number): string {
  return n.toLocaleString('es-ES');
}

const EVENT_ICON_MAP: Record<string, string> = {
  TASK_COMPLETED: '\u2694',
  TASK_UNCOMPLETED: '\u2694',
  SUBTASK_COMPLETED: '\u2694',
  SUBTASK_UNCOMPLETED: '\u2694',
  HABIT_CHECKED: '\u2726',
  HABIT_UNCHECKED: '\u2726',
  MEAL_LOGGED: '\u2020',
  DAY_SUMMARY: '\u2020',
  EXPENSE_LOGGED: '\u2020',
  EXPENSE_TRACKED: '\u2020',
  INCOME_LOGGED: '\u2020',
  LOAN_SETTLED: '\u2020',
  STATEMENT_IMPORTED: '\u2020',
  RECURRING_UPDATED: '\u2020',
  POMODORO_COMPLETED: '\u271A',
  LEVEL_UP: '\u271A',
};

/** Build the title trail from TITLE_THRESHOLDS. */
function buildTitleTrail(currentLevel: number, t: (key: string, fallback: string) => string) {
  const sorted = [...TITLE_THRESHOLDS].reverse();
  const currentKey = getTitleKey(currentLevel);
  return sorted.map(([threshold, key, fallback]) => ({
    level: threshold,
    roman: String(threshold),
    name: t(key, fallback),
    done: currentLevel >= threshold,
    current: key === currentKey,
  }));
}

/** Derive "virtue" stats from player data. These are synthetic
 *  gauges derived from the real stats. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveVirtues(stats: PlayerStats, t: (...args: any[]) => any) {
  // Each virtue maps a real metric to a 0-100 pct scale
  const cap = (v: number, max: number) => Math.min(100, Math.round((v / max) * 100));
  return [
    { name: t('character.virtueStrength', 'Fortaleza'), tip: t('character.virtueStrengthTip', 'Salud actual del héroe (HP)'), value: stats.hp, pct: cap(stats.hp, stats.maxHp), icon: Sword },
    { name: t('character.virtueWisdom', 'Sabiduría'), tip: t('character.virtueWisdomTip', 'Misiones completadas en total'), value: Math.min(stats.totalTasks, 99), pct: cap(stats.totalTasks, 200), icon: Book },
    { name: t('character.virtueTemperance', 'Templanza'), tip: t('character.virtueTemperanceTip', 'Comidas registradas en total'), value: Math.min(stats.totalMeals, 99), pct: cap(stats.totalMeals, 300), icon: Scale },
    { name: t('character.virtueDexterity', 'Destreza'), tip: t('character.virtueDexterityTip', 'Combo diario: acciones variadas en un día'), value: stats.dailyCombo, pct: cap(stats.dailyCombo, 10), icon: Bow },
    { name: t('character.virtueFortune', 'Fortuna'), tip: t('character.virtueFortuneTip', 'Transacciones registradas en total'), value: Math.min(stats.totalExpenses, 99), pct: cap(stats.totalExpenses, 200), icon: Coin },
    { name: t('character.virtueSpirit', 'Espíritu'), tip: t('character.virtueSpiritTip', 'Días consecutivos de actividad'), value: stats.streak, pct: cap(stats.streak, 30), icon: Flame },
  ];
}

/* ── main component ──────────────────────────────── */

export default function CharacterPage() {
  const { t } = useTranslation();
  const { user: authUser } = useAuthContext();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [history, setHistory] = useState<RpgEventRecord[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [characterName, setCharacterName] = useState<string>('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState<string>('');

  const load = useCallback(() => {
    setLoadError(false);
    Promise.all([
      window.api.getRpgStats().then(setStats),
      window.api.getRpgHistory(20).then(setHistory),
      window.api.characterGetName().then(name => setCharacterName(name || '')),
    ]).catch(() => setLoadError(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);

  if (loadError) return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ marginBottom: 12, color: 'var(--rubric)' }}>{t('common.somethingWentWrong')}</p>
      <button className="rpg-button" onClick={load}>{t('common.tryAgain')}</button>
    </div>
  );

  if (!stats) return <Loading />;

  const translatedTitle = t(getTitleKey(stats.level), stats.title);
  const playerName = characterName || authUser?.displayName || translatedTitle;
  const levelDisplay = stats.level;
  const titleTrail = buildTitleTrail(stats.level, t);
  const virtues = deriveVirtues(stats, t);
  const xpNeeded = stats.xpToNextLevel;
  const xpTotal = stats.xp;
  const xpForNext = xpThreshold(stats.level + 1);
  const xpPct = xpForNext > 0 ? Math.round((xpTotal / xpForNext) * 100) : 0;

  // Find next title info
  const nextTitle = titleTrail.find((t) => !t.done);

  return (
    <BookPage
      data-tour="character"
      eyebrow={t('character.eyebrow', '\u2726 TOMO V \u2726  \u2014  EFFIGIES HEROIS')}
      title={t('character.title', 'Ficha del Héroe')}
      subtitle={t('character.pageSubtitle', 'Dó se conservan el retrato, los hechos y las virtudes del aventurero')}
    >
      <div className="hero-layout">
        {/* === LEFT COLUMN: Portrait === */}
        <div>
          {/* Portrait frame */}
          <div className="hero-portrait-frame">
            <div className="hero-portrait-banner">
              <Banner>{playerName.toUpperCase()}</Banner>
            </div>
            <Character size={160} canCustomize />
          </div>

          {/* Editable character name */}
          <div className="hero-name-edit">
            {isEditingName ? (
              <input
                className="hero-name-input"
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const trimmed = nameInput.trim();
                    window.api.characterSetName(trimmed).then(() => {
                      setCharacterName(trimmed);
                      setIsEditingName(false);
                      window.dispatchEvent(new Event('character:nameChanged'));
                    });
                  } else if (e.key === 'Escape') {
                    setIsEditingName(false);
                  }
                }}
                onBlur={() => {
                  const trimmed = nameInput.trim();
                  window.api.characterSetName(trimmed).then(() => {
                    setCharacterName(trimmed);
                    setIsEditingName(false);
                    window.dispatchEvent(new Event('character:nameChanged'));
                  });
                }}
                autoFocus
                maxLength={30}
                placeholder={t('character.setName', 'Nombre del personaje...')}
              />
            ) : (
              <button
                className="hero-name-button"
                onClick={() => {
                  setNameInput(characterName);
                  setIsEditingName(true);
                }}
                title={t('character.editName', 'Click para cambiar el nombre del personaje')}
              >
                {characterName ? (
                  <span>{characterName}</span>
                ) : (
                  <span className="hero-name-placeholder">
                    {t('character.editName', 'Click para cambiar el nombre del personaje')}
                  </span>
                )}
                <span>{' \u270E'}</span>
              </button>
            )}
          </div>

          {/* Level & motto */}
          <div className="hero-info">
            <div className="qb-small-caps hero-rank">
              {t('rpg.level', 'Nivel').toUpperCase()} {levelDisplay} {'\u00b7'} {translatedTitle.toUpperCase()}
            </div>
            <div className="hero-motto">
              {t('character.motto', '\u00ab Que el constante obrar sea su escudo \u00bb')}
            </div>
          </div>

          {/* HP / XP bars */}
          <div className="hero-bars">
            <div>
              <div className="hero-bar-header">
                <span className="qb-small-caps" style={{ color: 'var(--rubric)' }}>VITA</span>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-label)' }}>{stats.hp} / {stats.maxHp}</span>
              </div>
              <Gauge value={stats.hp} max={stats.maxHp} tone="rubric" />
            </div>
            <div>
              <div className="hero-bar-header">
                <span className="qb-small-caps" style={{ color: 'var(--moss)' }}>EXPERIENTIA</span>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-label)' }}>
                  {formatNumber(xpTotal)} / {formatNumber(xpForNext)}
                </span>
              </div>
              <Gauge value={xpPct} max={100} tone="sage" />
              <div className="qb-hand hero-bar-hint">
                {formatNumber(xpNeeded)} {t('character.xpToNextLevel', 'xp para el próximo ascenso')}
                {nextTitle ? ` \u2014 ${nextTitle.name} ${t('character.atLevel', 'al nivel')} ${nextTitle.level}` : ''}
              </div>
            </div>
          </div>

          {/* Wax seals */}
          <div className="hero-seals">
            {[
              { label: String(stats.totalTasks), rotation: -4 },
              { label: String(stats.streak), rotation: 0 },
              { label: '\u2020', rotation: 4 },
            ].map((seal, i) => (
              <div
                key={i}
                className="hero-seal"
                style={{ transform: `rotate(${seal.rotation}deg)` }}
              >
                {seal.label}
              </div>
            ))}
          </div>
          <div className="qb-hand hero-seals-hint">
            {t('character.sealsHint', 'sellos de hazañas \u2014 misiones, racha, favor real')}
          </div>
        </div>

        {/* === RIGHT COLUMN === */}
        <div>
          {/* Virtues */}
          <Section
            title={t('character.virtues', 'VIRTUDES DEL HÉROE').toUpperCase()}
            icon={<Crown width="12" height="12" style={{ color: 'var(--rubric)' }} />}
            rightSlot={<HelpBubble variant="inline" text={t('character.virtuesHelp', 'Las virtudes reflejan tu actividad en cada módulo. Se actualizan con cada acción.')} />}
          >
            <div className="hero-virtues-grid">
              {virtues.map((v) => (
                <Tooltip key={v.name} text={v.tip}>
                  <div className="hero-virtue">
                    <div className="hero-virtue-icon">
                      <v.icon width="14" height="14" />
                    </div>
                    <div className="hero-virtue-body">
                      <div className="hero-virtue-header">
                        <span className="qb-hand">{v.name}</span>
                        <span className="qb-numeral" style={{ fontSize: 'var(--fs-label)' }}>{v.value}</span>
                      </div>
                      <Gauge value={v.pct} max={100} tone="ink" showPips={false} />
                    </div>
                  </div>
                </Tooltip>
              ))}
            </div>
          </Section>

          <QBDividerSection />

          {/* Libro de Hechos (stat grid) */}
          <Section
            title={t('character.deedBook', 'LIBRO DE HECHOS').toUpperCase()}
            icon={<Scroll width="12" height="12" style={{ color: 'var(--rubric)' }} />}
            rightSlot={<HelpBubble variant="inline" text={t('character.deedBookHelp', 'Estadísticas acumuladas: misiones, comidas, transacciones, racha y combo. El combo sube con acciones variadas en un día.')} />}
          >
            <div className="hero-stats-grid">
              <Tooltip text={t('character.statQuestsTip', 'Misiones completadas en total')}><StatBox label={t('character.statQuests', 'MISIONES')} value={formatNumber(stats.totalTasks)} /></Tooltip>
              <Tooltip text={t('character.statMealsTip', 'Comidas registradas en total')}><StatBox label={t('character.statMeals', 'VIANDAS')} value={formatNumber(stats.totalMeals)} /></Tooltip>
              <Tooltip text={t('character.statExpensesTip', 'Transacciones registradas en total')}><StatBox label={t('character.statExpenses', 'MONEDAS')} value={formatNumber(stats.totalExpenses)} /></Tooltip>
              <Tooltip text={t('character.statComboTip', 'Multiplicador diario por acciones variadas')}><StatBox label={t('character.statCombo', 'COMBO')} value={String(stats.dailyCombo)} /></Tooltip>
              <Tooltip text={t('character.statStreakTip', 'Días consecutivos de actividad')}><StatBox label={t('character.statStreak', 'RACHA')} value={`${stats.streak}d`} /></Tooltip>
              <Tooltip text={t('character.statLevelTip', 'Nivel actual del héroe')}><StatBox label={t('character.statLevel', 'NIVEL')} value={levelDisplay} /></Tooltip>
              <Tooltip text={t('character.statTotalXpTip', 'Experiencia acumulada en total')}><StatBox label={t('character.statTotalXp', 'XP TOTAL')} value={formatNumber(xpTotal)} /></Tooltip>
              <Tooltip text={t('character.statMaxHpTip', 'Salud máxima del héroe')}><StatBox label={t('character.statMaxHp', 'SALUD MAX')} value={String(stats.maxHp)} /></Tooltip>
            </div>
          </Section>

          <QBDividerSection />

          {/* Gesta Reciente (chronicle) */}
          <Section
            title={t('character.chronicle', 'GESTA RECIENTE').toUpperCase()}
            icon={<Quill width="12" height="12" style={{ color: 'var(--rubric)' }} />}
            rightSlot={<HelpBubble variant="inline" text={t('character.recentChronicleHelp', 'Últimos 12 eventos que dieron XP. Valores negativos ocurren por baja precisión calórica al cerrar el día.')} />}
          >
            {history.length === 0 ? (
              <p className="qb-hand" style={{ color: 'var(--ink-faded)' }}>
                {t('character.noActivity', 'Sin actividad todavía')}
              </p>
            ) : (
              <div className="hero-chronicle-grid">
                {history.slice(0, 12).map((event) => {
                  const icon = EVENT_ICON_MAP[event.eventType] ?? '\u2726';
                  const label = t(`events.${event.eventType}`);
                  const displayLabel = label !== `events.${event.eventType}` ? label : event.eventType;
                  const xpText = event.xpGained > 0
                    ? `+${Math.round(event.xpGained)} XP`
                    : `${Math.round(event.xpGained)} XP`;
                  return (
                    <div key={event.id} className="hero-chronicle-row">
                      <span className="hero-chronicle-icon">{icon}</span>
                      <span className="hero-chronicle-text">{displayLabel}</span>
                      <span className="qb-numeral hero-chronicle-xp">{xpText}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <QBDividerSection />

          {/* Title Trail */}
          <Section
            title={t('character.titleTrail', 'CAMINO DE LOS TÍTULOS').toUpperCase()}
            icon={<Compass width="12" height="12" style={{ color: 'var(--rubric)' }} />}
            rightSlot={<HelpBubble variant="inline" text={t('character.titleTrailHelp', 'Títulos se desbloquean al alcanzar cierto nivel. El título actual aparece junto a tu nombre.')} />}
          >
            <TitleTrail titles={titleTrail} />
          </Section>
        </div>
      </div>

      {/* Marginalia */}
      <div className="hero-marginalia">
        {t('character.marginalia', 'nota del escriba \u2014 el retrato fue pintado en la feria de Midsummer')} {'\u2197'}
      </div>
    </BookPage>
  );
}

/* ── TitleTrail ──────────────────────────────────── */

interface TitleTrailProps {
  titles: {
    level: number;
    roman: string;
    name: string;
    done: boolean;
    current: boolean;
  }[];
}

function TitleTrail({ titles }: TitleTrailProps) {
  return (
    <div className="hero-title-trail">
      <div className="hero-title-trail-line" />
      <div className="hero-title-trail-grid">
        {titles.map((t, i) => {
          const dotClass = t.current
            ? 'hero-title-trail-dot hero-title-trail-dot--current'
            : t.done
              ? 'hero-title-trail-dot hero-title-trail-dot--done'
              : 'hero-title-trail-dot hero-title-trail-dot--future';
          const labelClass = t.done
            ? 'qb-small-caps hero-title-trail-label hero-title-trail-label--done'
            : 'qb-small-caps hero-title-trail-label hero-title-trail-label--future';
          return (
            <div key={i} className="hero-title-trail-node">
              <div className={dotClass}>{t.roman}</div>
              <div className={labelClass}>{t.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
