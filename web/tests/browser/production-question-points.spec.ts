/**
 * A review's point is one row, in a review of twelve points each with a way under Accept: the
 * label, the three words of the verdict and the comment's press on one line where the point is
 * 30rem wide, as a card's drawer makes it, and the verdict on a line of its own across the row on
 * a phone; one quiet line under the label; and a press on the label that opens the point in place.
 *
 * Opening a point or one of its options moves nothing already read: the label, the chevron and
 * the verdict keep their place, and the description's first line starts where the quiet line
 * stood. What the verdict opens hangs from the open point behind the thread's rule, read only
 * until the verdict holds it, so Accept turns its marks into radios in the same boxes.
 *
 * Every accepted point used to unfold its way under it at once; the review's height with every
 * point accepted is recorded here for the owner to compare.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { wayReviewFields, WAYS_PROMPT } from '../support/reviewWays.ts'
import { drawnBox } from './edges.ts'
import { asked, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'

type Locale = 'en' | 'ru'
const WIDTHS = [1280, 390] as const
const LOCALES: readonly Locale[] = ['en', 'ru']
/** How far a thing that must not move may: half a pixel, the rounding of a layout. */
const STILL = 0.5

async function openWays(page: Page, width: number, locale: Locale = 'en') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const opened = await openQuestion(page, [
    asked({ prompt: WAYS_PROMPT, fields: wayReviewFields, title: 'Review of the board' }),
  ])
  await expect(opened.card.locator('.request-point')).toHaveCount(12)
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  await page.evaluate(async () => document.fonts.ready)
  await page.mouse.move(0, 0)
  return opened
}

const point = (card: Locator, label: string) => card.locator('.request-point', { hasText: label })
const segmentsOf = (row: Locator) => row.locator('.request-point-segments')
const toggleOf = (row: Locator) => row.locator('.request-point-toggle')

/** Two frames, so that what a change set going has been laid out and drawn. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => done())
        })
      }),
  )

interface Box {
  height: number
  width: number
  x: number
  y: number
}

async function box(target: Locator): Promise<Box> {
  const found = await target.boundingBox()
  if (!found) throw new Error('Not drawn')
  return found
}

/** The box of everything a locator finds, in order. */
const boxesOf = (targets: Locator) =>
  targets.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { height, width, x, y } = node.getBoundingClientRect()
      return { height, width, x, y }
    }),
  )

/** The most any box moved or changed size from the one in its place before. */
function drift(after: readonly Box[], before: readonly Box[]) {
  if (after.length !== before.length) return Number.POSITIVE_INFINITY
  const sides = ['x', 'y', 'width', 'height'] as const
  return Math.max(
    0,
    ...after.flatMap((one, index) => {
      const was = before[index]
      return was ? sides.map((side) => Math.abs(one[side] - was[side])) : [Number.POSITIVE_INFINITY]
    }),
  )
}

/** The labels of the twelve points, in their order. */
const POINTS = wayReviewFields.filter((field) => field.type === 'verdict').map(({ label }) => label)

/** The first line of words under the label: where the first letter of what is said there is. */
const firstLine = (row: Locator) =>
  row.locator('.request-point-said').evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      const rect = [...range.getClientRects()].find((part) => part.width > 0)
      if (rect) return { left: rect.left, top: rect.top }
    }
    throw new Error('No words under the label')
  })

/**
 * What must stay put in a row, from the row's own corner, since a press may scroll the row into
 * view: the label, the chevron, the verdict and the first line under the label. The verdict is
 * held by its end, where the row holds it: a chosen word may draw a hair wider than the others.
 */
async function still(row: Locator) {
  const corner = await box(row)
  const label = await drawnBox(row.locator('.request-point-label'))
  const chevron = await drawnBox(row.locator('.request-point-glyph'))
  const segments = await box(segmentsOf(row))
  const line = await firstLine(row)
  const from = (left: number, top: number) => ({ left: left - corner.x, top: top - corner.y })
  return {
    chevron: from(chevron.left, chevron.top),
    label: from(label.left, label.top),
    line: from(line.left, line.top),
    segments: from(segments.x + segments.width, segments.y),
  }
}

function expectStill(after: Awaited<ReturnType<typeof still>>, before: typeof after, at: string) {
  for (const part of ['chevron', 'label', 'line', 'segments'] as const) {
    expect(
      Math.abs(after[part].left - before[part].left),
      `${at}: ${part} left`,
    ).toBeLessThanOrEqual(STILL)
    expect(Math.abs(after[part].top - before[part].top), `${at}: ${part} top`).toBeLessThanOrEqual(
      STILL,
    )
  }
}

test.describe('a point is one row', () => {
  test('in a drawer the verdict shares the label’s line on every point', async ({ page }) => {
    const { card } = await openWays(page, 1280)
    for (const name of POINTS) {
      const row = point(card, name)
      const label = await drawnBox(row.locator('.request-point-label'))
      const segments = await box(segmentsOf(row))
      // On the first line of the label, and after its words.
      expect(segments.y, name).toBeLessThan(label.top + 4)
      expect(segments.y + segments.height, name).toBeGreaterThan(label.top + 4)
      expect(segments.x, name).toBeGreaterThan(label.right)
    }
  })

  test('on a phone the verdict stands on its own line across every row, at one edge', async ({
    page,
  }) => {
    const { card } = await openWays(page, 390)
    const lefts = []
    for (const name of POINTS) {
      const row = point(card, name)
      const label = await drawnBox(row.locator('.request-point-label'))
      const segments = await box(segmentsOf(row))
      const whole = await box(row)
      expect(segments.y, name).toBeGreaterThanOrEqual(label.bottom - STILL)
      expect(Math.abs(segments.x - whole.x), `${name}: from the row's start`).toBeLessThanOrEqual(
        STILL,
      )
      expect(
        Math.abs(segments.x + segments.width - (whole.x + whole.width)),
        `${name}: to the row's end`,
      ).toBeLessThanOrEqual(STILL)
      lefts.push(segments.x)
    }
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(STILL)
  })

  for (const width of WIDTHS) {
    test(`pointing at or focusing a row moves nothing in it, and a press leaves no ring, at ${width}`, async ({
      page,
    }) => {
      const { card } = await openWays(page, width)
      const row = point(card, 'P11 ')
      const before = await still(row)
      await row.locator('.request-point-label').hover()
      await settle(page)
      expectStill(await still(row), before, 'pointed at')
      await row.getByRole('radio').first().focus()
      await page.keyboard.press('Shift+Tab')
      await expect(toggleOf(row)).toBeFocused()
      await settle(page)
      expectStill(await still(row), before, 'focused')
      await page.mouse.move(0, 0)
      await card.getByRole('button', { name: 'Accept recommended', exact: true }).focus()
      await toggleOf(row).click()
      await toggleOf(row).click()
      expect(await toggleOf(row).evaluate((node) => node.matches(':focus-visible'))).toBe(false)
    })
  }
})

for (const width of WIDTHS) {
  for (const locale of LOCALES) {
    test(`opening a point and an option in it moves nothing read, at ${width} in ${locale}`, async ({
      page,
    }) => {
      const { card } = await openWays(page, width, locale)
      for (const label of ['P11 ', 'P12 ']) {
        const row = point(card, label)
        const before = await still(row)
        // A press at the point of the one before, with no move between, reaches nothing (DESIGN.md),
        // and scrolled into view the next point's label can stand right there.
        await page.mouse.move(0, 0)
        await toggleOf(row).click()
        await expect(row.locator('.request-point-detail')).toBeVisible()
        await settle(page)
        expectStill(await still(row), before, `${label}opened`)
      }
      // An option of the way hanging from the open point opens its description in place too.
      const row = point(card, 'P11 ')
      await row.getByRole('radio').first().click()
      const option = row.locator('.request-point-hang .request-option').first()
      const words = option.locator('.request-option-label')
      const excerpt = option.locator('.request-option-excerpt')
      await expect(excerpt).toBeVisible()
      const pointBefore = await still(row)
      const wordsBefore = await drawnBox(words)
      const lineBefore = await drawnBox(excerpt)
      await option.locator('.request-option-toggle').click()
      const detail = option.locator('.request-option-detail')
      await expect(detail).toBeVisible()
      await settle(page)
      expectStill(await still(row), pointBefore, 'option opened')
      const wordsAfter = await drawnBox(words)
      const lineAfter = await drawnBox(detail)
      expect(Math.abs(wordsAfter.top - wordsBefore.top)).toBeLessThanOrEqual(STILL)
      expect(Math.abs(lineAfter.top - lineBefore.top)).toBeLessThanOrEqual(STILL)
      expect(Math.abs(lineAfter.left - lineBefore.left)).toBeLessThanOrEqual(STILL)
    })
  }

  test(`Accept on an open point turns its way's marks into radios in their boxes, at ${width}`, async ({
    page,
  }) => {
    const { card } = await openWays(page, width)
    const row = point(card, 'P11 ')
    await toggleOf(row).click()
    const hang = row.locator('.request-point-hang')
    const marks = hang.locator('.request-option-input')
    await expect(marks).toHaveCount(3)
    await expect(hang.locator('input')).toHaveCount(0)
    const legend = hang.locator('.request-legend')
    const said = legend.locator('.request-legend-words > :not(.is-away)')
    await expect(said).toHaveText('Where · to choose after “Accept”')
    const before = await still(row)
    const boxes = await boxesOf(marks)
    const legendBefore = await box(legend)
    await row.getByRole('radio', { name: 'Accept', exact: true }).click()
    await expect(hang.getByRole('radio')).toHaveCount(3)
    await settle(page)
    expectStill(await still(row), before, 'accepted')
    expect(drift(await boxesOf(marks), boxes)).toBeLessThanOrEqual(STILL)
    const legendAfter = await box(legend)
    expect(Math.abs(legendAfter.height - legendBefore.height)).toBeLessThanOrEqual(STILL)
    await expect(said).toHaveText('Where · Required')
  })

  test(`the thread's rule runs from under the point to the end of its last field, at ${width}`, async ({
    page,
  }) => {
    const { card } = await openWays(page, width)
    const row = point(card, 'P10 ')
    await row.getByRole('radio', { name: 'Accept', exact: true }).click()
    await toggleOf(row).click()
    const hang = row.locator('.request-point-hang')
    await expect(hang).toBeVisible()
    // The comment's field hangs there too, so the rule has two fields to run past.
    await row.getByRole('button', { name: /^Comment: P10 /u }).click()
    await expect(hang.getByRole('textbox')).toBeVisible()
    const rule = await hang.evaluate((node) => {
      const style = getComputedStyle(node)
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-rule-strong)'
      node.append(probe)
      const strong = getComputedStyle(probe).color
      probe.remove()
      return { color: style.borderInlineStartColor, strong, width: style.borderInlineStartWidth }
    })
    expect(rule.width).toBe('1px')
    expect(rule.color).toBe(rule.strong)
    const thread = await box(hang)
    const advice = await box(row.locator('.request-point-advice'))
    const label = await drawnBox(row.locator('.request-point-label'))
    expect(thread.y).toBeGreaterThanOrEqual(advice.y + advice.height - STILL)
    expect(thread.y - (advice.y + advice.height)).toBeLessThanOrEqual(12)
    expect(Math.abs(thread.x - label.left)).toBeLessThanOrEqual(1)
    const children = await boxesOf(hang.locator(':scope > *'))
    expect(children).toHaveLength(2)
    const lefts = children.map(({ x }) => x)
    const bottom = Math.max(...children.map(({ height, y }) => y + height))
    expect(Math.abs(thread.y + thread.height - bottom)).toBeLessThanOrEqual(STILL)
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(STILL)
    expect(Math.min(...lefts)).toBeGreaterThan(thread.x)
  })
}

/** A label that wraps to three lines and more beside the verdict, and on a phone under it. */
const LONG =
  'P30 A sign that the client is alive: when the transcript of the session at the top was ' +
  'last written, and whether it still moves between a prompt and the end of its turn'

/** The review with that label on a point of its own ahead of the twelve. */
function withLongLabel(): InputRequestField[] {
  const [first, way] = wayReviewFields
  if (!first || !way) throw new Error('No point to lengthen')
  return [
    { ...first, id: 'p30', label: LONG },
    { ...way, id: 'p30-way', under: { field: 'p30', option: 'accept' } },
    ...wayReviewFields,
  ]
}

interface Drawn {
  bottom: number
  left: number
  right: number
  top: number
}

/** Whether two drawn boxes share any area, past a layout's rounding. */
const overlap = (one: Drawn, other: Drawn) =>
  one.left < other.right - STILL &&
  other.left < one.right - STILL &&
  one.top < other.bottom - STILL &&
  other.top < one.bottom - STILL

/**
 * Nothing in the row stands on the label's lines: the line under it starts below its last line
 * and where its words start, and the verdict, beside the label or under it, covers none of it.
 */
async function expectLabelClear(row: Locator, at: string) {
  const label = await drawnBox(row.locator('.request-point-label'))
  const lineHeight = await row
    .locator('.request-point-label')
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).lineHeight))
  const under = await firstLine(row)
  const segments = await box(segmentsOf(row))
  const verdict = {
    bottom: segments.y + segments.height,
    left: segments.x,
    right: segments.x + segments.width,
    top: segments.y,
  }
  // The case this is about: the label takes three lines or more.
  expect(label.bottom - label.top, `${at}: label lines`).toBeGreaterThan(2 * lineHeight)
  expect(under.top, `${at}: the line under the label`).toBeGreaterThanOrEqual(label.bottom - STILL)
  expect(Math.abs(under.left - label.left), `${at}: one start`).toBeLessThanOrEqual(STILL)
  expect(overlap(label, verdict), `${at}: the verdict over the label`).toBe(false)
}

for (const width of WIDTHS) {
  for (const locale of LOCALES) {
    test(`a long label runs into nothing under it, closed and open, at ${width} in ${locale}`, async ({
      page,
    }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.setViewportSize({ width, height: 844 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const { card, drawer } = await openQuestion(page, [
        asked({ prompt: WAYS_PROMPT, fields: withLongLabel(), title: 'Review of the board' }),
      ])
      await expect(drawer).toHaveCSS('transform', 'none')
      await page.evaluate(async () => document.fonts.ready)
      const row = point(card, 'P30 ')
      await expectLabelClear(row, `closed, at ${width} in ${locale}`)
      await toggleOf(row).click()
      await expect(toggleOf(row)).toHaveAttribute('aria-expanded', 'true')
      await settle(page)
      await expectLabelClear(row, `open, at ${width} in ${locale}`)
    })
  }
}

test('a review offers no row for your own option anywhere', async ({ page }) => {
  const { card } = await openWays(page, 1280)
  await card.getByRole('button', { name: 'Accept recommended', exact: true }).click()
  for (const row of await card.locator('.request-point').all()) await toggleOf(row).click()
  await expect(card.locator('.request-point-hang').first()).toBeVisible()
  await expect(card.getByText('Your own option', { exact: true })).toHaveCount(0)
  await expect(card.locator('.request-point-own')).toHaveCount(0)
})

test('a way left to choose says so in the line, and Send opens the point at it', async ({
  page,
}) => {
  const { card, requests } = await openWays(page, 1280)
  const row = point(card, 'P21 ')
  await row.getByRole('radio', { name: 'Accept', exact: true }).click()
  const way = row.locator('.request-point-way')
  await expect(way).toHaveText('Where: not chosen')
  await expect(way.locator('.request-point-missing')).toHaveText('not chosen')
  await send(card).click()
  await expect(toggleOf(row)).toHaveAttribute('aria-expanded', 'true')
  await expect(row.locator('.request-point-hang input').first()).toBeFocused()
  expect(requests.writes).toHaveLength(0)
})

test('the height of a review of twelve accepted points, closed, in a drawer', async ({
  page,
}, testInfo) => {
  const { card } = await openWays(page, 1280)
  await card.getByRole('button', { name: 'Accept recommended', exact: true }).click()
  await expect(card.locator('.request-review-count')).toContainText('12 of 12')
  await settle(page)
  const fields = await box(card.locator('.request-fields'))
  const whole = await box(card)
  const measured = `fields ${Math.round(fields.height)}px, card ${Math.round(whole.height)}px`
  testInfo.annotations.push({ type: 'height', description: measured })
  console.log(`twelve accepted points: ${measured}`)
  expect(fields.height).toBeGreaterThan(0)
})
