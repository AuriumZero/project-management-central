import { fromDay, isValidDate } from './dates'
import type { ISODate } from './types'

// Reading what Excel (or Google Sheets) puts on the clipboard: rows separated
// by new lines and cells by tabs, with the values as they were displayed.

/** Splits pasted text into rows of cells, or null for a single value (an ordinary paste). */
export function parseClipboard(text: string): string[][] | null {
  const rows = readTsv(text.replace(/\r\n?/g, '\n'))
  // Excel ends a copied range with a new line.
  while (rows.length && rows.at(-1)!.every((c) => !c.trim())) rows.pop()
  if (rows.length <= 1 && (rows[0]?.length ?? 0) <= 1) return null
  return rows
}

/** Tab-separated values, where Excel quotes a cell that holds a line break, a tab or a quote. */
function readTsv(text: string): string[][] {
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === '\t') { rows.at(-1)!.push(cell); cell = '' }
    else if (ch === '\n') { rows.at(-1)!.push(cell); cell = ''; rows.push([]) }
    else cell += ch
  }
  rows.at(-1)!.push(cell)
  return rows
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Reads a date the way Excel tends to show it: `2026-10-14`, `10/14/2026`,
 * `10/14/26`, `14-Oct-26`, `Oct 14, 2026` or `14 October 2026`.
 * Slashed dates are read month first, as in US Excel. Null if it isn't a date.
 */
export function parseDateText(text: string): ISODate | null {
  const t = text.trim()
  const year = (y: string) => (y.length <= 2 ? 2000 + Number(y) : Number(y))
  const make = (y: number, m: number, d: number) => {
    const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return isValidDate(iso) ? iso : null
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return make(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(t)
  if (m) return make(year(m[3]), +m[1], +m[2])
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*\.?[\s-],?\s*(\d{2}|\d{4})$/i.exec(t)
  if (m && MONTHS.includes(m[2].toLowerCase())) return make(year(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])
  m = /^(?:[a-z]+,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/i.exec(t)
  if (m && MONTHS.includes(m[1].toLowerCase())) return make(year(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])
  // A bare Excel date serial, as when a date cell is formatted as a number.
  m = /^(\d{5})$/.exec(t)
  if (m) return fromDay(+m[1] - 25569)
  return null
}

/** Reads `70%`, `70` or `0.7` (a fraction, as Excel stores percentages) as 70. Null if it isn't one. */
export function parsePercent(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t.replace('%', '').trim())
  if (!Number.isFinite(n)) return null
  const value = !t.includes('%') && n > 0 && n < 1 ? n * 100 : n
  return value >= 0 && value <= 100 ? Math.round(value) : null
}
