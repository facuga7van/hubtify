import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface Drawing {
  id: string;
  taskId: string;
  data: string;
  order: number;
  createdAt: string;
}

interface Props {
  taskId: string;
  onClose: () => void;
  onCountChanged?: () => void;
}

const CANVAS_W = 500;
const CANVAS_H = 350;
const INK_COLOR = '#3a2a1a';
const PARCHMENT_BG = '#f5f0e1';
const LINE_WIDTH = 2;

export default function ScrollNotes({ taskId, onClose, onCountChanged }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load drawings
  const loadDrawings = useCallback(async () => {
    const result = await window.api.questsGetDrawings(taskId);
    setDrawings(result as Drawing[]);
    setLoaded(true);
  }, [taskId]);

  useEffect(() => { loadDrawings(); }, [loadDrawings]);

  // Paint current drawing onto canvas when index changes or drawings load
  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear to parchment
    ctx.fillStyle = PARCHMENT_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const drawing = drawings[currentIdx];
    if (drawing) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = drawing.data;
    }
    setDirty(false);
  }, [currentIdx, drawings, loaded]);

  // Save current canvas to DB
  const saveCurrent = useCallback(async () => {
    if (!dirty) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    const drawing = drawings[currentIdx];
    if (drawing) {
      await window.api.questsSaveDrawing({ id: drawing.id, taskId, data });
    }
    setDirty(false);
  }, [dirty, drawings, currentIdx, taskId]);

  // Drawing handlers
  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = true;
    lastPosRef.current = getPos(e);
  };

  const onPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPosRef.current = pos;
    setDirty(true);
  };

  const onPointerUp = () => {
    isDrawingRef.current = false;
  };

  // Actions
  const handleNewNote = async () => {
    await saveCurrent();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = PARCHMENT_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const data = canvas.toDataURL('image/png');
    await window.api.questsSaveDrawing({ taskId, data });
    await loadDrawings();
    onCountChanged?.();
    setCurrentIdx(drawings.length); // will be updated after loadDrawings
  };

  // After loadDrawings, fix currentIdx to point to the new note
  useEffect(() => {
    if (drawings.length > 0 && currentIdx >= drawings.length) {
      setCurrentIdx(drawings.length - 1);
    }
  }, [drawings, currentIdx]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = PARCHMENT_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    setDirty(true);
  };

  const handleDelete = async () => {
    if (!confirm(t('questify.deleteNoteConfirm'))) return;
    const drawing = drawings[currentIdx];
    if (drawing) {
      await window.api.questsDeleteDrawing(drawing.id);
      await loadDrawings();
      onCountChanged?.();
      if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
    }
  };

  const goPage = async (delta: number) => {
    await saveCurrent();
    setCurrentIdx((prev) => Math.max(0, Math.min(drawings.length - 1, prev + delta)));
  };

  const handleClose = async () => {
    await saveCurrent();
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.75)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={handleClose}>
      <div style={{
        background: `linear-gradient(135deg, #e8dcc8 0%, ${PARCHMENT_BG} 30%, #ede5d0 70%, #e0d5be 100%)`,
        borderRadius: 8, padding: 20,
        boxShadow: '0 8px 32px rgba(44,24,16,0.5), inset 0 1px 0 rgba(255,255,255,0.3)',
        border: '2px solid var(--rpg-gold-dark)',
        minWidth: CANVAS_W + 40,
      }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {drawings.length > 1 && (
            <button className="rpg-button" onClick={() => goPage(-1)}
              disabled={currentIdx === 0}
              style={{ padding: '3px 8px', fontSize: '0.85rem' }}>
              ≪
            </button>
          )}
          <span style={{ flex: 1, textAlign: 'center', fontFamily: 'Crimson Text, serif', fontSize: '0.95rem', color: 'var(--rpg-ink-light)' }}>
            {drawings.length > 0
              ? t('questify.noteOf', { current: currentIdx + 1, total: drawings.length })
              : t('questify.noNotes')}
          </span>
          {drawings.length > 1 && (
            <button className="rpg-button" onClick={() => goPage(1)}
              disabled={currentIdx >= drawings.length - 1}
              style={{ padding: '3px 8px', fontSize: '0.85rem' }}>
              ≫
            </button>
          )}
          <button className="rpg-button" onClick={handleNewNote}
            style={{ padding: '3px 10px', fontSize: '0.8rem' }}>
            + {t('questify.newNote')}
          </button>
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          style={{
            cursor: 'crosshair',
            borderRadius: 4,
            border: '1px solid var(--rpg-gold-dark)',
            display: drawings.length === 0 ? 'none' : 'block',
          }}
        />

        {/* Empty state */}
        {drawings.length === 0 && (
          <div style={{
            width: CANVAS_W, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: 0.5, fontStyle: 'italic',
          }}>
            {t('questify.noNotes')}
          </div>
        )}

        {/* Footer */}
        {drawings.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="rpg-button" onClick={handleClear}
              style={{ padding: '3px 10px', fontSize: '0.8rem', opacity: 0.7 }}>
              {t('questify.clearCanvas')}
            </button>
            <button className="rpg-button" onClick={handleDelete}
              style={{ padding: '3px 10px', fontSize: '0.8rem', opacity: 0.5 }}>
              {t('questify.deleteNote')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
