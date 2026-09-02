import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TitleBar from '../shared/components/TitleBar';
import Sidebar from './Sidebar';
import type { ShellProps } from './shell-types';

/** Below this window width the sidebar collapses on its own. */
const AUTO_COLLAPSE_WIDTH = 820;

/**
 * El shell de escritorio, tal como vivía en Layout.tsx: barra de título de
 * Electron, riel fijo de 260/56 px con su botón de colapso y el <main>.
 * Layout lo elige (o a MobileShell) con useShellKind().
 */
export default function DesktopShell({ stats, onBellClick, onToggleInn, children }: ShellProps) {
  const { t } = useTranslation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (localStorage.getItem('hubtify_sidebar_collapsed') === 'true') return true;
    // Below ~820px the expanded rail leaves the content unusable and the 20px
    // toggle is basically undiscoverable, so start compact.
    return window.innerWidth < AUTO_COLLAPSE_WIDTH;
  });

  // Collapse automatically when the window shrinks past the threshold; leave the
  // user's own choice alone once they are back above it.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < AUTO_COLLAPSE_WIDTH) {
        setSidebarCollapsed(prev => (prev ? prev : true));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('hubtify_sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  return (
    <>
      <TitleBar />
      <div className="app-layout" style={{ flex: 1, height: 0 }}>
        <div className={`sidebar-wrapper ${sidebarCollapsed ? 'sidebar-wrapper--collapsed' : ''}`}>
          <Sidebar stats={stats} collapsed={sidebarCollapsed} onBellClick={onBellClick} onToggleInn={onToggleInn} />
          <button onClick={toggleSidebar} className={`sidebar-toggle tap-target ${sidebarCollapsed ? 'sidebar-toggle--collapsed' : ''}`}
            title={sidebarCollapsed ? t('hub.expand', 'Expandir') : t('hub.collapse', 'Colapsar')}
            aria-expanded={!sidebarCollapsed}
            aria-controls="main-sidebar"
            aria-label={t('hub.toggleSidebar', 'Alternar barra lateral')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              style={{ transition: 'transform 0.25s ease', transform: sidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <path d="M9 2L4 7l5 5"/>
            </svg>
          </button>
        </div>
        <main className="main-content">{children}</main>
      </div>
    </>
  );
}
