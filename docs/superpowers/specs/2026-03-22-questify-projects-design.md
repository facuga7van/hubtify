# Questify Projects — Design Spec

**Goal:** Add a Project > Category > Task hierarchy to Questify, with a project selector dropdown, per-project categories, and a global view with collapsible project sections.

**Approach:** Dropdown-based project selector + colored category tags. Vista global groups tasks by project in collapsible sections.

---

## 1. Data Model

### New table: `projects`

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | "Whatsnap", "Leadnavigators" |
| color | TEXT NOT NULL | Hex pastel color, e.g. `#8b7355` |
| project_order | INTEGER | For dropdown ordering |
| created_at | TEXT | ISO timestamp |

### Modified table: `tasks`

- Add column: `project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL`
- Existing tasks get `project_id = NULL` (shown as "Sin proyecto")

### Modified table: `task_categories`

- Add column: `project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE CASCADE`
- Categories become per-project. Existing categories get `project_id = NULL` (global)
- Unique constraint on `(name, project_id)` — same category name allowed across projects

### Predefined Color Palette

8 desaturated colors that fit the RPG/parchment aesthetic:

```
#8b7355  tierra/madera
#6b7c5e  verde musgo
#7c6b6b  borravino apagado
#5e6b7c  azul pizarra
#7c7254  dorado oscuro
#6b5e7c  violeta apagado
#7c5e5e  cobre
#5e7c72  verde agua
```

Auto-assigned on project creation (next unused color). User can change it.

---

## 2. IPC Handlers (new)

| Handler | Input | Output | Purpose |
|---------|-------|--------|---------|
| `quests:getProjects` | — | `Project[]` | List all projects ordered by project_order |
| `quests:upsertProject` | `{ id?, name, color }` | `string` (id) | Create or update project |
| `quests:deleteProject` | `id: string` | `void` | Delete project, tasks get project_id=NULL |
| `quests:syncProjectOrders` | `Array<{id, order}>` | `void` | Reorder projects |

### Modified handlers

| Handler | Change |
|---------|--------|
| `quests:getTasks` | Add optional `projectId` filter param |
| `quests:getCategories` | Add optional `projectId` filter param |
| `quests:ensureCategory` | Add `projectId` param |

---

## 3. UI — Filter Bar

Replaces the current category-only filter. Positioned above the task list:

```
[▼ Todos los proyectos]  [▼ Categoría]  [🔍 Buscar...]
```

- **Project dropdown options:**
  - "Todos los proyectos" (default) — shows global view
  - Each project with color dot: `● Whatsnap`
  - "Sin proyecto" — tasks with no project
  - Separator
  - "+ Nuevo proyecto" — inline creation (name + color picker)

- **Category dropdown:**
  - When project selected: shows only that project's categories
  - When "Todos": shows all categories (prefixed with project name if ambiguous)
  - "Todas" as default option

- **Search:** Unchanged, filters by task name within current project/category selection

---

## 4. UI — Global View (Todos los proyectos)

Tasks grouped in collapsible sections by project:

```
▼ ● Whatsnap (5 pendientes)
  ├─ [Cliente A] Arreglar login              +15 XP
  ├─ [Cliente A] Migrar DB                   +40 XP
  └─ [Cliente B] Diseñar landing             +15 XP

▶ ● Leadnavigators (3 pendientes)
  (collapsed)

▼ Sin proyecto (2 pendientes)
  ├─ Comprar dominio                         +5 XP
  └─ Renovar certificado SSL                 +15 XP
```

- Section header: collapse arrow + color dot + project name + pending count
- Collapse state persisted in localStorage (`questify_collapsed_projects`)
- Drag & drop works WITHIN sections only (not between projects)
- "Sin proyecto" section shown at the bottom if there are unassigned tasks
- Completed tab: same structure, grouped by project

---

## 5. UI — Project View (specific project selected)

Same as current TaskList but filtered:
- Only tasks from selected project
- Category dropdown shows only that project's categories
- Category badges shown inline on tasks (existing behavior)
- Drag & drop across all tasks in the project (no sections)

---

## 6. UI — TaskForm Changes

Add "Proyecto" field to create/edit form:

```
Proyecto:   [▼ Whatsnap        ]
Categoría:  [▼ Cliente A       ]
Nombre:     [_________________ ]
Tier:       [Quick] [Normal] [Epic]
```

- If viewing a specific project, pre-select that project
- Changing project reloads the category dropdown for that project
- "Sin proyecto" as an option
- "+ Nuevo proyecto" at the bottom of project dropdown (same inline creation)
- Category dropdown: existing behavior + scoped to selected project

---

## 7. UI — Project Management

Accessible from a small gear icon next to the project dropdown, or from Settings page.

Simple list view:
- Each project: color dot + name + edit/delete buttons
- Edit: inline name change + color picker (the 8 predefined colors as swatches)
- Delete: confirmation dialog, tasks moved to "Sin proyecto"
- Drag & drop to reorder

---

## 8. Migration Strategy

- New migration adds `projects` table, `project_id` columns to tasks and task_categories
- Existing tasks: `project_id = NULL` — shown under "Sin proyecto"
- Existing categories: `project_id = NULL` — shown as global categories
- No data loss, fully backward compatible
- User organizes tasks into projects at their own pace

---

## 9. What's NOT Included (YAGNI)

- No kanban/board views
- No permissions or collaborators
- No project-level deadlines or progress tracking
- No nested projects
- No project archiving (delete only)
- No cross-project drag & drop in global view

---

## 10. Types

```typescript
interface Project {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
}
```

Task type adds:
```typescript
interface Task {
  // ...existing fields
  projectId: string | null;
}
```

Category type adds:
```typescript
interface TaskCategory {
  name: string;
  projectId: string | null;
}
```
