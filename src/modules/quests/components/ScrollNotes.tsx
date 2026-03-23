import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import parchmentBg from '../../../assets/bg.jpg';

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
const ERASER_SIZE = 18;
const LINE_WIDTH = 2;

type Tool = 'pen' | 'eraser';

export default function ScrollNotes({ taskId, onClose, onCountChanged }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [bgReady, setBgReady] = useState(false);

  // Preload bg image
  useEffect(() => {
    const img = new Image();
    img.src = parchmentBg;
    img.onload = () => { bgImageRef.current = img; setBgReady(true); };
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      ctx.fillStyle = '#f5f0e1';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  }, []);

  const loadDrawings = useCallback(async () => {
    const result = await window.api.questsGetDrawings(taskId);
    setDrawings(result as Drawing[]);
    setLoaded(true);
  }, [taskId]);

  useEffect(() => { loadDrawings(); }, [loadDrawings]);

  // Paint current drawing onto canvas — wait for both data and bg texture
  useEffect(() => {
    if (!loaded || !bgReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    clearCanvas();

    const drawing = drawings[currentIdx];
    if (drawing) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = drawing.data;
    }
    setDirty(false);
  }, [currentIdx, drawings, loaded, bgReady, clearCanvas]);

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
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const onPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = true;
    lastPosRef.current = getPos(e);
    if (tool === 'eraser') {
      eraseAt(getPos(e));
    }
  };

  const eraseAt = (pos: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Save and restore to draw the bg texture in the erased area
    ctx.save();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, ERASER_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      ctx.fillStyle = '#f5f0e1';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    ctx.restore();
    setDirty(true);
  };

  const onPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const pos = getPos(e);

    if (tool === 'eraser') {
      eraseAt(pos);
      lastPosRef.current = pos;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
    clearCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    await window.api.questsSaveDrawing({ taskId, data });
    await loadDrawings();
    onCountChanged?.();
    setCurrentIdx(drawings.length);
  };

  useEffect(() => {
    if (drawings.length > 0 && currentIdx >= drawings.length) {
      setCurrentIdx(drawings.length - 1);
    }
  }, [drawings, currentIdx]);

  const handleClear = () => {
    clearCanvas();
    setDirty(true);
  };

  const handleDelete = async () => {
    const ok = await confirm({ message: t('questify.deleteNoteConfirm'), danger: true, confirmText: t('questify.deleteNote') });
    if (!ok) return;
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

  const bgUrl = new URL('../../../assets/bg.jpg', import.meta.url).href;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.75)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={handleClose}>
      <div style={{
        backgroundImage: `url(${bgUrl})`,
        backgroundSize: '400px',
        backgroundRepeat: 'repeat',
        borderRadius: 6, padding: '16px 20px',
        boxShadow: '0 12px 40px rgba(44,24,16,0.6), 0 0 0 1px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
        border: '3px solid var(--rpg-gold-dark)',
        minWidth: CANVAS_W + 40,
        position: 'relative',
      }} onClick={(e) => e.stopPropagation()}>

        {/* Decorative top edge */}
        <div style={{
          position: 'absolute', top: -3, left: 20, right: 20, height: 3,
          background: 'linear-gradient(90deg, transparent, var(--rpg-gold) 30%, var(--rpg-gold) 70%, transparent)',
        }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          {drawings.length > 1 && (
            <button className="rpg-button" onClick={() => goPage(-1)}
              disabled={currentIdx === 0}
              style={{ padding: '3px 10px', fontSize: '0.9rem' }}>
              ‹
            </button>
          )}
          <span style={{
            flex: 1, textAlign: 'center',
            fontFamily: 'Crimson Text, serif', fontSize: '0.95rem',
            color: 'var(--rpg-ink-light)', opacity: 0.7,
          }}>
            {drawings.length > 0
              ? t('questify.noteOf', { current: currentIdx + 1, total: drawings.length })
              : t('questify.noNotes')}
          </span>
          {drawings.length > 1 && (
            <button className="rpg-button" onClick={() => goPage(1)}
              disabled={currentIdx >= drawings.length - 1}
              style={{ padding: '3px 10px', fontSize: '0.9rem' }}>
              ›
            </button>
          )}
          <button className="rpg-button" onClick={handleNewNote}
            style={{ padding: '4px 12px', fontSize: '0.8rem' }}>
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
            cursor: tool === 'eraser' ? 'cell' : 'crosshair',
            borderRadius: 4,
            border: '1px solid rgba(201,168,76,0.4)',
            display: drawings.length === 0 ? 'none' : 'block',
            width: '100%',
            height: 'auto',
          }}
        />

        {/* Empty state */}
        {drawings.length === 0 && (
          <div style={{
            width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: 0.5, fontStyle: 'italic', fontFamily: 'Crimson Text, serif',
          }}>
            {t('questify.noNotes')}
          </div>
        )}

        {/* Toolbar */}
        {drawings.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
            {/* Pen */}
            <button className="rpg-button" onClick={() => setTool('pen')}
              style={{
                padding: '4px 8px', opacity: tool === 'pen' ? 1 : 0.5,
                background: tool === 'pen' ? 'var(--rpg-gold)' : undefined,
              }}
              title="Lapiz">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M11.5 2.5l2 2M4 10l7-7 2 2-7 7H4v-2z"/>
              </svg>
            </button>

            {/* Eraser */}
            <button className="rpg-button" onClick={() => setTool('eraser')}
              style={{
                padding: '4px 8px', opacity: tool === 'eraser' ? 1 : 0.5,
                background: tool === 'eraser' ? 'var(--rpg-gold)' : undefined,
              }}
              title="Goma">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.5 5.5l-5 5-3-3 5-5z"/>
                <path d="M4.5 10.5l-2 2h5l2-2"/>
              </svg>
            </button>

            <div style={{ flex: 1 }} />

            {/* Clear */}
            <button className="rpg-button" onClick={handleClear}
              style={{ padding: '4px 10px', fontSize: '0.8rem', opacity: 0.6 }}>
              {t('questify.clearCanvas')}
            </button>

            {/* Delete (trash icon) */}
            <button className="rpg-button" onClick={handleDelete}
              style={{ padding: '4px 8px', opacity: 0.4 }}
              title={t('questify.deleteNote')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
