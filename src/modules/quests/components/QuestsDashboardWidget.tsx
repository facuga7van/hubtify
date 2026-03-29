import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Loading from '../../../shared/components/Loading';

export default function QuestsDashboardWidget() {
  const { t } = useTranslation();
  const [pendingCount, setPendingCount] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadCounts = useCallback(() => {
    Promise.all([
      window.api.questsGetPendingCount(),
      window.api.questsGetCompletedTodayCount(),
    ]).then(([p, c]) => {
      setPendingCount(p);
      setCompletedToday(c);
      setLoading(false);
    }).catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  useEffect(() => {
    const handler = () => loadCounts();
    window.addEventListener('sync:questsUpdated', handler);
    return () => window.removeEventListener('sync:questsUpdated', handler);
  }, [loadCounts]);

  if (loading) return <Loading size="sm" />;
  if (loadError) return <p style={{ fontSize: '0.8rem', color: 'var(--rpg-hp-red)' }}>{t('common.somethingWentWrong')}</p>;

  return (
    <div>
      <p style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
        {completedToday} <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>done today</span>
      </p>
      <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: 4 }}>
        {pendingCount} quests pending
      </p>
    </div>
  );
}
