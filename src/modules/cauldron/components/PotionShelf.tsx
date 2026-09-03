import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PotionJar from './PotionJar';
import type { CauldronShelfSession, CauldronWeekTaskRow } from '../types';

interface Props {
  sessions: CauldronShelfSession[];
  week: CauldronWeekTaskRow[];
  hasMore: boolean;
  onLoadMore: () => void;
}

/** Clave de día LOCAL. `startedAt` es un instante UTC: un slice(0,10) rodaría a las 21:00 en UTC-3. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * El Estante de Pociones.
 *
 * Reemplaza al viejo «Historial de sesiones» (una lista de texto plano que nadie
 * miraba dos veces). Cada enfoque completado deposita un frasco; cada enfoque
 * abandonado pasado el umbral deja uno roto EN EL MISMO LUGAR. El estante solo
 * crece — nunca se vacía, nunca se resetea. Esa permanencia es el mecanismo:
 * lo que se acumula tiene valor, y lo que tiene valor cuesta romper.
 */
export default function PotionShelf({ sessions, week, hasMore, onLoadMore }: Props) {
  const { t } = useTranslation();

  /** Frascos agrupados por día; el día es la repisa. */
  const shelves = useMemo(() => {
    const map = new Map<string, CauldronShelfSession[]>();
    for (const s of sessions) {
      const key = localDayKey(s.startedAt);
      const bucket = map.get(key);
      if (bucket) bucket.push(s);
      else map.set(key, [s]);
    }
    return Array.from(map.entries());
  }, [sessions]);

  /**
   * La respuesta a «¿en qué se me fue el foco?», en una línea y sin un gráfico
   * más: «Esta semana: 9 pociones — 5 de Trabajo, 3 de Facultad, 1 suelta».
   */
  const weekSummary = useMemo(() => {
    if (week.length === 0) return null;

    const total = week.reduce((sum, r) => sum + r.sessions, 0);
    if (total === 0) return null;

    // Se agrupa por PROYECTO: la pregunta es en qué se fue el foco, no en qué
    // tarea puntual. Sin misión y misión sin proyecto caen juntas en «sueltas».
    const byProject = new Map<string, { name: string; count: number }>();
    let loose = 0;
    for (const row of week) {
      if (row.projectId && row.projectName) {
        const entry = byProject.get(row.projectId);
        if (entry) entry.count += row.sessions;
        else byProject.set(row.projectId, { name: row.projectName, count: row.sessions });
      } else {
        loose += row.sessions;
      }
    }

    const parts = Array.from(byProject.values())
      .sort((a, b) => b.count - a.count)
      .map((p) => t('cauldron.shelf.ofProject', '{{count}} de {{project}}', {
        count: p.count,
        project: p.name,
      }));

    if (loose > 0) {
      parts.push(
        loose === 1
          ? t('cauldron.shelf.looseOne', '{{count}} suelta', { count: loose })
          : t('cauldron.shelf.looseMany', '{{count}} sueltas', { count: loose }),
      );
    }

    return t('cauldron.shelf.weekSummary', 'Esta semana: {{count}} pociones — {{breakdown}}', {
      count: total,
      breakdown: parts.join(', '),
    });
  }, [week, t]);

  const dayLabel = (key: string): string => {
    const today = localDayKey(new Date().toISOString());
    if (key === today) return t('cauldron.shelf.today', 'Hoy');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === localDayKey(yesterday.toISOString())) {
      return t('cauldron.shelf.yesterday', 'Ayer');
    }
    return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  };

  /** Hora, duración, misión — y en los rotos, hasta dónde llegó. */
  const jarTitle = (s: CauldronShelfSession): string => {
    const time = new Date(s.startedAt).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const mission = s.taskName
      ? s.projectName
        ? `${s.taskName} (${s.projectName})`
        : s.taskName
      : t('cauldron.shelf.unlabeled', 'sin etiqueta');
    const duration = s.abandoned
      ? t('cauldron.shelf.abandonedAt', 'abandonada a los {{minutes}} min', {
          minutes: s.elapsedMinutes ?? 0,
        })
      : t('cauldron.history.duration', '{{minutes}} min', { minutes: s.durationMinutes });
    // Retroactiva: se dice en el tooltip, además del borde punteado. Que el
    // estante no mienta, pero sin castigar.
    const retroMark = s.retroactive
      ? ` · ${t('cauldron.retro.jarMark', 'registrada a mano')}`
      : '';
    return `${time} · ${duration}${retroMark}\n${mission}`;
  };

  if (sessions.length === 0) {
    return (
      <div className="cauldron-empty-state">
        {t('cauldron.shelf.empty', 'El estante está vacío. La primera poción lo estrena.')}
      </div>
    );
  }

  return (
    <div className="cauldron-shelf">
      {weekSummary && <p className="cauldron-shelf-summary">{weekSummary}</p>}

      {shelves.map(([day, jars]) => (
        <div key={day} className="cauldron-shelf-row">
          {/* El día encabeza su renglón, como el rótulo de una fila de libro
              mayor. Antes colgaba del borde derecho de la repisa, sobre madera
              oscura y a 1580 px de sus propios frascos. */}
          <span className="cauldron-shelf-day">{dayLabel(day)}</span>
          <div className="cauldron-shelf-jars">
            {jars.map((s) => (
              <PotionJar
                key={s.id}
                id={s.id}
                color={s.projectColor}
                broken={s.abandoned}
                retroactive={!!s.retroactive}
                title={jarTitle(s)}
              />
            ))}
          </div>
          {/* La repisa: la tabla de madera sobre la que se apoyan los frascos. */}
          <div className="cauldron-shelf-plank" />
        </div>
      ))}

      {hasMore && (
        <button className="cauldron-btn cauldron-load-more" onClick={onLoadMore}>
          {t('cauldron.history.loadMore', 'Cargar más')}
        </button>
      )}
    </div>
  );
}
