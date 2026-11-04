/**
 * A reference in text wraps with the text, as a link in prose does, at every width a line
 * can take. Drawn as a box of its own, it moved to the next line whole when the rest of the
 * line could not hold it, leaving that rest empty, and once longer than a line it let the
 * comma written against it start the next line alone.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { aCardAsking, LONG_PATH } from './documentBackend.ts'
import { openReported } from './previewPage.ts'
import { test } from './test.ts'

const BODY = [
  'Связано с MAIN-12, план отдельно; ещё MAIN-13, затем (MAIN-14) и «MAIN-15», а также MAIN-16.',
  'Related to MAIN-12, the plan apart; then MAIN-13, next (MAIN-14) and "MAIN-15", and MAIN-16.',
].join('\n\n')

/** A plan's path as agents write it, longer than a phone's line, and a comma written against it. */
const PLAN = 'projects/valkama/docs/plans/2026-11-03-valkama-2.5-threads-and-questions.md'
const PROMPT = [
  `Сначала прочтите ${PLAN}, затем ${LONG_PATH}. Решите до MAIN-12, пожалуйста.`,
  `Read ${PLAN}, then ${LONG_PATH}; decide before MAIN-12, please.`,
].join('\n\n')

/**
 * Every width the text can be narrowed to, one pixel at a time, and at each what is wrong
 * with how a reference wraps, as `<room>px <kind>: <reference>`:
 *
 * - `hole`: a reference that starts on a line below the word before it, while that line had
 *   room left for its first piece — what it holds up to and including its first `/` or `-`,
 *   where a path or a number may break.
 * - `split`: the character written right after a reference, with no space between, stands
 *   on a line below the reference's last line.
 */
function wrapFaults(element: Element, narrowest: number): string[] {
  const box = element as HTMLElement
  const texts: Text[] = []
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.textContent) texts.push(node as Text)
  const glyph = (text: Text, at: number) => {
    const range = document.createRange()
    range.setStart(text, at)
    range.setEnd(text, at + 1)
    return range
  }
  const outside = (reference: Element) => (text: Text) => !reference.contains(text)
  const follows = (reference: Element, text: Text) =>
    (reference.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  /** The block a reference's lines run in, and where its content ends on the right. */
  function contentRight(reference: Element): number {
    let block: Element | null = reference.parentElement
    while (block && getComputedStyle(block).display.startsWith('inline'))
      block = block.parentElement
    if (!block) return Number.POSITIVE_INFINITY
    const style = getComputedStyle(block)
    return (
      block.getBoundingClientRect().right -
      Number.parseFloat(style.paddingRight) -
      Number.parseFloat(style.borderRightWidth)
    )
  }
  /** The last character before a reference that is not a space, and whether a space parts them. */
  function before(reference: Element): { parted: boolean; range: Range } | null {
    const prior = texts.filter((text) => outside(reference)(text) && !follows(reference, text))
    let parted = false
    for (const text of prior.reverse()) {
      const words = text.textContent ?? ''
      for (let at = words.length - 1; at >= 0; at -= 1) {
        if (/\s/u.test(words[at] ?? '')) parted = true
        else return { parted, range: glyph(text, at) }
      }
    }
    return null
  }
  /**
   * The width of a reference's first piece: up to and including its first `/`, or a `-`
   * before anything but a digit, since `MAIN-12` does not break; with no such place, the
   * whole of it and what is written against its end.
   */
  function firstPiece(reference: Element): number {
    let width = 0
    const from = texts.findIndex((candidate) => reference.contains(candidate))
    for (const text of texts.slice(from)) {
      const words = text.textContent ?? ''
      const within = reference.contains(text)
      for (let at = 0; at < words.length; at += 1) {
        const character = words[at] ?? ''
        if (!within && /\s/u.test(character)) return width
        width += glyph(text, at).getBoundingClientRect().width
        const next = words[at + 1] ?? ''
        if (within && (character === '/' || (character === '-' && !/\d/u.test(next)))) return width
      }
    }
    return width
  }
  /** Whether a reference starts a line below the word before it, while that line had room. */
  function leavesHole(reference: Element): boolean {
    const inside = texts.find((text) => reference.contains(text))
    const prior = before(reference)
    if (!inside || !prior?.parted) return false
    const first = glyph(inside, 0).getBoundingClientRect()
    const end = prior.range.getBoundingClientRect()
    const left = contentRight(reference) - end.right
    const space = Number.parseFloat(getComputedStyle(reference).fontSize) / 2
    return first.top > end.bottom - 2 && left > firstPiece(reference) + space
  }
  /** The character written right after a reference when it stands below the reference's last line. */
  function splitOff(reference: Element): string | null {
    const next = texts.find((text) => outside(reference)(text) && follows(reference, text))
    if (!next || /^\s/u.test(next.textContent ?? '')) return null
    const last = [...reference.getClientRects()].at(-1)
    const below = last && glyph(next, 0).getBoundingClientRect().top > last.bottom - 2
    return below ? (next.textContent?.[0] ?? '') : null
  }
  const found: string[] = []
  const widest = Math.floor(box.getBoundingClientRect().width)
  for (let room = widest; room >= narrowest; room -= 1) {
    box.style.width = `${room}px`
    for (const reference of box.querySelectorAll('.rich-reference')) {
      const name = reference.textContent ?? ''
      if (leavesHole(reference)) found.push(`${room}px hole: ${name}`)
      const split = splitOff(reference)
      if (split !== null) found.push(`${room}px split: ${name}${split}`)
    }
  }
  box.style.width = ''
  return found
}

const faultsIn = (text: Locator, narrowest = 160) => text.evaluate(wrapFaults, narrowest)

for (const width of [1500, 390]) {
  test(`what is written against a reference keeps to its line, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { entry } = await openReported(page, BODY)
    await expect(entry.locator('.rich-reference', { hasText: 'MAIN-16' }).first()).toBeVisible()
    expect(await faultsIn(entry)).toEqual([])
  })

  test(`a path in a question wraps as prose does, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { card } = await aCardAsking(page, PROMPT)
    const prompt = card.locator('.request-prompt')
    await expect(prompt.locator('.rich-reference', { hasText: 'the-plan-itself.md' })).toHaveCount(
      2,
    )
    await expect(prompt.locator('[aria-busy="true"]')).toHaveCount(0)
    expect(await faultsIn(prompt)).toEqual([])
  })
}

/**
 * A code span stands on a ground inset from its words, and the inset beside a comma or a
 * bracket written against it read as a space before the comma. Where something touches the
 * ground, the gap from the span's last letter to it is narrower than the inset it keeps on a
 * side a space parts; where a space parts them, the inset is whole.
 */
test('a comma written against code stands close to it, as after a word', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  const { entry } = await openReported(page, 'in `App.vue`, then (`a.ts`) and `free` here.')
  const gaps = await entry.evaluate((element) => {
    const texts: Text[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.textContent) texts.push(node as Text)
    /** From the edge of the span's words to the edge of the character written beside them. */
    function gap(code: Element, side: 'after' | 'before') {
      const words = document.createRange()
      words.selectNodeContents(code)
      const inside = texts.filter((text) => code.contains(text))
      const edge = side === 'after' ? inside.at(-1) : inside[0]
      const text = texts[texts.indexOf(edge as Text) + (side === 'after' ? 1 : -1)]
      if (!text?.textContent) return null
      const beside = document.createRange()
      const at = side === 'after' ? 0 : text.textContent.length - 1
      beside.setStart(text, at)
      beside.setEnd(text, at + 1)
      const [inner, outer] = [words.getBoundingClientRect(), beside.getBoundingClientRect()]
      return Math.round(side === 'after' ? outer.left - inner.right : inner.left - outer.right)
    }
    return [...element.querySelectorAll('code.rich-code')].map((code) => ({
      inset: getComputedStyle(code).paddingInlineEnd,
      after: gap(code, 'after'),
      before: gap(code, 'before'),
    }))
  })
  const [comma, bracketed, free] = gaps
  expect(comma?.after).toBeLessThanOrEqual(2)
  expect(bracketed?.before).toBeLessThanOrEqual(2)
  expect(bracketed?.after).toBeLessThanOrEqual(2)
  // Parted by spaces, the span keeps the inset its ground is drawn with.
  expect(free?.inset).toBe('4px')
})
