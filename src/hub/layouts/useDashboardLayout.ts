import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_LAYOUT, WIDGET_DEFINITIONS } from '../widgets/widget-registry';
import type { ColSpan, RowSpan, DashboardLayoutState } from '../widgets/widget-registry';

const STORAGE_KEY = 'hubtify:dashboard:layout';

function toggleColSpan(current: ColSpan): ColSpan {
  return current === 2 ? 4 : 2;
}

function toggleRowSpan(current: RowSpan): RowSpan {
  return current === 1 ? 2 : 1;
}

/** Ensure all known widgets present, remove unknown ones, normalize fields. */
function reconcileLayout(stored: DashboardLayoutState): DashboardLayoutState {
  const knownIds = new Set(Object.keys(WIDGET_DEFINITIONS));
  const valid = stored.widgets
    .filter(w => knownIds.has(w.id))
    .map(w => ({
      ...w,
      colSpan: (w.colSpan === 2 || w.colSpan === 4 ? w.colSpan : 2) as ColSpan,
      rowSpan: (w.rowSpan === 1 || w.rowSpan === 2 ? w.rowSpan : 1) as RowSpan,
    }));
  const presentIds = new Set(valid.map(w => w.id));
  const missing = DEFAULT_LAYOUT.widgets.filter(w => !presentIds.has(w.id));
  return { ...stored, widgets: [...valid, ...missing] };
}

function loadFromStorage(): DashboardLayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardLayoutState;
      if (parsed.version === 1 && Array.isArray(parsed.widgets)) {
        return reconcileLayout(parsed);
      }
    }
  } catch { /* corrupt data — use default */ }
  return DEFAULT_LAYOUT;
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayoutState>(loadFromStorage);

  // Persist on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const cycleColSpan = useCallback((widgetId: string) => {
    setLayout(prev => ({
      ...prev,
      widgets: prev.widgets.map(w =>
        w.id === widgetId
          ? { ...w, colSpan: toggleColSpan(w.colSpan) }
          : w
      ),
    }));
  }, []);

  const cycleRowSpan = useCallback((widgetId: string) => {
    setLayout(prev => ({
      ...prev,
      widgets: prev.widgets.map(w =>
        w.id === widgetId
          ? { ...w, rowSpan: toggleRowSpan(w.rowSpan ?? 1) }
          : w
      ),
    }));
  }, []);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setLayout(prev => {
      const next = [...prev.widgets];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...prev, widgets: next };
    });
  }, []);

  return { layout, cycleColSpan, cycleRowSpan, reorder };
}
