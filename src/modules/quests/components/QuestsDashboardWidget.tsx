import { useState, useEffect, useCallback } from 'react';
import Loading from '../../../shared/components/Loading';

export default function QuestsDashboardWidget() {
  const [pendingCount, setPendingCount] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadCounts = useCallback(() => {
    Promise.all([
      window.api.questsGetPendingCount(),
      window.api.questsGetCompletedTodayCount(),
    ]).then(([p, c]) => {
      setPendingCount(p);
      setCompletedToday(c);
      setLoading(false);
    }).catch(console.error);
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  useEffect(() => {
    const handler = () => loadCounts();
    window.addEventListener('sync:questsUpdated', handler);
    return () => window.removeEventListener('sync:questsUpdated', handler);
  }, [loadCounts]);

  if (loading) return <Loading size="sm" />;

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
