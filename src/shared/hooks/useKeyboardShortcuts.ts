import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Don't trigger during guided tour
      if (document.body.dataset.tourActive) return;

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '1': e.preventDefault(); navigate('/'); break;
          case '2': e.preventDefault(); navigate('/quests'); break;
          case '3': e.preventDefault(); navigate('/nutrition'); break;
          case '4': e.preventDefault(); navigate('/finance'); break;
          case '5': e.preventDefault(); navigate('/character'); break;
          case '6': e.preventDefault(); navigate('/cauldron'); break;
          case ',': e.preventDefault(); navigate('/settings'); break;
          case '?': e.preventDefault(); setShortcutModalOpen(true); break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return { shortcutModalOpen, setShortcutModalOpen };
}
