import { describe, expect, it } from 'vitest'
import { buildXlsx, colName, excelDate, zip } from './xlsx'
import { toDay } from './dates'
import { unzip } from '../test/unzip'

describe('xlsx writer', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA'])
  })

  it("converts day numbers to Excel's date serials", () => {
    expect(excelDate(toDay('1970-01-01'))).toBe(25569)
    expect(excelDate(toDay('2026-10-01'))).toBe(46296)
  })

  it('writes a zip with a correct checksum and end record', () => {
    const bytes = zip([['a.txt', 'hello']])
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(14, true)).toBe(0x3610a686) // CRC-32 of "hello"
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
    expect(unzip(bytes).get('a.txt')).toBe('hello')
  })

  it('escapes text and shares one cell format per style', () => {
    const files = unzip(buildXlsx({
      sheets: [{ name: 'One', rows: [[{ v: 'A & <B>', s: 0 }, { v: 3, s: 1 }]], freeze: { rows: 1, cols: 0 }, autoFilter: 'A1:B1' }],
      styles: [{ bold: true }, { bold: true, numFmt: '0%' }],
    }))
    const sheet = files.get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">A &amp; &lt;B&gt;</t></is></c>')
    expect(sheet).toContain('<c r="B1" s="2"><v>3</v></c>')
    expect(sheet).toContain('ySplit="1"')
    const styles = files.get('xl/styles.xml')!
    expect(styles).toContain('<cellXfs count="3">')
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="0%"/>')
    // Both styles are bold, so they share one font.
    expect(styles).toContain('<fonts count="2">')
    expect(files.get('xl/workbook.xml')).toContain("'One'!$A$1:$B$1")
  })
})
