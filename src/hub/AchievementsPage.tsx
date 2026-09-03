import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { BookPage } from '../shared/components/codex';
import { Section, QBDividerSection } from '../shared/components/codex/CodexPrimitives';
import { Chalice, Sparkle, Scroll, Padlock } from '../shared/components/icons';
import { Medallion, SealRosette } from './codex/CodexSealIcons';
import Skeleton from '../shared/components/Skeleton';
import EmptyState from '../shared/components/EmptyState';
import ErrorState from '../shared/components/ErrorState';
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

type AchFilter = 'all' | 'unlocked' | 'locked';

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
            : <Padlock width={22} height={22} />}
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
  const navigate = useNavigate();
  const locale = i18n.language === 'en' ? 'en-US' : 'es-AR';
  const [items, setItems] = useState<AchievementState[] | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * Sin `.catch` el rechazo dejaba `items` en `null` y la página caía en «Todavía
   * no hay nada en el estante»: le decía al usuario que no había ganado nada
   * cuando en realidad la consulta se había caído. Un vacío y un fallo son dos
   * cosas distintas y se dicen distinto.
   */
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<AchFilter>('all');

  const available = codexApiReady();

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    getAchievements({ strict: true })
      .then((list) => { setItems(list); })
      .catch((err) => {
        console.error('[Logros] no se pudo leer el estante', err);
        setLoadError(true);
      })
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
      .map((group) => {
        /* El contador del estante se calcula SOBRE LA LISTA COMPLETA del
           grupo, nunca sobre la filtrada (decisión abierta nº4). Si se contaba
           lo filtrado, el «/ N» cambiaba de significado con el filtro: en
           Pendientes decía «0 / 1» y en Todos «2 / 2» para el MISMO estante.
           Un contador que cambia de denominador según lo que estás mirando
           miente. Ahora dice siempre «obtenidos del grupo / total del grupo»,
           igual que el contador de la cabecera. */
        const all = shelved.filter((s) => s.group === group);
        return {
          group,
          total: all.length,
          unlocked: all.filter((s) => s.unlocked).length,
          items: all
            .filter((s) => (filter === 'all' ? true : filter === 'unlocked' ? s.unlocked : !s.unlocked))
            .sort((a, b) => a.order - b.order),
        };
      })
      // Una estantería vacía bajo el filtro no se dibuja: nada de títulos
      // colgando sobre la nada.
      .filter((s) => s.items.length > 0);
  }, [items, filter]);

  const unlockedCount = items?.filter((a) => a.unlocked).length ?? 0;
  const total = Math.max(items?.length ?? 0, catalogSize());
  const lockedCount = (items?.length ?? 0) - unlockedCount;
  const pct = total > 0 ? Math.round((unlockedCount / total) * 100) : 0;

  const FILTERS: Array<{ key: AchFilter; label: string; count: number }> = [
    { key: 'all', label: t('rpg.achFilterAll', 'Todos'), count: items?.length ?? 0 },
    { key: 'unlocked', label: t('rpg.achFilterUnlocked', 'Obtenidos'), count: unlockedCount },
    { key: 'locked', label: t('rpg.achFilterLocked', 'Pendientes'), count: lockedCount },
  ];

  const body = (() => {
    if (!available) {
      return (
        <EmptyState
          icon={<Padlock width={32} height={32} />}
          message={t('rpg.achUnavailable', 'Los logros todavía no están disponibles en esta versión.')}
        />
      );
    }
    /* Un esqueleto con la forma de la estantería en vez de la brújula: el ojo
       ya sabe dónde van a caer los medallones antes de que lleguen. */
    if (loading && !items) {
      return <Skeleton variant="card" count={4} label={t('rpg.achEyebrow', 'ESTANTE DE LOS LOGROS')} />;
    }
    if (loadError) {
      return (
        <ErrorState
          message={t('rpg.achLoadFailed', 'No se pudo abrir el estante de los logros.')}
          onRetry={load}
        />
      );
    }
    if (!items || items.length === 0) {
      return (
        <EmptyState
          icon={<Chalice width={32} height={32} />}
          message={t('rpg.achEmpty', 'Todavía no hay nada en el estante. Se llena solo, jugando.')}
          action={{
            label: t('rpg.achGoPlay', 'Ir al tablero'),
            onClick: () => navigate('/'),
          }}
        />
      );
    }
    return (
      <>
        {/* Barra de avance + filtro. Los juegos ponen esto arriba de todo: te
            dice dónde estás antes de que empieces a mirar medallones. */}
        <div className="ach-toolbar">
          <div className="ach-progress" role="img"
            aria-label={t('rpg.achProgressLabel', '{{done}} de {{total}} logros obtenidos', { done: unlockedCount, total })}>
            <div className="ach-progress__track">
              <div className="ach-progress__fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="ach-progress__pct">{pct}%</span>
          </div>
          <div className="ach-filter" role="group"
            aria-label={t('rpg.achFilterLabel', 'Filtrar logros')}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`ach-filter__btn${filter === f.key ? ' ach-filter__btn--on' : ''}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="ach-filter__count">{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* El hueco del filtro tenía el filtro JUSTO ARRIBA y no ofrecía
            volver: la salida ahora vive dentro del hueco, como manda C8. */}
        {shelves.length === 0 && (
          <EmptyState
            icon={<Sparkle width={32} height={32} />}
            message={filter === 'unlocked'
              ? t('rpg.achNoneUnlocked', 'Todavía no ganaste ninguno. El estante espera.')
              : t('rpg.achAllUnlocked', 'No queda ninguno pendiente. Los tenés todos.')}
            action={{
              label: t('rpg.achClearFilter', 'Ver todos'),
              onClick: () => setFilter('all'),
            }}
          />
        )}

        {shelves.map(({ group, items: groupItems, total: groupTotal, unlocked: groupUnlocked }, i) => (
          <div key={group}>
            {i > 0 && <QBDividerSection />}
            <Section
              title={groupTitle(group, t).toUpperCase()}
              icon={group === 'codex'
                ? <SealRosette width={12} height={12} style={{ color: 'var(--rubric)' }} />
                : <Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />}
              rightSlot={
                <span className="ach-counter__total" data-group={group}>
                  {groupUnlocked}/{groupTotal}
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
