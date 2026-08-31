import React, { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  Sparkle,
  Dagger,
  CrossPlus,
  Pencil,
  ArrowUpRight,
  Cauldron,
} from '../shared/components/icons';
import Tooltip from '../shared/components/Tooltip';
import HelpBubble from '../shared/components/HelpBubble';
import Loading from '../shared/components/Loading';
import Character from './Character';
import { xpThreshold, getTitleKey } from '../../shared/rpg-engine';
import { TITLE_THRESHOLDS } from '../../shared/types';
import type { PlayerStats, RpgEventRecord } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import './styles/character.css';

/* ── helpers ─────────────────────────────────────── */

function formatNumber(n: number, locale = 'es-ES'): string {
  return n.toLocaleString(locale);
}

const EVENT_ICON_COMPONENTS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  TASK_COMPLETED: Sword,
  TASK_UNCOMPLETED: Sword,
  SUBTASK_COMPLETED: Sword,
  SUBTASK_UNCOMPLETED: Sword,
  HABIT_CHECKED: Sparkle,
  HABIT_UNCHECKED: Sparkle,
  MEAL_LOGGED: Scale,
  DAY_SUMMARY: Scale,
  EXPENSE_LOGGED: Coin,
  EXPENSE_TRACKED: Coin,
  INCOME_LOGGED: Coin,
  LOAN_SETTLED: Coin,
  STATEMENT_IMPORTED: Coin,
  RECURRING_UPDATED: Coin,
  POMODORO_COMPLETED: Cauldron,
  LEVEL_UP: CrossPlus,
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
function deriveVirtues(stats: PlayerStats, t: TFunction) {
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
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'es-ES';
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
      window.api.getRpgStats().then(setStats).catch(() => null),
      window.api.getRpgHistory(20).then(setHistory).catch(() => null),
      window.api.characterGetName().then(name => setCharacterName(name || '')).catch(() => null),
    ]).then(results => {
      if (results[0] === null && results[1] === null) setLoadError(true);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);

  // ── Hooks MUST run on every render ──────────────────────────
  // These used to sit below the `!stats` early return, so the first render
  // (stats === null) ran four fewer hooks than the second one and React threw
  // "Rendered more hooks than during the previous render" — which the app-wide
  // ErrorBoundary turned into a full-shell crash.
  const level = stats?.level ?? 1;
  const titleTrail = useMemo(() => buildTitleTrail(level, t), [level, t]);
  const virtues = useMemo(() => (stats ? deriveVirtues(stats, t) : []), [stats, t]);
  const xpForCurrent = useMemo(() => xpThreshold(level), [level]);
  const xpForNext = useMemo(() => xpThreshold(level + 1), [level]);
  const nextTitle = useMemo(() => titleTrail.find((entry) => !entry.done), [titleTrail]);

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
  const xpNeeded = stats.xpToNextLevel;
  const xpTotal = stats.xp;
  // Same formula as the sidebar bar (progress WITHIN the level), so the two
  // never disagree on the same data.
  const xpPct = xpForNext > xpForCurrent
    ? Math.max(0, Math.min(100, Math.round(((xpTotal - xpForCurrent) / (xpForNext - xpForCurrent)) * 100)))
    : 100;

  return (
    <BookPage
      data-tour="character"
      eyebrow={<><Sparkle width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {t('character.eyebrowText', 'TOMO V')} <Sparkle width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {'\u2014'} {t('character.eyebrowSub', 'EFFIGIES HEROIS')}</>}
      title={t('character.title', 'Ficha del Héroe')}
      subtitle={t('character.pageSubtitle', 'Dó se conservan el retrato, los hechos y las virtudes del aventurero')}
    >
      <div className="hero-layout">
        {/* === LEFT COLUMN: Portrait === */}
        <div>
          {/* Portrait frame */}
          <div className="hero-portrait-frame">
            <div className="hero-portrait-banner" title={playerName}>
              <Banner>{playerName.toUpperCase()}</Banner>
            </div>
            <Character size={160} canCustomize />
          </div>

          {/* Editable character name */}
          <div className="hero-name-edit">
            {isEditingName ? (
              <>
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
                <span className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', display: 'block', marginTop: 2 }}>
                  {nameInput.length}/30
                </span>
              </>
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
                <Pencil width={12} height={12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
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
                <span className="qb-small-caps" style={{ color: 'var(--rubric)' }}>{t('rpg.vita', 'VITA')}</span>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-label)' }}>{stats.hp} / {stats.maxHp}</span>
              </div>
              <Gauge value={stats.hp} max={stats.maxHp} tone="rubric" />
            </div>
            <div>
              <div className="hero-bar-header">
                <span className="qb-small-caps" style={{ color: 'var(--moss)' }}>EXPERIENTIA</span>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-label)' }}>
                  {formatNumber(xpTotal, locale)} / {formatNumber(xpForNext, locale)}
                </span>
              </div>
              <Gauge value={xpPct} max={100} tone="sage" />
              <div className="qb-hand hero-bar-hint">
                {formatNumber(xpNeeded, locale)} {t('character.xpToNextLevel', 'xp para el próximo ascenso')}
                {nextTitle ? ` \u2014 ${nextTitle.name} ${t('character.atLevel', 'al nivel')} ${nextTitle.level}` : ''}
              </div>
            </div>
          </div>

          {/* Wax seals */}
          <div className="hero-seals">
            {[
              { label: String(stats.totalTasks) as ReactNode, rotation: -4 },
              { label: String(stats.streak) as ReactNode, rotation: 0 },
              { label: <Dagger width={14} height={14} /> as ReactNode, rotation: 4 },
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
              <Tooltip text={t('character.statQuestsTip', 'Misiones completadas en total')}><StatBox label={t('character.statQuests', 'MISIONES')} value={formatNumber(stats.totalTasks, locale)} /></Tooltip>
              <Tooltip text={t('character.statMealsTip', 'Comidas registradas en total')}><StatBox label={t('character.statMeals', 'VIANDAS')} value={formatNumber(stats.totalMeals, locale)} /></Tooltip>
              <Tooltip text={t('character.statExpensesTip', 'Transacciones registradas en total')}><StatBox label={t('character.statExpenses', 'MONEDAS')} value={formatNumber(stats.totalExpenses, locale)} /></Tooltip>
              <Tooltip text={t('character.statComboTip', 'Multiplicador diario por acciones variadas')}><StatBox label={t('character.statCombo', 'COMBO')} value={String(stats.dailyCombo)} /></Tooltip>
              <Tooltip text={t('character.statStreakTip', 'Días consecutivos de actividad')}><StatBox label={t('character.statStreak', 'RACHA')} value={`${stats.streak}d`} /></Tooltip>
              <Tooltip text={t('character.statLevelTip', 'Nivel actual del héroe')}><StatBox label={t('character.statLevel', 'NIVEL')} value={levelDisplay} /></Tooltip>
              <Tooltip text={t('character.statTotalXpTip', 'Experiencia acumulada en total')}><StatBox label={t('character.statTotalXp', 'XP TOTAL')} value={formatNumber(xpTotal, locale)} /></Tooltip>
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
                  const IconComp = EVENT_ICON_COMPONENTS[event.eventType] ?? Sparkle;
                  const label = t(`events.${event.eventType}`);
                  const displayLabel = label !== `events.${event.eventType}` ? label : event.eventType;
                  const xpText = event.xpGained > 0
                    ? `+${Math.round(event.xpGained)} XP`
                    : `${Math.round(event.xpGained)} XP`;
                  return (
                    <div key={event.id} className="hero-chronicle-row">
                      <span className="hero-chronicle-icon"><IconComp width={12} height={12} /></span>
                      <span className="hero-chronicle-text" title={displayLabel}>{displayLabel}</span>
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
        {t('character.marginalia', 'nota del escriba \u2014 el retrato fue pintado en la feria de Midsummer')} <ArrowUpRight width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} />
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
