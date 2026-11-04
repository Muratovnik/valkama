import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/**
 * The narrowest a name may be drawn beside the time, in widths of the digit zero: about
 * seventeen lowercase letters in the interface font, so a word of an agent's name such as
 * "retrospective" stands whole beside the time.
 */
const NAME_MIN_CH = 14

export type DatePlace = 'first line' | 'own line'

/**
 * Who wrote an entry and when, beside a name too long to share one line with the time. The
 * time stands at the end of the name's first line while the name keeps at least
 * `NAME_MIN_CH` there, or as much as the whole name takes if that is less; with less room
 * it takes a line of its own under the name, at its end, and the name the whole width. In
 * either place the name breaks inside a word only where that word does not fit its line.
 * A name squeezed into what the time left over once stood a word or two to a line.
 */
export async function expectDateHeld(meta: Locator, where: string): Promise<DatePlace> {
  const line = await meta.evaluate((root, minCh) => {
    const [who, when] = [root.firstElementChild, root.lastElementChild]
    if (!who || !when || who === when) throw new Error('A name and a time')
    const box = root.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(who)
    const whose = [...range.getClientRects()].filter((rect) => rect.width > 0)
    // The minimum measured in the name's own font, apart from whatever rule applies it.
    const probe = document.createElement('span')
    probe.textContent = '0'.repeat(minCh)
    probe.style.whiteSpace = 'nowrap'
    who.append(probe)
    const minimum = probe.getBoundingClientRect().width
    probe.remove()
    // A line may break between words and after a hyphen; a piece cut anywhere else is a
    // word broken, and it is recorded with the width it would need on one line.
    const broken: { piece: string; width: number }[] = []
    const walker = document.createTreeWalker(who, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.textContent ?? '').matchAll(/[^\s-]+-?/g)) {
        range.setStart(node, match.index)
        range.setEnd(node, match.index + match[0].length)
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
        if (new Set(rects.map((rect) => Math.round(rect.top))).size < 2) continue
        broken.push({ piece: match[0], width: rects.reduce((sum, rect) => sum + rect.width, 0) })
      }
    }
    const whenBox = when.getBoundingClientRect()
    return {
      broken,
      gap: Number.parseFloat(getComputedStyle(root).columnGap) || 0,
      minimum,
      // The name laid out end to end, as long as it would be on one line.
      nameWidth: whose.reduce((sum, rect) => sum + rect.width, 0),
      nameTop: whose[0]?.top ?? Number.NaN,
      nameBottom: Math.max(...whose.map((rect) => rect.bottom)),
      right: box.right,
      whenRight: whenBox.right,
      whenTop: whenBox.top,
      whenWidth: whenBox.width,
      whoWidth: who.getBoundingClientRect().width,
      width: box.width,
    }
  }, NAME_MIN_CH)
  expect(
    line.nameWidth + line.gap + line.whenWidth,
    `${where}: the name and the date do not fit one line`,
  ).toBeGreaterThan(line.width)
  const place: DatePlace = Math.abs(line.whenTop - line.nameTop) <= 2 ? 'first line' : 'own line'
  const room = line.width - line.whenWidth - line.gap
  const owed = Math.min(line.minimum, line.nameWidth)
  // A pixel either side of the threshold is the browser's rounding, not a decision.
  if (Math.abs(room - owed) > 1) {
    expect(place, `${where}: the date's line, with ${room}px left beside it`).toBe(
      room > owed ? 'first line' : 'own line',
    )
  }
  if (place === 'first line') {
    expect(line.whoWidth, `${where}: the name's room beside the date`).toBeGreaterThanOrEqual(
      owed - 1,
    )
  } else {
    expect(line.whenTop, `${where}: the date under the name`).toBeGreaterThanOrEqual(
      line.nameBottom - 1,
    )
    expect(line.whoWidth, `${where}: the name's room above the date`).toBeGreaterThanOrEqual(
      Math.min(line.width, line.nameWidth) - 1,
    )
  }
  expect(Math.abs(line.whenRight - line.right), `${where}: the date's end`).toBeLessThanOrEqual(1)
  expect(
    line.broken.filter(({ width }) => width <= line.whoWidth),
    `${where}: words broken that fit the name's line`,
  ).toEqual([])
  return place
}
