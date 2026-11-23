/**
 * Code in a work item's title, written between backticks, is drawn as code on every surface
 * that draws a title: in the monospace face (`--font-family-mono`), without the backticks
 * (`titleRuns.ts`, `textRuns.ts`). A line of it breaks after a `/` or at a space and never at a
 * hyphen, a word of code wider than its line stays inside its box, and a surface that ends a
 * title in an ellipsis still does with code in it.
 *
 * Every surface is opened through `titleSurfaces.ts`, as the title breaks are measured. The
 * measures are read from where each character is drawn, not judged from a picture.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { test } from './test.ts'
import { overflowOf } from './titleBreaks.ts'
import { TITLE_SURFACES } from './titleSurfaces.ts'

/** Two pieces of code, one a path with hyphens in its pieces, and a reference outside them. */
const CODED =
  'Raise `STORE_SCHEMA_VERSION` and move `web/src/entities/work-item/components/work-item-title.ts` after MAIN-12'
const DRAWN = CODED.replaceAll('`', '')
const IN_CODE = ['STORE_SCHEMA_VERSION', 'web/src/entities/work-item/components/work-item-title.ts']

/** One word of code wider than any line a title is given. */
const WIDE_WORD = `Bump \`${'SCHEMA_VERSION_OF_THE_STORE_'.repeat(5)}END\``

/** A title long enough, within the 200 characters a title may have, that a clamp cuts it. */
const LONG = `${CODED} and then 'some-more-code' and the words, with \`still-more/code-here\` past it`

/** The surfaces that draw a work item's title; a path in free text is no title. */
const SURFACES = Object.entries(TITLE_SURFACES).filter(([name]) => name !== 'a path in free text')

/** The surfaces whose layout is measured with code in the title. */
const MEASURED = ['the board', 'the list', "a reference's card", "a card's head"] as const

/** A list of font families as one string, quotes and spacing aside. */
const face = (family: string) =>
  family
    .replaceAll(/["']/gu, '')
    .replaceAll(/\s*,\s*/gu, ',')
    .trim()

/** The code drawn in a title: each element's words and face, and the face of the token. */
async function codeOf(text: Locator) {
  const read = await text.evaluate((element) => ({
    mono: getComputedStyle(document.documentElement).getPropertyValue('--font-family-mono'),
    codes: Array.from(element.querySelectorAll('code'), (code) => ({
      face: getComputedStyle(code).fontFamily,
      text: code.textContent,
    })),
  }))
  return {
    mono: face(read.mono),
    codes: read.codes.map((code) => ({ ...code, face: face(code.face) })),
  }
}

/**
 * Each piece of code in a title as the characters drawn of it, with the top of each: a
 * character drawn lower than the one before it starts a new line.
 */
const drawnCode = (text: Locator) =>
  text.evaluate((element) => {
    const range = document.createRange()
    return Array.from(element.querySelectorAll('code'), (code) => {
      const drawn: { character: string; top: number }[] = []
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node
        Array.from(at.textContent ?? '', (character, offset) => {
          range.setStart(at, offset)
          range.setEnd(at, offset + 1)
          const box = range.getClientRects()[0]
          if (box && box.width > 0) drawn.push({ character, top: box.top })
          return character
        })
      }
      return drawn
    })
  })

/**
 * The character before each place a line of code goes on to the next, and how many lines the
 * code takes.
 */
async function codeBreaks(text: Locator) {
  const pieces = await drawnCode(text)
  const breaks = pieces.map((drawn) =>
    drawn.flatMap(({ top }, at) =>
      at > 0 && top > drawn[at - 1].top + 2 ? [drawn[at - 1].character] : [],
    ),
  )
  return {
    before: breaks.flat(),
    lines: breaks.reduce((sum, each) => sum + each.length + 1, 0),
  }
}

for (const width of [390, 1280]) {
  test.describe(`at ${width}px`, () => {
    /** How many breaks a path in code takes at least: one at a phone's width, any at a desktop's. */
    const mustBreak = width === 390 ? 1 : 0

    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width, height: 900 })
    })

    for (const [surface, open] of SURFACES) {
      test(`code in a title is drawn as code, without its backticks, in ${surface}`, async ({
        page,
      }) => {
        const text = await open(page, CODED)
        await expect(text).toBeVisible()
        await expect(text).toContainText(DRAWN)
        await expect(text).not.toContainText('`')
        const { codes, mono } = await codeOf(text)
        expect(codes.map((code) => code.text)).toEqual(IN_CODE)
        for (const code of codes) expect(code.face, `the face of ${code.text}`).toBe(mono)
        expect(await overflowOf(text), 'past its box, in px').toBeLessThanOrEqual(0.5)
      })
    }

    for (const surface of MEASURED) {
      const open = TITLE_SURFACES[surface]

      test(`code breaks after a slash and never at a hyphen in ${surface}`, async ({ page }) => {
        const text = await open(page, CODED)
        await expect(text).toBeVisible()
        const { before, lines } = await codeBreaks(text)
        expect(lines, 'lines of code drawn').toBeGreaterThanOrEqual(IN_CODE.length)
        for (const character of before) expect(['/', ' ']).toContain(character)
      })

      test(`a word of code wider than its line stays inside its box in ${surface}`, async ({
        page,
      }) => {
        const text = await open(page, WIDE_WORD)
        await expect(text.locator('code')).toHaveCount(1)
        expect(await overflowOf(text), 'past its box, in px').toBeLessThanOrEqual(0.5)
        const past = await text.evaluate((element) => {
          const code = element.querySelector('code')?.getBoundingClientRect()
          let block: Element = element
          while (block.parentElement && getComputedStyle(block).display.startsWith('inline'))
            block = block.parentElement
          const box = block.getBoundingClientRect()
          return (
            (code?.right ?? Infinity) -
            (box.right - Number.parseFloat(getComputedStyle(block).paddingRight))
          )
        })
        expect(past, 'the code past its box, in px').toBeLessThanOrEqual(0.5)
      })
    }

    for (const surface of ["a reference's card", "a card's head"] as const) {
      test(`a path in code breaks only between its pieces in ${surface}`, async ({ page }) => {
        // Too long for one line at a phone's width, so it has to break there, and only after a
        // `/`; at a desktop's width it may fit.
        const text = await TITLE_SURFACES[surface](page, CODED)
        await expect(text).toBeVisible()
        const { before } = await codeBreaks(text)
        expect(before.length, 'breaks in the code').toBeGreaterThanOrEqual(mustBreak)
        for (const character of before) expect(['/', ' ']).toContain(character)
      })
    }

    for (const [surface, lines, kind, title] of [
      ['the board', 3, 'a long title', LONG],
      ["the graph's card", 2, 'a long title', LONG],
      // One word of code over many lines was one line to the clamp when it was drawn as a box.
      ['the board', 3, 'a word of code wider than its line', WIDE_WORD],
      ["the graph's card", 2, 'a word of code wider than its line', WIDE_WORD],
    ] as const) {
      test(`${kind} with code is still cut to ${lines} lines in ${surface}`, async ({ page }) => {
        const text = await TITLE_SURFACES[surface](page, title)
        await expect(text.locator('code').first()).toBeVisible()
        const cut = await text.evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            clamp: style.webkitLineClamp,
            overflow: style.overflowY,
            height: element.clientHeight,
            line: Number.parseFloat(style.lineHeight),
            more: element.scrollHeight - element.clientHeight,
          }
        })
        expect(cut.clamp).toBe(String(lines))
        expect(cut.overflow).toBe('hidden')
        expect(cut.more, 'text cut off below the clamp, in px').toBeGreaterThan(0)
        expect(cut.height, 'the cut box, in px').toBeLessThanOrEqual(lines * cut.line + 0.5)
        expect(await overflowOf(text), 'past its box, in px').toBeLessThanOrEqual(0.5)
      })
    }
  })
}
