import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/** One line of drawn words: where it stands and what it says. */
export interface DrawnLine {
  left: number
  right: number
  text: string
  top: number
}

/**
 * The lines the words under `selector` (or the node itself) are drawn on, read character by
 * character off the text nodes, so a box's padding or a link's two rects never count. A
 * character more than half a letter lower than the line before starts a new line: words in
 * two fonts on one line start a pixel or so apart. Words only a screen reader is given
 * (`.visually-hidden`) are not drawn and do not count.
 */
export const drawnLines = (node: Locator, selector = ':scope') =>
  node.evaluate((root, within) => {
    const target = root.matches(within) ? root : root.querySelector(within)
    if (!target) throw new Error(`Nothing at ${within}`)
    const half = Number.parseFloat(getComputedStyle(target).fontSize) / 2
    const lines: DrawnLine[] = []
    const range = document.createRange()
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text.parentElement?.closest('.visually-hidden')) continue
      for (const { 0: letter, index } of (text.textContent ?? '').matchAll(/./gsu)) {
        range.setStart(text, index)
        range.setEnd(text, index + letter.length)
        const rect = [...range.getClientRects()].find((box) => box.width > 0)
        if (!rect) continue
        const last = lines.at(-1)
        if (last && Math.abs(rect.top - last.top) < half) {
          last.left = Math.min(last.left, rect.left)
          last.right = Math.max(last.right, rect.right)
          last.text += letter
        } else lines.push({ left: rect.left, right: rect.right, text: letter, top: rect.top })
      }
    }
    return lines.map((line) => ({ ...line, text: line.text.replaceAll('\u{A0}', ' ').trim() }))
  }, selector)

/** How wide the words under `selector` would be on one line, at the font they are drawn in. */
export const oneLineWidth = (node: Locator, selector = ':scope') =>
  node.evaluate((root, within) => {
    const target = root.matches(within) ? root : root.querySelector(within)
    if (!target?.parentElement) throw new Error(`Nothing at ${within}`)
    const copy = target.cloneNode(true) as HTMLElement
    Object.assign(copy.style, { position: 'absolute', whiteSpace: 'nowrap', width: 'auto' })
    copy.removeAttribute('id')
    target.parentElement.append(copy)
    const width = copy.getBoundingClientRect().width
    copy.remove()
    return width
  }, selector)

/**
 * Who and when as one unit in a head (`MetaLine` with `phrase`, or a name with its session's
 * start): the words of who take one line wherever one line holds them, and the time shares
 * their last line only where the whole of them fits beside it, else it starts its own line
 * under them where they start. A pixel either side of fitting is the browser's rounding.
 */
export async function expectUnitHeld(head: Locator, where: string) {
  const who = await drawnLines(head, '.meta-who')
  const [time] = await drawnLines(head, '.meta-when')
  const whole = await oneLineWidth(head, '.meta-who')
  const room = await head.evaluate((line) => ({
    gap: Number.parseFloat(getComputedStyle(line).columnGap),
    time: line.querySelector('.meta-when')?.getBoundingClientRect().width ?? 0,
    width: line.getBoundingClientRect().width,
  }))
  const fits = whole + room.gap + room.time
  const beside = Math.abs(time.top - who[0].top) < 2
  const label = `${where}: ${fits}px of ${room.width}px`
  expect(who, `${label}: the lines of who`).toHaveLength(whole < room.width - 1 ? 1 : who.length)
  if (Math.abs(fits - room.width) > 1) expect(beside, label).toBe(fits < room.width)
  if (beside) return 'its line'
  expect(time.top, `${label}: the time under who`).toBeGreaterThan(who.at(-1)?.top ?? Number.NaN)
  expect(Math.abs(time.left - who[0].left), `${label}: the time's start`).toBeLessThan(1)
  return 'own line'
}
