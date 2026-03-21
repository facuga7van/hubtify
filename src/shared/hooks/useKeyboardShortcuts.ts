import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '1': e.preventDefault(); navigate('/'); break;
          case '2': e.preventDefault(); navigate('/quests'); break;
          case '3': e.preventDefault(); navigate('/nutrition'); break;
          case '4': e.preventDefault(); navigate('/finance'); break;
          case '5': e.preventDefault(); navigate('/character'); break;
          case ',': e.preventDefault(); navigate('/settings'); break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
