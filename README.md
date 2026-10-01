# Project Management Central

A personal project planner with a Gantt chart and a ticket board, built with React and TypeScript. It runs entirely in the browser.

[![CI and deploy](https://github.com/AuriumZero/project-management-central/actions/workflows/ci.yml/badge.svg)](https://github.com/AuriumZero/project-management-central/actions/workflows/ci.yml)

**[Live demo](https://auriumzero.github.io/project-management-central/)**: it opens with a sample project, so you can try it right away.

![Gantt chart view](docs/gantt.png)
![Ticket board view](docs/board.png)

## Features

- **Projects.** Keep several projects, each with its own plan, tickets and ticket prefix (e.g. `WEB-12`).
- **Gantt chart.** Drag a bar to reschedule a task, or drag either edge to change its length. It shows dependency arrows, milestones, a today marker, and day, week and month zoom.
- **Ticket board.** Four columns (Backlog, To do, In progress, Done) with drag and drop. Tickets have a priority, a type, a due date with an overdue flag, and an optional link to a task in the plan. You can filter by text or by type.
- **Progress at a glance.** Project completion is weighted by task duration, alongside an open-ticket count and the overall timeline.
- **Backup and restore.** Export everything to a JSON file and import it on another machine.
- **Light and dark themes.** It follows your system setting and works at phone width.

## How it's built

- **React 19 + TypeScript (strict)**, bundled with Vite. There's no backend: state is one JSON object saved to `localStorage`, and the format is versioned so data from the earlier single-file version still loads.
- **All state changes go through one reducer** (`src/state/reducer.ts`), which is a pure function. That makes every change easy to test without rendering anything.
- **The Gantt layout is a pure function too** (`src/lib/schedule.ts`). It takes tasks, a zoom level and today's date, and returns bar positions, scale labels and SVG dependency paths. The component only draws what it's given.
- **Dates are whole UTC day numbers**, so task lengths and drag offsets don't drift across daylight-saving changes. There's a test for exactly that.
- **Drag to reschedule uses Pointer Events**, so it works with a mouse or a finger. Resizing can't make a task end before it starts.
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
- Critical path highlighting and automatic rescheduling of dependent tasks
- Keyboard controls for moving and resizing bars
