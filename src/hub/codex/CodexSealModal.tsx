import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { BookPage } from '../../shared/components/codex';
import {
  Cartouche,
  QBDividerSection,
  Rune,
  Section,
} from '../../shared/components/codex/CodexPrimitives';
import {
  Cauldron,
  Dagger,
  FloralHeart,
  Flame,
  Quill,
  Scroll,
  Sparkle,
  Sword,
} from '../../shared/components/icons';
import { SealRosette } from './CodexSealIcons';
import { sealStyleIcon } from './SealStyleIcons';
import { Obolus } from '../rewards/RewardIcons';
import { useModalA11y } from '../../shared/hooks/useModalA11y';
import { sealCeremony } from '../../shared/animations/seal';
import { humanise, titleKey } from './achievementCatalog';
import { closingPhrase } from './codexPhrases';
import {
  CODEX_SEALED_EVENT,
  type DaySeal,
  type DaySummary,
  type SealFailReason,
  addDaysISO,
  codexApiReady,
  equippedSealStyleId,
  getDaySummary,
  getObolosBalance,
  getRewards,
  getSeals,
  localDateISO,
  rewardsApiReady,
  sealDay,
  setCodexModalOpen,
} from './codexApi';
import { purseHint } from './purse';
import {
  closeNutritionDay,
  isNutritionDayClosed,
  nutritionCloseApiReady,
  readDayMetrics,
} from './nutritionClose';
import { notifyNutritionChanged, notifyNutritionDayClosed } from '../../modules/nutrition/notify';
import Checkbox from '../../shared/components/Checkbox';
import RpgNumberInput from '../../shared/components/RpgNumberInput';
import '../styles/codex-seal.css';

/** How long the wax has to be held before it takes. */
const HOLD_MS = 1500;
/** Days shown in the seal strip. */
const STRIP_DAYS = 14;

type Phase = 'page' | 'sealing' | 'done';
type Problem = SealFailReason | 'unavailable' | null;

const MODULE_ORDER = ['quests', 'nutrition', 'finance', 'cauldron'];

function moduleIcon(moduleId: string, size = 13) {
  switch (moduleId) {
    case 'quests': return <Sword width={size} height={size} />;
    case 'nutrition': return <FloralHeart width={size} height={size} />;
    case 'finance': return <Dagger width={size} height={size} />;
    case 'cauldron': return <Cauldron width={size} height={size} />;
    default: return <Sparkle width={size} height={size} />;
  }
}

function moduleLabel(moduleId: string, t: TFunction): string {
  switch (moduleId) {
    case 'quests': return t('dashboard.moduleTasks', 'Misiones');
    case 'nutrition': return t('dashboard.moduleNutrition', 'Vituallas');
    case 'finance': return t('dashboard.moduleFinance', 'Arcas');
    case 'cauldron': return t('dashboard.moduleCauldron', 'Caldero');
    default: return moduleId;
  }
}

/** The contract allows either an ISO timestamp or a plain HH:mm. */
function formatTime(time: string, locale: string): string {
  if (/^\d{1,2}:\d{2}/.test(time)) return time.slice(0, 5);
  const d = new Date(time);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatLongDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

export interface CodexSealModalProps {
  /** Local YYYY-MM-DD of the page being read. */
  date: string;
  onClose: () => void;
  /** Jump to another day from the seal strip. */
  onSelectDate: (date: string) => void;
}

/**
 * The Cierre del Códice — the ~30 second ritual that closes a day.
 *
 * It is a page, not an interrogation: Escape, the backdrop and the X all close
 * it, at any moment, with no confirmation and no guilt. Skipping a day is not a
 * failure and nothing in here is allowed to imply otherwise.
 */
export default function CodexSealModal({ date, onClose, onSelectDate }: CodexSealModalProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'es-AR';
  const { dialogProps, stopPropagation } = useModalA11y<HTMLDivElement>({ onClose });
  const navigate = useNavigate();

  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [seals, setSeals] = useState<DaySeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('page');
  const [award, setAward] = useState<{ xpAwarded: number; vigor: number; achievementIds: string[]; obolosGranted: number } | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [holdPct, setHoldPct] = useState(0);

  const available = codexApiReady();
  const today = localDateISO();

  /* ── which matrix stamps the wax ──
     The equipped seal style lives as a data attribute on <html> (stamped by
     codexApi.applyEquippedCosmetics). Observing the attribute — rather than
     re-fetching the shop — makes the stamp follow equips instantly and keeps
     one source of truth. Default (attribute absent) = the free rosette. */
  const [sealStyle, setSealStyle] = useState<string | null>(() => equippedSealStyleId());
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setSealStyle(equippedSealStyleId()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-equip-seal'] });
    setSealStyle(equippedSealStyleId());
    return () => observer.disconnect();
  }, []);

  /* ── the flag that keeps the global achievement toast quiet ──
     While this modal is up, unlocks are shown inside the ceremony; the watcher
     in Layout reads this and suppresses its toast so the same unlock is never
     announced twice. */
  useEffect(() => {
    setCodexModalOpen(true);
    return () => setCodexModalOpen(false);
  }, []);

  const load = useCallback(() => {
    if (!available) { setLoading(false); return; }
    setLoading(true);
    const from = addDaysISO(today, -(STRIP_DAYS - 1));
    Promise.all([getDaySummary(date), getSeals(from, today)])
      .then(([s, sl]) => { setSummary(s); setSeals(sl); })
      .finally(() => setLoading(false));
  }, [available, date, today]);

  useEffect(() => { load(); }, [load]);

  /* ── la bolsa ─────────────────────────────────────
     Los óbolos se ganan ACÁ y hasta ahora se mencionaban una sola vez, en el
     instante en que se acuñaban. En la base real: 132 ganados, 0 gastados. El
     saldo vive donde se gana, y dice para qué alcanza. */
  const [purse, setPurse] = useState<{ balance: number; rewards: Array<{ id: string; name: string; cost: number }> } | null>(null);
  const loadPurse = useCallback(() => {
    if (!rewardsApiReady()) { setPurse(null); return; }
    Promise.all([getObolosBalance(), getRewards()])
      .then(([b, r]) => {
        if (!b) { setPurse(null); return; }
        setPurse({ balance: b.balance, rewards: r.map((x) => ({ id: x.id, name: x.name, cost: x.cost })) });
      })
      .catch(() => setPurse(null));
  }, []);

  useEffect(() => { loadPurse(); }, [loadPurse]);

  /* ── un solo cierre de día ────────────────────────
     Había DOS rituales que pagaban XP por separado: este sello (anunciado en
     el brief y en la barra) y el cierre de Nutrify (nunca anunciado, en un
     footer sticky de /nutrition). En la base real: 6 cierres de Nutrify contra
     1 sello. Si el día tiene comidas y todavía no está cerrado, el paso de
     nutrición pasa a vivir acá adentro y el lacre hace las dos cosas.

     Encadenar es seguro sin migración ni reescritura: los dos backends ya son
     idempotentes por su cuenta (`alreadyClosed`, `already_sealed`), así que
     nada se paga dos veces y nada ya otorgado se toca. */
  const [nutriPending, setNutriPending] = useState(false);
  const [nutriSteps, setNutriSteps] = useState('');
  const [nutriGym, setNutriGym] = useState(false);
  const [nutriAward, setNutriAward] = useState<number | null>(null);
  const [nutriBusy, setNutriBusy] = useState(false);

  const dayHasNutrition = !!summary?.modules.includes('nutrition');

  useEffect(() => {
    let alive = true;
    setNutriAward(null);
    if (!dayHasNutrition || !nutritionCloseApiReady()) { setNutriPending(false); return; }
    isNutritionDayClosed(date).then(async (closed) => {
      if (!alive) return;
      setNutriPending(!closed);
      if (closed) return;
      const metrics = await readDayMetrics(date);
      if (!alive) return;
      setNutriSteps(metrics.steps);
      setNutriGym(metrics.gym);
    });
    return () => { alive = false; };
  }, [date, dayHasNutrition]);

  /** Cierra la jornada de comidas y deja anotado lo que pagó. Nunca lanza. */
  const runNutritionClose = useCallback(async () => {
    if (!nutriPending) return;
    setNutriBusy(true);
    try {
      const breakdown = await closeNutritionDay(date, nutriSteps, nutriGym);
      setNutriPending(false);
      if (breakdown) setNutriAward(breakdown.xpTotal);
      notifyNutritionChanged();
      // Nutrify tiene que pasar a solo lectura sin recargar (NUT-02).
      notifyNutritionDayClosed();
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } catch {
      // Un tropiezo de nutrición no puede impedir sellar el día.
      setNutriPending(false);
    } finally {
      setNutriBusy(false);
    }
  }, [date, nutriPending, nutriSteps, nutriGym]);

  useEffect(() => {
    const handler = () => { load(); loadPurse(); };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load, loadPurse]);

  // A different day means a fresh page: drop any previous outcome.
  useEffect(() => {
    setPhase('page');
    setAward(null);
    setProblem(null);
    setHoldPct(0);
  }, [date]);

  /* ── sealing ──────────────────────────────────────── */

  const commitSeal = useCallback(async () => {
    setProblem(null);
    // Nutrición PRIMERO: su XP es propio y se paga aunque el sello después
    // rebote (día ya sellado, fuera de ventana). Al revés, un rebote del sello
    // se llevaría puesto el cierre de comidas que el usuario sí pidió.
    await runNutritionClose();
    const res = await sealDay(date);
    if (!res) {
      // Handler not wired yet — say so rather than pretending it worked.
      setProblem('unavailable');
      setHoldPct(0);
      return;
    }
    if (!res.ok) {
      setProblem(res.reason);
      setHoldPct(0);
      // "already sealed" is not an error to argue with: show the sealed page.
      if (res.reason === 'already_sealed') load();
      return;
    }
    setAward({
      xpAwarded: res.xpAwarded,
      vigor: res.vigor,
      achievementIds: res.achievementIds ?? [],
      obolosGranted: typeof res.obolosGranted === 'number' ? res.obolosGranted : 0,
    });
    setPhase('sealing');
    loadPurse();
    window.dispatchEvent(new Event('rpg:statsChanged'));
    window.dispatchEvent(new Event(CODEX_SEALED_EVENT));
  }, [date, load, loadPurse, runNutritionClose]);

  /* ── hold-to-seal (pointer + keyboard) ────────────── */

  const holdingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const commitRef = useRef(commitSeal);
  useEffect(() => { commitRef.current = commitSeal; }, [commitSeal]);

  const cancelHold = useCallback(() => {
    holdingRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setHoldPct((pct) => (pct >= 1 ? pct : 0));
  }, []);

  const tick = useCallback(() => {
    if (!holdingRef.current) return;
    const pct = Math.min(1, (performance.now() - startedAtRef.current) / HOLD_MS);
    setHoldPct(pct);
    if (pct >= 1) {
      holdingRef.current = false;
      rafRef.current = null;
      void commitRef.current();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startHold = useCallback(() => {
    if (holdingRef.current || phase !== 'page') return;
    holdingRef.current = true;
    startedAtRef.current = performance.now();
    setProblem(null);
    rafRef.current = requestAnimationFrame(tick);
  }, [phase, tick]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  /* ── the ceremony ─────────────────────────────────── */

  const stageRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<ReturnType<typeof sealCeremony> | null>(null);

  useEffect(() => {
    if (phase !== 'sealing') return;
    const el = stageRef.current;
    if (!el) { setPhase('done'); return; }
    timelineRef.current = sealCeremony(el, () => setPhase('done'));
    return () => {
      timelineRef.current?.data?.particles?.stop();
      timelineRef.current?.kill();
      timelineRef.current = null;
    };
  }, [phase]);

  /* ── derived ──────────────────────────────────────── */

  const grouped = useMemo(() => {
    if (!summary) return [] as Array<{ moduleId: string; events: DaySummary['events'] }>;
    const map = new Map<string, DaySummary['events']>();
    for (const ev of summary.events) {
      const list = map.get(ev.moduleId) ?? [];
      list.push(ev);
      map.set(ev.moduleId, list);
    }
    return [...map.entries()]
      .sort((a, b) => {
        const ia = MODULE_ORDER.indexOf(a[0]);
        const ib = MODULE_ORDER.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([moduleId, events]) => ({ moduleId, events }));
  }, [summary]);

  const strip = useMemo(() => {
    const sealedSet = new Map(seals.map((s) => [s.date, s]));
    const cells: Array<{ date: string; seal: DaySeal | undefined; isToday: boolean }> = [];
    for (let i = STRIP_DAYS - 1; i >= 0; i--) {
      const d = addDaysISO(today, -i);
      cells.push({ date: d, seal: sealedSet.get(d), isToday: d === today });
    }
    return cells;
  }, [seals, today]);

  const sealedNow = phase === 'sealing' || phase === 'done' || (summary?.sealed ?? false);
  const emptyDay = !!summary && summary.eventsCount === 0 && !summary.sealed;
  const thisSeal = seals.find((s) => s.date === date);
  /** Sin lacre que apretar (ya sellado o fuera de ventana), el cierre de
      comidas necesita su propio botón. */
  const nutriStandalone = sealedNow || !!(summary && !summary.canSeal);

  const dayLabel = formatLongDate(date, locale);
  const isYesterday = date === addDaysISO(today, -1);

  /* ── copy for the states the handler can return ───── */
  const problemCopy = (() => {
    switch (problem) {
      case 'already_sealed':
        return t('rpg.codexAlreadySealed', 'Este día ya estaba sellado. Acá está su página.');
      case 'empty_day':
        return t('rpg.codexEmptyDay', 'El códice registra días vividos. Volvé cuando haya algo que anotar.');
      case 'too_old':
        return t('rpg.codexTooOld', 'Esta página ya se encuadernó. Los días viejos se quedan como quedaron, y está bien.');
      case 'future':
        return t('rpg.codexFuture', 'Ese día todavía no se vivió. El códice se cierra al final, no antes.');
      case 'unavailable':
        return t('rpg.codexUnavailable', 'El cierre del códice todavía no está disponible en esta versión.');
      default:
        return null;
    }
  })();

  /** One line that turns the balance into a reason. Never invents a reward. */
  const purseCopy = (() => {
    if (!purse) return null;
    const hint = purseHint(purse.balance, purse.rewards);
    switch (hint.kind) {
      case 'no-rewards':
        return t('rpg.codexPurseNoRewards', 'Escribí en el mostrador qué querés comprarte.');
      case 'affordable':
        return t('rpg.codexPurseAffordable', {
          name: hint.reward.name,
          defaultValue: 'Te alcanza para «{{name}}».',
        });
      case 'closest':
        return t('rpg.codexPurseClosest', {
          name: hint.reward.name,
          missing: hint.missing,
          defaultValue: '«{{name}}» te queda a {{missing}} óbolos.',
        });
    }
  })();

  /* ── render ───────────────────────────────────────── */

  const body = (() => {
    if (!available) {
      return (
        <p className="codex-note">
          {t('rpg.codexUnavailable', 'El cierre del códice todavía no está disponible en esta versión.')}
        </p>
      );
    }
    if (loading) {
      return (
        <div className="codex-skeleton" aria-hidden="true">
          <div className="codex-skeleton__line" />
          <div className="codex-skeleton__line codex-skeleton__line--short" />
          <div className="codex-skeleton__block" />
        </div>
      );
    }
    if (!summary) {
      return (
        <p className="codex-note">
          {t('rpg.codexNoPage', 'No pudimos leer la página de este día.')}
        </p>
      );
    }

    return (
      <>
        {/* ── the day's numbers ────────────────────── */}
        <div className="codex-cartouches">
          <Cartouche
            label={t('rpg.codexXpToday', 'XP DEL DÍA')}
            value={`+${Math.round(summary.totalXp)}`}
            foot={t('rpg.codexXpFoot', 'anotados al margen')}
            icon={<Sword width={14} height={14} />}
            tone="sage"
          />
          <Cartouche
            label={t('rpg.codexMaxCombo', 'COMBO MÁXIMO')}
            value={`×${summary.maxCombo}`}
            foot={t('rpg.codexComboFoot', 'en un mismo día')}
            icon={<Flame width={14} height={14} />}
          />
          <Cartouche
            label={t('rpg.codexDeeds', 'HECHOS')}
            value={summary.eventsCount}
            foot={t('rpg.codexDeedsFoot', 'entradas del día')}
            icon={<Quill width={14} height={14} />}
          />
          <Cartouche
            label={t('rpg.vigor', 'VIGOR')}
            value={summary.vigor}
            foot={`${t('rpg.streak', 'Racha')} ${summary.streak}`}
            icon={<Sparkle width={14} height={14} />}
            tone="rubric"
          />
        </div>

        {/* ── the modules touched, as little seals ──── */}
        {summary.modules.length > 0 && (
          <div className="codex-module-seals">
            {summary.modules.map((m) => (
              /* `tone="gold"` pinta el rótulo en --gold (#a88a3c) sobre
                 pergamino: 2.27:1. Los tres sellos de módulo se veían
                 fantasmales, como si estuvieran deshabilitados. */
              <Rune key={m} tone="ink">
                <span className="codex-module-seal">
                  {moduleIcon(m, 11)} {moduleLabel(m, t)}
                </span>
              </Rune>
            ))}
          </div>
        )}

        <QBDividerSection />

        {/* ── marginalia, grouped by module ─────────── */}
        {grouped.length > 0 ? (
          <div className="codex-marginalia">
            {grouped.map(({ moduleId, events }) => (
              <Section
                key={moduleId}
                title={moduleLabel(moduleId, t).toUpperCase()}
                icon={<span className="codex-marginalia__icon">{moduleIcon(moduleId)}</span>}
                rightSlot={<span className="qb-numeral codex-marginalia__count">{events.length}</span>}
              >
                <ul className="codex-marginalia__list">
                  {events.map((ev, i) => {
                    const label = t(`events.${ev.eventType}`);
                    const text = label !== `events.${ev.eventType}` ? label : ev.eventType;
                    return (
                      <li key={`${moduleId}-${i}`} className="codex-marginalia__row">
                        <span className="qb-hand codex-marginalia__time">{formatTime(ev.time, locale)}</span>
                        <span className="codex-marginalia__text" title={text}>{text}</span>
                        <span className="qb-numeral codex-marginalia__xp">
                          {ev.xpGained >= 0 ? '+' : ''}{Math.round(ev.xpGained)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            ))}
          </div>
        ) : (
          <p className="codex-note">
            {t('rpg.codexEmptyDay', 'El códice registra días vividos. Volvé cuando haya algo que anotar.')}
          </p>
        )}

        {/* ── the closing line ──────────────────────── */}
        {summary.eventsCount > 0 && (
          <p className="codex-phrase">{'« '}{closingPhrase(summary, t)}{' »'}</p>
        )}

        <QBDividerSection />

        {/* ── la jornada de comidas, dentro del mismo ritual ── */}
        {nutriPending && (
          <div className="codex-nutri">
            <div className="qb-small-caps codex-nutri__title">
              {t('rpg.codexNutriTitle', 'LA JORNADA DE COMIDAS')}
            </div>
            <p className="qb-hand codex-nutri__hint">
              {nutriStandalone
                ? t('rpg.codexNutriHintSealed', 'La jornada de comidas quedó abierta. Cerrala y queda todo en una sola página.')
                : t('rpg.codexNutriHint', 'Este día tiene comidas sin cerrar. El lacre cierra las dos cosas de una vez.')}
            </p>
            <div className="codex-nutri__fields">
              <label className="codex-nutri__field">
                <span className="qb-hand">{t('nutrify.steps', 'Pasos')}</span>
                <RpgNumberInput
                  value={nutriSteps}
                  onChange={setNutriSteps}
                  step={100} min={0} max={99999}
                  style={{ width: 110 }}
                />
              </label>
              <label className="codex-nutri__field codex-nutri__field--check">
                <Checkbox checked={nutriGym} onChange={() => setNutriGym((v) => !v)} />
                <span className="qb-hand">{t('nutrify.gym', 'Gimnasio')}</span>
              </label>
            </div>
            {/* El lacre hace las dos cosas; pero si el sello ya está puesto o
                el día quedó fuera de su ventana, el cierre de comidas tiene
                que seguir siendo posible por su cuenta — Nutrify nunca tuvo
                límite retroactivo y quitárselo sería sacarle XP al usuario. */}
            {nutriStandalone && (
              <button
                type="button"
                className="rpg-button codex-nutri__close tap-target"
                disabled={nutriBusy}
                onClick={runNutritionClose}
              >
                {t('rpg.codexNutriCloseNow', 'Cerrar la jornada')}
              </button>
            )}
          </div>
        )}

        {nutriAward !== null && (
          <p className="codex-nutri__award" role="status">
            {t('rpg.codexNutriClosed', {
              n: Math.round(nutriAward),
              defaultValue: 'Jornada de comidas cerrada · +{{n}} XP',
            })}
          </p>
        )}

        {/* ── the wax ───────────────────────────────── */}
        <div className="codex-wax-zone">
          {sealedNow ? (
            <div className="codex-sealed" ref={stageRef}>
              <div className="codex-seal-halo" data-seal="halo" aria-hidden="true" />
              <div className="qb-seal codex-seal-disc" data-seal="wax">
                <span data-seal="stamp" className="codex-seal-mark">
                  {sealStyleIcon(sealStyle, 34)}
                </span>
              </div>
              <div className="codex-sealed__text" data-seal="result">
                <div className="qb-small-caps codex-sealed__label">
                  {t('rpg.codexSealedOn', 'Sellado')} {'·'} {dayLabel}
                </div>
                {award ? (
                  <>
                    <div className="codex-award">
                      +{Math.round(award.xpAwarded)} {t('rpg.codexXpUnit', 'XP')}
                    </div>
                    <div className="qb-hand codex-award__breakdown">
                      {t('rpg.codexAwardBreakdown', {
                        vigor: award.vigor,
                        defaultValue: 'día vivo × vigor {{vigor}}',
                      })}
                    </div>
                    {award.obolosGranted > 0 && (
                      <div className="codex-obolos">
                        <span className="codex-obolos__coins" aria-hidden="true">
                          <span className="codex-obolos__coin"><Obolus width={15} height={15} /></span>
                          <span className="codex-obolos__coin"><Obolus width={13} height={13} /></span>
                          <span className="codex-obolos__coin"><Obolus width={15} height={15} /></span>
                        </span>
                        <span className="codex-obolos__text">
                          {t('rpg.codexObolosGranted', {
                            n: award.obolosGranted,
                            defaultValue: '+{{n}} óbolos a la bolsa',
                          })}
                        </span>
                      </div>
                    )}
                    {award.achievementIds.length > 0 && (
                      <div className="codex-unlocks">
                        <div className="qb-small-caps codex-unlocks__title">
                          {t('rpg.codexUnlocked', 'Desbloqueaste')}
                        </div>
                        <ul className="codex-unlocks__list">
                          {award.achievementIds.map((id) => (
                            <li key={id} className="codex-unlocks__item">
                              <SealRosette width={13} height={13} />
                              <span>{t(titleKey(id), humanise(id))}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : thisSeal ? (
                  <div className="codex-award">
                    +{Math.round(thisSeal.xpAwarded)} {t('rpg.codexXpUnit', 'XP')}
                  </div>
                ) : null}

                {/* La salida del ritual, acá abajo, donde te deja la ceremonia.
                    Durante 'sealing' no: el lacre todavía se está estampando y
                    el botón entra con el resto del bloque [data-seal="result"]. */}
                {phase !== 'sealing' && (
                  <button
                    type="button"
                    className="codex-sealed__exit tap-target"
                    onClick={onClose}
                  >
                    {t('rpg.codexCloseBook', 'Cerrar el libro')}
                  </button>
                )}
              </div>
            </div>
          ) : emptyDay ? (
            /* The marginalia above already says "el codice registra dias
               vividos"; the rule is only that there is NO button here. */
            null
          ) : (
            <>
              <button
                type="button"
                className={`codex-wax tap-target${holdPct > 0 ? ' codex-wax--holding' : ''}`}
                style={{ '--codex-hold': `${Math.round(holdPct * 100)}%` } as CSSProperties}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  startHold();
                }}
                onPointerUp={cancelHold}
                onPointerCancel={cancelHold}
                onKeyDown={(e) => {
                  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                    e.preventDefault();
                    startHold();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') cancelHold();
                }}
                aria-label={t('rpg.codexHoldToSeal', 'Mantené apretado para sellar el día')}
              >
                <span className="codex-wax__fill" aria-hidden="true" />
                <span className="codex-wax__face">
                  {sealStyleIcon(sealStyle, 30)}
                </span>
              </button>
              <div className="qb-hand codex-wax__hint">
                {t('rpg.codexHoldHint', 'Mantené apretado para sellar el día')}
              </div>
            </>
          )}

          {problemCopy && (
            <p className="codex-problem" role="status">{problemCopy}</p>
          )}
        </div>

        {/* ── la bolsa: el saldo, donde se gana ─────── */}
        {purse && (
          <div className="codex-purse">
            <span className="codex-purse__coin" aria-hidden="true"><Obolus width={16} height={16} /></span>
            <span className="codex-purse__balance">
              <b className="qb-numeral">{purse.balance}</b>{' '}
              <span className="qb-hand">{t('rpg.codexPurseUnit', 'óbolos en la bolsa')}</span>
            </span>
            <span className="qb-hand codex-purse__hint">{purseCopy}</span>
            <button
              type="button"
              className="codex-purse__link tap-target"
              onClick={() => { onClose(); navigate('/rewards'); }}
            >
              {t('rpg.codexPurseSpend', 'Ir al mostrador')}
            </button>
          </div>
        )}

        {/* ── the 14 day strip ──────────────────────── */}
        <QBDividerSection />
        <Section
          title={t('rpg.codexStrip', 'ÚLTIMOS XIV DÍAS').toUpperCase()}
          icon={<Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />}
        >
          <div className="codex-strip">
            {strip.map((cell) => {
              const isOpen = cell.date === date;
              const day = Number(cell.date.slice(8, 10));
              const canOpen = !cell.seal && !isOpen;
              const label = cell.seal
                ? t('rpg.codexStripSealed', {
                    date: formatLongDate(cell.date, locale),
                    xp: Math.round(cell.seal.xpAwarded),
                    defaultValue: '{{date}} — sellado, +{{xp}} XP',
                  })
                : t('rpg.codexStripOpen', {
                    date: formatLongDate(cell.date, locale),
                    defaultValue: '{{date}} — sin sellar',
                  });
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={[
                    'codex-strip__cell',
                    cell.seal ? 'codex-strip__cell--sealed' : 'codex-strip__cell--open',
                    isOpen ? 'codex-strip__cell--current' : '',
                    cell.isToday ? 'codex-strip__cell--today' : '',
                  ].join(' ').trim()}
                  title={label}
                  aria-label={label}
                  aria-current={isOpen ? 'date' : undefined}
                  disabled={!canOpen}
                  onClick={() => { if (canOpen) onSelectDate(cell.date); }}
                >
                  {cell.seal
                    ? <SealRosette width={16} height={16} />
                    : <span className="codex-strip__num">{day}</span>}
                </button>
              );
            })}
          </div>
          <div className="qb-hand codex-strip__legend">
            {t('rpg.codexStripLegend', 'Un día sin sellar no es una falta — es una página que quedó abierta.')}
          </div>
        </Section>
      </>
    );
  })();

  return (
    <div className="codex-overlay" onClick={onClose}>
      <div
        {...dialogProps}
        className="codex-modal"
        aria-label={t('rpg.codexTitle', 'Cierre del Códice')}
        onClick={stopPropagation}
      >
        <button
          type="button"
          className="codex-modal__close tap-target"
          onClick={onClose}
          aria-label={t('common.close', 'Cerrar')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
          </svg>
        </button>

        {/* El scroll vive acá adentro, no en `.codex-modal`: así la X de arriba
            —que es `position: absolute` contra el modal— se queda quieta en el
            marco en vez de irse con el contenido. Ver el comentario largo en
            codex-seal.css. */}
        <div className="codex-modal__scroll">
          <BookPage
            className="codex-book"
            eyebrow={
              <>
                <Sparkle width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                {t('rpg.codexEyebrow', 'CIERRE DEL CÓDICE')}
                {isYesterday && <> {'—'} {t('rpg.codexYesterdayTag', 'PÁGINA DE AYER')}</>}
              </>
            }
            title={dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)}
            subtitle={
              sealedNow
                ? t('rpg.codexSubtitleSealed', 'Esta página está cerrada. Lo que pasó, pasó, y quedó escrito.')
                : t('rpg.codexSubtitle', 'Leé el día, y si querés, cerralo. Podés irte cuando quieras.')
            }
          >
            {body}
          </BookPage>
        </div>
      </div>
    </div>
  );
}
