import { describe, expect, it } from 'vitest'
import { planFileName, planWorkbook } from './excel'
import { toDay } from './dates'
import { seedState } from './storage'
import { unzip } from '../test/unzip'

const project = seedState().projects[0]
const todayDay = toDay('2026-10-01')

describe('Excel export', () => {
  const files = unzip(planWorkbook(project, todayDay))
  const tasks = files.get('xl/worksheets/sheet1.xml')!
  const gantt = files.get('xl/worksheets/sheet2.xml')!

  it('has a task sheet and a Gantt chart sheet', () => {
    expect(files.get('xl/workbook.xml')).toMatch(/<sheet name="Tasks".*<sheet name="Gantt chart".*<sheet name="Risks &amp; issues"/)
  })

  it('logs every risk with its impact, likelihood and wrapped notes', () => {
    const risks = files.get('xl/worksheets/sheet3.xml')!
    for (const r of project.risks) expect(risks).toContain(`<v>${r.likelihood / 100}</v>`)
    expect(risks).toContain('>High</t>')
    expect(files.get('xl/styles.xml')).toContain('wrapText="1"')
  })

  it('lists the project, every task and the links both ways', () => {
    const xml = (s: string) => s.replace(/&/g, '&amp;')
    for (const t of project.tasks) expect(tasks).toContain(`>${xml(t.name)}</t>`)
    expect(tasks).toContain('>Predecessors</t>')
    expect(tasks).toContain('>Successors</t>')
    expect(tasks).toContain(`>${project.name}</t>`)
  })

  it('makes the project and parent rows bold, but not subtasks', () => {
    const styles = files.get('xl/styles.xml')!
    const xfs = [...styles.matchAll(/<xf numFmtId="\d+" fontId="(\d+)"/g)].slice(1).map((m) => Number(m[1]))
    const fonts = [...styles.matchAll(/<font>(.*?)<\/font>/g)].map((m) => m[1])
    const boldAt = (name: string) => {
      const style = Number(new RegExp(`<c r="B\\d+" s="(\\d+)" t="inlineStr"><is><t xml:space="preserve">${name}</t>`).exec(tasks)![1])
      return fonts[xfs[style]].includes('<b/>')
    }
    const parent = project.tasks.find((t) => !t.parentId)!
    const sub = project.tasks.find((t) => t.parentId)!
    expect(boldAt(project.name.replace(/[()]/g, '\\$&'))).toBe(true)
    expect(boldAt(parent.name)).toBe(true)
    expect(boldAt(sub.name)).toBe(false)
  })

  it('draws bars and milestones on the Gantt sheet', () => {
    expect(gantt).toContain('>◆</t>')
    expect(gantt).toContain('<mergeCell ')
    expect(gantt).toContain('orientation="landscape"')
  })

  it('names the file after the project and date', () => {
    expect(planFileName(project, todayDay)).toBe('Website-relaunch-example-plan-2026-10-01.xlsx')
  })
})
