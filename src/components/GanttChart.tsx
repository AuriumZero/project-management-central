import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, PointerEvent as ReactPointerEvent, Ref } from 'react'
import { formatDay, spanDays, toDay, today } from '../lib/dates'
import { dragOffsets, ganttLayout, ROW_HEIGHT } from '../lib/schedule'
import type { DragMode } from '../lib/schedule'
import type { Project, Task } from '../lib/types'
import type { Action } from '../state/reducer'

export interface GanttHandle {
  scrollToToday: () => void
}

interface GanttChartProps {
  project: Project
  dispatch: Dispatch<Action>
  onEditTask: (task: Task) => void
  onNewTask: () => void
  ref?: Ref<GanttHandle>
}

interface Drag {
  id: string
  start: number
  end: number
  /** Pointer position for the floating date tip. */
  x: number
  y: number
}

function useNameColumnWidth() {
  const narrow = () => typeof window !== 'undefined' && window.innerWidth < 760
  const [isNarrow, setNarrow] = useState(narrow)
  useEffect(() => {
    const onResize = () => setNarrow(narrow())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isNarrow ? 150 : 250
}

export function GanttChart({ project, dispatch, onEditTask, onNewTask, ref }: GanttChartProps) {
  const { tasks, zoom } = project
  const todayDay = today()
  const layout = useMemo(() => ganttLayout(tasks, zoom, todayDay), [tasks, zoom, todayDay])
  const left = useNameColumnWidth()
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const scrollToToday = (behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current
    if (!el || layout.todayX == null) return
    el.scrollTo({ left: Math.max(0, layout.todayX - (el.clientWidth - left) / 4), behavior })
  }
  useImperativeHandle(ref, () => ({ scrollToToday }))

  // Start each project and zoom level with today in view.
  useLayoutEffect(() => { scrollToToday('instant') }, [project.id, zoom])

  if (!tasks.length) {
    return (
      <div className="blank">
        <h2>No tasks in this plan</h2>
        <p>Add tasks with start and end dates. They appear here as bars you can drag to reschedule.</p>
        <button className="btn primary" onClick={onNewTask}>Add the first task</button>
      </div>
    )
  }

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, task: Task) => {
    if (e.button !== 0) return
    e.preventDefault()
    const bar = e.currentTarget
    const handle = (e.target as HTMLElement).dataset.handle as DragMode | undefined
    const mode: DragMode = task.milestone ? 'move' : handle ?? 'move'
    const length = spanDays(task.start, task.end)
    const x0 = e.clientX
    let moved = false
    let offsets = { start: 0, end: 0 }
    bar.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true
      if (!moved) return
      offsets = dragOffsets(mode, Math.round((ev.clientX - x0) / layout.dayWidth), length)
      setDrag({ id: task.id, ...offsets, x: ev.clientX, y: ev.clientY })
    }
    const onUp = () => {
      bar.removeEventListener('pointermove', onMove)
      bar.removeEventListener('pointerup', onUp)
      bar.removeEventListener('pointercancel', onUp)
      setDrag(null)
      if (!moved) return onEditTask(task)
      if (offsets.start || offsets.end) dispatch({ type: 'shiftTask', id: task.id, ...offsets })
    }
    bar.addEventListener('pointermove', onMove)
    bar.addEventListener('pointerup', onUp)
    bar.addEventListener('pointercancel', onUp)
  }

  const dragged = drag && tasks.find((t) => t.id === drag.id)
  const tip = dragged && drag && (() => {
    const s = toDay(dragged.start) + drag.start
    const e = dragged.milestone ? s : toDay(dragged.end) + drag.end
    return dragged.milestone ? formatDay(s) : `${formatDay(s)} – ${formatDay(e)} · ${e - s + 1}d`
  })()

  return (
    <div className="gantt" ref={scroller} style={{ '--rh': `${ROW_HEIGHT}px` } as CSSProperties}>
      <div className="g-inner" style={{ width: left + layout.width }}>
        <div className="g-head">
          <div className="g-corner label" style={{ width: left }}>Task</div>
          <div className="g-scale" style={{ width: layout.width }}>
            {layout.months.map((m) => <div key={m.x} className="g-mon" style={{ left: m.x }}>{m.label}</div>)}
            {layout.days.map((d) => (
              <div key={d.x} className={`g-day${d.weekStart ? ' wk' : ''}${d.isToday ? ' now' : ''}`} style={{ left: d.x, width: d.width }}>{d.label}</div>
            ))}
            {zoom !== 'day' && layout.todayX != null && <div className="g-today-tag" style={{ left: layout.todayX }}>TODAY</div>}
          </div>
        </div>
        <div className="g-rows">
          <div className="g-names" style={{ width: left }}>
            {tasks.map((t) => (
              <button key={t.id} className="g-name" onClick={() => onEditTask(t)}>
                <span className="t">{t.milestone ? '◆ ' : ''}{t.name}</span>
                <span className="d">
                  {t.milestone
                    ? formatDay(toDay(t.start))
                    : `${formatDay(toDay(t.start))} – ${formatDay(toDay(t.end))} · ${spanDays(t.start, t.end)}d`}
                </span>
              </button>
            ))}
            <div className="g-add"><button className="btn ghost small" onClick={onNewTask}>+ Add task</button></div>
          </div>
          <div className="g-body" style={{ width: layout.width, height: layout.height }}>
            {layout.gridLines.map((x) => <div key={`l${x}`} className="g-line" style={{ left: x }} />)}
            {layout.weekends.map((w) => <div key={`w${w.x}`} className="g-wkend" style={{ left: w.x, width: w.width }} />)}
            {tasks.map((t, i) => <div key={`r${t.id}`} className="g-rowline" style={{ top: (i + 1) * ROW_HEIGHT - 1 }} />)}
            {layout.todayX != null && <div className="g-today" style={{ left: layout.todayX - 1 }} />}
            <svg className="g-svg" width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0 L8 4 L0 8 z" />
                </marker>
              </defs>
              {layout.arrows.map((d) => <path key={d} d={d} markerEnd="url(#ah)" />)}
            </svg>
            {layout.bars.map((bar, i) => {
              const t = tasks[i]
              const off = drag?.id === t.id ? drag : null
              const x = bar.x + (off ? off.start * layout.dayWidth : 0)
              const width = bar.width + (off && !bar.milestone ? (off.end - off.start) * layout.dayWidth : 0)
              const done = t.progress >= 100
              return (
                <div
                  key={t.id}
                  className={`bar${bar.milestone ? ' ms' : ''}${done ? ' done' : ''}${off ? ' dragging' : ''}`}
                  style={{ left: x, top: bar.y, width }}
                  title={t.name}
                  data-testid={`bar-${t.id}`}
                  onPointerDown={(e) => startDrag(e, t)}
                >
                  {!bar.milestone && <>
                    <div className="fill" style={{ width: `${t.progress}%` }} />
                    <div className="h l" data-handle="start" />
                    <div className="h r" data-handle="end" />
                  </>}
                  <span className="lbl">{t.name}{!bar.milestone && t.progress ? ` · ${t.progress}%` : ''}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {tip && drag && <div className="drag-tip" style={{ left: drag.x + 12, top: drag.y + 14 }}>{tip}</div>}
    </div>
  )
}
