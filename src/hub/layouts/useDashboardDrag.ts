import { useState, useCallback } from 'react';

export function useDashboardDrag(reorder: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const onDragStart = useCallback((index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, []);

  const onDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  }, []);

  const onDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const onDrop = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      reorder(dragIndex, index);
    }
    setDragIndex(null);
    setDropTargetIndex(null);
  }, [dragIndex, reorder]);

  const onDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTargetIndex(null);
  }, []);

  return { dragIndex, dropTargetIndex, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd };
}
