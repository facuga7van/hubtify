import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gsap } from 'gsap';
import { BookPage } from '../../shared/components/codex';
import { Section, QBDividerSection } from '../../shared/components/codex/CodexPrimitives';
import { Sparkle, Scroll } from '../../shared/components/icons';
import Loading from '../../shared/components/Loading';
import { useConfirm } from '../../shared/components/ConfirmDialog';
import {
  type ObolosBalance,
  type Reward,
  CODEX_SEALED_EVENT,
  OBOLOS_CHANGED_EVENT,
  deleteReward,
  getObolosBalance,
  getRewards,
  redeemReward,
  rewardsApiReady,
  saveReward,
} from '../codex/codexApi';
import { Obolus, REWARD_ICON_NAMES, rewardIcon } from './RewardIcons';
import ShopSection from './ShopSection';
import './rewards.css';

/** How many coins the redeem micro-ceremony drops into the purse. */
const CEREMONY_COINS = 5;

interface FormState {
  /** null = closed, '' = creating, uuid = editing that reward. */
  id: string | null;
  name: string;
  cost: string;
  icon: string | null;
}

const CLOSED_FORM: FormState = { id: null, name: '', cost: '', icon: null };

type Notice =
  | { kind: 'redeemed'; rewardId: string }
  | { kind: 'insufficient'; rewardId: string }
  | { kind: 'not_found' }
  | null;

/**
 * El Mostrador de Recompensas — where óbolos (earned only by sealing the day
 * and by achievements) are spent on treats the player defines. The page is
 * the elastic drain of the economy: if the purse only ever fills, this page
 * failed.
 *
 * Suggested route: /rewards (wired by the orchestrator in App.tsx).
 */
export default function RewardsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();

  const [balance, setBalance] = useState<ObolosBalance | null>(null);
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(CLOSED_FORM);
  const [notice, setNotice] = useState<Notice>(null);
  /** Rewards FIRST — the player's own counter is the economy's main drain. */
  const [tab, setTab] = useState<'rewards' | 'shop'>('rewards');

  const available = rewardsApiReady();

  const purseRef = useRef<HTMLDivElement>(null);
  const burstRef = useRef<HTMLDivElement>(null);

  /* ── data ─────────────────────────────────────────── */

  const load = useCallback(() => {
    if (!available) { setLoading(false); return; }
    Promise.all([getObolosBalance(), getRewards()])
      .then(([b, r]) => { setBalance(b); setRewards(r); })
      .finally(() => setLoading(false));
  }, [available]);

  useEffect(() => { load(); }, [load]);

  // Mandatory account listener, plus the moments the purse actually moves:
  // a sealed day mints óbolos and an unlocked achievement pays some too.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    window.addEventListener(CODEX_SEALED_EVENT, handler);
    window.addEventListener(OBOLOS_CHANGED_EVENT, handler);
    window.addEventListener('rpg:achievementUnlocked', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener(CODEX_SEALED_EVENT, handler);
      window.removeEventListener(OBOLOS_CHANGED_EVENT, handler);
      window.removeEventListener('rpg:achievementUnlocked', handler);
    };
  }, [load]);

  /* ── redeem (with micro-ceremony) ─────────────────── */

  const celebrate = useCallback(() => {
    const purse = purseRef.current;
    const burst = burstRef.current;
    if (!purse) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const value = purse.querySelector('.rwd-purse__value');
    if (value) {
      gsap.fromTo(value, { scale: 1.18 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
    }
    if (burst) {
      const coins = burst.querySelectorAll('.rwd-burst__coin');
      gsap.fromTo(coins,
        { y: -26, opacity: 0, rotate: () => gsap.utils.random(-40, 40) },
        {
          y: 10, opacity: 1, rotate: 0, duration: 0.45, ease: 'power2.in',
          stagger: 0.07,
          onComplete: () => { gsap.to(coins, { opacity: 0, duration: 0.3, stagger: 0.04 }); },
        });
    }
  }, []);

  const onRedeem = useCallback(async (reward: Reward) => {
    setNotice(null);
    const ok = await confirm({
      title: t('rpg.rwdRedeem', 'Canjear'),
      message: t('rpg.rwdRedeemConfirm', {
        name: reward.name,
        cost: reward.cost,
        defaultValue: '¿Canjear «{{name}}» por {{cost}} óbolos?',
      }),
      confirmText: t('rpg.rwdRedeem', 'Canjear'),
    });
    if (!ok) return;

    const res = await redeemReward(reward.id);
    if (!res) { setNotice({ kind: 'not_found' }); return; }
    if (!res.ok) {
      setNotice(res.reason === 'insufficient'
        ? { kind: 'insufficient', rewardId: reward.id }
        : { kind: 'not_found' });
      load();
      return;
    }
    setNotice({ kind: 'redeemed', rewardId: reward.id });
    load();
    // Let React paint the fresh balance first, then pop it.
    requestAnimationFrame(celebrate);
    window.dispatchEvent(new Event(OBOLOS_CHANGED_EVENT));
  }, [confirm, t, load, celebrate]);

  /* ── CRUD ─────────────────────────────────────────── */

  const openCreate = useCallback(() => {
    setNotice(null);
    setForm({ id: '', name: '', cost: '', icon: null });
  }, []);

  const openEdit = useCallback((reward: Reward) => {
    setNotice(null);
    setForm({ id: reward.id, name: reward.name, cost: String(reward.cost), icon: reward.icon });
  }, []);

  const onSave = useCallback(async () => {
    const name = form.name.trim();
    const cost = Math.round(Number(form.cost));
    if (!name || !Number.isFinite(cost) || cost < 1) return;
    const saved = await saveReward({
      id: form.id || undefined,
      name,
      cost,
      icon: form.icon ?? undefined,
    });
    if (saved) {
      setForm(CLOSED_FORM);
      load();
    }
  }, [form, load]);

  const onDelete = useCallback(async (reward: Reward) => {
    const ok = await confirm({
      message: t('rpg.rwdDeleteConfirm', {
        name: reward.name,
        defaultValue: '¿Retirar «{{name}}» del mostrador? Sus canjes quedan en el libro.',
      }),
      confirmText: t('common.delete', 'Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await deleteReward(reward.id);
    if (form.id === reward.id) setForm(CLOSED_FORM);
    load();
  }, [confirm, t, form.id, load]);

  /* ── render pieces ────────────────────────────────── */

  const canAfford = (cost: number) => (balance?.balance ?? 0) >= cost;

  const formValid = form.name.trim().length > 0
    && Number.isFinite(Number(form.cost)) && Math.round(Number(form.cost)) >= 1;

  const renderForm = () => (
    <div className="rwd-form rpg-card">
      <div className="rwd-form__row">
        <label className="qb-small-caps rwd-form__label" htmlFor="rwd-name">
          {t('rpg.rwdName', 'Recompensa')}
        </label>
        <input
          id="rwd-name"
          className="rpg-input rwd-form__name"
          value={form.name}
          maxLength={80}
          placeholder={t('rpg.rwdNamePlaceholder', '«2 h de jueguito», «Pedir delivery», «Capítulo extra»')}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          autoFocus
        />
      </div>
      <div className="rwd-form__row">
        <label className="qb-small-caps rwd-form__label" htmlFor="rwd-cost">
          {t('rpg.rwdCost', 'Costo en óbolos')}
        </label>
        <div className="rwd-form__cost">
          <input
            id="rwd-cost"
            className="rpg-input rwd-form__cost-input"
            type="number"
            min={1}
            step={1}
            value={form.cost}
            placeholder="50"
            onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
          />
          <Obolus width={16} height={16} />
        </div>
      </div>
      <div className="rwd-form__row">
        <span className="qb-small-caps rwd-form__label">{t('rpg.rwdIconLabel', 'Sello de la recompensa')}</span>
        <div className="rwd-form__icons" role="radiogroup" aria-label={t('rpg.rwdIconLabel', 'Sello de la recompensa')}>
          {REWARD_ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={form.icon === name}
              className={`rwd-form__icon${form.icon === name ? ' rwd-form__icon--on' : ''}`}
              onClick={() => setForm((f) => ({ ...f, icon: f.icon === name ? null : name }))}
            >
              {rewardIcon(name, 16)}
            </button>
          ))}
        </div>
      </div>
      <div className="rwd-form__actions">
        <button type="button" className="rpg-button rpg-btn-sm" disabled={!formValid} onClick={onSave}>
          {t('common.save', 'Guardar')}
        </button>
        <button type="button" className="rpg-button rpg-btn-sm" onClick={() => setForm(CLOSED_FORM)}>
          {t('common.cancel', 'Cancelar')}
        </button>
      </div>
    </div>
  );

  const renderReward = (reward: Reward) => {
    const affordable = canAfford(reward.cost);
    const rowNotice = notice && 'rewardId' in notice && notice.rewardId === reward.id ? notice : null;
    return (
      <li key={reward.id} className="rwd-item">
        <span className="rwd-item__medal" aria-hidden="true">{rewardIcon(reward.icon, 20)}</span>
        <div className="rwd-item__body">
          <span className="rwd-item__name">{reward.name}</span>
          {reward.redeemedCount > 0 && (
            <span className="qb-hand rwd-item__times">
              {t('rpg.rwdRedeemedTimes', { n: reward.redeemedCount, defaultValue: 'canjeada ×{{n}}' })}
            </span>
          )}
          {rowNotice?.kind === 'redeemed' && (
            <span className="qb-hand rwd-item__notice rwd-item__notice--good" role="status">
              {t('rpg.rwdRedeemed', 'Canjeado. Disfrutalo: te lo ganaste.')}
            </span>
          )}
          {rowNotice?.kind === 'insufficient' && (
            <span className="qb-hand rwd-item__notice" role="status">
              {t('rpg.rwdInsufficient', 'Todavía no te alcanzan los óbolos. Un par de días sellados más.')}
            </span>
          )}
        </div>
        <span className={`rwd-item__cost${affordable ? '' : ' rwd-item__cost--far'}`}>
          <span className="qb-numeral">{reward.cost}</span>
          <Obolus width={14} height={14} />
        </span>
        {/* Un botón apagado que no dice POR QUÉ es un callejón sin salida: el
            aviso de «no te alcanzan» sólo aparecía si lograbas hacer click, y
            deshabilitado nunca lo lográs. El título dice cuántos óbolos faltan. */}
        <button
          type="button"
          className="rpg-button rpg-btn-sm rwd-item__redeem"
          disabled={!affordable}
          title={affordable
            ? undefined
            : t('rpg.rwdMissing', {
              n: reward.cost - (balance?.balance ?? 0),
              defaultValue: 'Te faltan {{n}} óbolos para canjearla',
            })}
          onClick={() => onRedeem(reward)}
        >
          {t('rpg.rwdRedeem', 'Canjear')}
        </button>
        <span className="rwd-item__manage">
          <button
            type="button"
            className="rwd-item__tool"
            aria-label={t('rpg.rwdEdit', 'Editar')}
            title={t('rpg.rwdEdit', 'Editar')}
            onClick={() => openEdit(reward)}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20 L5 16 L16.5 4.5 A1.8 1.8 0 0 1 19.5 7.5 L8 19 Z" />
            </svg>
          </button>
          <button
            type="button"
            className="rwd-item__tool rwd-item__tool--danger"
            aria-label={t('common.delete', 'Eliminar')}
            title={t('common.delete', 'Eliminar')}
            onClick={() => onDelete(reward)}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 7 H19 M9 7 V5 H15 V7 M7 7 L8 20 H16 L17 7" />
            </svg>
          </button>
        </span>
      </li>
    );
  };

  /* ── body ─────────────────────────────────────────── */

  const body = (() => {
    if (!available) {
      return (
        <p className="rwd-empty">
          {t('rpg.rwdUnavailable', 'El mostrador todavía no está disponible en esta versión.')}
        </p>
      );
    }
    if (loading && !rewards) return <Loading />;

    return (
      <>
        {/* ── the purse ─────────────────────────────── */}
        <div className="rwd-purse" ref={purseRef}>
          <span className="rwd-purse__coin" aria-hidden="true"><Obolus width={44} height={44} /></span>
          <div className="rwd-purse__text">
            <span className="qb-eyebrow rwd-purse__label">{t('rpg.rwdPurse', 'LA BOLSA')}</span>
            <span className="rwd-purse__value">
              {balance?.balance ?? 0}
              <span className="rwd-purse__unit">{t('rpg.rwdObolos', 'óbolos')}</span>
            </span>
            <span className="qb-hand rwd-purse__foot">
              {balance?.earned ?? 0} {t('rpg.rwdEarned', 'ganados')} · {balance?.spent ?? 0} {t('rpg.rwdSpent', 'gastados')}
            </span>
          </div>
          <div className="rwd-burst" ref={burstRef} aria-hidden="true">
            {Array.from({ length: CEREMONY_COINS }, (_, i) => (
              <span key={i} className="rwd-burst__coin"><Obolus width={15} height={15} /></span>
            ))}
          </div>
        </div>

        {/* ── the two counters: own rewards | the shop ── */}
        <div className="rwd-tabs" role="tablist" aria-label={t('rpg.rwdTitle', 'Recompensas')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'rewards'}
            className={`rwd-tab${tab === 'rewards' ? ' rwd-tab--on' : ''}`}
            onClick={() => setTab('rewards')}
          >
            {t('rpg.rwdTab', 'Recompensas')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'shop'}
            className={`rwd-tab${tab === 'shop' ? ' rwd-tab--on' : ''}`}
            onClick={() => setTab('shop')}
          >
            {t('rpg.shopTab', 'Tienda')}
          </button>
        </div>

        <QBDividerSection />

        {tab === 'shop' && (
          <ShopSection
            balance={balance?.balance ?? 0}
            onCelebrate={celebrate}
          />
        )}

        {tab === 'rewards' && (
        <Section
          title={t('rpg.rwdEyebrow', 'EL MOSTRADOR DE RECOMPENSAS').toUpperCase()}
          icon={<Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />}
          rightSlot={
            form.id === null ? (
              <button type="button" className="rpg-button rpg-btn-sm rwd-add" onClick={openCreate}>
                {t('rpg.rwdAdd', 'Nueva recompensa')}
              </button>
            ) : undefined
          }
        >
          {form.id !== null && renderForm()}

          {rewards && rewards.length > 0 ? (
            <ul className="rwd-list">
              {rewards.map(renderReward)}
            </ul>
          ) : (
            <p className="rwd-empty">
              {t('rpg.rwdEmpty', 'Los óbolos se ganan sellando el día y se gastan acá: escribí vos el premio («2 h de jueguito») y ponele precio.')}
            </p>
          )}

          {notice?.kind === 'not_found' && (
            <p className="qb-hand rwd-item__notice" role="status">
              {t('rpg.rwdNotFound', 'Esa recompensa ya no está en el mostrador.')}
            </p>
          )}
        </Section>
        )}
      </>
    );
  })();

  return (
    <BookPage
      eyebrow={
        <>
          <Sparkle width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
          {t('rpg.rwdEyebrow', 'EL MOSTRADOR DE RECOMPENSAS')}
        </>
      }
      title={t('rpg.rwdTitle', 'Recompensas')}
      subtitle={t('rpg.rwdSubtitle', 'Dó los óbolos ganados se cambian por gustos que vos mismo ponés en el mostrador')}
    >
      {/* El mostrador es un LISTADO: nombre a la izquierda, precio y botón a la
          derecha. Sin techo de ancho, en ventana maximizada la fila medía
          1380 px y quedaban ~700 px de pergamino vacío entre «Una tarde de
          videojuegos sin culpa» y su precio — y la bolsa, un lingote de 1380 px
          con todo apretado contra el borde izquierdo. */}
      <div className="rwd-page">{body}</div>
    </BookPage>
  );
}
