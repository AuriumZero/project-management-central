import { useEffect, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

export const MIN_COLUMN = 36
export const MAX_COLUMN = 900

export const clampColumn = (w: number, min = MIN_COLUMN) => Math.round(Math.min(MAX_COLUMN, Math.max(min, w)))

/** Column widths the user has dragged, remembered in this browser under `key`. */
export function useColumnWidths(key: string) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
      return saved && typeof saved === 'object' ? Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number> : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(widths)) } catch { /* not critical */ }
  }, [key, widths])
  const setWidth = (col: string, width: number) => setWidths((w) => ({ ...w, [col]: width }))
  return [widths, setWidth] as const
}

/**
 * The width a column needs to show every cell in full: text fields count the text
 * they scroll past, other cells their own overflow.
 */
export function fitColumn(root: Element | null, cls: string, min = MIN_COLUMN): number | null {
  if (!root) return null
  let need = 0
  root.querySelectorAll<HTMLElement>(`.${cls}`).forEach((cell) => {
    const fields = cell.querySelectorAll<HTMLElement>('input, textarea, select')
    let extra = Math.max(0, cell.scrollWidth - cell.clientWidth)
    fields.forEach((f) => { extra = Math.max(extra, f.scrollWidth - f.clientWidth) })
    need = Math.max(need, cell.offsetWidth + extra)
  })
  return need > 0 ? clampColumn(need + 6, min) : null
}

interface ColumnResizerProps {
  label: string
  width: number
  /** Called once when a drag (or key press) begins, before any `onResize`. */
  onStart?: () => void
  /** `dx` is the distance moved since the drag began; `done` is true on release. */
  onResize: (dx: number, done: boolean) => void
  /** Double-click: size the column to its contents. */
  onFit: () => void
}

/** A drag handle on the right edge of a column heading. */
export function ColumnResizer({ label, width, onStart, onResize, onFit }: ColumnResizerProps) {
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    const x0 = e.clientX
    let dx = 0
    onStart?.()
    handle.setPointerCapture?.(e.pointerId)
    document.body.classList.add('col-resizing')
    const onMove = (ev: PointerEvent) => {
      dx = ev.clientX - x0
      onResize(dx, false)
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('col-resizing')
      onResize(dx, true)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
    if (!dx) return
    e.preventDefault()
    onStart?.()
    onResize(dx, true)
  }
  return (
    <div
      className="col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label} column`}
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_COLUMN}
      aria-valuemax={MAX_COLUMN}
      tabIndex={0}
      title="Drag to resize. Double-click to fit the contents."
      onPointerDown={start}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onFit() }}
      onKeyDown={key}
    />
  )
}
