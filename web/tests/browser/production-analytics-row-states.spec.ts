/**
 * The one model of states the Analytics page's rows share, in the real app at 1440×900, in
 * English and in Russian. Every entry of the rail is a box at rest, a step over the rail's ground;
 * at rest, under the pointer and chosen it keeps one box, whose left edge stands on the page's
 * left line and whose corners are rounded alike, and its name is whole in every state. The chosen
 * entry, with the pointer elsewhere, is told from a hovered one by its ground and by a mark that
 * stands inside its box clear of its words; the keyboard's ring is drawn inside the box and moves
 * nothing. A ranked row and a table row that open something take the hovered ground a rail entry
 * takes, and the keyboard's ring inside their box. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { pageAt, record, serve } from './analyticsPage.ts'
import { drawnColours } from './contrast.ts'
import { test } from './test.ts'

/** The contrast two grounds side by side owe each other (DESIGN.md, System rules). */
const SEAM = 1.15

/** WCAG 2 contrast of two relative luminances. */
const contrast = (one: number, two: number) =>
  (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)

/** One entry of the rail as it is drawn: its box, corners, ground, mark and name. */
const entryState = (entry: Locator) =>
  entry.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const corners = [
      style.borderStartStartRadius,
      style.borderStartEndRadius,
      style.borderEndStartRadius,
      style.borderEndEndRadius,
    ].map((radius) => Number.parseFloat(radius))
    // The chosen entry's mark: a drawing of its own, or else a start edge drawn in a colour, which
    // stands on the box's own edge.
    const before = getComputedStyle(element, '::before')
    const startEdge = Number.parseFloat(style.borderLeftWidth)
    const edgeDrawn =
      startEdge > 0 && !/rgba\(0, 0, 0, 0\)|transparent/u.test(style.borderLeftColor)
    let mark: { bottom: number; colour: string; left: number; right: number; top: number } | null =
      null
    if (before.content !== 'none' && Number.parseFloat(before.width) > 0) {
      const left = Number.parseFloat(before.left)
      const top = Number.parseFloat(before.top)
      mark = {
        left,
        right: left + Number.parseFloat(before.width),
        top,
        bottom: Number.parseFloat(before.bottom),
        colour: before.backgroundColor,
      }
    } else if (edgeDrawn)
      mark = { left: 0, right: startEdge, top: 0, bottom: 0, colour: style.borderLeftColor }
    const name = element.querySelector<HTMLElement>('.analytics-rail-name')
    const nameBox = name?.getBoundingClientRect()
    const range = document.createRange()
    if (name) range.selectNodeContents(name)
    return {
      section: element.dataset.section ?? '',
      left: box.left,
      right: box.right,
      corners,
      mark,
      name: {
        text: name?.textContent.trim() ?? '',
        // Whole: its box neither scrolls its words nor is narrower than they are laid out, to the
        // hundredth of a pixel, and it stands inside the entry's box.
        scrolls: !name || name.scrollWidth > name.clientWidth,
        short:
          Math.round((range.getBoundingClientRect().width - (nameBox?.width ?? 0)) * 100) / 100,
        left: (nameBox?.left ?? 0) - box.left,
        past: (nameBox?.right ?? 0) - box.right,
      },
      ring: {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
        offset: Number.parseFloat(style.outlineOffset),
      },
    }
  })

/** An entry's state with the luminance of the ground it is drawn on. */
async function measured(entry: Locator) {
  const [state, colours] = await Promise.all([
    entryState(entry),
    entry.evaluate(drawnColours, 'own' as const),
  ])
  return { ...state, ground: colours.fill, luminance: colours.fillLuminance }
}

type Measured = Awaited<ReturnType<typeof measured>>

/** The ground a row is drawn on, as its style says it. */
const ground = (target: Locator) =>
  target.evaluate((element) => getComputedStyle(element).backgroundColor)

/** Moves the pointer onto the panel's heading, away from every row. */
const pointAway = async (page: Page) => {
  const heading = await page.locator('.module-title').boundingBox()
  await page.mouse.move((heading?.x ?? 0) + 2, (heading?.y ?? 0) + 2)
}

async function open(page: Page) {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  await expect(page.locator('.analytics-rail-entry[aria-current="page"]')).toBeVisible()
  await expect(page.locator('.analytics-rail [aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

/** Every state of one entry: at rest, under the pointer, chosen, and chosen under the pointer. */
interface States {
  chosen: Measured
  chosenHover: Measured
  hover: Measured
  rest: Measured
}

/** The rail's every entry in each state, its ground, and the page's left line. */
async function walkRail(page: Page) {
  const entries = await page.locator('.analytics-rail-entry').all()
  const states: States[] = []
  for (const [index, entry] of entries.entries()) {
    // At rest: another entry chosen and the pointer away.
    await entries[index === 0 ? 1 : 0]?.click()
    await pointAway(page)
    const rest = await measured(entry)
    await entry.hover()
    const hover = await measured(entry)
    await entry.click()
    await expect(entry).toHaveAttribute('aria-current', 'page')
    const chosenHover = await measured(entry)
    await pointAway(page)
    const chosen = await measured(entry)
    states.push({ rest, hover, chosen, chosenHover })
  }
  // The rail's ground: what its list, which draws none of its own, is laid on.
  const rail = await page.locator('.analytics-rail-list').evaluate(drawnColours, 'own' as const)
  const heading = await page.locator('.module-title').boundingBox()
  const line = heading?.x ?? Number.NaN
  return { states, rail, line }
}

for (const [language, locale] of [
  ['English', 'en-US'],
  ['Russian', 'ru-RU'],
] as const)
  test.describe(`in ${language}`, () => {
    test.use({ locale })

    test("the rail's entries keep one box in every state, on the page's line, their names whole", async ({
      page,
    }, info) => {
      await open(page)
      const { states, rail, line } = await walkRail(page)
      await record(info, `analytics row states ${locale}`, { line, rail: rail.fill, states })

      expect(states.length, 'entries measured').toBeGreaterThan(10)
      for (const { rest, hover, chosen, chosenHover } of states) {
        const all = { rest, hover, chosen, chosenHover }
        for (const [state, one] of Object.entries(all)) {
          const where = `${one.section} ${state}`
          expect(Math.abs(one.left - rest.left), `${where}: left edge moved`).toBeLessThanOrEqual(
            0.5,
          )
          expect(
            Math.abs(one.right - rest.right),
            `${where}: right edge moved`,
          ).toBeLessThanOrEqual(0.5)
          expect(
            Math.abs(one.left - line),
            `${where}: off the page's left line`,
          ).toBeLessThanOrEqual(1)
          expect(
            one.corners.every((radius) => radius > 0),
            `${where}: a square corner`,
          ).toBe(true)
          expect(new Set(one.corners).size, `${where}: corners rounded apart`).toBe(1)
          expect(one.name.scrolls, `${where}: «${one.name.text}» scrolls in its box`).toBe(false)
          expect(one.name.short, `${where}: «${one.name.text}» cut`).toBeLessThanOrEqual(0)
          expect(one.name.past, `${where}: «${one.name.text}» past its entry`).toBeLessThanOrEqual(
            0,
          )
        }
        // A box at rest: its ground a step over the rail's.
        expect(
          contrast(rest.luminance, rail.fillLuminance),
          `${rest.section}: no box at rest over the rail's ground`,
        ).toBeGreaterThanOrEqual(SEAM)
      }
    })

    test('the chosen entry is told from a hovered one by its ground and its mark inside its box, and the ring moves nothing', async ({
      page,
    }, info) => {
      await open(page)
      const { states } = await walkRail(page)
      const marks = states.map(({ chosen, hover, chosenHover }) => ({
        section: chosen.section,
        grounds: contrast(chosen.luminance, hover.luminance),
        chosen: chosen.mark,
        hovered: hover.mark,
        chosenHovered: chosenHover.ground.join(',') === chosen.ground.join(','),
        nameStart: chosen.name.left,
        width: chosen.right - chosen.left,
      }))

      // The keyboard's ring on the chosen entry: back onto it from the one before it.
      const chosen = page.locator('.analytics-rail-entry[aria-current="page"]')
      const before = await entryState(chosen)
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(chosen).toBeFocused()
      const focused = await entryState(chosen)
      const ringShown = await chosen.evaluate((element) => element.matches(':focus-visible'))
      await record(info, `analytics row marks ${locale}`, { marks, before, focused })

      for (const one of marks) {
        expect(one.grounds, `${one.section}: chosen and hovered grounds`).toBeGreaterThanOrEqual(
          SEAM,
        )
        expect(one.hovered, `${one.section}: a hovered entry draws the chosen mark`).toBeNull()
        expect(one.chosen, `${one.section}: the chosen entry has no mark`).not.toBeNull()
        const mark = one.chosen ?? { left: 0, right: 0, top: 0, bottom: 0, colour: '' }
        expect(mark.left, `${one.section}: the mark on the box's start edge`).toBeGreaterThan(0)
        expect(mark.right, `${one.section}: the mark past the box`).toBeLessThan(one.width)
        expect(mark.top, `${one.section}: the mark on the box's top edge`).toBeGreaterThan(0)
        expect(mark.bottom, `${one.section}: the mark on the box's bottom edge`).toBeGreaterThan(0)
        expect(mark.right, `${one.section}: the mark over the words`).toBeLessThanOrEqual(
          one.nameStart,
        )
        expect(one.chosenHovered, `${one.section}: chosen, the pointer changes its ground`).toBe(
          true,
        )
      }
      expect(ringShown, 'the ring shows after the keyboard').toBe(true)
      expect(focused.ring.style, 'the ring').toBe('solid')
      expect(focused.ring.width, "the ring's width").toBeGreaterThan(0)
      expect(
        focused.ring.width + focused.ring.offset,
        'the ring drawn past the box',
      ).toBeLessThanOrEqual(0)
      expect(focused.left, 'focus moved the box').toBe(before.left)
      expect(focused.right, 'focus moved the box').toBe(before.right)
    })

    test("a ranked row and a table row take the rail's hovered ground and its ring inside their box", async ({
      page,
    }, info) => {
      await serve(page)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto(pageAt({ by: 'work_item' }))
      const ranked = page.locator('.spending-bars .ranked-line[href]').first()
      const row = page
        .locator('.spending-table tbody tr')
        .filter({ has: page.locator('a') })
        .first()
      await expect(ranked).toBeVisible()
      await expect(row).toBeVisible()

      const entry = page.locator('.analytics-rail-entry:not([aria-current])').first()
      await entry.hover()
      const railHover = await ground(entry)
      await ranked.hover()
      const rankedHover = await ground(ranked)
      await row.locator('td').last().hover()
      const rowHover = await ground(row.locator('td').last())
      const nameHover = await ground(row.locator('th'))

      // The keyboard on the ranked row: its ring inside its box, which stays where it was.
      await pointAway(page)
      const rankedBox = await ranked.boundingBox()
      await ranked.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(ranked).toBeFocused()
      const rankedRing = await ranked.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          shown: element.matches(':focus-visible'),
          style: style.outlineStyle,
          reach: Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset),
        }
      })
      const rankedFocusedBox = await ranked.boundingBox()

      // The keyboard on the table row's name: the row draws the ring round its cells.
      const link = row.locator('a')
      await link.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(link).toBeFocused()
      const rowRing = await row.evaluate((element) => {
        const cells = [...element.children].map((cell) => getComputedStyle(cell).boxShadow)
        const press = element.querySelector('a')
        return {
          cells,
          press: press ? getComputedStyle(press).outlineStyle : '',
        }
      })
      await record(info, `analytics row states rows ${locale}`, {
        railHover,
        rankedHover,
        rowHover,
        nameHover,
        rankedRing,
        rankedBox,
        rankedFocusedBox,
        rowRing,
      })

      expect(rankedHover, 'a hovered ranked row').toBe(railHover)
      expect(rowHover, 'a hovered table row').toBe(railHover)
      expect(nameHover, "a hovered table row's name").toBe(railHover)
      expect(rankedRing.shown).toBe(true)
      expect(rankedRing.style).toBe('solid')
      expect(rankedRing.reach, "the ranked row's ring past its box").toBeLessThanOrEqual(0)
      // Focus may scroll the panel to the row, which moves it up or down and nothing else.
      expect({ ...rankedFocusedBox, y: 0 }, "focus changed the ranked row's box").toEqual({
        ...rankedBox,
        y: 0,
      })
      expect(
        rowRing.cells.every((shadow) => shadow.includes('inset')),
        "the table row's ring round its cells",
      ).toBe(true)
      expect(rowRing.press, "the name's own ring beside the row's").toBe('none')
    })
  })
