import React from 'react';
import { useTranslation } from 'react-i18next';
import { ModuleCard } from '../../shared/components/codex';
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
  isDragging,
  isDropTarget,
  onCycleColSpan,
  onCycleRowSpan,
  dragHandlers,
  title,
  tome,
  latin,
  icon,
  navTo,
  children,
}: DashboardWidgetWrapperProps) {
  const { t } = useTranslation();

  const className = [
    'widget-wrapper',
    `widget-span-${colSpan}`,
    rowSpan === 2 ? 'widget-row-2' : '',
    isDragging ? 'widget-dragging' : '',
    isDropTarget ? 'widget-drop-target' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      draggable
      onDragStart={dragHandlers.onDragStart}
      onDragOver={dragHandlers.onDragOver}
      onDragLeave={dragHandlers.onDragLeave}
      onDrop={dragHandlers.onDrop}
      onDragEnd={dragHandlers.onDragEnd}
    >
      {/* Resize buttons */}
      <div className="widget-resize-group">
        <button
          className="widget-resize-btn"
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
          className="widget-resize-btn"
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
        {React.Children.map(children, child =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<{ colSpan?: number; rowSpan?: number }>, { colSpan, rowSpan })
            : child
        )}
      </ModuleCard>
    </div>
  );
}
