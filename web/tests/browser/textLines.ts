import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/** One line of drawn words: where it stands and what it says. */
interface DrawnLine {
  left: number
  right: number
  text: string
  top: number
}

/** A character as it is laid out, and half a letter of the font it is in. */
interface Letter {
  bottom: number
  half: number
  left: number
  letter: string
  right: number
  top: number
}

/** Each character laid out under `selector` (or the node itself), as `drawnLines` reads it. */
const lettersOf = (node: Locator, selector: string) =>
  node.evaluate((root, within) => {
    const target = root.matches(within) ? root : root.querySelector(within)
    if (!target) throw new Error(`Nothing at ${within}`)
    const half = Number.parseFloat(getComputedStyle(target).fontSize) / 2
    const letters: Letter[] = []
    const range = document.createRange()
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text.parentElement?.closest('.visually-hidden')) continue
      for (const { 0: letter, index } of (text.textContent ?? '').matchAll(/./gsu)) {
        range.setStart(text, index)
        range.setEnd(text, index + letter.length)
        const rect = [...range.getClientRects()].find((box) => box.width > 0)
        if (rect) letters.push({ ...rect.toJSON(), half, letter })
      }
    }
    return letters
  }, selector)

/** The boxes that clip away what is under `selector` for good: it, and those around it that clip
 *  or hide their overflow, the padding box each. */
const clipsOf = (node: Locator, selector: string) =>
  node.evaluate((root, within) => {
    const boxes: { bottom: number; left: number; right: number; top: number }[] = []
    let box = root.matches(within) ? root : root.querySelector(within)
    // The page's own overflow is the window's, which scrolls.
    for (; box && box !== document.body; box = box.parentElement) {
      // A scroller hides only what is scrolled away, which a scroll brings back.
      const { overflowX, overflowY } = getComputedStyle(box)
      if (![overflowX, overflowY].some((overflow) => overflow === 'clip' || overflow === 'hidden'))
        continue
      const rect = box.getBoundingClientRect()
      const [left, top] = [rect.left + box.clientLeft, rect.top + box.clientTop]
      boxes.push({ bottom: top + box.clientHeight, left, right: left + box.clientWidth, top })
    }
    return boxes
  }, selector)

/** The letters set on lines: one more than half a letter lower than the line before starts one. */
function linesOf(letters: readonly Letter[]): DrawnLine[] {
  const lines: DrawnLine[] = []
  for (const { half, left, letter, right, top } of letters) {
    const last = lines.at(-1)
    if (last && Math.abs(top - last.top) < half) {
      last.left = Math.min(last.left, left)
      last.right = Math.max(last.right, right)
      last.text += letter
    } else lines.push({ left, right, text: letter, top })
  }
  return lines.map((line) => ({ ...line, text: line.text.replaceAll('\u{A0}', ' ').trim() }))
}

/**
 * The lines the words under `selector` (or the node itself) are drawn on, read character by
 * character off the text nodes, so a box's padding or a link's two rects never count. A
 * character more than half a letter lower than the line before starts a new line: words in
 * two fonts on one line start a pixel or so apart. Words only a screen reader is given
 * (`.visually-hidden`) are not drawn and do not count.
 */
export const drawnLines = async (node: Locator, selector = ':scope') =>
  linesOf(await lettersOf(node, selector))

/**
 * The lines the words under `selector` are seen on, as `drawnLines` reads them less the letters
 * whose middle a box clips away, the node or one around it, and those letters, as `hidden`.
 */
export async function seenLines(node: Locator, selector = ':scope') {
  const [letters, boxes] = await Promise.all([lettersOf(node, selector), clipsOf(node, selector)])
  const seen = ({ bottom, left, right, top }: Letter) => {
    const [x, y] = [(left + right) / 2, (top + bottom) / 2]
    return boxes.every((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
  }
  const hidden = letters.filter((letter) => !seen(letter))
  return {
    hidden: hidden
      .map(({ letter }) => letter)
      .join('')
      .trim(),
    lines: linesOf(letters.filter((letter) => seen(letter))),
  }
}

/** How wide the words under `selector` would be on one line, at the font they are drawn in. */
const oneLineWidth = (node: Locator, selector = ':scope') =>
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
