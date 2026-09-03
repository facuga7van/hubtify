import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Section, QBDividerSection } from '../../shared/components/codex/CodexPrimitives';
import { Flame, Scroll, Sparkle, Bag } from '../../shared/components/icons';
import Skeleton from '../../shared/components/Skeleton';
import EmptyState from '../../shared/components/EmptyState';
import ErrorState from '../../shared/components/ErrorState';
import { useConfirm } from '../../shared/components/ConfirmDialog';
import { sealStyleIcon } from '../codex/SealStyleIcons';
import {
  type ShopCatalogEntry,
  type ShopCatalogResult,
  OBOLOS_CHANGED_EVENT,
  SHOP_CHANGED_EVENT,
  equipShopItem,
  getShopCatalog,
  purchaseShopItem,
  shopApiReady,
} from '../codex/codexApi';
import { Obolus } from './RewardIcons';

type Notice =
  | { kind: 'purchased'; itemId: string }
  | { kind: 'insufficient'; itemId: string }
  | { kind: 'monthly_cap'; itemId: string }
  | { kind: 'already_owned'; itemId: string }
  | null;

interface ShopSectionProps {
  /** Current balance, owned by RewardsPage (single purse for both tabs). */
  balance: number;
  /** Fires the purse micro-ceremony up in RewardsPage. */
  onCelebrate?: () => void;
}

/**
 * La Tienda — the SECOND drain of the óbolos (the player's own rewards stay
 * first). Sells only what never existed before it: seal matrices for the
 * Códice, one extra monthly pardon, and frames/backgrounds for the hero card.
 * The avatar picker's free combos are not for sale and never will be.
 */
export default function ShopSection({ balance, onCelebrate }: ShopSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();

  const [catalog, setCatalog] = useState<ShopCatalogResult | null>(null);
  const [loading, setLoading] = useState(true);
  /** Una tienda que no se pudo leer no es una tienda sin nada para vender. */
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const available = shopApiReady();

  const load = useCallback(() => {
    if (!available) { setLoading(false); return; }
    setLoading(true);
    setLoadError(false);
    getShopCatalog({ strict: true })
      .then(setCatalog)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [available]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    window.addEventListener(OBOLOS_CHANGED_EVENT, handler);
    window.addEventListener(SHOP_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener(OBOLOS_CHANGED_EVENT, handler);
      window.removeEventListener(SHOP_CHANGED_EVENT, handler);
    };
  }, [load]);

  /* ── buy ──────────────────────────────────────────── */

  const onBuy = useCallback(async (item: ShopCatalogEntry) => {
    setNotice(null);
    const name = t(`${item.i18nKey}.name`, item.id);
    const ok = await confirm({
      title: t('rpg.shopBuy', 'Comprar'),
      message: t('rpg.shopBuyConfirm', {
        name,
        cost: item.cost,
        defaultValue: '¿Comprar «{{name}}» por {{cost}} óbolos?',
      }),
      confirmText: t('rpg.shopBuy', 'Comprar'),
    });
    if (!ok) return;

    const res = await purchaseShopItem(item.id);
    if (!res) return;
    if (!res.ok) {
      if (res.reason === 'insufficient') setNotice({ kind: 'insufficient', itemId: item.id });
      else if (res.reason === 'monthly_cap') setNotice({ kind: 'monthly_cap', itemId: item.id });
      else if (res.reason === 'already_owned') setNotice({ kind: 'already_owned', itemId: item.id });
      load();
      return;
    }
    setNotice({ kind: 'purchased', itemId: item.id });
    load();
    window.dispatchEvent(new Event(OBOLOS_CHANGED_EVENT));
    window.dispatchEvent(new Event(SHOP_CHANGED_EVENT));
    requestAnimationFrame(() => onCelebrate?.());
  }, [confirm, t, load, onCelebrate]);

  /* ── equip / unequip ──────────────────────────────── */

  const onEquip = useCallback(async (item: ShopCatalogEntry) => {
    setNotice(null);
    const res = item.equipped
      ? await equipShopItem(null, item.kind)
      : await equipShopItem(item.id);
    if (res?.ok) {
      load();
      window.dispatchEvent(new Event(SHOP_CHANGED_EVENT));
    }
  }, [load]);

  /* ── render pieces ────────────────────────────────── */

  const preview = (item: ShopCatalogEntry) => {
    switch (item.kind) {
      case 'seal_style':
        return <span className="shop-preview shop-preview--seal">{sealStyleIcon(item.id, 26)}</span>;
      case 'pardon':
        return <span className="shop-preview shop-preview--pardon"><Flame width={22} height={22} /></span>;
      default:
        // Frames and backgrounds: the art is CSS — the swatch wears the same
        // class family codex-seal.css applies to the real card.
        return (
          <span className={`shop-preview shop-swatch shop-swatch--${item.id}`} aria-hidden="true">
            <span className="shop-swatch__dot" />
          </span>
        );
    }
  };

  const renderItem = (item: ShopCatalogEntry) => {
    const name = t(`${item.i18nKey}.name`, item.id);
    const desc = t(`${item.i18nKey}.desc`, '');
    const affordable = balance >= item.cost;
    const equippable = item.kind !== 'pardon';
    const rowNotice = notice && notice.itemId === item.id ? notice : null;

    return (
      <li key={item.id} className={`shop-item${item.owned ? ' shop-item--owned' : ''}`}>
        {preview(item)}
        <div className="shop-item__body">
          <span className="shop-item__name">{name}</span>
          {desc && <span className="qb-hand shop-item__desc">{desc}</span>}
          {rowNotice?.kind === 'purchased' && (
            <span className="qb-hand shop-item__notice shop-item__notice--good" role="status">
              {t('rpg.shopPurchased', 'Comprado. Ya es tuyo, para siempre.')}
            </span>
          )}
          {rowNotice?.kind === 'insufficient' && (
            <span className="qb-hand shop-item__notice" role="status">
              {t('rpg.shopInsufficient', 'Todavía no te alcanzan los óbolos. Un par de días sellados más.')}
            </span>
          )}
          {rowNotice?.kind === 'monthly_cap' && (
            <span className="qb-hand shop-item__notice" role="status">
              {t('rpg.shopMonthlyCap', 'El indulto comprado es uno por mes, y este mes ya está.')}
            </span>
          )}
          {rowNotice?.kind === 'already_owned' && (
            <span className="qb-hand shop-item__notice" role="status">
              {t('rpg.shopAlreadyOwned', 'Ya era tuyo.')}
            </span>
          )}
        </div>

        {!item.owned ? (
          <>
            <span className={`shop-item__cost${affordable ? '' : ' shop-item__cost--far'}`}>
              <span className="qb-numeral">{item.cost}</span>
              <Obolus width={14} height={14} />
            </span>
            <button
              type="button"
              className="rpg-button rpg-btn-sm shop-item__buy"
              disabled={!affordable}
              onClick={() => onBuy(item)}
            >
              {t('rpg.shopBuy', 'Comprar')}
            </button>
          </>
        ) : item.kind === 'pardon' ? (
          <span className="qb-small-caps shop-item__state">
            {t('rpg.shopPardonBought', 'comprado este mes')}
          </span>
        ) : (
          <>
            <span className="qb-small-caps shop-item__state">
              {item.equipped
                ? t('rpg.shopEquipped', 'en uso')
                : t('rpg.shopOwned', 'comprado')}
            </span>
            {equippable && (
              <button
                type="button"
                className={`rpg-button rpg-btn-sm shop-item__buy${item.equipped ? ' shop-item__buy--on' : ''}`}
                onClick={() => onEquip(item)}
              >
                {item.equipped ? t('rpg.shopUnequip', 'Quitar') : t('rpg.shopEquip', 'Usar')}
              </button>
            )}
          </>
        )}
      </li>
    );
  };

  const renderGroup = (title: string, icon: ReactNode, items: ShopCatalogEntry[], foot?: string) => {
    if (items.length === 0) return null;
    return (
      <Section title={title.toUpperCase()} icon={icon}>
        <ul className="shop-list">{items.map(renderItem)}</ul>
        {foot && <p className="qb-hand shop-group__foot">{foot}</p>}
      </Section>
    );
  };

  /* ── body ─────────────────────────────────────────── */

  if (!available) {
    return (
      <EmptyState
        icon={<Bag width={32} height={32} />}
        message={t('rpg.shopUnavailable', 'La tienda todavía no está disponible en esta versión.')}
      />
    );
  }
  if (loading && !catalog) return <Skeleton variant="block" count={4} />;
  if (loadError) {
    return (
      <ErrorState
        message={t('rpg.shopLoadFailed', 'No se pudo abrir la tienda.')}
        onRetry={load}
      />
    );
  }

  const items = catalog?.items ?? [];
  const seals = items.filter((i) => i.kind === 'seal_style');
  const pardons = items.filter((i) => i.kind === 'pardon');
  const ornaments = items.filter((i) => i.kind === 'frame' || i.kind === 'background');

  return (
    <>
      {renderGroup(
        t('rpg.shopGroupSeals', 'Sellos coleccionables'),
        <Sparkle width={12} height={12} style={{ color: 'var(--rubric)' }} />,
        seals,
        t('rpg.shopSealsFoot', 'El lacre del Códice estampa el sello que elijas. La roseta de siempre es tuya y no se va a ningún lado.'),
      )}
      {pardons.length > 0 && <QBDividerSection />}
      {renderGroup(
        t('rpg.shopGroupPardon', 'Indulto extra'),
        <Flame width={12} height={12} style={{ color: 'var(--rubric)' }} />,
        pardons,
        t('rpg.shopPardonFoot', 'Suma un tercer indulto al mes en curso, además de los dos automáticos. Uno por mes, sin acumular.'),
      )}
      {ornaments.length > 0 && <QBDividerSection />}
      {renderGroup(
        t('rpg.shopGroupOrnaments', 'Ornamentos del héroe'),
        <Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />,
        ornaments,
        t('rpg.shopPerDevice', 'Lo comprado te sigue a todas tus máquinas; lo que está en uso se elige en cada una.'),
      )}
    </>
  );
}
