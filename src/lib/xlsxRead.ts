// Reads the cells of an .xlsx workbook in the browser, with no library: an
// .xlsx file is a zip of XML parts. Only what an import needs is read: each
// sheet's values, which cells are dates or percentages, and cell indents.

import { readDelimited } from './paste'

export interface SheetCell {
  /** The value as text: a string as typed, or a number in plain digits. */
  text: string
  /** Set when the cell holds a number. */
  num?: number
  /** The cell's number format shows a date (so `num` is an Excel date serial). */
  date?: boolean
  /** The cell's number format is a percentage (so `num` is a fraction). */
  percent?: boolean
  /** Indent level from the cell's alignment, which Excel users use for subtasks. */
  indent?: number
}

export interface SheetData {
  name: string
  /** Rows of cells; a missing cell is `undefined`. */
  rows: (SheetCell | undefined)[][]
}

/** Reads every sheet of a workbook. Throws with a readable message if it isn't one. */
export async function readWorkbook(bytes: Uint8Array): Promise<SheetData[]> {
  const files = await unzip(bytes)
  const text = (path: string) => {
    const data = files.get(path)
    return data ? new TextDecoder().decode(data) : undefined
  }
  const workbook = text('xl/workbook.xml')
  if (!workbook) throw new Error("This doesn't look like an Excel workbook.")

  const book = xml(workbook)
  const rels = new Map(tags(xml(text('xl/_rels/workbook.xml.rels') ?? '<r/>'), 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target') ?? '']))
  const strings = sharedStrings(text('xl/sharedStrings.xml'))
  const styles = cellStyles(text('xl/styles.xml'))
  // Workbooks from old Mac Excel count dates from 1904.
  const date1904 = ['1', 'true'].includes(tags(book, 'workbookPr')[0]?.getAttribute('date1904') ?? '')

  return tags(book, 'sheet').flatMap((sheet) => {
    const rid = sheet.getAttributeNS(REL_NS, 'id') ?? sheet.getAttribute('r:id')
    const target = rels.get(rid ?? '') ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const source = text(path)
    if (!source) return []
    return [{ name: sheet.getAttribute('name') ?? 'Sheet', rows: readSheet(source, strings, styles, date1904) }]
  })
}

/** Reads a .csv or tab-separated file as a one-sheet workbook. */
export function readCsv(text: string, name: string): SheetData[] {
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0)
  const sep = firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ','
  const rows = readDelimited(text.replace(/^﻿/, ''), sep).map((r) => r.map((c) => (c.trim() ? { text: c.trim() } : undefined)))
  return [{ name, rows }]
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const xml = (source: string) => new DOMParser().parseFromString(source, 'application/xml')
/** Elements by local name, whatever namespace prefix the file uses. */
const tags = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name))

/** Text of shared strings, joining the runs of rich text and skipping phonetic hints. */
function sharedStrings(source: string | undefined): string[] {
  if (!source) return []
  return tags(xml(source), 'si').map(stringItem)
}

function stringItem(si: Element): string {
  return tags(si, 't').filter((t) => t.parentElement?.localName !== 'rPh').map((t) => t.textContent ?? '').join('')
}

interface CellStyleInfo { date: boolean; percent: boolean; indent: number }

// Built-in number formats that show dates or times, and percentages.
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])
const PERCENT_FORMATS = new Set([9, 10])

function cellStyles(source: string | undefined): CellStyleInfo[] {
  if (!source) return []
  const doc = xml(source)
  const custom = new Map(tags(doc, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']))
  const xfs = tags(doc, 'cellXfs')[0]
  if (!xfs) return []
  return Array.from(xfs.children).filter((x) => x.localName === 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0)
    // Quoted text and [colour] or [$-locale] blocks aren't part of the pattern.
    const code = (custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
    return {
      date: DATE_FORMATS.has(id) || /[dmyh]/i.test(code),
      percent: PERCENT_FORMATS.has(id) || code.includes('%'),
      indent: Number(tags(xf, 'alignment')[0]?.getAttribute('indent') ?? 0),
    }
  })
}

/** "BC12" → column 54 (zero-based). */
function columnOf(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const code = ch.toUpperCase().charCodeAt(0)
    if (code < 65 || code > 90) break
    n = n * 26 + code - 64
  }
  return n - 1
}

function readSheet(source: string, strings: string[], styles: CellStyleInfo[], date1904: boolean): (SheetCell | undefined)[][] {
  const rows: (SheetCell | undefined)[][] = []
  let nextRow = 0
  for (const row of tags(xml(source), 'row')) {
    const r = Number(row.getAttribute('r') ?? nextRow + 1) - 1
    nextRow = r + 1
    const cells: (SheetCell | undefined)[] = []
    let nextCol = 0
    for (const c of Array.from(row.children).filter((x) => x.localName === 'c')) {
      const ref = c.getAttribute('r')
      const col = ref ? columnOf(ref) : nextCol
      nextCol = col + 1
      const cell = readCell(c, strings, styles, date1904)
      if (cell) cells[col] = cell
    }
    if (cells.length) rows[r] = cells
  }
  return Array.from(rows, (r) => r ?? [])
}

function readCell(c: Element, strings: string[], styles: CellStyleInfo[], date1904: boolean): SheetCell | undefined {
  const type = c.getAttribute('t') ?? 'n'
  const style = styles[Number(c.getAttribute('s') ?? 0)]
  const v = Array.from(c.children).find((x) => x.localName === 'v')?.textContent ?? ''
  const indent = style?.indent || undefined
  let text: string
  if (type === 's') text = strings[Number(v)] ?? ''
  else if (type === 'inlineStr') text = Array.from(c.children).filter((x) => x.localName === 'is').map(stringItem).join('')
  else if (type === 'str' || type === 'e') text = v
  else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE'
  else if (type === 'd') text = v.slice(0, 10)
  else {
    if (v === '') return undefined
    const num = Number(v)
    if (!Number.isFinite(num)) return { text: v, indent }
    const date = !!style?.date
    return { text: v, num: date && date1904 ? num + 1462 : num, date: date || undefined, percent: style?.percent || undefined, indent }
  }
  return text.trim() ? { text: text.trim(), indent } : undefined
}

/** Unpacks a zip archive into its files. Stored and deflated entries are supported. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end-of-central-directory record is in the last 64 KB (it may be followed by a comment).
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error("This doesn't look like an Excel workbook (.xlsx).")

  const count = view.getUint16(end + 10, true)
  let p = view.getUint32(end + 16, true)
  const names = new TextDecoder()
  const files = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('The workbook file is damaged.')
    const method = view.getUint16(p + 10, true)
    const size = view.getUint32(p + 20, true)
    const nameLength = view.getUint16(p + 28, true)
    const extraLength = view.getUint16(p + 30, true)
    const commentLength = view.getUint16(p + 32, true)
    const local = view.getUint32(p + 42, true)
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength))
    p += 46 + nameLength + extraLength + commentLength

    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + size)
    if (method === 0) files.set(name, data)
    else if (method === 8) files.set(name, await inflate(data))
    else throw new Error('The workbook uses a kind of compression this app can’t read.')
  }
  return files
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
  const output = input.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(output).arrayBuffer())
}
