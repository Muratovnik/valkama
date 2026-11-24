/**
 * How wide `ellipsisFit` makes a start cut with `text-overflow: ellipsis`, by the rule the space
 * window's folders keep (DESIGN.md, «The space window»): every cut shows at least the start's
 * first letter and the whole «…», whatever the room, and otherwise the longest start that fits
 * the room with its «…». Given less room than one letter and the «…», a box as wide as the «…»
 * alone drew the first letter and clipped the «…» to one dot.
 *
 * happy-dom lays nothing out, so a range is as wide as its letters at the widths given here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ellipsisFit, ellipsisLeast } from '@/shared/lib/ellipsisFit.ts'

/** Every letter is 8px wide but `W`, 12px; the «…» is 11.5px. */
const letter = (char: string) => (char === 'W' ? 12 : 8)
const DOTS = 11.5

beforeEach(() => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const text = (this.startContainer.textContent ?? '').slice(this.startOffset, this.endOffset)
    let width = 0
    for (const char of text) width += letter(char)
    return new DOMRect(0, 0, width, 16)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const words = (data: string) => document.createTextNode(data)

describe('ellipsisFit', () => {
  it('gives nothing where the whole start fits', () => {
    expect(ellipsisFit(words('D:/work'), 56, DOTS)).toBeNull()
  })

  it('ends the longest start that fits the room with its «…» at the box’s edge', () => {
    // Three letters and the «…» are 35.5px, four 43.5px: in 40px three show.
    expect(ellipsisFit(words('D:/work/clients'), 40, DOTS)).toBeCloseTo(24 + DOTS, 0)
  })

  it('never cuts a start to less than its first letter and the whole «…»', () => {
    // One letter and the «…» are 19.5px; the room is 18px, as wide as 1.5em of the folders' type.
    const fit = ellipsisFit(words('WD:/work/clients'), 18, DOTS)
    expect(fit).not.toBeNull()
    expect(fit ?? 0).toBeGreaterThanOrEqual(12 + DOTS)
    // and no wider than that, so no second letter shows
    expect(fit ?? Number.POSITIVE_INFINITY).toBeLessThan(12 + 8 + DOTS)
  })

  it('keeps the first letter and the «…» in a room narrower than the «…» itself', () => {
    expect(ellipsisFit(words('D:/work/clients'), 6, DOTS) ?? 0).toBeGreaterThanOrEqual(8 + DOTS)
  })
})

describe('ellipsisLeast', () => {
  it('is the first letter and the whole «…», which no cut start is narrower than', () => {
    const least = ellipsisLeast(words('WD:/work/clients'), DOTS)
    expect(least).toBeGreaterThanOrEqual(12 + DOTS)
    expect(least).toBeLessThan(12 + 8 + DOTS)
  })
})
