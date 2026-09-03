import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAnchoredPopup } from '../../../shared/hooks/useAnchoredPopup';
import EmptyState from '../../../shared/components/EmptyState';
import { Sword } from '../../../shared/components/icons/CodexIcons';
import { UNLABELED_POTION_COLOR } from '../types';

/** Una misión abierta, tal como la devuelve `quests:getTasks`. */
export interface MissionOption {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string;
}

interface RawTask {
  id: string;
  name: string;
  status: number;
  projectId: string | null;
}

interface RawProject {
  id: string;
  name: string;
  color: string;
}

/** A partir de cuántas misiones aparece el buscador. */
const SEARCH_THRESHOLD = 8;

/**
 * Carga las misiones ABIERTAS agrupadas por proyecto.
 *
 * Se apoya en los canales de quests que ya expone preload — el caldero no
 * necesita una API propia para leer misiones, es la misma base.
 */
export function useOpenMissions(enabled: boolean) {
  const [missions, setMissions] = useState<MissionOption[]>([]);

  const load = useCallback(() => {
    if (!enabled) return;
    Promise.all([window.api.questsGetTasks(), window.api.questsGetProjects()])
      .then(([rawTasks, rawProjects]) => {
        const projects = rawProjects as RawProject[];
        const byId = new Map(projects.map((p) => [p.id, p]));
        const open = (rawTasks as RawTask[])
          .filter((t) => !t.status)
          .map<MissionOption>((t) => {
            const project = t.projectId ? byId.get(t.projectId) : undefined;
            return {
              id: t.id,
              name: t.name,
              projectId: t.projectId ?? null,
              projectName: project?.name ?? null,
              projectColor: project?.color ?? UNLABELED_POTION_COLOR,
            };
          });
        setMissions(open);
      })
      .catch(() => setMissions([]));
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);

  return { missions, reloadMissions: load };
}

interface Props {
  missions: MissionOption[];
  /** La misión ya vinculada, para marcarla. */
  selectedId: string | null;
  /** `null` = desvincular. Elegir NUNCA es requisito de nada. */
  onPick: (taskId: string | null) => void;
  /** El disparador: un enlace tenue, nunca un botón que compita con el play. */
  label: string;
  className?: string;
  disabled?: boolean;
}

/**
 * «¿Sobre qué misión?» — el vínculo opcional con Questify.
 *
 * Vive SIEMPRE debajo del botón grande y en tono secundario: elegir una misión
 * no es un peaje antes de encender el caldero (ese fue el error de Focus To-Do,
 * que puso la fricción antes del play). Se puede abrir durante el foco o al
 * terminarlo — que es justo cuando uno sabe qué hizo.
 */
export default function MissionPicker({
  missions,
  selectedId,
  onPick,
  label,
  className,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const closePicker = useCallback(() => setOpen(false), []);
  const { anchorRef, popupRef, pos } = useAnchoredPopup<HTMLButtonElement, HTMLDivElement>(open, 4, { onClose: closePicker });
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = missions.length > SEARCH_THRESHOLD;

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    if (showSearch) searchRef.current?.focus();
  }, [open, showSearch]);

  // Cerrar al clickear afuera o con Escape — mismo gesto que el resto de los
  // popovers anclados de la app.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popupRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef, popupRef]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? missions.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            (m.projectName ?? '').toLowerCase().includes(q),
        )
      : missions;

    const map = new Map<string, { name: string; color: string; items: MissionOption[] }>();
    for (const m of filtered) {
      const key = m.projectId ?? '';
      let group = map.get(key);
      if (!group) {
        group = {
          name: m.projectName ?? t('cauldron.mission.noProject', 'Sin proyecto'),
          color: m.projectColor,
          items: [],
        };
        map.set(key, group);
      }
      group.items.push(m);
    }
    // Las sueltas al final: los proyectos son el orden natural de lectura.
    return Array.from(map.entries())
      .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : 0))
      .map(([id, g]) => ({ id, ...g }));
  }, [missions, query, t]);

  const choose = (taskId: string | null) => {
    onPick(taskId);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`cauldron-mission-trigger${className ? ` ${className}` : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && createPortal(
        <div
          ref={popupRef}
          className="cauldron-mission-popover"
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
        >
          {showSearch && (
            <input
              ref={searchRef}
              className="cauldron-mission-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('cauldron.mission.search', 'Buscar misión…')}
              aria-label={t('cauldron.mission.search', 'Buscar misión…')}
            />
          )}

          <div className="cauldron-mission-list">
            {selectedId && (
              <button
                type="button"
                role="menuitem"
                className="cauldron-mission-item cauldron-mission-item--clear"
                onClick={() => choose(null)}
              >
                {t('cauldron.mission.clear', 'Sin misión')}
              </button>
            )}

            {/* Era una frase suelta. Con búsqueda escrita, la salida obvia es
                borrarla —el desplegable no puede ofrecer «anotá una misión» sin
                cerrarse encima de lo que el usuario estaba haciendo—. */}
            {groups.length === 0 && (
              <EmptyState
                compact
                icon={<Sword width={20} height={20} />}
                message={missions.length === 0
                  ? t('cauldron.mission.noneOpen', 'No hay misiones abiertas.')
                  : t('cauldron.mission.noMatches', 'Ninguna misión coincide.')}
                action={query.trim()
                  ? { label: t('cauldron.mission.clearSearch', 'Borrar la búsqueda'), onClick: () => { setQuery(''); searchRef.current?.focus(); } }
                  : undefined}
              />
            )}

            {groups.map((group) => (
              <div key={group.id || '_loose'} className="cauldron-mission-group">
                <div className="cauldron-mission-group-head">
                  <span
                    className="cauldron-mission-swatch"
                    style={{ background: group.color }}
                    aria-hidden="true"
                  />
                  {group.name}
                </div>
                {group.items.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitem"
                    className={`cauldron-mission-item${m.id === selectedId ? ' selected' : ''}`}
                    onClick={() => choose(m.id)}
                    title={m.name}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
