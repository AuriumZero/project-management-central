# Project Management Central

A personal project planner with a Gantt chart and a ticket board, built with React and TypeScript. It runs entirely in the browser.

[![CI and deploy](https://github.com/AuriumZero/project-management-central/actions/workflows/ci.yml/badge.svg)](https://github.com/AuriumZero/project-management-central/actions/workflows/ci.yml)

**[Live demo](https://auriumzero.github.io/project-management-central/)**: it opens with a sample project, so you can try it right away.

![Gantt chart view](docs/gantt.png)
![Ticket board view](docs/board.png)

## Features

- **A plan that works like Microsoft Project.** The plan is an editable table next to the Gantt chart. You type names, start and finish dates, durations, predecessors, assignees and % complete straight into the grid. You can drag the divider to give the chart more room.
- **Quick task entry.** + Task adds a blank row with the cursor in its name, and Tab goes straight on to Start, Days, Predecessors and Assignee, so you can type a plan without opening a dialog.
- **Three levels of task.** Row 0 is the whole project, rolled up from everything below it. Parent tasks are the big deliverables and milestones. Subtasks sit under a parent and have an assignee. A parent's dates and progress come from its subtasks, and you can fold a parent to hide them.
- **Dependencies with link types.** You can use finish-to-start, start-to-start, finish-to-finish and start-to-finish links, with lag or lead in working days. Enter them as `3, 5SS+2d` in the Predecessors column, pick them in the task dialog (predecessors and successors), or drag from the dot at the end of one bar onto another.
- **Auto-scheduling.** When a task moves or grows, its successors are pushed later to keep every link true. Moving a parent moves all of its subtasks. Links that would create a loop are refused.
- **Row buttons.** Every row has buttons to edit, add a subtask, indent or outdent, and delete (with a confirm click), so you don't have to open the task first.
- **Working days.** Durations and lag skip Saturdays and Sundays by default, like Microsoft Project's standard calendar. The Working days setting in the toolbar switches a project to counting all seven days.
- **Drag to reschedule.** Drag a bar to move it, or drag either end to change its length. Undo and redo are available with Ctrl+Z / Ctrl+Shift+Z.
- **Export to Excel.** Downloads an .xlsx file with two sheets. The Tasks sheet has every column plus predecessors and successors, with the project and parent tasks in bold. The Gantt chart sheet draws the timeline with colored cells, one column per day.
- **Ticket board.** Four columns (Backlog, To do, In progress, Done) with drag and drop, priorities, types, due dates with an overdue flag, and links to plan tasks.
- **Backup and restore.** Export everything to a JSON file and import it on another machine. Older backups are upgraded automatically.
- **Light and dark themes.** It follows your system setting and works at phone width.

## How it's built

- **React 19 + TypeScript (strict)**, bundled with Vite. There's no backend: state is one JSON object saved to `localStorage`, and the format is versioned so data from the earlier single-file version still loads.
- **All state changes go through one reducer** (`src/state/reducer.ts`), which is a pure function. That makes every change easy to test without rendering anything.
- **Scheduling is a pure function** (`src/lib/plan.ts`). `schedule()` drops links that can't be satisfied (loops, a parent linked to its own subtask), pushes successors later until every FS/SS/FF/SF link holds, and rolls subtasks up into their parents. The loop check runs on the lowest-level tasks, so a cycle that goes through a parent is caught too.
- **The Gantt layout is a pure function too** (`src/lib/schedule.ts`). It takes tasks, a zoom level and today's date, and returns bar positions, scale labels and SVG dependency paths. The component only draws what it's given.
- **Dates are whole UTC day numbers**, so task lengths and drag offsets don't drift across daylight-saving changes. There's a test for exactly that.
- **Drag to reschedule uses Pointer Events**, so it works with a mouse or a finger. Resizing can't make a task end before it starts.
- **The Excel export is written by hand** (`src/lib/xlsx.ts`). An .xlsx file is a zip of XML files, so a small writer for cells, styles, merged cells and frozen panes, plus an uncompressed zip, does the job without a spreadsheet library. It's loaded only when you export.
- **Backups are validated on import.** Bad dates, unknown statuses and links to tasks that no longer exist are repaired or dropped instead of breaking the app.

```
src/
  lib/         types, date math, Gantt layout, storage and backup parsing
  state/       reducer and actions
  components/  GanttChart, TicketBoard, dialogs
  App.tsx      layout and wiring
```

## Tests and CI

Vitest with Testing Library covers the date math, the Gantt layout, backup parsing, the reducer, and the main user flows (adding tasks, creating and filtering tickets, two-step delete, restoring a backup). GitHub Actions runs lint, typecheck, tests and a production build on every pull request, and deploys `main` to GitHub Pages.

## Run it locally

```sh
npm install
npm run dev        # http://localhost:5173/project-management-central/
npm test           # run the test suite once
npm run build      # production build in dist/
```

## Roadmap

- Optional cloud sync so the same data shows up on every device
- Critical path highlighting
- Keyboard controls for moving and resizing bars
