import { describe, expect, it } from 'vitest'
import { parseClipboard, parseDateText, parsePercent } from './paste'

describe('pasting from Excel', () => {
  it('splits rows and cells, ignoring the trailing new line', () => {
    expect(parseClipboard('Plan\r\nBuild\r\nTest\r\n')).toEqual([['Plan'], ['Build'], ['Test']])
    expect(parseClipboard('A\t10/14/2026\nB\t10/20/2026\n')).toEqual([['A', '10/14/2026'], ['B', '10/20/2026']])
    expect(parseClipboard('"Line one\nline two"\tx\n"Say ""hi"""\ty')).toEqual([['Line one\nline two', 'x'], ['Say "hi"', 'y']])
  })

  it('leaves a single value to an ordinary paste', () => {
    expect(parseClipboard('Just one')).toBeNull()
    expect(parseClipboard('Just one\n')).toBeNull()
  })

  it('reads dates the way Excel shows them', () => {
    for (const text of ['2026-10-14', '10/14/2026', '10/14/26', '14-Oct-26', 'Oct 14, 2026', '14 October 2026', 'Wednesday, October 14, 2026', '46309'])
      expect([text, parseDateText(text)]).toEqual([text, '2026-10-14'])
    expect(parseDateText('13/14/2026')).toBeNull()
    expect(parseDateText('soon')).toBeNull()
  })

  it('reads percentages', () => {
    expect([parsePercent('70%'), parsePercent('70'), parsePercent('0.7'), parsePercent('1'), parsePercent('150'), parsePercent('')]).toEqual([70, 70, 70, 1, null, null])
  })
})
