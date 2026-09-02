import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import HelpBubble from '../../../shared/components/HelpBubble';
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
const LINE_WIDTH = 2;
const UNDO_WINDOW_MS = 8000;

type SaveState = 'idle' | 'saving' | 'saved';

export default function ScrollNotes({ taskId, onClose, onCountChanged }: Props) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const undoTimerRef = useRef<number | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [bgReady, setBgReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [undoSnapshot, setUndoSnapshot] = useState<string | null>(null);

  // Preload bg image
  useEffect(() => {
    const img = new Image();
    img.src = parchmentBg;
    img.onload = () => { bgImageRef.current = img; setBgReady(true); };
  }, []);

  useEffect(() => () => {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
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

  useEffect(() => {
    const handler = () => loadDrawings();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadDrawings]);

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
      setSaveState('saving');
      await window.api.questsSaveDrawing({ id: drawing.id, taskId, data });
      setSaveState('saved');
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
  };

  const onPointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const pos = getPos(e);

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
    setSaveState('idle');
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
    setCurrentIdx(Number.MAX_SAFE_INTEGER);
  };

  useEffect(() => {
    if (drawings.length > 0 && currentIdx >= drawings.length) {
      setCurrentIdx(drawings.length - 1);
    }
  }, [drawings, currentIdx]);

  /* Clearing used to be one silent click away from an auto-saved blank page.
     Now it asks first, and keeps the previous pixels around for a few seconds. */
  const handleClear = async () => {
    const ok = await confirm({
      message: t('questify.clearCanvasConfirm', '¿Limpiar este pergamino? Se borrará todo lo dibujado en esta página.'),
      danger: true,
      confirmText: t('questify.clearCanvas'),
    });
    if (!ok) return;
    const canvas = canvasRef.current;
    const snapshot = canvas ? canvas.toDataURL('image/png') : null;
    clearCanvas();
    setDirty(true);
    setSaveState('idle');
    if (snapshot) {
      setUndoSnapshot(snapshot);
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => setUndoSnapshot(null), UNDO_WINDOW_MS);
    }
  };

  const handleUndoClear = () => {
    const snapshot = undoSnapshot;
    if (!snapshot) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      clearCanvas();
      ctx.drawImage(img, 0, 0);
      setDirty(true);
      setSaveState('idle');
    };
    img.src = snapshot;
    setUndoSnapshot(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
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
    setUndoSnapshot(null);
    setCurrentIdx((prev) => Math.max(0, Math.min(drawings.length - 1, prev + delta)));
  };

  const handleClose = useCallback(async () => {
    await saveCurrent();
    onClose();
  }, [saveCurrent, onClose]);

  // Escape / focus trap / focus restore — and, crucially, focus is set ONCE on
  // mount instead of on every stroke (the old inline `ref={el => el?.focus()}`).
  const { dialogProps, stopPropagation } = useModalA11y<HTMLDivElement>({ onClose: handleClose });

  const statusText =
    saveState === 'saving' ? t('questify.saving', 'Guardando…')
      : dirty ? t('questify.unsaved', 'Sin guardar')
        : saveState === 'saved' ? t('questify.saved', 'Guardado')
          : '';

  const bgUrl = parchmentBg;

  return (
    <div className="quest-notes-overlay" onClick={handleClose}>
      <div
        {...dialogProps}
        className="quest-notes-dialog"
        aria-label={t('questify.scrollNotes', 'Notas')}
        style={{
          backgroundImage: `url(${bgUrl})`,
          backgroundSize: '400px',
          backgroundRepeat: 'repeat',
          borderRadius: 6, padding: '16px 20px',
          boxShadow: '0 12px 40px rgba(44,24,16,0.6), 0 0 0 1px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
          border: '3px solid var(--gold-dark)',
          position: 'relative',
        }}
        onClick={stopPropagation}
      >
        {/* Close first in the DOM: it takes the initial focus and it is the safe action. */}
        <button
          type="button"
          className="quest-modal-close tap-target"
          onClick={handleClose}
          aria-label={t('questify.close', 'Cerrar')}
          title={t('questify.close', 'Cerrar')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="M2 2l10 10M12 2L2 12"/>
          </svg>
        </button>

        {/* Decorative top edge */}
        <div style={{
          position: 'absolute', top: -3, left: 20, right: 20, height: 3,
          background: 'linear-gradient(90deg, transparent, var(--gold) 30%, var(--gold) 70%, transparent)',
        }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingRight: 32 }}>
          {drawings.length > 1 && (
            <button className="rpg-button" onClick={() => goPage(-1)}
              disabled={currentIdx === 0}
              aria-label={t('questify.previousPage', 'Página anterior')}
              style={{ padding: '3px 10px', fontSize: 'var(--fs-quote)' }}>
              &lsaquo;
            </button>
          )}
          <span style={{
            flex: 1, textAlign: 'center',
            fontFamily: "'IM Fell English', serif", fontSize: 'var(--fs-body)',
            color: 'var(--ink-soft)',
          }}>
            {drawings.length > 0
              ? t('questify.noteOf', { current: currentIdx + 1, total: drawings.length })
              : t('questify.noNotes')}
            {' '}<HelpBubble variant="inline" text={t('questify.scrollNotesHelp', 'Pergaminos: dibujá apuntes a mano alzada para cada misión. Podés crear varias páginas.')} />
          </span>
          {drawings.length > 1 && (
            <button className="rpg-button" onClick={() => goPage(1)}
              disabled={currentIdx >= drawings.length - 1}
              aria-label={t('questify.nextPage', 'Página siguiente')}
              style={{ padding: '3px 10px', fontSize: 'var(--fs-quote)' }}>
              &rsaquo;
            </button>
          )}
          <button className="rpg-button" onClick={handleNewNote}
            style={{ padding: '4px 12px', fontSize: 'var(--fs-label)' }}>
            + {t('questify.newNote')}
          </button>
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{
            cursor: 'crosshair',
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
            opacity: 0.65, fontStyle: 'italic', fontFamily: "'IM Fell English', serif",
          }}>
            {t('questify.noNotes')}
          </div>
        )}

        {/* Toolbar */}
        {drawings.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="quest-notes-status" aria-live="polite">{statusText}</span>

            {undoSnapshot && (
              <button className="rpg-button" onClick={handleUndoClear}
                style={{ padding: '4px 10px', fontSize: 'var(--fs-label)' }}>
                {t('questify.undoClear', 'Deshacer')}
              </button>
            )}

            <div style={{ flex: 1 }} />

            <button className="rpg-button" onClick={saveCurrent} disabled={!dirty}
              style={{ padding: '4px 10px', fontSize: 'var(--fs-label)' }}>
              {t('questify.save')}
            </button>

            {/* Clear */}
            <button className="rpg-button" onClick={handleClear}
              style={{ padding: '4px 10px', fontSize: 'var(--fs-label)', opacity: 0.75 }}>
              {t('questify.clearCanvas')}
            </button>

            {/* Delete (trash icon) */}
            <button className="rpg-button" onClick={handleDelete}
              style={{ padding: '4px 8px', opacity: 0.6 }}
              aria-label={t('questify.deleteNote')}
              title={t('questify.deleteNote')}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
                <path d="M2 4h10M5 4V2.5h4V4M3.5 4l.7 8h5.6l.7-8"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
