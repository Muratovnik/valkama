/**
 * The hover card as the window floats it (`ReferencePreview` over `WorkItemPreview`), measured
 * line by line: an identifier is never cut across lines, and in every state the card keeps to its
 * own width, to the window less its 8px edge, and every line of its text to its content box.
 *
 * Lines are read as the browser lays them out, through the client rects of a range over each
 * text: one rect per line a text stands on.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

const CARD = '.reference-preview'
/** The window's edge the card keeps to (`ReferencePreview`'s collision padding). */
const EDGE = 8
/** Past the half second a resting pointer waits for its card. */
const PAST_THE_DELAY_MS = 800
/** Past the moment after a card goes in which the next one opens at once. */
const PAST_THE_WARM_MS = 350

const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]

/** Every state of the fixture (`previewSurface.ts`), each over a reference named by it. */
const STATES = [
  'agent',
  'claimed',
  'closed',
  'foreign',
  'stale',
  'long',
  'loading',
  'failed',
  'missing',
  'unavailable',
]
const PLACES = ['flow', 'right', 'bottom']

const AGENT_TITLE =
  'Свести MAIN-1201, MAIN-1202 и MAIN-1203 в одно правило переноса после MAIN-1204, MAIN-1205 и MAIN-1206'

/** How many references `?shift` stands, the agent's claim after a word one letter longer each. */
const SHIFTS = 40

async function openCards(page: Page, viewport: (typeof WIDTHS)[number], place = 'flow') {
  await page.setViewportSize(viewport)
  await page.clock.install()
  await page.goto(`/tests/browser/harness.html?lang=ru&surface=preview-cards&${place}`)
  const anchors = place === 'shift' ? 'a[data-shift]' : 'a[data-state]'
  await expect(page.locator(anchors)).toHaveCount(place === 'shift' ? SHIFTS : STATES.length)
}

/** The pointer rests on the reference `anchor` finds until its card shows, from nowhere near one. */
async function showCard(page: Page, anchor: string) {
  await page.mouse.move(EDGE / 2, EDGE / 2)
  await page.clock.runFor(PAST_THE_WARM_MS)
  await expect(page.locator(CARD)).toHaveCount(0)
  const box = await page.locator(anchor).boundingBox()
  if (!box) throw new Error(`${anchor}: the reference is not on screen`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 })
  await page.clock.runFor(PAST_THE_DELAY_MS)
  const card = page.locator(CARD)
  await expect(card.locator('[data-preview-part]').first()).toBeVisible()
  return card
}

interface Line {
  bottom: number
  left: number
  right: number
  top: number
}

/** A text of the card as laid out: the line it is on, its part and mark, and its words' lines. */
interface DrawnText {
  facet: string
  lines: Line[]
  part: string
  text: string
  words: { lines: number[]; word: string }[]
}

/**
 * The card as the page lays it out: its box and padding, how far it and its content overflow
 * their width, every text it shows with the lines it is drawn on and the lines of each of its
 * words, the holder's glyph, and the facts' boxes. A screen reader's words, in a box of one
 * pixel, are left out.
 */
function layout(page: Page) {
  return page.locator(CARD).evaluate((card) => {
    const linesOf = (node: Text, start: number, end: number) => {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      return [...range.getClientRects()]
        .filter((rect) => rect.width > 0)
        .map(({ bottom, left, right, top }) => ({ bottom, left, right, top }))
    }
    const texts = []
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text
      const parent = text.parentElement
      if (!parent || parent.closest('.visually-hidden')) continue
      const value = text.textContent ?? ''
      // What a box between the text and the card cuts sideways — a one-line label's end, behind
      // its ellipsis — is not drawn, so a line is read up to that box's edge.
      let clip = { left: -Infinity, right: Infinity }
      for (let box = parent; box && box !== card; box = box.parentElement)
        if (['clip', 'hidden'].includes(getComputedStyle(box).overflowX)) {
          const edge = box.getBoundingClientRect()
          clip = { left: Math.max(clip.left, edge.left), right: Math.min(clip.right, edge.right) }
        }
      texts.push({
        part: parent.closest<HTMLElement>('[data-preview-part]')?.dataset.previewPart ?? '',
        facet: parent.closest<HTMLElement>('[data-facet]')?.dataset.facet ?? '',
        text: value,
        lines: linesOf(text, 0, value.length).map((line) => ({
          ...line,
          left: Math.max(line.left, clip.left),
          right: Math.min(line.right, clip.right),
        })),
        words: [...value.matchAll(/\S+/gu)].map((word) => ({
          word: word[0],
          lines: linesOf(text, word.index, word.index + word[0].length).map(({ top }) => top),
        })),
      })
    }
    const facts = Object.fromEntries(
      [...card.querySelectorAll<HTMLElement>('[data-preview-part="facts"] [data-facet]')].map(
        (mark) => {
          const { bottom, left, right, top } = mark.getBoundingClientRect()
          return [mark.dataset.facet, { bottom, left, right, top }]
        },
      ),
    )
    const glyph = card.querySelector('[data-facet="holder"] svg')?.getBoundingClientRect()
    const root = card.querySelector('[data-preview-part]')?.parentElement
    const style = getComputedStyle(card)
    const { bottom, left, right, top } = card.getBoundingClientRect()
    return {
      card: { bottom, left, right, top },
      content: {
        left:
          left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft),
        right:
          right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight),
      },
      window: { width: innerWidth, height: innerHeight },
      overflow: {
        card: card.scrollWidth - card.clientWidth,
        content: root ? root.scrollWidth - root.clientWidth : null,
      },
      texts: texts as DrawnText[],
      glyph: glyph
        ? { bottom: glyph.bottom, left: glyph.left, right: glyph.right, top: glyph.top }
        : null,
      facts: facts as Record<string, Line | undefined>,
    }
  })
}

const lineCount = (tops: readonly number[]) => new Set(tops.map((top) => Math.round(top))).size
const middleOf = (line: Line) => (line.top + line.bottom) / 2

/**
 * The card read for its rules: where it stands, how far it overflows, every line of text that
 * leaves its content box, and the lines each word stands on — every word of the head, the facts
 * and the date, and each reference in the title, whose other words may break inside where they
 * are longer than a line. The holder's glyph is given with the first line of its words.
 */
async function measure(page: Page) {
  const drawn = await layout(page)
  const { content } = drawn
  const outside = drawn.texts.flatMap(({ lines, text }) =>
    lines
      .filter((line) => line.left < content.left - 0.5 || line.right > content.right + 0.5)
      .map(
        (line) =>
          `«${text.trim().slice(0, 40)}» ${Math.round(line.left)}–${Math.round(line.right)} in ${Math.round(content.left)}–${Math.round(content.right)}`,
      ),
  )
  const words = drawn.texts
    .filter(({ part }) => ['facts', 'head', 'title', 'when'].includes(part))
    .flatMap(({ part, words: its }) =>
      its
        .filter(({ word }) => part !== 'title' || /^\(?[A-Z]+-\d+[,.)]?$/u.test(word))
        .map(({ lines, word }) => ({
          part,
          word: word.replaceAll(/[(),.]/gu, ''),
          lines: lineCount(lines),
        })),
    )
  const holder = drawn.texts.filter(({ facet }) => facet === 'holder').flatMap(({ lines }) => lines)
  const firstTop = Math.min(...holder.map(({ top }) => top))
  const first = holder.find(({ top }) => top === firstTop)
  const glyph = drawn.glyph ? middleOf(drawn.glyph) : Number.NaN
  const { holder: held, steps } = drawn.facts
  return {
    ...drawn,
    outside,
    words,
    titleLines: lineCount(
      drawn.texts
        .filter(({ part }) => part === 'title')
        .flatMap(({ lines }) => lines.map(({ top }) => top)),
    ),
    holder: {
      lines: lineCount(holder.map(({ top }) => top)),
      glyphOnFirstLine: first !== undefined && glyph > first.top && glyph < first.bottom,
    },
    stepsBeside:
      held && steps
        ? { apart: Math.abs(middleOf(held) - middleOf(steps)), after: steps.left >= held.right }
        : null,
  }
}

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.width}px`, () => {
    test('no identifier in the card is cut across lines: the holder, its session, a reference in the title', async ({
      page,
    }) => {
      await openCards(page, viewport, 'place=flow')
      const card = await showCard(page, 'a[data-state="agent"]')
      await expect(card.locator('[data-preview-part="facts"] [data-facet="holder"]')).toHaveText(
        'claude agent a1b2c3d4e5f60718a · 7c0ffee1-3e5a',
      )
      // The title is the one written, character for character.
      await expect(card.locator('[data-preview-part="title"]')).toHaveText(AGENT_TITLE)
      const drawn = await measure(page)

      // The agent's id and the session's start, each whole on a line of the facts row.
      const facts = drawn.words.filter(({ part }) => part === 'facts')
      expect(facts.map(({ word }) => word)).toEqual(
        expect.arrayContaining(['a1b2c3d4e5f60718a', '7c0ffee1-3e5a', '2/3']),
      )
      expect(facts.filter(({ lines }) => lines !== 1)).toEqual([])
      // Each reference the title names, whole on its line wherever the line ends.
      const references = drawn.words.filter(({ part }) => part === 'title')
      expect(references.map(({ word }) => word)).toEqual([
        'MAIN-1201',
        'MAIN-1202',
        'MAIN-1203',
        'MAIN-1204',
        'MAIN-1205',
        'MAIN-1206',
      ])
      expect(references.filter(({ lines }) => lines !== 1)).toEqual([])
      // The head's number and words, whole.
      const head = drawn.words.filter(({ part }) => part === 'head')
      expect(head.map(({ word }) => word)).toContain('MAIN-1401')
      expect(head.filter(({ lines }) => lines !== 1)).toEqual([])

      // The holder's glyph stands on the first line of its words, however many it takes.
      expect(drawn.holder.lines).toBeGreaterThanOrEqual(1)
      expect(drawn.holder.glyphOnFirstLine).toBe(true)
    })

    test('wherever a line ends on the holder or the title, it ends between words', async ({
      page,
    }) => {
      await openCards(page, viewport, 'shift')
      const holderLines: number[] = []
      const titleLines: number[] = []
      for (let shift = 1; shift <= SHIFTS; shift += 1) {
        await showCard(page, `a[data-shift="${shift}"]`)
        const drawn = await measure(page)
        const where = `after ${shift} letters`
        // The word before them grows wider than a line by the end of the run, and breaks
        // inside then, as a word wider than its line has to; an identifier is never that wide.
        const ids = drawn.words.filter(({ word }) =>
          ['7c0ffee1-3e5a', 'a1b2c3d4e5f60718a', 'MAIN-1201', 'MAIN-1202'].includes(word),
        )
        expect(ids, where).toHaveLength(4)
        expect(
          ids.filter(({ lines }) => lines !== 1),
          where,
        ).toEqual([])
        expect(drawn.holder.glyphOnFirstLine, where).toBe(true)
        holderLines.push(drawn.holder.lines)
        titleLines.push(drawn.titleLines)
      }
      // The run did take the holder and the title over a line's end.
      expect(Math.max(...holderLines)).toBeGreaterThan(1)
      expect(Math.max(...titleLines)).toBeGreaterThan(1)
    })

    test('the steps stand beside the holder when both fit on one line', async ({ page }) => {
      await openCards(page, viewport, 'place=flow')
      const card = await showCard(page, 'a[data-state="claimed"]')
      await expect(card.locator('[data-preview-part="facts"] [data-facet="steps"]')).toHaveText(
        '1/5',
      )
      const drawn = await measure(page)
      expect(drawn.stepsBeside).not.toBeNull()
      expect(drawn.stepsBeside?.apart).toBeLessThanOrEqual(1)
      expect(drawn.stepsBeside?.after).toBe(true)
    })

    for (const place of PLACES)
      test(`every state keeps to its card, and its card to the window, at the ${place}`, async ({
        page,
      }) => {
        await openCards(page, viewport, `place=${place}`)
        for (const state of STATES) {
          await showCard(page, `a[data-state="${state}"]`)
          const drawn = await measure(page)
          const where = `${state} at the ${place}`
          expect(drawn.words.length, where).toBeGreaterThan(0)
          expect(drawn.overflow.card, where).toBeLessThanOrEqual(0)
          expect(drawn.overflow.content, where).not.toBeNull()
          expect(drawn.overflow.content ?? 1, where).toBeLessThanOrEqual(0)
          expect(drawn.card.left, where).toBeGreaterThanOrEqual(EDGE - 0.5)
          expect(drawn.card.top, where).toBeGreaterThanOrEqual(EDGE - 0.5)
          expect(drawn.card.right, where).toBeLessThanOrEqual(drawn.window.width - EDGE + 0.5)
          expect(drawn.card.bottom, where).toBeLessThanOrEqual(drawn.window.height - EDGE + 0.5)
          expect(drawn.outside, where).toEqual([])
          // Every word of the head, the facts and the date stands on one line.
          expect(
            drawn.words.filter(({ lines }) => lines !== 1),
            where,
          ).toEqual([])
        }
      })
  })
}
