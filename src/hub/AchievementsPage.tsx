import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { BookPage } from '../shared/components/codex';
import { Section, QBDividerSection } from '../shared/components/codex/CodexPrimitives';
import { Chalice, Sparkle, Scroll } from '../shared/components/icons';
import { Medallion, SealRosette } from './codex/CodexSealIcons';
import Loading from '../shared/components/Loading';
import {
  type AchievementGroup,
  GROUP_ORDER,
  catalogEntry,
  catalogSize,
  descKey,
  humanise,
  titleKey,
} from './codex/achievementCatalog';
import {
  type AchievementState,
  CODEX_SEALED_EVENT,
  codexApiReady,
  getAchievements,
} from './codex/codexApi';
import './styles/codex-seal.css';

interface Shelved extends AchievementState {
  group: AchievementGroup;
  order: number;
}

function groupTitle(group: AchievementGroup, t: TFunction): string {
  switch (group) {
    case 'starts': return t('rpg.achGroupStarts', 'Primeros pasos');
    case 'rhythm': return t('rpg.achGroupRhythm', 'Ritmo y tiempo');
    case 'mastery': return t('rpg.achGroupMastery', 'Maestría');
    case 'quests': return t('rpg.achGroupQuests', 'Del Questify');
    case 'nutrition': return t('rpg.achGroupNutrition', 'Del Nutrify');
    case 'finance': return t('rpg.achGroupFinance', 'Del Coinify');
    case 'cauldron': return t('rpg.achGroupCauldron', 'Del Caldero');
    case 'codex': return t('rpg.achGroupCodex', 'Del Códice');
    case 'chronicle': return t('rpg.achGroupChronicle', 'Cronista');
    case 'progress': return t('rpg.achGroupProgress', 'Progresión');
    case 'hidden': return t('rpg.achGroupHidden', 'Ocultos');
    default: return t('rpg.achGroupOther', 'Del héroe');
  }
}

function formatDate(iso: string | undefined, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── one medallion ────────────────────────────────── */

function AchievementCard({ item, locale, t }: { item: Shelved; locale: string; t: TFunction }) {
  const secret = item.hidden && !item.unlocked;
  const cls = item.unlocked
    ? 'ach-card ach-card--unlocked'
    : secret
      ? 'ach-card ach-card--secret'
      : 'ach-card ach-card--locked';

  const title = secret ? '???' : t(titleKey(item.id), humanise(item.id));
  const desc = secret
    ? t('rpg.achSecretDesc', 'Algo espera a ser encontrado.')
    : t(descKey(item.id), '');
  const when = formatDate(item.unlockedAt, locale);

  return (
    <div className={cls}>
      <span className="ach-card__medal" aria-hidden="true">
        {item.unlocked
          ? <Medallion width={26} height={26} />
          : secret
            ? <Sparkle width={20} height={20} />
            : <Medallion width={24} height={24} />}
      </span>
      <div className="ach-card__body">
        <div className="ach-card__title">{title}</div>
        {desc && desc !== descKey(item.id) && <p className="ach-card__desc">{desc}</p>}
        {item.unlocked && when && (
          <div className="ach-card__date">
            {t('rpg.achUnlockedOn', 'Obtenido')} {when}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the page ─────────────────────────────────────── */

export default function AchievementsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'en' ? 'en-US' : 'es-AR';
  const [items, setItems] = useState<AchievementState[] | null>(null);
  const [loading, setLoading] = useState(true);

  const available = codexApiReady();

  const load = useCallback(() => {
    setLoading(true);
    getAchievements()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Mandatory for anything that reads backend data, plus a refresh after a
  // seal — that is the moment achievements most often flip.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    window.addEventListener(CODEX_SEALED_EVENT, handler);
    window.addEventListener('rpg:achievementUnlocked', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener(CODEX_SEALED_EVENT, handler);
      window.removeEventListener('rpg:achievementUnlocked', handler);
    };
  }, [load]);

  const shelves = useMemo(() => {
    if (!items) return [];
    const shelved: Shelved[] = items.map((a) => {
      const entry = catalogEntry(a.id);
      // A hidden achievement that HAS been earned is no longer a secret: it
      // moves out of the "ocultos" shelf and onto the one it belongs to.
      const group: AchievementGroup = a.hidden && !a.unlocked ? 'hidden' : entry.group;
      return { ...a, group, order: entry.order };
    });

    return GROUP_ORDER
      .map((group) => ({
        group,
        items: shelved.filter((s) => s.group === group).sort((a, b) => a.order - b.order),
      }))
      .filter((s) => s.items.length > 0);
  }, [items]);

  const unlockedCount = items?.filter((a) => a.unlocked).length ?? 0;
  const total = Math.max(items?.length ?? 0, catalogSize());

  const body = (() => {
    if (!available) {
      return (
        <p className="ach-empty">
          {t('rpg.achUnavailable', 'Los logros todavía no están disponibles en esta versión.')}
        </p>
      );
    }
    if (loading && !items) return <Loading />;
    if (!items || items.length === 0) {
      return (
        <p className="ach-empty">
          {t('rpg.achEmpty', 'Todavía no hay nada en el estante. Se llena solo, jugando.')}
        </p>
      );
    }
    return (
      <>
        {shelves.map(({ group, items: groupItems }, i) => (
          <div key={group}>
            {i > 0 && <QBDividerSection />}
            <Section
              title={groupTitle(group, t).toUpperCase()}
              icon={group === 'codex'
                ? <SealRosette width={12} height={12} style={{ color: 'var(--rubric)' }} />
                : <Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />}
              rightSlot={
                <span className="ach-counter__total">
                  {groupItems.filter((a) => a.unlocked).length}/{groupItems.length}
                </span>
              }
            >
              <div className="ach-shelf">
                {groupItems.map((item) => (
                  <AchievementCard key={item.id} item={item} locale={locale} t={t} />
                ))}
              </div>
            </Section>
          </div>
        ))}
      </>
    );
  })();

  return (
    <BookPage
      eyebrow={
        <>
          <Sparkle width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
          {t('rpg.achEyebrow', 'ESTANTE DE LOS LOGROS')}
        </>
      }
      title={t('nav.achievements', 'Logros')}
      subtitle={t('rpg.achSubtitle', 'Dó se guardan los medallones ganados y los que aún esperan dueño')}
      headerExtra={
        <div className="ach-counter">
          <Chalice width={16} height={16} />
          <span>{unlockedCount}</span>
          <span className="ach-counter__total">/ {total}</span>
        </div>
      }
    >
      {body}
    </BookPage>
  );
}
