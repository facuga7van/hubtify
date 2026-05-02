# Questify Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 41 UI/UX issues found in the Questify module audit (4 critical, 10 medium, 15 minor, 12 nitpick).

**Architecture:** Surgical fixes across existing files. No new components. Focus on CSS, i18n, error handling, accessibility, and data integrity.

**Tech Stack:** React 19, TypeScript, CSS, better-sqlite3, i18n (es/en)

---

## File Map

| File | Changes |
|------|---------|
| `src/i18n/es.json` | Fix XP values in help text, add missing keys |
| `src/i18n/en.json` | Fix XP values in help text, add missing keys |
| `src/modules/quests/components/TaskList.tsx` | Error handling, overflow, sorting, filtering, a11y, unicode→svg |
| `src/modules/quests/components/ScrollNotes.tsx` | z-index, Escape key, pointer events, stale state, duplicate import |
| `src/modules/quests/components/SubtaskList.tsx` | i18n, hover via CSS, a11y |
| `src/modules/quests/components/HabitTracker.tsx` | Loading state, Escape key, hover via CSS, a11y |
| `src/modules/quests/components/ProjectManager.tsx` | Escape key, focus trap, ARIA |
| `src/modules/quests/components/TaskForm.tsx` | Extract inline styles to CSS |
| `src/modules/quests/styles/quests.css` | Overflow, font-scale, border-radius, hover classes, new utility classes |
| `src/shared/components/Tooltip.tsx` | maxWidth + word wrap |
| `electron/modules/quests.ipc.ts` | updated_at on drawing save, cascade habit_checks soft delete |
| `src/modules/quests/quests.schema.ts` | Fix duplicate index name |

---

## Chunk 1: Critical Fixes

### Task 1: Fix XP value mismatch in help text

**Files:**
- Modify: `src/i18n/es.json:175`
- Modify: `src/i18n/en.json:175`

- [ ] **Step 1: Fix es.json**

Change line 175 from:
```json
"taskListHelp": "Misiones ordenadas por vencimiento y prioridad. Tier I = 5 XP, Tier II = 15 XP, Tier III = 30 XP."
```
To:
```json
"taskListHelp": "Misiones ordenadas por vencimiento y prioridad. Tier I = 5 XP, Tier II = 15 XP, Tier III = 40 XP."
```

- [ ] **Step 2: Fix en.json**

Change line 175 from:
```json
"taskListHelp": "Quests sorted by due date and priority. Tier I = 5 XP, Tier II = 15 XP, Tier III = 30 XP."
```
To:
```json
"taskListHelp": "Quests sorted by due date and priority. Tier I = 5 XP, Tier II = 15 XP, Tier III = 40 XP."
```

---

### Task 2: Fix ScrollNotes z-index

**Files:**
- Modify: `src/modules/quests/components/ScrollNotes.tsx:225`

- [ ] **Step 1: Replace hardcoded z-index**

Change:
```tsx
position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.75)', zIndex: 9999,
```
To:
```tsx
position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.75)', zIndex: 'var(--z-modal)',
```

---

### Task 3: Fix infinite loading on error in TaskList

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx:92-94`

- [ ] **Step 1: Add setLoading(false) in catch block**

Change:
```tsx
    } catch (err) {
      console.error('[Quests]', err);
    }
```
To:
```tsx
    } catch (err) {
      console.error('[Quests]', err);
      setLoading(false);
    }
```

---

### Task 4: Fix misleading overdue penalty display

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx:737-741`

The UI shows negative XP for overdue tasks but `handleComplete` still awards positive XP. Since implementing actual penalties is a feature change beyond this audit, we fix by removing the misleading penalty display. Overdue tasks show normal XP with a visual warning instead.

- [ ] **Step 1: Remove fake penalty from XP display**

Change:
```tsx
          <div className={`quest-row-xp-value ${isOverdue ? 'quest-row-xp-value--penalty' : 'quest-row-xp-value--reward'}`}>
            {isOverdue ? `-${XP_MAP[task.tier]}` : `+${XP_MAP[task.tier]}`}
          </div>
          <div className="quest-row-xp-label">{isOverdue ? t('questify.penalty', 'CASTIGO') : 'XP'}</div>
```
To:
```tsx
          <div className={`quest-row-xp-value quest-row-xp-value--reward${isOverdue ? ' quest-row-xp-value--overdue' : ''}`}>
            +{XP_MAP[task.tier]}
          </div>
          <div className="quest-row-xp-label">XP</div>
```

- [ ] **Step 2: Add overdue visual style in CSS**

Add after `.quest-row-xp-value--penalty` in `quests.css`:
```css
.quest-row-xp-value--overdue { opacity: 0.5; }
```

- [ ] **Step 3: Commit critical fixes**

```bash
git add src/i18n/es.json src/i18n/en.json src/modules/quests/components/ScrollNotes.tsx src/modules/quests/components/TaskList.tsx src/modules/quests/styles/quests.css
git commit -m "fix(quests): critical audit fixes — XP help text, z-index, loading error, overdue display"
```

---

## Chunk 2: Medium Fixes — Text Overflow, Tooltip, Sorting, Filtering

### Task 5: Fix task title overflow

**Files:**
- Modify: `src/modules/quests/styles/quests.css:163-167`

- [ ] **Step 1: Add overflow protection to quest-row-title**

Change:
```css
.quest-row-title {
  font-family: 'IM Fell English', serif;
  font-size: calc(14.5px * var(--font-scale));
  color: var(--ink);
}
```
To:
```css
.quest-row-title {
  font-family: 'IM Fell English', serif;
  font-size: calc(14.5px * var(--font-scale));
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

### Task 6: Fix Tooltip overflow on long text

**Files:**
- Modify: `src/shared/components/Tooltip.tsx:75`

- [ ] **Step 1: Replace nowrap with constrained wrapping**

Change:
```tsx
            whiteSpace: 'nowrap',
```
To:
```tsx
            whiteSpace: 'normal',
            maxWidth: '300px',
            wordBreak: 'break-word',
```

---

### Task 7: Sort completed tasks by completedAt

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx:156-158`

- [ ] **Step 1: Add sort to completed tasks**

Change:
```tsx
  const completed = useMemo(() =>
    filteredByProject.filter((t) => t.status),
    [filteredByProject]
  );
```
To:
```tsx
  const completed = useMemo(() =>
    filteredByProject
      .filter((t) => t.status)
      .filter((t) => !filter || t.category === filter)
      .sort((a, b) => {
        if (!a.completedAt || !b.completedAt) return 0;
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      }),
    [filteredByProject, filter]
  );
```

This also fixes issue 2.10 (category filter not applied to completed tab).

---

### Task 8: Fix ScrollNotes stale state on new note

**Files:**
- Modify: `src/modules/quests/components/ScrollNotes.tsx:176-186`

- [ ] **Step 1: Fix index after loadDrawings**

Change:
```tsx
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
```
To:
```tsx
  const handleNewNote = async () => {
    await saveCurrent();
    clearCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL('image/png');
    await window.api.questsSaveDrawing({ taskId, data });
    const loaded = await loadDrawings();
    onCountChanged?.();
    if (typeof loaded === 'number') setCurrentIdx(loaded - 1);
  };
```

NOTE: This depends on `loadDrawings` returning the count. Check what it returns — if it doesn't, the implementer should make it return `drawings.length` after setting state, or use a ref to track count.

---

### Task 9: Commit medium fixes (text/sort/tooltip)

- [ ] **Step 1: Commit**

```bash
git add src/modules/quests/styles/quests.css src/shared/components/Tooltip.tsx src/modules/quests/components/TaskList.tsx src/modules/quests/components/ScrollNotes.tsx
git commit -m "fix(quests): text overflow, tooltip wrapping, completed sort+filter, stale note index"
```

---

## Chunk 3: Medium Fixes — Accessibility & Keyboard

### Task 10: Add Escape key + ARIA to ProjectManager modal

**Files:**
- Modify: `src/modules/quests/components/ProjectManager.tsx:57`

- [ ] **Step 1: Add keyboard handler and ARIA attributes**

Change:
```tsx
    <div className="quest-project-modal-overlay" onClick={onClose}>
      <div className="quest-project-modal" onClick={(e) => e.stopPropagation()}>
```
To:
```tsx
    <div className="quest-project-modal-overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()} role="dialog" aria-modal="true" aria-label={t('questify.manageProjects')}>
      <div className="quest-project-modal" onClick={(e) => e.stopPropagation()}>
```

---

### Task 11: Add Escape key + ARIA to ScrollNotes modal

**Files:**
- Modify: `src/modules/quests/components/ScrollNotes.tsx:224-225`

- [ ] **Step 1: Add keyboard handler and ARIA**

Change:
```tsx
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.75)', zIndex: 'var(--z-modal)',
```
To:
```tsx
    <div onKeyDown={(e) => e.key === 'Escape' && handleClose()} role="dialog" aria-modal="true" aria-label={t('questify.scrollNotes', 'Scroll Notes')} tabIndex={-1} ref={(el) => el?.focus()} style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.75)', zIndex: 'var(--z-modal)',
```

---

### Task 12: Add aria-labels to interactive SVG icons in TaskList

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx` (lines 694, 753-774)

- [ ] **Step 1: Add a11y to drag handle**

Change:
```tsx
        <div className="quest-drag-handle" {...listeners}>
          <svg width="10" height="14" viewBox="0 0 10 14" fill="var(--ink-faded)">
```
To:
```tsx
        <div className="quest-drag-handle" {...listeners} aria-label={t('questify.dragHandle', 'Reorder')} role="button">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="var(--ink-faded)" aria-hidden="true">
```

- [ ] **Step 2: Add a11y to note icon**

Change:
```tsx
            <svg width="14" height="14" viewBox="0 0 16 16"
              style={{ opacity: drawingCount > 0 ? 0.6 : 0.35 }}
              fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
```
To:
```tsx
            <svg width="14" height="14" viewBox="0 0 16 16"
              style={{ opacity: drawingCount > 0 ? 0.6 : 0.35 }}
              fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
              role="img" aria-label={t('questify.notes', 'Notes')}>
```

- [ ] **Step 3: Add a11y to edit icon**

Change:
```tsx
          <svg onClick={onEdit} width="14" height="14" viewBox="0 0 16 16"
            fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round">
```
To:
```tsx
          <svg onClick={onEdit} width="14" height="14" viewBox="0 0 16 16"
            fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round"
            role="button" tabIndex={0} aria-label={t('questify.edit', 'Edit')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}>
```

- [ ] **Step 4: Add a11y to select checkbox**

Change:
```tsx
          <svg onClick={onToggleSelect} width="12" height="12" viewBox="0 0 14 14"
            fill="none" stroke={selected ? 'var(--rubric)' : 'var(--ink-faded)'} strokeWidth="1.3">
```
To:
```tsx
          <svg onClick={onToggleSelect} width="12" height="12" viewBox="0 0 14 14"
            fill="none" stroke={selected ? 'var(--rubric)' : 'var(--ink-faded)'} strokeWidth="1.3"
            role="checkbox" tabIndex={0} aria-checked={selected} aria-label={t('questify.selectTask', 'Select task')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelect(); } }}>
```

---

### Task 13: Add a11y to SubtaskList delete icon

**Files:**
- Modify: `src/modules/quests/components/SubtaskList.tsx:201-206`

- [ ] **Step 1: Add keyboard + aria**

Change:
```tsx
        <svg onClick={() => setConfirmDelete(true)} width="12" height="12" viewBox="0 0 12 12"
          style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
          onMouseOut={(e) => (e.currentTarget.style.opacity = '0.4')}
          stroke="var(--rubric)" strokeWidth="1.8" strokeLinecap="round">
```
To:
```tsx
        <svg onClick={() => setConfirmDelete(true)} width="12" height="12" viewBox="0 0 12 12"
          className="quest-icon-hover"
          style={{ cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s' }}
          stroke="var(--rubric)" strokeWidth="1.8" strokeLinecap="round"
          role="button" tabIndex={0} aria-label={t('questify.delete', 'Delete')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setConfirmDelete(true); } }}>
```

- [ ] **Step 2: Add CSS hover class to quests.css**

Add at end of file:
```css
/* ── Icon hover utility ─────────────── */
.quest-icon-hover { transition: opacity 0.2s; }
.quest-icon-hover:hover, .quest-icon-hover:focus-visible { opacity: 0.8 !important; }
```

---

### Task 14: Add a11y to HabitTracker delete icon

**Files:**
- Modify: `src/modules/quests/components/HabitTracker.tsx:275-281`

- [ ] **Step 1: Replace JS hover with CSS class + add a11y**

Change:
```tsx
                <svg onClick={() => handleDelete(h.id)} width="10" height="10" viewBox="0 0 14 14"
                  style={{ cursor: 'pointer', opacity: 0.25, transition: 'opacity 0.2s', flexShrink: 0 }}
                  onMouseOver={(e) => (e.currentTarget.style.opacity = '0.6')}
                  onMouseOut={(e) => (e.currentTarget.style.opacity = '0.25')}
                  fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round">
```
To:
```tsx
                <svg onClick={() => handleDelete(h.id)} width="10" height="10" viewBox="0 0 14 14"
                  className="quest-icon-hover"
                  style={{ cursor: 'pointer', opacity: 0.25, flexShrink: 0 }}
                  fill="none" stroke="var(--ink-faded)" strokeWidth="1.3" strokeLinecap="round"
                  role="button" tabIndex={0} aria-label={t('questify.deleteHabit', 'Delete habit')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDelete(h.id); } }}>
```

---

### Task 15: Add separator a11y in dropdown

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx:410`

- [ ] **Step 1: Add aria-hidden**

Change:
```tsx
          <option disabled>--------</option>
```
To:
```tsx
          <option disabled aria-hidden="true">--------</option>
```

---

### Task 16: Commit accessibility fixes

- [ ] **Step 1: Commit**

```bash
git add src/modules/quests/components/ProjectManager.tsx src/modules/quests/components/ScrollNotes.tsx src/modules/quests/components/TaskList.tsx src/modules/quests/components/SubtaskList.tsx src/modules/quests/components/HabitTracker.tsx src/modules/quests/styles/quests.css
git commit -m "fix(quests): accessibility — Escape key, ARIA labels, keyboard nav on SVG icons"
```

---

## Chunk 4: Minor Fixes

### Task 17: Fix font-scale on XP value

**Files:**
- Modify: `src/modules/quests/styles/quests.css:221`

- [ ] **Step 1: Use font-scale variable**

Change:
```css
  font-size: 17px;
```
To:
```css
  font-size: calc(17px * var(--font-scale));
```

---

### Task 18: Add Escape key to HabitTracker add form

**Files:**
- Modify: `src/modules/quests/components/HabitTracker.tsx:298`

- [ ] **Step 1: Add Escape handler**

Change:
```tsx
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
```
To:
```tsx
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
```

---

### Task 19: Fix hardcoded i18n strings

**Files:**
- Modify: `src/modules/quests/components/SubtaskList.tsx:122`
- Modify: `src/modules/quests/components/ScrollNotes.tsx:315,327`
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Fix SubtaskList limit string**

Change:
```tsx
title={atLimit ? 'Max 30 subtasks reached' : undefined}
```
To:
```tsx
title={atLimit ? t('questify.subtaskLimit', 'Max 30 subtasks reached') : undefined}
```

- [ ] **Step 2: Fix ScrollNotes tool titles**

Change `title="Lapiz"` to:
```tsx
title={t('questify.penTool', 'Pen')}
```

Change `title="Goma"` to:
```tsx
title={t('questify.eraserTool', 'Eraser')}
```

- [ ] **Step 3: Add i18n keys to es.json**

Add in the questify section (alphabetical):
```json
"eraserTool": "Goma",
"penTool": "Lápiz",
"subtaskLimit": "Máximo 30 subtareas alcanzado",
```

- [ ] **Step 4: Add i18n keys to en.json**

Add in the questify section (alphabetical):
```json
"eraserTool": "Eraser",
"penTool": "Pen",
"subtaskLimit": "Max 30 subtasks reached",
```

---

### Task 20: Add pointer events to ScrollNotes canvas

**Files:**
- Modify: `src/modules/quests/components/ScrollNotes.tsx:283-286`

- [ ] **Step 1: Replace mouse events with pointer events**

Change:
```tsx
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
```
To:
```tsx
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
```

Also find the `onMouseDown` for this canvas (should be nearby) and change to `onPointerDown`.

---

### Task 21: Add loading state to HabitTracker

**Files:**
- Modify: `src/modules/quests/components/HabitTracker.tsx`

- [ ] **Step 1: Add loading state**

Add state near other state declarations:
```tsx
const [loading, setLoading] = useState(true);
```

In the loadHabits function, add `setLoading(false)` after setting habits data.

- [ ] **Step 2: Show loading state in render**

Change the empty state check:
```tsx
  if (habits.length === 0 && !adding) {
```
To:
```tsx
  if (loading) return null;
  if (habits.length === 0 && !adding) {
```

---

### Task 22: Fix saveDrawing missing updated_at

**Files:**
- Modify: `electron/modules/quests.ipc.ts:300-301`

- [ ] **Step 1: Add updated_at to drawing update**

Change:
```ts
    if (drawing.id) {
      db.prepare('UPDATE task_drawings SET data = ? WHERE id = ?').run(drawing.data, drawing.id);
```
To:
```ts
    if (drawing.id) {
      db.prepare('UPDATE task_drawings SET data = ?, updated_at = ? WHERE id = ?').run(drawing.data, new Date().toISOString(), drawing.id);
```

---

### Task 23: Cascade soft delete to habit_checks

**Files:**
- Modify: `electron/modules/quests.ipc.ts:595-599`

- [ ] **Step 1: Soft delete associated habit_checks**

Change:
```ts
  ipcHandle('quests:deleteHabit', (_e, id: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE habits SET deleted_at = ? WHERE id = ?').run(now, id);
  });
```
To:
```ts
  ipcHandle('quests:deleteHabit', (_e, id: string) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE habits SET deleted_at = ? WHERE id = ?').run(now, id);
    db.prepare('UPDATE habit_checks SET deleted_at = ? WHERE habit_id = ?').run(now, id);
  });
```

---

### Task 24: Fix duplicate index name in schema

**Files:**
- Modify: `src/modules/quests/quests.schema.ts:141`

- [ ] **Step 1: Rename compound index**

Change:
```ts
      CREATE INDEX IF NOT EXISTS idx_drawings_task ON task_drawings(task_id, draw_order);
```
To:
```ts
      CREATE INDEX IF NOT EXISTS idx_drawings_task_order ON task_drawings(task_id, draw_order);
```

---

### Task 25: Fix stats strip grid for HelpBubble

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx:360-361`

- [ ] **Step 1: Move HelpBubble outside grid**

Change:
```tsx
      <div className="quest-stats-strip">
        <HelpBubble text={t('questify.statsHelp', 'Resumen de misiones: en progreso, vencidas, para hoy y completadas este mes.')} />
```
To:
```tsx
      <div style={{ position: 'relative' }}>
        <HelpBubble text={t('questify.statsHelp', 'Resumen de misiones: en progreso, vencidas, para hoy y completadas este mes.')} />
      <div className="quest-stats-strip">
```

And add a closing `</div>` after the stats strip closing `</div>`.

- [ ] **Step 2: Also fix statsHelp text accuracy**

In es.json, change:
```json
"statsHelp": "Resumen de misiones: en progreso, vencidas, para hoy y completadas este mes."
```
To:
```json
"statsHelp": "Resumen de misiones: en progreso, vencidas, para hoy y completadas."
```

In en.json, change:
```json
"statsHelp": "Quest summary: in progress, overdue, due today, and completed this month."
```
To:
```json
"statsHelp": "Quest summary: in progress, overdue, due today, and completed."
```

---

### Task 26: Replace Unicode characters with aria-hidden

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx:585,691`

- [ ] **Step 1: Add aria-hidden to ornament character**

Change line 691:
```tsx
      <span className="quest-row-ornament" style={{ color: tier.color }}>&#10022;</span>
```
To:
```tsx
      <span className="quest-row-ornament" style={{ color: tier.color }} aria-hidden="true">&#10022;</span>
```

- [ ] **Step 2: Add aria-hidden to campaign diamond**

Change line 585:
```tsx
                        <span style={{ color: c.project.color }}>&#9670;</span> {c.project.name}
```
To:
```tsx
                        <span style={{ color: c.project.color }} aria-hidden="true">&#9670;</span> {c.project.name}
```

---

### Task 27: Remove duplicate parchmentBg import in ScrollNotes

**Files:**
- Modify: `src/modules/quests/components/ScrollNotes.tsx:221`

- [ ] **Step 1: Use existing import instead of new URL()**

Change:
```tsx
  const bgUrl = new URL('../../../assets/bg.jpg', import.meta.url).href;
```
To:
```tsx
  const bgUrl = parchmentBg;
```

---

### Task 28: Add due date badge border-radius

**Files:**
- Modify: `src/modules/quests/styles/quests.css:256-272`

- [ ] **Step 1: Add subtle border-radius to overdue and today badges**

Add `border-radius: 2px;` to both `.quest-due--overdue` and `.quest-due--today`.

---

### Task 29: Commit minor fixes

- [ ] **Step 1: Commit**

```bash
git add src/modules/quests/styles/quests.css src/modules/quests/components/HabitTracker.tsx src/modules/quests/components/SubtaskList.tsx src/modules/quests/components/ScrollNotes.tsx src/modules/quests/components/TaskList.tsx src/i18n/es.json src/i18n/en.json electron/modules/quests.ipc.ts src/modules/quests/quests.schema.ts
git commit -m "fix(quests): minor audit fixes — i18n, pointer events, loading states, data integrity"
```

---

## Chunk 5: Nitpick Fixes

### Task 30: Fix collapsedProjects localStorage not scoped per account

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx:64-69`

- [ ] **Step 1: Scope by current user**

The implementer needs to check how the current user ID is accessed (likely via Firebase auth or a context). Then change:
```tsx
const saved = localStorage.getItem('questify_collapsed_projects');
```
To include the user ID in the key. If no user context available in this component, skip this fix.

---

### Task 31: Fix habit name hover indication

**Files:**
- Modify: `src/modules/quests/styles/quests.css` (around line 413)

- [ ] **Step 1: Add hover effect to habit name**

Find `.quest-habit-name` and add:
```css
.quest-habit-name:hover {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}
```

---

### Task 32: Remove dead legendaria CSS and i18n

Skip this task — keep for future use as documented in types.ts comment.

---

### Task 33: Commit nitpick fixes

- [ ] **Step 1: Commit**

```bash
git add src/modules/quests/components/TaskList.tsx src/modules/quests/styles/quests.css
git commit -m "fix(quests): nitpick fixes — localStorage scope, habit hover"
```
