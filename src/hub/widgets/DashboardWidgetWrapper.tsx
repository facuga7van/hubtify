import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModuleCard } from '../../shared/components/codex';
import ErrorBoundary from '../../shared/components/ErrorBoundary';
import ErrorState from '../../shared/components/ErrorState';
import { ResizeHorizontal, ResizeVertical } from '../../shared/components/icons/CodexIcons';
import type { ColSpan, RowSpan } from './widget-registry';

interface DashboardWidgetWrapperProps {
  widgetId: string;
  colSpan: ColSpan;
  rowSpan: RowSpan;
  index: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onCycleColSpan: (id: string) => void;
  onCycleRowSpan: (id: string) => void;
  /** Keyboard reorder: Ctrl+ArrowUp / Ctrl+ArrowDown on the focused card. */
  onMove?: (index: number, direction: -1 | 1) => void;
  dragHandlers: {
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  title: string;
  tome?: string;
  latin?: string;
  icon?: React.ReactNode;
  navTo?: string;
  children: React.ReactNode;
}

export default function DashboardWidgetWrapper({
  widgetId,
  colSpan,
  rowSpan,
  index,
  isDragging,
  isDropTarget,
  onCycleColSpan,
  onCycleRowSpan,
  onMove,
  dragHandlers,
  title,
  tome,
  latin,
  icon,
  navTo,
  children,
}: DashboardWidgetWrapperProps) {
  const { t } = useTranslation();
  // `draggable` used to sit on the whole wrapper, so the card moved when you
  // grabbed it anywhere — including over its own content — while only the
  // header showed `cursor: grab`. Now only the explicit handle arms the drag.
  const [dragArmed, setDragArmed] = useState(false);

  const className = [
    'widget-wrapper',
    `widget-span-${colSpan}`,
    rowSpan === 2 ? 'widget-row-2' : '',
    isDragging ? 'widget-dragging' : '',
    isDropTarget ? 'widget-drop-target' : '',
  ].filter(Boolean).join(' ');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onMove || !(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); onMove(index, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onMove(index, 1); }
  };

  return (
    <div
      className={className}
      draggable={dragArmed}
      onDragStart={dragHandlers.onDragStart}
      onDragOver={dragHandlers.onDragOver}
      onDragLeave={dragHandlers.onDragLeave}
      onDrop={dragHandlers.onDrop}
      onDragEnd={() => { setDragArmed(false); dragHandlers.onDragEnd(); }}
    >
      {/* Controls — hidden until the card is hovered or something inside it has
          focus, so the card no longer wears three stacked icons at all times. */}
      <div className="widget-controls">
        <button
          className="widget-drag-handle tap-target"
          type="button"
          onMouseDown={() => setDragArmed(true)}
          onMouseUp={() => setDragArmed(false)}
          onBlur={() => setDragArmed(false)}
          onKeyDown={handleKeyDown}
          title={t('dashboard.dragWidget', 'Arrastrá para reordenar (Ctrl+↑ / Ctrl+↓)')}
          aria-label={t('dashboard.dragWidget', 'Arrastrá para reordenar (Ctrl+↑ / Ctrl+↓)')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="2" r="1" /><circle cx="8" cy="2" r="1" />
            <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
            <circle cx="4" cy="10" r="1" /><circle cx="8" cy="10" r="1" />
          </svg>
        </button>
        <button
          className="widget-resize-btn tap-target"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCycleColSpan(widgetId);
          }}
          title={t('dashboard.resizeWidget', 'Cambiar ancho')}
          aria-label={`${t('dashboard.resizeWidget', 'Cambiar ancho')}: ${colSpan}/4`}
        >
          <ResizeHorizontal width={14} height={14} />
        </button>
        <button
          className="widget-resize-btn tap-target"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCycleRowSpan(widgetId);
          }}
          title={t('dashboard.resizeHeight', 'Cambiar alto')}
          aria-label={`${t('dashboard.resizeHeight', 'Cambiar alto')}: ${rowSpan}x`}
        >
          <ResizeVertical width={14} height={14} />
        </button>
      </div>

      <ModuleCard
        title={title}
        tome={tome}
        latin={latin}
        icon={icon}
        navTo={navTo}
      >
        {/* Un boundary POR CUADRO. `ErrorBoundary` existía desde siempre y sólo
            se usaba dos veces, las dos en la raíz de `App.tsx`: cualquier
            excepción dentro de un widget del tablero se llevaba puesto el shell
            entero —los otros cuatro cuadros, la barra lateral y todo—. Ahora el
            que se rompe es el que se rompe, y se puede volver a intentar sin
            recargar la app. */}
        <ErrorBoundary
          label={widgetId}
          fallbackRender={(error, reset) => (
            <ErrorState
              compact
              message={t('dashboard.widgetFailed', 'Este cuadro no se pudo dibujar.')}
              detail={error?.message ?? null}
              onRetry={reset}
            />
          )}
        >
          {React.Children.map(children, child =>
            React.isValidElement(child)
              ? React.cloneElement(child as React.ReactElement<{ colSpan?: number; rowSpan?: number }>, { colSpan, rowSpan })
              : child
          )}
        </ErrorBoundary>
      </ModuleCard>
    </div>
  );
}
