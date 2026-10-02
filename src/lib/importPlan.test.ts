import { describe, expect, it } from 'vitest'
import { toDay } from './dates'
import { planWorkbook } from './excel'
import { nameFromFile, readPlan } from './importPlan'
import { outline, schedule } from './plan'
import { seedState } from './storage'
import { readCsv, readWorkbook } from './xlsxRead'
import { deflateZip } from '../test/deflateZip'

const todayDay = toDay('2026-10-01')

describe('importing from Excel', () => {
  it('reads back a file exported from this app unchanged', async () => {
    const project = seedState(todayDay).projects[0]
    const sheets = await readWorkbook(planWorkbook(project, todayDay))
    const result = readPlan(sheets, project.workWeek, todayDay)

    expect(result.taskSheet).toBe('Tasks')
    expect(result.riskSheet).toBe('Risks & issues')
    expect(result.project).toEqual({ name: project.name, description: project.description })
    expect(result.warnings).toEqual([])

    const shape = (tasks: typeof project.tasks) => {
      const rows = outline(tasks)
      const num = new Map(rows.map((r) => [r.task.id, r.num]))
      return rows.map(({ task, depth }) => ({
        name: task.name, depth, start: task.start, end: task.end, progress: task.progress,
        assignee: task.assignee, milestone: !!task.milestone,
        deps: task.deps.map((d) => `${num.get(d.id)}${d.type}${d.lag}`),
      }))
    }
    expect(shape(result.tasks)).toEqual(shape(project.tasks))
    expect(result.risks.map(({ id: _id, ...r }) => r)).toEqual(project.risks.map(({ id: _id, ...r }) => r))
  })

  it('reads a Microsoft Project style sheet from a compressed workbook', async () => {
    const sheet = (rows: string[][]) =>
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.join('')}</row>`).join('')}</sheetData></worksheet>`
    const s = (ref: string, i: number, style = 0) => `<c r="${ref}" t="s" s="${style}"><v>${i}</v></c>`
    const n = (ref: string, v: number, style = 0) => `<c r="${ref}" s="${style}"><v>${v}</v></c>`
    const strings = ['ID', 'Task Name', 'Duration', 'Start', 'Finish', 'Predecessors', 'Resource Names', '% Complete', 'Outline Level',
      'Kickoff', '3 days', 'Build', 'Write code', '1', 'Sam', 'Ship it']
    const serial = (iso: string) => toDay(iso) + 25569
    const bytes = await deflateZip([
      ['xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Task_Table1" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="/xl/worksheets/sheet1.xml"/></Relationships>'],
      ['xl/sharedStrings.xml', `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((t, i) => (i === 12 ? `<si><r><t>Write </t></r><r><t>code</t></r></si>` : `<si><t>${t}</t></si>`)).join('')}</sst>`],
      ['xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="9"/></cellXfs></styleSheet>'],
      ['xl/worksheets/sheet1.xml', sheet([
        strings.slice(0, 9).map((_, i) => s(`${'ABCDEFGHI'[i]}1`, i)),
        [n('A2', 1), s('B2', 9), s('C2', 10), n('D2', serial('2026-10-05'), 1), n('H2', 1, 2), n('I2', 1)],
        [n('A3', 2), s('B3', 11), n('I3', 1)],
        [n('A4', 3), s('B4', 12), n('C4', 5), s('F4', 13), s('G4', 14), n('H4', 0.4, 2), n('I4', 2)],
        [n('A5', 4), s('B5', 15), n('C5', 0), s('F5', 13), n('I5', 1)],
      ])],
    ])
    const { tasks, warnings, taskColumns } = readPlan(await readWorkbook(bytes), 'weekdays', todayDay)
    expect(warnings).toEqual([])
    expect(taskColumns).toContain('Resource Names')
    // The app schedules imported tasks as it adds them.
    const rows = outline(schedule(tasks, 'weekdays')).map(({ task, depth }) => [task.name, depth, task.start, task.end, task.progress, task.assignee, !!task.milestone])
    expect(rows).toEqual([
      ['Kickoff', 0, '2026-10-05', '2026-10-07', 100, '', false],
      // Write code waits on Kickoff, so it starts the next working day.
      ['Build', 0, '2026-10-08', '2026-10-14', 40, '', false],
      ['Write code', 1, '2026-10-08', '2026-10-14', 40, 'Sam', false],
      ['Ship it', 0, '2026-10-08', '2026-10-08', 0, '', true],
    ])
  })

  it('reads a plain CSV with a phase column and loose headings', () => {
    const csv = 'Phase,Activity,Begin,Due,Owner,Comments\r\nPlanning,Book venue,10/5/2026,10/9/2026,Ana,"Call first, then email"\r\nPlanning,Send invites,,,Ben,\r\n'
    const { tasks } = readPlan(readCsv(csv, 'party'), 'weekdays', todayDay)
    const rows = outline(tasks).map(({ task, depth }) => [task.name, depth, task.assignee, task.notes])
    expect(rows).toEqual([
      ['Planning', 0, '', ''],
      ['Book venue', 1, 'Ana', 'Call first, then email'],
      ['Send invites', 1, 'Ben', ''],
    ])
  })

  it('reads risks with words or numbers for impact and likelihood', () => {
    const csv = [
      'Risk,Classification,Severity,Probability,Mitigation',
      'Vendor late,Risk,High,30%,Chase weekly',
      'Server down,Issue,Low,,Restarted',
      'Budget cut,Risk,Moderate,Likely,',
    ].join('\n')
    const { risks, tasks } = readPlan(readCsv(csv, 'risks'), 'weekdays', todayDay)
    expect(tasks).toEqual([])
    expect(risks.map(({ id: _id, ...r }) => r)).toEqual([
      { name: 'Vendor late', kind: 'risk', impact: 'high', likelihood: 30, notes: 'Chase weekly' },
      { name: 'Server down', kind: 'issue', impact: 'low', likelihood: 100, notes: 'Restarted' },
      { name: 'Budget cut', kind: 'risk', impact: 'medium', likelihood: 75, notes: '' },
    ])
  })

  it('reports predecessors it cannot read and keeps the task', () => {
    const { tasks, warnings } = readPlan(readCsv('Task\tPredecessors\nA\t\nB\tafter A\n', 'x'), 'weekdays', todayDay)
    expect(tasks.map((t) => t.name)).toEqual(['A', 'B'])
    expect(warnings[0]).toMatch(/Row 3, “B”: predecessors “after A” skipped/)
  })

  it('names a project after the file', () => {
    expect(nameFromFile('Website-relaunch-plan-2026-10-01.xlsx')).toBe('Website relaunch')
    expect(nameFromFile('Q4 launch.xlsx')).toBe('Q4 launch')
  })
})
