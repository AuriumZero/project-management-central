// Turns the sheets of a workbook into tasks and risks. Columns are found by
// their headings, under the names this app's own export uses and the usual
// alternatives (Microsoft Project's, and plain spreadsheets'), so a file
// exported from here imports back unchanged.

import { addWorkdays, nextWorkday } from './calendar'
import type { WorkWeek } from './calendar'
import { fromDay, toDay, today } from './dates'
import { parseDateText, parsePercent } from './paste'
import { keepManualStarts, parsePredecessors } from './plan'
import { makeId } from './storage'
import type { Impact, Risk, Task } from './types'
import type { SheetCell, SheetData } from './xlsxRead'

type TaskField = 'name' | 'id' | 'type' | 'level' | 'wbs' | 'parent' | 'start' | 'end' | 'days' | 'progress' | 'assignee' | 'preds' | 'milestone' | 'notes'
type RiskField = 'name' | 'kind' | 'impact' | 'likelihood' | 'notes'

/**
 * Accepted headings for each column, compared without case, spaces or
 * punctuation. Fields are matched in this order, each taking the first
 * heading on its list that is still free, so "Description" is a risk's name
 * only when there is no "Risk" column, and otherwise its notes.
 */
const TASK_HEADINGS: [TaskField, string[]][] = [
  ['name', ['task', 'taskname', 'name', 'title', 'activity', 'activityname', 'item', 'deliverable', 'workitem', 'summary']],
  ['id', ['id', 'number', 'no', 'num', 'taskid', 'row']],
  ['type', ['type', 'tasktype', 'kind']],
  ['level', ['outlinelevel', 'level']],
  ['wbs', ['wbs', 'outlinenumber']],
  ['parent', ['parent', 'parenttask', 'phase', 'group', 'workstream', 'stage']],
  ['start', ['start', 'startdate', 'begin', 'begindate', 'plannedstart', 'from']],
  ['end', ['finish', 'end', 'finishdate', 'enddate', 'due', 'duedate', 'plannedfinish', 'deadline', 'to']],
  ['days', ['days', 'duration', 'durationdays', 'workdays', 'workingdays', 'length']],
  ['progress', ['percentcomplete', 'complete', 'progress', 'pctcomplete', 'percentdone', 'done']],
  ['assignee', ['assignee', 'assignedto', 'owner', 'resourcenames', 'resource', 'resources', 'responsible', 'who']],
  ['preds', ['predecessors', 'predecessor', 'pred', 'preds', 'dependson', 'dependencies']],
  ['milestone', ['milestone']],
  ['notes', ['notes', 'note', 'comments', 'comment', 'description', 'details']],
]

const RISK_HEADINGS: [RiskField, string[]][] = [
  ['name', ['riskorissue', 'riskissue', 'risk', 'issue', 'riskdescription', 'issuedescription', 'title', 'name', 'description', 'summary']],
  ['kind', ['type', 'classification', 'category', 'kind']],
  ['impact', ['impact', 'severity', 'consequence']],
  ['likelihood', ['likelihood', 'probability', 'possibility', 'chance']],
  ['notes', ['notes', 'note', 'mitigation', 'mitigationplan', 'response', 'actions', 'comments', 'comment', 'description', 'details']],
]

/** `% Complete` → `percentcomplete`; a note in brackets such as `Impact (1-5)` is dropped. */
const norm = (heading: string) => heading.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/%/g, 'percent').replace(/#/g, 'number').replace(/[^a-z0-9]/g, '')

interface Header<F extends string> { row: number; cols: Map<F, number>; labels: Map<F, string> }

function matchHeadings<F extends string>(cells: (SheetCell | undefined)[], spec: [F, string[]][]): Pick<Header<F>, 'cols' | 'labels'> {
  const headings = cells.map((c) => (c ? norm(c.text) : ''))
  const used = new Set<number>()
  const cols = new Map<F, number>()
  const labels = new Map<F, string>()
  for (const [field, names] of spec) {
    for (const name of names) {
      const col = headings.findIndex((h, i) => h === name && !used.has(i))
      if (col >= 0) {
        cols.set(field, col)
        labels.set(field, cells[col]!.text)
        used.add(col)
        break
      }
    }
  }
  return { cols, labels }
}

/** The heading row: the one in the first 15 rows matching the most columns, with a name column. */
function findHeader<F extends string>(sheet: SheetData, spec: [F, string[]][]): Header<F> | null {
  let best: Header<F> | null = null
  sheet.rows.slice(0, 15).forEach((cells, row) => {
    const match = matchHeadings(cells, spec)
    if (match.cols.has('name' as F) && (!best || match.cols.size > best.cols.size)) best = { row, ...match }
  })
  return best
}

export interface ImportResult {
  tasks: Task[]
  risks: Risk[]
  /** Sheets the tasks and risks came from. */
  taskSheet?: string
  riskSheet?: string
  /** Column headings that were used, as written in the file. */
  taskColumns: string[]
  riskColumns: string[]
  /** The project row of a file exported from this app, when there is one. */
  project?: { name: string; description: string }
  /** Problems with individual cells that were skipped. */
  warnings: string[]
}

/**
 * Finds a sheet of tasks and a sheet of risks (they can be the same sheet in
 * neither case) and reads them. Tasks with predecessors keep their dates from
 * the file as "start no earlier than", so the import doesn't move anything.
 */
export function readPlan(sheets: SheetData[], week: WorkWeek, todayDay = today()): ImportResult {
  const result: ImportResult = { tasks: [], risks: [], taskColumns: [], riskColumns: [], warnings: [] }

  // Risks: a sheet with a name and an impact or likelihood column.
  const riskSheets = sheets
    .map((sheet) => ({ sheet, header: findHeader(sheet, RISK_HEADINGS) }))
    .filter((s): s is { sheet: SheetData; header: Header<RiskField> } => !!s.header && (s.header.cols.has('impact') || s.header.cols.has('likelihood')))
  const risky = riskSheets.sort((a, b) => b.header.cols.size - a.header.cols.size)[0]

  // Tasks: the sheet (other than the risks') with the most recognised columns.
  const taskSheets = sheets
    .filter((sheet) => sheet !== risky?.sheet)
    .map((sheet) => ({ sheet, header: findHeader(sheet, TASK_HEADINGS) }))
    .filter((s): s is { sheet: SheetData; header: Header<TaskField> } => !!s.header)
  const tasky = taskSheets.sort((a, b) => b.header.cols.size - a.header.cols.size)[0]

  if (tasky) {
    result.taskSheet = tasky.sheet.name
    result.taskColumns = [...tasky.header.labels.values()]
    readTasks(tasky.sheet, tasky.header, week, todayDay, result)
  }
  if (risky) {
    result.riskSheet = risky.sheet.name
    result.riskColumns = [...risky.header.labels.values()]
    result.risks = readRisks(risky.sheet, risky.header)
  }
  return result
}

const serialToDay = (serial: number) => Math.round(serial) - 25569

function dayOf(cell: SheetCell | undefined): number | null {
  if (!cell) return null
  // A number in a date column is a date serial even without a date format.
  if (cell.num !== undefined && cell.num > 1000) return serialToDay(cell.num)
  const iso = parseDateText(cell.text) ?? parseDateText(cell.text.replace(/^[a-z]{3,9},?\s+/i, ''))
  return iso ? toDay(iso) : null
}

/** `5`, `5d`, `5 days`, `2w` or `2 weeks` in working days. */
function daysOf(cell: SheetCell | undefined, week: WorkWeek): number | null {
  if (!cell) return null
  const m = /^(\d+(?:\.\d+)?)\s*(d|days?|edays?|w|wks?|weeks?)?\??$/i.exec(cell.text.trim())
  if (!m) return null
  const n = Number(m[1]) * (m[2] && /^w/i.test(m[2]) ? (week === 'all' ? 7 : 5) : 1)
  return Math.ceil(n)
}

function percentOf(cell: SheetCell | undefined): number | null {
  if (!cell) return null
  if (cell.percent && cell.num !== undefined) return Math.max(0, Math.min(100, Math.round(cell.num * 100)))
  return parsePercent(cell.text)
}

const yes = (cell: SheetCell | undefined) => !!cell && /^(y|yes|true|x|1|✓|◆)$/i.test(cell.text)

function readTasks(sheet: SheetData, header: Header<TaskField>, week: WorkWeek, todayDay: number, result: ImportResult): void {
  const at = (cells: (SheetCell | undefined)[], field: TaskField) => {
    const col = header.cols.get(field)
    return col === undefined ? undefined : cells[col]
  }
  const tasks: Task[] = []
  const idByNum = new Map<number, string>()
  const predText = new Map<string, { text: string; line: number }>()
  const parentByName = new Map<string, string>()
  let lastTop = ''
  let num = 0

  for (let r = header.row + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? []
    const nameCell = at(cells, 'name')
    const rawName = nameCell?.text ?? ''
    const name = rawName.trim()
    if (!name) continue
    const type = norm(at(cells, 'type')?.text ?? '')
    const idText = at(cells, 'id')?.text.trim() ?? ''
    // Row 0 of this app's export is the project itself.
    if (type === 'project' || (idText === '0' && !tasks.length)) {
      result.project = { name, description: at(cells, 'notes')?.text ?? '' }
      continue
    }

    // Outline: from a level or WBS column, a parent column, an indent, or the type.
    const level = Number(at(cells, 'level')?.text)
    const wbs = at(cells, 'wbs')?.text.trim()
    const parentName = at(cells, 'parent')?.text.trim()
    let sub: boolean
    if (Number.isFinite(level) && level > 0) sub = level > 1
    else if (wbs) sub = wbs.replace(/\.$/, '').includes('.')
    else if (parentName) sub = true
    else if ((nameCell?.indent ?? 0) > 0 || /^\s/.test(rawName)) sub = true
    else sub = type === 'subtask' || type === 'child'

    const id = makeId()
    let parentId = ''
    if (parentName) {
      parentId = parentByName.get(parentName.toLowerCase()) ?? ''
      if (!parentId) {
        // The parent named in the column isn't a row of its own: add it.
        parentId = makeId()
        tasks.push({ id: parentId, name: parentName, start: fromDay(todayDay), end: fromDay(todayDay), progress: 0, deps: [], parentId: '', assignee: '', notes: '' })
        parentByName.set(parentName.toLowerCase(), parentId)
      }
    } else if (sub && lastTop) parentId = lastTop
    if (!parentId) {
      lastTop = id
      parentByName.set(name.toLowerCase(), id)
    }

    // Dates: any two of start, finish and days give the third.
    const days = daysOf(at(cells, 'days'), week)
    const milestone = type === 'milestone' || yes(at(cells, 'milestone')) || days === 0
    let start = dayOf(at(cells, 'start'))
    let end = dayOf(at(cells, 'end'))
    const length = Math.max(1, days ?? 1)
    if (start === null && end !== null) start = addWorkdays(end, -(length - 1), week)
    if (start === null) start = todayDay
    start = nextWorkday(start, week)
    if (milestone) end = start
    else if (end === null || end < start) end = addWorkdays(start, length - 1, week)

    const progress = percentOf(at(cells, 'progress'))
    const task: Task = {
      id, name, parentId,
      start: fromDay(start), end: fromDay(end),
      progress: milestone ? 0 : progress ?? 0,
      deps: [],
      assignee: at(cells, 'assignee')?.text ?? '',
      notes: at(cells, 'notes')?.text ?? '',
      ...(milestone ? { milestone: true } : {}),
    }
    tasks.push(task)

    // Predecessors refer to the ID column, or else to row numbers as in Microsoft Project.
    num++
    const own = /^\d+$/.test(idText) ? Number(idText) : num
    if (!idByNum.has(own)) idByNum.set(own, id)
    const preds = at(cells, 'preds')?.text.trim()
    if (preds) predText.set(id, { text: preds, line: r + 1 })
  }

  for (const task of tasks) {
    const preds = predText.get(task.id)
    if (!preds) continue
    const deps = parsePredecessors(preds.text, idByNum, task.id)
    if (typeof deps === 'string') result.warnings.push(`Row ${preds.line}, “${task.name}”: predecessors “${preds.text}” skipped. ${deps}`)
    else task.deps = deps
  }
  result.tasks = keepManualStarts(tasks, week)
}

const IMPACT_WORDS: [RegExp, Impact][] = [
  [/^(h|hi|high|very ?high|critical|severe|major|extreme|catastrophic)/, 'high'],
  [/^(l|lo|low|very ?low|minor|negligible|insignificant)/, 'low'],
  [/^(m|med|medium|moderate|mid)/, 'medium'],
]

const LIKELIHOOD_WORDS: [RegExp, number][] = [
  [/^(very ?high|almost certain|certain)/, 90],
  [/^(very ?low|rare|remote)/, 10],
  [/^(h|high|likely|probable)/, 75],
  [/^(m|med|medium|moderate|possible)/, 50],
  [/^(l|low|unlikely)/, 25],
]

function readRisks(sheet: SheetData, header: Header<RiskField>): Risk[] {
  const at = (cells: (SheetCell | undefined)[], field: RiskField) => {
    const col = header.cols.get(field)
    return col === undefined ? undefined : cells[col]
  }
  const rows = sheet.rows.slice(header.row + 1).filter((cells) => at(cells ?? [], 'name')?.text.trim())
  // Impact scored as numbers: 1–3, or 1–5 when any is above 3.
  const scores = rows.map((cells) => at(cells, 'impact')?.num).filter((n): n is number => n !== undefined)
  const outOf5 = scores.some((n) => n > 3)

  return rows.map((cells) => {
    const kind = /issue/i.test(at(cells, 'kind')?.text ?? '') ? 'issue' : 'risk'
    const impactCell = at(cells, 'impact')
    let impact: Impact = 'medium'
    if (impactCell?.num !== undefined) {
      const n = impactCell.num
      impact = outOf5 ? (n <= 2 ? 'low' : n >= 4 ? 'high' : 'medium') : n <= 1 ? 'low' : n >= 3 ? 'high' : 'medium'
    } else if (impactCell) {
      impact = IMPACT_WORDS.find(([re]) => re.test(impactCell.text.toLowerCase()))?.[1] ?? 'medium'
    }
    const likelyCell = at(cells, 'likelihood')
    let likelihood = percentOf(likelyCell)
    if (likelihood === null && likelyCell) likelihood = LIKELIHOOD_WORDS.find(([re]) => re.test(likelyCell.text.toLowerCase()))?.[1] ?? null
    return {
      id: makeId(),
      name: at(cells, 'name')!.text.trim(),
      kind,
      impact,
      likelihood: likelihood ?? (kind === 'issue' ? 100 : 50),
      notes: at(cells, 'notes')?.text ?? '',
    }
  })
}

/** A project name from a file name: `Website-relaunch-plan-2026-10-01.xlsx` → `Website relaunch`. */
export function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/-plan-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Imported plan'
}
