import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalA11y } from '../hooks/useModalA11y';
import { SHORTCUTS } from '../shortcuts';
import type { Project } from '../../modules/quests/types';
import { TierBadge, TIER_LABEL } from '../../modules/quests/utils';
import type { TaskTier } from '../../modules/quests/types';
import {
  parseQuickAdd, escapeTokens, tokensOfKind,
  type QuickAddToken, type QuickAddTokenKind,
} from '../../modules/quests/quickadd-parser';

interface Props {
  onClose: () => void;
}

/* ── Highlight painting ───────────────────────────────────────────────────
   A mirror div sits BEHIND a normal, fully visible <input>. It renders the
   same string with `color: transparent` and paints a background only on the
   matched ranges — so the text you read is always the input's own.

   Why this and not contentEditable: the input keeps the native caret, the
   browser undo stack, and — decisive for a Spanish parser — IME/dead-key
   composition for tildes. And why not chips below: chips say WHAT was
   understood (the confirmation line already does that) but never WHICH words
   were eaten, which is exactly the Todoist failure mode we are guarding
   against. If the mirror ever drifts by a pixel the damage is cosmetic: the
   confirmation line, not the highlight, is the safety net. */

const TOKEN_TINT: Record<QuickAddTokenKind, string> = {
  date: 'rgba(168, 138, 60, 0.30)',
  time: 'rgba(168, 138, 60, 0.30)',
  tier: 'rgba(139, 58, 58, 0.22)',
  project: 'rgba(107, 124, 94, 0.28)',
};

function MirrorText({ text, tokens }: { text: string; tokens: QuickAddToken[] }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token, i) => {
    if (token.start > cursor) parts.push(text.slice(cursor, token.start));
    parts.push(
      <span
        key={i}
        style={{
          background: TOKEN_TINT[token.kind],
          borderRadius: 3,
          boxShadow: `0 1px 0 0 ${TOKEN_TINT[token.kind]}`,
        }}
      >
        {text.slice(token.start, token.end)}
      </span>
    );
    cursor = token.end;
  });
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** The real binding lives in Layout + shortcuts.ts; the header used to say Ctrl+Q, which is Quit on macOS/Linux. */
const QUICK_ADD_KEYS = SHORTCUTS.find((s) => s.i18nKey === 'shortcuts.quickAdd')?.keys ?? 'Ctrl+K';

export default function QuickAdd({ onClose }: Props) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  // Holding Enter (key autorepeat) used to create N identical quests: the form
  // stayed mounted with a truthy title until two IPC round-trips finished.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [tier, setTier] = useState<TaskTier>(2);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  /** El usuario ya tocó los selectores: la inferencia no le pisa la elección. */
  const projectTouched = useRef(false);
  const tierTouched = useRef(false);

  const loadProjects = useCallback(() => {
    window.api.questsGetProjects().then((p) => setProjects(p as Project[]));
  }, []);

  /**
   * La paleta creaba misiones huérfanas: `projectId` arrancaba en `null`
   * hardcodeado mientras el formulario completo sí hereda el proyecto activo.
   * En la base real 28 de las 37 misiones vivas tienen proyecto, y sobre las 30
   * más recientes el reparto es «Dardo» 14, «Whatsnap» 8, `null` **2**: el
   * default era el valor menos frecuente y había que arrastrar la misión después.
   */
  const loadEntryDefaults = useCallback(() => {
    // Canal nuevo: en un binding viejo simplemente no está, y el default vale.
    const api = window.api as Partial<typeof window.api>;
    if (typeof api.questsGetEntryDefaults !== 'function') return;
    api.questsGetEntryDefaults()
      .then((defaults) => {
        if (!defaults) return;
        if (!projectTouched.current) setProjectId(defaults.projectId);
        if (!tierTouched.current) setTier(defaults.tier);
      })
      .catch(() => { /* el default ya está puesto */ });
  }, []);

  useEffect(() => {
    loadProjects();
    loadEntryDefaults();
    inputRef.current?.focus();
  }, [loadProjects, loadEntryDefaults]);

  useEffect(() => {
    const handler = () => {
      // Otra cuenta, otro historial: lo que el usuario tocó acá ya no aplica.
      projectTouched.current = false;
      tierTouched.current = false;
      loadProjects();
      loadEntryDefaults();
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadProjects, loadEntryDefaults]);

  // Escape, focus trap and focus restore.
  const { dialogProps, stopPropagation } = useModalA11y<HTMLDivElement>({ onClose });

  /* ── Parse ────────────────────────────────────────
     Pure and cheap, so it simply runs on every keystroke. When it recognises
     nothing the result is byte-for-byte today's behaviour: `name.trim()`. */
  const parsed = useMemo(
    () => parseQuickAdd(name, { projects }),
    [name, projects],
  );

  // A recognised token beats the pickers; clicking a picker escapes the token
  // (below), so the last thing the user touched always wins.
  const effectiveTier = parsed.tier ?? tier;
  const effectiveProjectId = parsed.projectId ?? projectId;
  const effectiveProject = projects.find((p) => p.id === effectiveProjectId) ?? null;

  /** Keeps the highlight glued to the text when the field scrolls sideways. */
  const syncScroll = useCallback(() => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, []);

  useEffect(syncScroll, [name, syncScroll]);

  /** Turns a recognised fragment back into plain title text. */
  const release = (...kinds: QuickAddTokenKind[]) => {
    const targets = tokensOfKind(parsed.tokens, ...kinds);
    if (targets.length === 0) return;
    setName(escapeTokens(name, targets));
    inputRef.current?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.title || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      await window.api.questsUpsertTask({
        name: parsed.title,
        tier: effectiveTier,
        projectId: effectiveProjectId,
        category: '',
        description: '',
        dueDate: parsed.dueDate,
      });

      await window.api.processRpgEvent({
        type: 'TASK_CREATED', moduleId: 'quests',
        payload: { xp: 0, hp: 0 },
        timestamp: Date.now(),
      });

      window.dispatchEvent(new Event('rpg:statsChanged'));
      window.dispatchEvent(new Event('quests:dataChanged'));
      onClose();
    } catch (err) {
      // The palette stays open with the text intact: nothing was lost, retry is one Enter away.
      console.error('[QuickAdd] create failed', err);
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  /* ── Confirmation line ────────────────────────────
     Never a summary of the syntax — a statement of what the Enter key is
     about to save. Fragments that came from the text are buttons: one click
     hands the words back to the title. */
  const dayLabel = (day: string): string => {
    const now = new Date();
    const at = (n: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    if (day === at(0)) return t('questify.postponeToday', 'Hoy');
    if (day === at(1)) return t('questify.postponeTomorrow', 'Mañana');
    return new Date(`${day}T00:00:00`).toLocaleDateString(i18n.language, {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  };

  const releaseHint = t('questify.quickAddRelease', 'Click para devolverlo al título');
  const fragmentStyle: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, font: 'inherit',
    color: 'var(--ink-soft)', cursor: 'pointer', textDecoration: 'underline',
    textDecorationStyle: 'dotted', textUnderlineOffset: 3,
  };

  const fragments: React.ReactNode[] = [];
  if (parsed.dueDay) {
    fragments.push(
      <button key="due" type="button" style={fragmentStyle} title={releaseHint}
        onClick={() => release('date', 'time')}>
        {t('questify.dueLabel', 'Vence:')} {dayLabel(parsed.dueDay)}
        {parsed.dueTime ? ` ${parsed.dueTime}` : ''}
      </button>
    );
  }
  if (parsed.tokens.some((tk) => tk.kind === 'tier')) {
    fragments.push(
      <button key="tier" type="button" style={fragmentStyle} title={releaseHint}
        onClick={() => release('tier')}>
        {t(TIER_LABEL[effectiveTier])}
      </button>
    );
  } else if (parsed.dueDay || parsed.projectId) {
    fragments.push(<span key="tier">{t(TIER_LABEL[effectiveTier])}</span>);
  }
  if (parsed.projectName) {
    fragments.push(
      <button key="project" type="button" style={fragmentStyle} title={releaseHint}
        onClick={() => release('project')}>
        #{parsed.projectName}
      </button>
    );
  } else if (effectiveProject) {
    fragments.push(<span key="project">#{effectiveProject.name}</span>);
  }

  const bgUrl = new URL('../../assets/bg.jpg', import.meta.url).href;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.6)', zIndex: 'var(--z-modal)' as unknown as number,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '20vh',
    }} onClick={onClose}>
      <div {...dialogProps} aria-label={t('questify.quickAdd')} style={{
        backgroundImage: `url(${bgUrl})`,
        backgroundSize: '400px', backgroundRepeat: 'repeat',
        borderRadius: 8, padding: '16px 20px',
        boxShadow: '0 12px 40px rgba(44,24,16,0.6)',
        border: '3px solid var(--gold-dark)',
        width: 440,
      }} onClick={stopPropagation}>

        <div style={{
          fontSize: 'var(--fs-label)', color: 'var(--ink-soft)', marginBottom: 8,
          fontFamily: "'IM Fell English', serif", textAlign: 'center',
        }}>
          {t('questify.quickAdd')} — {QUICK_ADD_KEYS}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="quest-qa-wrap">
            {/* Behind the input: the same string, invisible, with the matched
                ranges tinted. aria-hidden — the input is the real content. */}
            <div ref={mirrorRef} className="quest-qa-mirror" aria-hidden="true">
              <MirrorText text={name} tokens={parsed.tokens} />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onScroll={syncScroll}
              placeholder={t('questify.questName')}
              className="rpg-input quest-qa-input"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* The safety net: what Enter is about to save, always visible. */}
          <div className="quest-qa-summary">
            {fragments.length > 0 ? (
              fragments.map((fragment, i) => (
                <span key={i}>
                  {i > 0 && <span className="quest-qa-sep" aria-hidden="true">&#183;</span>}
                  {fragment}
                </span>
              ))
            ) : (
              <span className="quest-qa-hint">
                {t('questify.quickAddHint', 'Probá «entregar informe mañana 15hs !epica #proyecto»')}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Tier */}
            <div style={{ display: 'flex', gap: 3 }}>
              {([1, 2, 3] as TaskTier[]).map((tierVal) => (
                <button key={tierVal} type="button"
                  onClick={() => { tierTouched.current = true; setTier(tierVal); release('tier'); }}
                  style={{
                    padding: '3px 8px', border: '1px solid var(--leather)',
                    borderRadius: '6px', cursor: 'pointer',
                    background: effectiveTier === tierVal ? 'var(--gold)' : 'var(--parch-0)',
                    color: effectiveTier === tierVal ? 'var(--ink)' : 'var(--ink-soft)',
                    fontWeight: effectiveTier === tierVal ? 'bold' : 'normal',
                    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-label)',
                  }}>
                  <TierBadge tier={tierVal} size={12} active={effectiveTier === tierVal} /> {t(TIER_LABEL[tierVal])}
                </button>
              ))}
            </div>

            {/* Project */}
            {projects.length > 0 && (
              <select value={effectiveProjectId ?? ''}
                onChange={(e) => { projectTouched.current = true; setProjectId(e.target.value || null); release('project'); }}
                className="rpg-select" style={{ fontSize: 'var(--fs-label)' }}>
                <option value="">{t('questify.noProject')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            <div style={{ flex: 1 }} />

            <button type="submit" className="rpg-button" disabled={!parsed.title || submitting}
              style={{ padding: '5px 16px', fontWeight: 'bold' }}>
              {t('questify.addQuest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
