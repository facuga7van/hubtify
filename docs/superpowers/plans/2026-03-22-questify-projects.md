# Questify Projects — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Project > Category > Task hierarchy to Questify with dropdown selector, per-project categories, and a global view with collapsible project sections.

**Architecture:** New `projects` table with UUID/name/color/order. `tasks` and `task_categories` get a nullable `project_id` FK. Frontend adds a project dropdown to the filter bar and TaskForm. Global view groups tasks by project in collapsible sections. Existing tasks migrate to "Sin proyecto" (null project_id).

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React, @dnd-kit

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/modules/quests/quests.schema.ts` | Modify | Add migration v2: projects table, project_id columns |
| `src/modules/quests/types.ts` | Modify | Add Project interface, update Task with projectId |
| `electron/modules/quests.ipc.ts` | Modify | Add project CRUD handlers, modify getTasks/getCategories |
| `electron/preload.ts` | Modify | Expose new project IPC methods |
| `shared/types.ts` | Modify | Add project API methods to HubtifyApi |
| `src/modules/quests/components/TaskList.tsx` | Modify | Project dropdown, global view with sections |
| `src/modules/quests/components/TaskForm.tsx` | Modify | Project selector field |
| `src/modules/quests/components/ProjectManager.tsx` | Create | Project CRUD modal (name, color, reorder, delete) |
| `src/i18n/es.json` | Modify | Add project-related translation keys |
| `src/i18n/en.json` | Modify | Add project-related translation keys |

---

## Chunk 1: Backend (Schema + IPC + Types)

### Task 1: Schema migration v2

**Files:**
- Modify: `src/modules/quests/quests.schema.ts`

- [ ] **Step 1: Add migration v2 to questsMigrations array**

```typescript
{
  namespace: 'quests',
  version: 2,
  up: `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8b7355',
      project_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    ALTER TABLE tasks ADD COLUMN project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL;
    ALTER TABLE task_categories ADD COLUMN project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE CASCADE;

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_categories_project ON task_categories(project_id);
  `,
},
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/quests/quests.schema.ts
git commit -m "feat(questify): add projects schema migration v2"
```

---

### Task 2: Types

**Files:**
- Modify: `src/modules/quests/types.ts`

- [ ] **Step 1: Add Project interface and color palette constant**

After the existing `MAX_SUBTASKS` line, add:

```typescript
export interface Project {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
}

export const PROJECT_COLORS = [
  '#8b7355', // tierra
  '#6b7c5e', // verde musgo
  '#7c6b6b', // borravino
  '#5e6b7c', // azul pizarra
  '#7c7254', // dorado oscuro
  '#6b5e7c', // violeta
  '#7c5e5e', // cobre
  '#5e7c72', // verde agua
] as const;
```

- [ ] **Step 2: Add projectId to Task interface**

```typescript
export interface Task {
  id: string;
  name: string;
  description: string;
  status: boolean;
  tier: TaskTier;
  category: string;
  projectId: string | null;  // <-- add this
  dueDate: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/quests/types.ts
git commit -m "feat(questify): add Project type and color palette"
```

---

### Task 3: IPC handlers

**Files:**
- Modify: `electron/modules/quests.ipc.ts`

- [ ] **Step 1: Add project CRUD handlers after the Categories section**

```typescript
  // ── Projects ─────────────────────────────────────

  ipcMain.handle('quests:getProjects', () => {
    const db = getDb();
    return db.prepare(`
      SELECT id, name, color, project_order AS "order", created_at AS createdAt
      FROM projects ORDER BY project_order ASC
    `).all();
  });

  ipcMain.handle('quests:upsertProject', (_e, project: {
    id?: string; name: string; color: string;
  }) => {
    const db = getDb();
    const id = project.id || genId();
    const now = new Date().toISOString();

    if (project.id) {
      db.prepare('UPDATE projects SET name = ?, color = ? WHERE id = ?')
        .run(project.name, project.color, id);
    } else {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(project_order), -1) + 1 AS next FROM projects').get() as { next: number };
      db.prepare('INSERT INTO projects (id, name, color, project_order, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, project.name, project.color, maxOrder.next, now);
    }
    return id;
  });

  ipcMain.handle('quests:deleteProject', (_e, id: string) => {
    const db = getDb();
    // Tasks get project_id = NULL via ON DELETE SET NULL
    // Categories get deleted via ON DELETE CASCADE
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  ipcMain.handle('quests:syncProjectOrders', (_e, orders: Array<{ id: string; order: number }>) => {
    const db = getDb();
    const stmt = db.prepare('UPDATE projects SET project_order = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const { id, order } of orders) {
        stmt.run(order, id);
      }
    });
    tx();
  });
```

- [ ] **Step 2: Modify `quests:getTasks` to include project_id and accept optional projectId filter**

Replace the existing handler:

```typescript
  ipcMain.handle('quests:getTasks', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      // All tasks
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks ORDER BY task_order ASC
      `).all();
    } else {
      // Filter by project (null = unassigned)
      return db.prepare(`
        SELECT id, name, description, status, tier, category,
               project_id AS projectId, due_date AS dueDate, task_order AS "order",
               created_at AS createdAt, updated_at AS updatedAt
        FROM tasks WHERE project_id IS ? ORDER BY task_order ASC
      `).all(projectId);
    }
  });
```

- [ ] **Step 3: Modify `quests:upsertTask` to handle projectId**

Add `projectId` to the parameter type and include it in INSERT/UPDATE:

In the upsertTask handler, add `projectId?: string | null;` to the param type.

Update the UPDATE query:
```sql
UPDATE tasks SET name = ?, description = ?, tier = ?, category = ?,
       project_id = ?, due_date = ?, task_order = ?, status = ?, updated_at = ?
WHERE id = ?
```
With `task.projectId ?? null` in the values.

Update the INSERT query:
```sql
INSERT INTO tasks (id, name, description, tier, category, project_id, due_date, task_order, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
```
With `task.projectId ?? null` in the values.

- [ ] **Step 4: Modify `quests:getCategories` to accept optional projectId**

```typescript
  ipcMain.handle('quests:getCategories', (_e, projectId?: string | null) => {
    const db = getDb();
    if (projectId === undefined) {
      return (db.prepare('SELECT name FROM task_categories ORDER BY created_at ASC').all() as { name: string }[])
        .map((r) => r.name);
    } else {
      return (db.prepare('SELECT name FROM task_categories WHERE project_id IS ? ORDER BY created_at ASC').all(projectId) as { name: string }[])
        .map((r) => r.name);
    }
  });
```

- [ ] **Step 5: Modify `quests:ensureCategory` to accept projectId**

```typescript
  ipcMain.handle('quests:ensureCategory', (_e, name: string, projectId?: string | null) => {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO task_categories (name, project_id) VALUES (?, ?)').run(name, projectId ?? null);
  });
```

- [ ] **Step 6: Commit**

```bash
git add electron/modules/quests.ipc.ts
git commit -m "feat(questify): add project IPC handlers, extend tasks/categories with projectId"
```

---

### Task 4: Preload + shared types

**Files:**
- Modify: `electron/preload.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Add project methods to preload.ts**

After the `questsEnsureCategory` line, add:

```typescript
  questsGetProjects: () => ipcRenderer.invoke('quests:getProjects'),
  questsUpsertProject: (project: Record<string, unknown>) => ipcRenderer.invoke('quests:upsertProject', project),
  questsDeleteProject: (id: string) => ipcRenderer.invoke('quests:deleteProject', id),
  questsSyncProjectOrders: (orders: Array<{ id: string; order: number }>) => ipcRenderer.invoke('quests:syncProjectOrders', orders),
```

- [ ] **Step 2: Update existing preload methods to pass optional params**

```typescript
  questsGetTasks: (projectId?: string | null) => ipcRenderer.invoke('quests:getTasks', projectId),
  questsGetCategories: (projectId?: string | null) => ipcRenderer.invoke('quests:getCategories', projectId),
  questsEnsureCategory: (name: string, projectId?: string | null) => ipcRenderer.invoke('quests:ensureCategory', name, projectId),
```

- [ ] **Step 3: Add project methods to HubtifyApi in shared/types.ts**

In the `// Quests` section, add:

```typescript
  questsGetProjects: () => Promise<unknown[]>;
  questsUpsertProject: (project: Record<string, unknown>) => Promise<string>;
  questsDeleteProject: (id: string) => Promise<void>;
  questsSyncProjectOrders: (orders: Array<{ id: string; order: number }>) => Promise<void>;
```

And update existing signatures:

```typescript
  questsGetTasks: (projectId?: string | null) => Promise<unknown[]>;
  questsGetCategories: (projectId?: string | null) => Promise<string[]>;
  questsEnsureCategory: (name: string, projectId?: string | null) => Promise<void>;
```

- [ ] **Step 4: Commit**

```bash
git add electron/preload.ts shared/types.ts
git commit -m "feat(questify): expose project APIs in preload and types"
```

---

## Chunk 2: Frontend (UI Components)

### Task 5: i18n keys

**Files:**
- Modify: `src/i18n/es.json`
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Add project translation keys to es.json**

In the `questify` section:

```json
"allProjects": "Todos los proyectos",
"noProject": "Sin proyecto",
"newProject": "Nuevo proyecto",
"projectName": "Nombre del proyecto",
"manageProjects": "Gestionar proyectos",
"deleteProjectConfirm": "Las tasks de este proyecto pasarán a 'Sin proyecto'. ¿Continuar?",
"pendingCount": "{{count}} pendientes"
```

- [ ] **Step 2: Add same keys to en.json**

```json
"allProjects": "All projects",
"noProject": "No project",
"newProject": "New project",
"projectName": "Project name",
"manageProjects": "Manage projects",
"deleteProjectConfirm": "Tasks from this project will move to 'No project'. Continue?",
"pendingCount": "{{count}} pending"
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/es.json src/i18n/en.json
git commit -m "feat(questify): add project i18n keys"
```

---

### Task 6: ProjectManager component

**Files:**
- Create: `src/modules/quests/components/ProjectManager.tsx`

- [ ] **Step 1: Create the ProjectManager modal component**

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../types';
import { PROJECT_COLORS } from '../types';

interface Props {
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}

export default function ProjectManager({ projects, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(() => {
    const used = new Set(projects.map(p => p.color));
    return PROJECT_COLORS.find(c => !used.has(c)) ?? PROJECT_COLORS[0];
  });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await window.api.questsUpsertProject({ name: newName.trim(), color: newColor });
    setNewName('');
    const used = new Set([...projects.map(p => p.color), newColor]);
    setNewColor(PROJECT_COLORS.find(c => !used.has(c)) ?? PROJECT_COLORS[0]);
    onSaved();
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    await window.api.questsUpsertProject({ id, name: editName.trim(), color: editColor });
    setEditingId(null);
    onSaved();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('questify.deleteProjectConfirm'))) return;
    await window.api.questsDeleteProject(id);
    onSaved();
  };

  const startEdit = (p: Project) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditColor(p.color);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,24,16,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div className="rpg-card" style={{ width: 400, maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="rpg-card-title">{t('questify.manageProjects')}</div>

        {/* Existing projects */}
        {projects.map((p) => (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: '1px solid var(--rpg-parchment-dark)',
          }}>
            {editingId === p.id ? (
              <>
                <ColorPicker value={editColor} onChange={setEditColor} />
                <input className="rpg-input" value={editName} onChange={(e) => setEditName(e.target.value)}
                  style={{ flex: 1 }} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleUpdate(p.id)} />
                <button className="rpg-button" onClick={() => handleUpdate(p.id)}
                  style={{ padding: '3px 8px', fontSize: '0.8rem' }}>OK</button>
                <button className="rpg-button" onClick={() => setEditingId(null)}
                  style={{ padding: '3px 8px', fontSize: '0.8rem', opacity: 0.6 }}>{t('questify.cancel')}</button>
              </>
            ) : (
              <>
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', background: p.color, flexShrink: 0,
                }} />
                <span style={{ flex: 1, fontWeight: 'bold' }}>{p.name}</span>
                <button className="rpg-button" onClick={() => startEdit(p)}
                  style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.6 }}>
                  {t('questify.edit')}
                </button>
                <button className="rpg-button" onClick={() => handleDelete(p.id)}
                  style={{ padding: '3px 8px', fontSize: '0.75rem', opacity: 0.4 }}>
                  {t('questify.delete')}
                </button>
              </>
            )}
          </div>
        ))}

        {/* New project */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <input className="rpg-input" placeholder={t('questify.projectName')} value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <button className="rpg-button" onClick={handleCreate} disabled={!newName.trim()}>
            + {t('questify.newProject')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', width: 80 }}>
      {PROJECT_COLORS.map((c) => (
        <button key={c} onClick={() => onChange(c)} style={{
          width: 16, height: 16, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
          outline: c === value ? '2px solid var(--rpg-gold)' : '2px solid transparent',
          outlineOffset: 1,
        }} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/quests/components/ProjectManager.tsx
git commit -m "feat(questify): add ProjectManager component with CRUD and color picker"
```

---

### Task 7: TaskForm — add project selector

**Files:**
- Modify: `src/modules/quests/components/TaskForm.tsx`

- [ ] **Step 1: Add project props and state**

Update the Props interface:
```typescript
interface Props {
  editingTask: Task | null;
  categories: string[];
  projects: Project[];
  activeProjectId: string | null;  // pre-select when viewing a specific project
  onSaved: () => void;
}
```

Add import: `import type { TaskTier, Task, Project } from '../types';`

Add state: `const [projectId, setProjectId] = useState<string | null>(null);`

- [ ] **Step 2: Pre-fill projectId from editingTask or activeProjectId**

In the existing useEffect for editingTask, add:
```typescript
setProjectId(editingTask ? (editingTask.projectId ?? null) : (activeProjectId ?? null));
```

- [ ] **Step 3: Include projectId in handleSubmit**

Add `projectId` to the task object:
```typescript
const task: Record<string, unknown> = {
  id: editingTask?.id,
  name: name.trim(),
  description: description.trim(),
  tier,
  category: resolvedCategory,
  projectId,
  dueDate: useDate && dueDate ? dueDate : null,
  order: editingTask?.order ?? 0,
  status: editingTask?.status ?? false,
};
```

Update the ensureCategory call to include projectId:
```typescript
await window.api.questsEnsureCategory(resolvedCategory.trim(), projectId);
```

Reset projectId on submit: add `setProjectId(activeProjectId ?? null);` to the reset block.

- [ ] **Step 4: Add project dropdown to the form JSX**

Before the category select, add:
```tsx
<select value={projectId ?? ''} onChange={(e) => {
    const val = e.target.value;
    setProjectId(val || null);
    setCategory(''); // reset category when project changes
  }} className="rpg-select">
  <option value="">{t('questify.noProject')}</option>
  {projects.map((p) => (
    <option key={p.id} value={p.id}>{p.name}</option>
  ))}
</select>
```

- [ ] **Step 5: Filter categories by selected project**

Replace `categories.map(...)` in the category select with:
```tsx
{categories
  .filter(() => true) // categories already filtered by parent based on projectId
  .map((c) => <option key={c} value={c}>{c}</option>)}
```

(The parent component will pass categories already filtered by project.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/quests/components/TaskForm.tsx
git commit -m "feat(questify): add project selector to TaskForm"
```

---

### Task 8: TaskList — project dropdown + global view with sections

**Files:**
- Modify: `src/modules/quests/components/TaskList.tsx`

This is the largest change. Key modifications:

- [ ] **Step 1: Add project state and imports**

Add imports:
```typescript
import type { Task, TaskTier, Subtask, Project, XP_MAP } from '../types';
import ProjectManager from './ProjectManager';
```

Add state inside TaskList component:
```typescript
const [projects, setProjects] = useState<Project[]>([]);
const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined); // undefined = all
const [showProjectManager, setShowProjectManager] = useState(false);
const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
  try {
    const saved = localStorage.getItem('questify_collapsed_projects');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch { return new Set(); }
});
```

- [ ] **Step 2: Load projects in loadTasks**

Update loadTasks to also fetch projects:
```typescript
const loadTasks = useCallback(async () => {
  try {
    const [allTasks, cats, count, projs] = await Promise.all([
      window.api.questsGetTasks(),
      window.api.questsGetCategories(activeProjectId === undefined ? undefined : activeProjectId),
      window.api.questsCountCompletedToday(),
      window.api.questsGetProjects(),
    ]);
    setTasks(allTasks as Task[]);
    setCategories(cats);
    setTodayCount(count);
    setProjects(projs as Project[]);
  } catch (err) {
    console.error(err);
  }
}, [activeProjectId]);
```

Add effect to reload when activeProjectId changes:
```typescript
useEffect(() => { loadTasks(); }, [loadTasks]);
```

- [ ] **Step 3: Update the pending/completed memos to filter by project**

```typescript
const filteredByProject = useMemo(() => {
  if (activeProjectId === undefined) return tasks; // all
  return tasks.filter((t) => (activeProjectId === null ? t.projectId === null : t.projectId === activeProjectId));
}, [tasks, activeProjectId]);

const pending = useMemo(() =>
  filteredByProject.filter((t) => !t.status)
    .sort((a, b) => a.order - b.order)
    .filter((t) => !filter || t.category === filter)
    .filter((t) => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())),
  [filteredByProject, filter, searchQuery]
);

const completed = useMemo(() =>
  filteredByProject.filter((t) => t.status)
    .filter((t) => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())),
  [filteredByProject, searchQuery]
);
```

- [ ] **Step 4: Group pending tasks by project for global view**

```typescript
const pendingByProject = useMemo(() => {
  if (activeProjectId !== undefined) return null; // not in global view
  const groups: Array<{ project: Project | null; tasks: Task[] }> = [];
  const projectMap = new Map(projects.map(p => [p.id, p]));

  // Group by project
  const grouped = new Map<string | null, Task[]>();
  for (const t of pending) {
    const key = t.projectId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  // Projects first (in order), then unassigned
  for (const p of projects) {
    const tasks = grouped.get(p.id);
    if (tasks && tasks.length > 0) groups.push({ project: p, tasks });
  }
  const unassigned = grouped.get(null);
  if (unassigned && unassigned.length > 0) groups.push({ project: null, tasks: unassigned });

  return groups;
}, [pending, projects, activeProjectId]);
```

- [ ] **Step 5: Add project dropdown to the filter bar**

Replace the category filter section with:

```tsx
{/* Project filter */}
<select value={activeProjectId === undefined ? '__all__' : (activeProjectId ?? '__none__')}
  onChange={(e) => {
    const val = e.target.value;
    setActiveProjectId(val === '__all__' ? undefined : val === '__none__' ? null : val);
    setFilter(''); // reset category filter
  }}
  style={{ padding: '4px 8px', border: '1px solid var(--rpg-wood)',
    borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-parchment)', fontSize: '0.85rem' }}>
  <option value="__all__">{t('questify.allProjects')}</option>
  {projects.map((p) => (
    <option key={p.id} value={p.id}>● {p.name}</option>
  ))}
  <option value="__none__">{t('questify.noProject')}</option>
</select>

{/* Manage projects button */}
<button className="rpg-button" onClick={() => setShowProjectManager(true)}
  title={t('questify.manageProjects')}
  style={{ padding: '4px 8px', fontSize: '0.8rem', opacity: 0.6 }}>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
</button>

{/* Category filter — keep existing but use uniqueCategories */}
{uniqueCategories.length > 0 && (
  <select value={filter} onChange={(e) => setFilter(e.target.value)}
    style={{ padding: '4px 8px', border: '1px solid var(--rpg-wood)',
      borderRadius: 'var(--rpg-radius)', background: 'var(--rpg-parchment)', fontSize: '0.85rem' }}>
    <option value="">{t('questify.allCategories')}</option>
    {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
  </select>
)}
```

- [ ] **Step 6: Render global view with collapsible sections**

In the pending tab, add conditional rendering:

```tsx
{activeTab === 'pending' && pendingByProject ? (
  /* Global view — sections by project */
  pendingByProject.map(({ project, tasks: sectionTasks }) => {
    const sectionKey = project?.id ?? '__none__';
    const isCollapsed = collapsedProjects.has(sectionKey);
    return (
      <div key={sectionKey} style={{ marginBottom: 12 }}>
        <div onClick={() => toggleProjectCollapse(sectionKey)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            cursor: 'pointer', borderBottom: '1px solid var(--rpg-parchment-dark)',
            userSelect: 'none',
          }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            style={{ transition: 'transform 0.2s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
            <path d="M3 1l4 4-4 4"/>
          </svg>
          {project && <span style={{ width: 10, height: 10, borderRadius: '50%', background: project.color, flexShrink: 0 }} />}
          <span style={{ fontWeight: 'bold', flex: 1 }}>{project?.name ?? t('questify.noProject')}</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
            {t('questify.pendingCount', { count: sectionTasks.length })}
          </span>
        </div>
        {!isCollapsed && (
          <DndContext collisionDetection={closestCenter} onDragEnd={(event) => onDragEndInSection(event, sectionTasks)}>
            <SortableContext items={sectionTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
              {sectionTasks.map((task) => (
                <SortableTaskItem key={task.id} task={task}
                  expanded={expandedIds.has(task.id)} selected={selectedIds.has(task.id)}
                  subtasks={subtasksMap[task.id] ?? []} todayCount={todayCount}
                  onToggleExpand={() => toggleExpand(task.id)}
                  onComplete={() => handleComplete(task)}
                  onEdit={() => setEditingTask(task)}
                  onToggleSelect={() => setSelectedIds((prev) => {
                    const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next;
                  })}
                  onShowToast={setToastData}
                  onSubtaskChanged={() => { loadSubtasks(task.id); loadTasks(); }}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    );
  })
) : activeTab === 'pending' && (
  /* Single project view — flat list */
  <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
    <SortableContext items={pending.map((t) => t.id)} strategy={verticalListSortingStrategy}>
      {pending.map((task) => (
        <SortableTaskItem key={task.id} task={task} /* ...same props as before... */ />
      ))}
    </SortableContext>
  </DndContext>
)}
```

- [ ] **Step 7: Add helper functions**

```typescript
const toggleProjectCollapse = (key: string) => {
  setCollapsedProjects((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    localStorage.setItem('questify_collapsed_projects', JSON.stringify([...next]));
    return next;
  });
};

const onDragEndInSection = async (event: DragEndEvent, sectionTasks: Task[]) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const oldIdx = sectionTasks.findIndex((t) => t.id === active.id);
  const newIdx = sectionTasks.findIndex((t) => t.id === over.id);
  if (oldIdx === -1 || newIdx === -1) return;
  const reordered = arrayMove(sectionTasks, oldIdx, newIdx);
  const orders = reordered.map((t, i) => ({ id: t.id, order: i }));
  setTasks((prev) => {
    const updated = [...prev];
    for (const { id, order } of orders) {
      const idx = updated.findIndex((t) => t.id === id);
      if (idx !== -1) updated[idx] = { ...updated[idx], order };
    }
    return updated;
  });
  await window.api.questsSyncTaskOrders(orders);
};
```

- [ ] **Step 8: Pass projects and activeProjectId to TaskForm**

```tsx
<TaskForm
  editingTask={editingTask}
  categories={categories}
  projects={projects}
  activeProjectId={activeProjectId === undefined ? null : activeProjectId}
  onSaved={() => { setEditingTask(null); loadTasks(); }}
/>
```

- [ ] **Step 9: Add ProjectManager modal**

At the end of the component JSX, before the closing `</div>`:

```tsx
{showProjectManager && (
  <ProjectManager
    projects={projects}
    onClose={() => setShowProjectManager(false)}
    onSaved={() => loadTasks()}
  />
)}
```

- [ ] **Step 10: Add project color dot to SortableTaskItem category badge**

In the SortableTaskItem component, update the category badge to show project color:

After the existing category badge, add a project indicator for global view:
```tsx
{task.projectId && activeProjectId === undefined && (
  <span style={{
    fontSize: '0.7rem', padding: '1px 6px', borderRadius: 3,
    background: projects.find(p => p.id === task.projectId)?.color ?? 'var(--rpg-gold)',
    color: 'var(--rpg-parchment)', opacity: 0.8,
  }}>
    {projects.find(p => p.id === task.projectId)?.name}
  </span>
)}
```

Note: pass `projects` and `activeProjectId` as additional props to SortableTaskItem.

- [ ] **Step 11: Commit**

```bash
git add src/modules/quests/components/TaskList.tsx
git commit -m "feat(questify): add project dropdown, global view with collapsible sections"
```

---

### Task 9: Update sync to include projects

**Files:**
- Modify: `src/shared/sync.ts`

- [ ] **Step 1: Include projects in syncPush**

Add to the Promise.all in syncPush:
```typescript
window.api.questsGetProjects(),
```

Destructure: `const [stats, tasks, categories, charData, ..., projects] = ...`

Add to the setDoc data:
```typescript
questify: { tasks, subtasks: allSubs, categories, projects },
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/sync.ts
git commit -m "feat(questify): include projects in sync push"
```

---

### Task 10: TypeScript check + final commit

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Final commit if needed**

```bash
git add -A
git commit -m "fix(questify): resolve type errors from projects feature"
```
