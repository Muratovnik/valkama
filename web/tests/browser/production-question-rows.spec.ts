/**
 * Where the words of a question stand, read off the built page: an answered row keeps no room
 * for a control it does not have, and opening anything moves nothing that was already read.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { box, settledBox } from './editorPage.ts'
import { asked, crowdedField, mixedField, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'

type Asked = NonNullable<Parameters<typeof asked>[0]>

// Playwright hides scrollbars, and one that arrives narrows what it scrolls on a real screen.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const WIDTHS = [1280, 390] as const
const ticks: InputRequestField = { ...mixedField, type: 'multi_choice', required: false }
const answered = (fields: InputRequestField[], answers: Asked['answers'], own?: Asked['own']) =>
  ({
    status: 'answered',
    fields,
    answers,
    own: own ?? {},
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-10-24T12:00:00Z',
  }) satisfies Asked

/** Where the first line of text under this element stands, and how it is set. */
const firstLine = (element: Locator) =>
  element.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent?.trim()) node = walker.nextNode()
    if (!node?.parentElement) throw new Error('No text here')
    const range = document.createRange()
    range.selectNodeContents(node)
    const line = range.getClientRects()[0]
    if (!line) throw new Error('Not laid out')
    const { color, font } = getComputedStyle(node.parentElement)
    return { x: line.x, y: line.y, color, font }
  })
type Line = Awaited<ReturnType<typeof firstLine>>

function expectNear(now: number, before: number, what: string) {
  expect(Math.abs(now - before), what).toBeLessThanOrEqual(1)
}

function expectSameLine(now: Line, before: Line, what: string) {
  expectNear(now.x, before.x, `${what}: across`)
  expectNear(now.y, before.y, `${what}: down`)
  expect(now.font, `${what}: type`).toBe(before.font)
  expect(now.color, `${what}: colour`).toBe(before.color)
}

async function expectStartsAt(element: Locator, x: number) {
  const line = await firstLine(element)
  expect(line.x).toBeCloseTo(x, 0)
}

const topOf = async (element: Locator) => {
  const { y } = await box(element)
  return y
}
const widthOf = async (element: Locator) => {
  const { width } = await box(element)
  return width
}
const scrollTop = (scroller: Locator) => scroller.evaluate((element) => element.scrollTop)
const groundOf = (row: Locator) => row.evaluate((node) => getComputedStyle(node).backgroundColor)

/** A real press, which unlike `click()` scrolls nothing into view on its way. */
async function press(page: Page, target: Locator) {
  const { x, y, width, height } = await box(target)
  await page.mouse.click(x + width / 2, y + height / 2)
}

/** A row's whole state of being read, to compare before and after a press on its toggle. */
async function readRow(row: Locator, scroller: Locator) {
  await settledBox(row)
  const toggle = await box(row.getByRole('button'))
  return {
    label: await firstLine(row.locator('.request-option-label')),
    top: await topOf(row),
    toggleX: toggle.x,
    toggleY: toggle.y,
    scrolled: await scrollTop(scroller),
  }
}

function expectRowStill(now: Awaited<ReturnType<typeof readRow>>, before: typeof now) {
  expectSameLine(now.label, before.label, 'label')
  expectNear(now.top, before.top, 'row')
  expectNear(now.toggleX, before.toggleX, 'toggle across')
  expectNear(now.toggleY, before.toggleY, 'toggle down')
  expectNear(now.scrolled, before.scrolled, 'scroller')
}

/** The excerpt and what took its place are one text: the same place, type and measure. */
async function expectContinues(detail: Locator, line: Line, room: number) {
  expectSameLine(await firstLine(detail), line, 'first line of the description')
  expectNear(await widthOf(detail.locator('p').first()), room, 'its measure')
}

for (const width of WIDTHS) {
  test(`an answered row starts its words at its own inset, chosen or not, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const { card } = await openQuestion(page, [
      asked(
        answered([mixedField, routeField], { mixed: 'long' }, { route: 'Only after acceptance' }),
      ),
    ])
    const rows = card.locator('.request-option')
    await expect(rows).toHaveCount(7)
    const expected = await rows
      .first()
      .locator('.request-option-line')
      .evaluate((line) => Number.parseFloat(getComputedStyle(line).paddingInlineStart))
    expect(expected).toBeGreaterThan(0)
    for (const row of await rows.all()) {
      const words = await firstLine(row.locator('.request-option-label'))
      const { x } = await box(row)
      expect(words.x - x).toBeCloseTo(expected, 0)
    }
    const chosen = rows.nth(1)
    await chosen.scrollIntoViewIfNeeded()
    await settledBox(chosen)
    const { x } = await firstLine(chosen.locator('.request-option-label'))
    await expectStartsAt(chosen.locator('.request-option-excerpt'), x)
    // What opens, and what stands under your own option, starts on that same line.
    await press(page, chosen.getByRole('button'))
    await expectStartsAt(chosen.locator('.request-option-detail'), x)
    const own = rows.last()
    await expectStartsAt(own.locator('.request-option-below'), x)
  })
}

test('the chosen row is told apart by its ground and its word, and in a forced palette too', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked(answered([mixedField], { mixed: 'long' }))])
  const rows = card.locator('.request-option')
  const chosen = rows.nth(1)
  const passed = rows.nth(0)
  await expect(chosen).toContainText('selected')
  await expect(passed).not.toContainText('selected')
  expect(await groundOf(chosen)).not.toBe(await groundOf(passed))
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(chosen.getByText('selected', { exact: true })).toBeVisible()
  await expect(chosen).toHaveCSS('outline-style', 'solid')
  await expect(passed).toHaveCSS('outline-style', 'none')
})

for (const width of WIDTHS) {
  for (const [state, change] of [
    ['a form of radios', { fields: [mixedField] }],
    ['a form of ticks', { fields: [ticks] }],
    ['an answered question, the row chosen', answered([mixedField], { mixed: 'long' })],
    ['an answered question, the row passed over', answered([mixedField], { mixed: 'short' })],
  ] as [string, Asked][]) {
    test(`opening an excerpt only adds lines under it, in ${state} at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      const { drawer, card } = await openQuestion(page, [asked(change)])
      const scroller = drawer.locator('.drawer-frame-body')
      const row = card.locator('.request-option').nth(1)
      const above = card.locator('.request-option').first()
      const excerpt = row.locator('.request-option-excerpt')
      const detail = row.locator('.request-option-detail')
      const toggle = row.getByRole('button')
      await toggle.scrollIntoViewIfNeeded()
      const before = await readRow(row, scroller)
      const line = await firstLine(excerpt)
      const room = await widthOf(excerpt)
      const aboveTop = await topOf(above)

      await press(page, toggle)
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(detail).toContainText('second paragraph')
      expectRowStill(await readRow(row, scroller), before)
      await expectContinues(detail, line, room)
      expectNear(await topOf(above), aboveTop, 'the row above')

      await press(page, toggle)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(detail).toHaveCount(0)
      expectRowStill(await readRow(row, scroller), before)
      expectSameLine(await firstLine(excerpt), line, 'the excerpt back')
    })
  }

  test(`a folded description opens under the label on its line, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const { drawer, card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
    const scroller = drawer.locator('.drawer-frame-body')
    const row = card.locator('.request-option').nth(4)
    const toggle = row.getByRole('button')
    await toggle.scrollIntoViewIfNeeded()
    const before = await readRow(row, scroller)
    await press(page, toggle)
    const detail = row.locator('.request-option-detail')
    await expect(detail).toContainText('second paragraph')
    expectRowStill(await readRow(row, scroller), before)
    await expectStartsAt(detail, before.label.x)
    await press(page, toggle)
    await expect(detail).toHaveCount(0)
    expectRowStill(await readRow(row, scroller), before)
  })
}
