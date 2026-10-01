import { isWorkday, workdaysBetween } from './calendar'
import { dayOfMonth, formatDay, fromDay, toDay, today, weekday } from './dates'
import { duration, formatPredecessors, formatSuccessors, outline, projectSummary } from './plan'
import { IMPACTS } from './types'
import type { Project } from './types'
import { buildXlsx, colName, excelDate, ref } from './xlsx'
import type { Cell, CellStyle, Sheet } from './xlsx'

// Colors match the app: teal bars, dark summary bars, orange milestones.
const C = {
  ink: '#17201d', muted: '#5d6b66', line: '#d5dcd9', accent: '#0f6e66', white: '#ffffff',
  soft: '#d3ebe7', bar: '#2f8c82', summary: '#3b4a45', milestone: '#c2410c', weekend: '#eef1f0', tint: '#f3f5f4',
}
const DATE = 'mmm d, yyyy'

/** Every style the export uses; cells refer to them by position. */
const STYLES = {
  title: { bold: true, size: 14, color: C.ink },
  subtitle: { color: C.muted },
  head: { bold: true, color: C.white, fill: C.accent },
  headCenter: { bold: true, color: C.white, fill: C.accent, align: 'center' },
  // The project row and parent tasks are bold.
  project: { bold: true, fill: C.tint, underline: C.line },
  projectDate: { bold: true, fill: C.tint, underline: C.line, numFmt: DATE },
  projectNum: { bold: true, fill: C.tint, underline: C.line, align: 'center' },
  projectPct: { bold: true, fill: C.tint, underline: C.line, align: 'center', numFmt: '0%' },
  parent: { bold: true, underline: C.line },
  parentDate: { bold: true, underline: C.line, numFmt: DATE },
  parentNum: { bold: true, underline: C.line, align: 'center' },
  parentPct: { bold: true, underline: C.line, align: 'center', numFmt: '0%' },
  sub: { underline: C.line, indent: 2 },
  plain: { underline: C.line },
  date: { underline: C.line, numFmt: DATE },
  num: { underline: C.line, align: 'center' },
  pct: { underline: C.line, align: 'center', numFmt: '0%' },
  // Gantt cells.
  month: { bold: true, color: C.ink, fill: C.tint },
  day: { size: 8, color: C.muted, align: 'center' },
  dayWeekend: { size: 8, color: C.muted, align: 'center', fill: C.weekend },
  dayToday: { size: 8, bold: true, color: C.white, align: 'center', fill: C.milestone },
  weekend: { fill: C.weekend },
  barTodo: { fill: C.soft },
  barDone: { fill: C.bar },
  barSummary: { fill: C.summary },
  milestone: { bold: true, color: C.milestone, align: 'center' },
  legend: { size: 9, color: C.muted },
  // Risk log.
  riskText: { underline: C.line, valign: 'top', wrap: true },
  riskNum: { underline: C.line, valign: 'top', align: 'center' },
  riskPct: { underline: C.line, valign: 'top', align: 'center', numFmt: '0%' },
  impactLow: { bold: true, color: '#64748b', underline: C.line, valign: 'top', align: 'center' },
  impactMedium: { bold: true, color: '#c2410c', underline: C.line, valign: 'top', align: 'center' },
  impactHigh: { bold: true, color: '#b91c1c', underline: C.line, valign: 'top', align: 'center' },
} satisfies Record<string, CellStyle>

type StyleName = keyof typeof STYLES
const NAMES = Object.keys(STYLES) as StyleName[]
const S = Object.fromEntries(NAMES.map((n, i) => [n, i])) as Record<StyleName, number>

const cell = (v: string | number | undefined, style: StyleName): Cell => ({ v, s: S[style] })

type Kind = 'project' | 'parent' | 'sub'
type Column = 'text' | 'date' | 'num' | 'pct'
const SUFFIX: Record<Column, string> = { text: '', date: 'Date', num: 'Num', pct: 'Pct' }
/** Bold styles for the project and parent rows, plain ones for subtasks. */
const styleFor = (kind: Kind, what: Column): StyleName =>
  kind === 'sub' ? (what === 'text' ? 'plain' : what) : (`${kind}${SUFFIX[what]}` as StyleName)

/** The rows both sheets list: the project (row 0), then every task in outline order. */
function planRows(project: Project) {
  const { tasks, workWeek } = project
  const rows = outline(tasks)
  const numById = new Map(rows.map((r) => [r.task.id, r.num]))
  const summary = projectSummary(tasks)
  const list = summary ? [{
    num: 0, name: project.name, kind: 'project' as Kind, type: 'Project', start: summary.start, end: summary.end,
    days: workdaysBetween(summary.start, summary.end, workWeek), progress: summary.progress,
    assignee: '', preds: '', succs: '', notes: project.description, milestone: false, summaryBar: true,
  }] : []
  for (const { task, num, depth, hasChildren } of rows) {
    list.push({
      num, name: task.name || 'Untitled', kind: depth ? 'sub' : 'parent',
      type: task.milestone ? 'Milestone' : depth ? 'Subtask' : 'Parent task',
      start: toDay(task.start), end: toDay(task.end), days: duration(task, workWeek), progress: task.progress,
      assignee: hasChildren ? '' : task.assignee,
      preds: formatPredecessors(task, numById), succs: formatSuccessors(task, tasks, numById),
      notes: task.notes ?? '', milestone: !!task.milestone, summaryBar: hasChildren,
    })
  }
  return list
}

function tasksSheet(project: Project): Sheet {
  const rows = planRows(project)
  const head = ['ID', 'Task', 'Type', 'Start', 'Finish', 'Days', '% Complete', 'Assignee', 'Predecessors', 'Successors', 'Notes']
  return {
    name: 'Tasks',
    cols: [6, 40, 12, 14, 14, 7, 11, 16, 16, 16, 40],
    freeze: { rows: 1, cols: 2 },
    autoFilter: `A1:${colName(head.length - 1)}${rows.length + 1}`,
    rows: [
      head.map((h, i) => cell(h, i === 0 || i === 5 || i === 6 ? 'headCenter' : 'head')),
      ...rows.map((r) => [
        cell(r.num, styleFor(r.kind, 'num')),
        cell(r.name, r.kind === 'sub' ? 'sub' : r.kind),
        cell(r.type, styleFor(r.kind, 'text')),
        cell(excelDate(r.start), styleFor(r.kind, 'date')),
        cell(excelDate(r.end), styleFor(r.kind, 'date')),
        cell(r.days, styleFor(r.kind, 'num')),
        cell(r.progress / 100, styleFor(r.kind, 'pct')),
        cell(r.assignee, styleFor(r.kind, 'text')),
        cell(r.preds, styleFor(r.kind, 'text')),
        cell(r.succs, styleFor(r.kind, 'text')),
        cell(r.notes, styleFor(r.kind, 'text')),
      ]),
    ],
  }
}

/** Columns before the timeline on the Gantt sheet. */
const LEFT = ['ID', 'Task', 'Start', 'Finish', 'Days', 'Pred.']
const LEFT_WIDTHS = [5, 32, 12, 12, 6, 9]
/** Rows above the first task: title, subtitle, month names, day numbers. */
const TOP = 4

function ganttSheet(project: Project, todayDay: number): Sheet {
  const rows = planRows(project)
  const sheet: Sheet = { name: 'Gantt chart', rows: [], landscape: true }
  const grid: (Cell | null)[][] = []
  const put = (r: number, c: number, v: Cell | null) => { (grid[r] ??= [])[c] = v }
  put(0, 0, cell(project.name, 'title'))
  put(1, 0, cell(`Gantt chart · ${project.workWeek === 'weekdays' ? 'Mon–Fri working days' : '7-day weeks'} · exported ${formatDay(todayDay, { month: 'short', day: 'numeric', year: 'numeric' })}`, 'subtitle'))
  LEFT.forEach((h, c) => put(TOP - 1, c, cell(h, c === 1 ? 'head' : 'headCenter')))
  if (!rows.length) {
    sheet.rows = grid
    sheet.cols = LEFT_WIDTHS
    return sheet
  }

  // From the Monday on or before the first start to a few days past the last finish.
  const first = rows[0].start - ((weekday(rows[0].start) + 6) % 7)
  const last = Math.max(...rows.map((r) => r.end)) + 3
  const days = last - first + 1
  const col = (day: number) => LEFT.length + day - first
  const weekends = project.workWeek === 'weekdays'
  const merges: string[] = []

  for (let d = first; d <= last; d++) {
    if (d === first || dayOfMonth(d) === 1) {
      const monthEnd = Math.min(last, toDay(fromDay(d).slice(0, 8) + '01') + daysInMonth(d) - 1)
      put(TOP - 2, col(d), cell(formatDay(d, { month: monthEnd - d < 6 ? 'short' : 'long', year: 'numeric' }), 'month'))
      for (let x = d + 1; x <= monthEnd; x++) put(TOP - 2, col(x), cell(undefined, 'month'))
      if (monthEnd > d) merges.push(`${ref(TOP - 2, col(d))}:${ref(TOP - 2, col(monthEnd))}`)
    }
    const off = weekends && !isWorkday(d, 'weekdays')
    put(TOP - 1, col(d), cell(dayOfMonth(d), d === todayDay ? 'dayToday' : off ? 'dayWeekend' : 'day'))
  }

  rows.forEach((r, i) => {
    const y = TOP + i
    put(y, 0, cell(r.num, styleFor(r.kind, 'num')))
    put(y, 1, cell(r.name, r.kind === 'sub' ? 'sub' : r.kind))
    put(y, 2, cell(excelDate(r.start), styleFor(r.kind, 'date')))
    put(y, 3, cell(excelDate(r.end), styleFor(r.kind, 'date')))
    put(y, 4, cell(r.days, styleFor(r.kind, 'num')))
    put(y, 5, cell(r.preds, styleFor(r.kind, 'num')))
    // The finished share of a bar is the darker part, as on screen.
    const doneTo = r.start + Math.round(((r.end - r.start + 1) * r.progress) / 100) - 1
    for (let d = first; d <= last; d++) {
      let style: StyleName | null = weekends && !isWorkday(d, 'weekdays') ? 'weekend' : null
      if (d >= r.start && d <= r.end && !r.milestone) style = r.summaryBar ? 'barSummary' : d <= doneTo ? 'barDone' : 'barTodo'
      if (r.milestone && d === r.start) put(y, col(d), cell('◆', 'milestone'))
      else if (style) put(y, col(d), cell(undefined, style))
    }
  })

  const legendRow = TOP + rows.length + 1
  put(legendRow, 1, cell('Dark bars are the project and parent tasks. Teal is the finished share of a task, light teal is what is left. ◆ marks a milestone.', 'legend'))

  sheet.rows = grid
  sheet.cols = [...LEFT_WIDTHS, ...Array.from({ length: days }, () => 3.2)]
  sheet.freeze = { rows: TOP, cols: LEFT.length }
  sheet.merges = merges
  return sheet
}

function daysInMonth(day: number): number {
  const d = new Date(day * 86_400_000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}

function risksSheet(project: Project): Sheet {
  const impact = { low: 'impactLow', medium: 'impactMedium', high: 'impactHigh' } as const
  return {
    name: 'Risks & issues',
    cols: [6, 40, 10, 10, 12, 70],
    freeze: { rows: 1, cols: 0 },
    autoFilter: `A1:F${project.risks.length + 1}`,
    rows: [
      ['ID', 'Risk or issue', 'Type', 'Impact', 'Likelihood', 'Notes'].map((h, i) => cell(h, i >= 2 && i <= 4 ? 'headCenter' : 'head')),
      ...project.risks.map((r, i) => [
        cell(`R${i + 1}`, 'riskNum'),
        cell(r.name, 'riskText'),
        cell(r.kind === 'issue' ? 'Issue' : 'Risk', 'riskNum'),
        cell(IMPACTS.find(([v]) => v === r.impact)?.[1] ?? r.impact, impact[r.impact]),
        cell(r.likelihood / 100, 'riskPct'),
        cell(r.notes, 'riskText'),
      ]),
    ],
  }
}

/** The plan as an Excel workbook: a task table, a Gantt chart drawn with cell colors, and the risk log. */
export function planWorkbook(project: Project, todayDay = today()): Uint8Array {
  return buildXlsx({
    sheets: [tasksSheet(project), ganttSheet(project, todayDay), ...(project.risks.length ? [risksSheet(project)] : [])],
    styles: NAMES.map((n) => STYLES[n]),
  })
}

export function planFileName(project: Project, todayDay = today()): string {
  const base = project.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60) || project.key
  return `${base}-plan-${fromDay(todayDay)}.xlsx`
}

/** Downloads the plan as an .xlsx file. */
export function downloadPlan(project: Project): void {
  const bytes = planWorkbook(project)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: planFileName(project) })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
