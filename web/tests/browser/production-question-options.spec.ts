/**
 * Options with long descriptions: the labels stay what is read on the first screen,
 * and a description opens on its own press, for the mouse and for the keyboard alike.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { box, settledBox } from './editorPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { asked, crowdedField, mixedField, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'

const SIZES = [
  [1680, 1050],
  [1024, 768],
  [390, 844],
] as const
const ticks: InputRequestField = { ...crowdedField, type: 'multi_choice', required: false }
const opening = (option: number) => `opening paragraph of the option number ${option},`
const rowTops = (rows: Locator) =>
  rows.evaluateAll((all) => all.map((row) => row.getBoundingClientRect().top))
const drift = (now: number[], before: number[]) =>
  Math.max(...now.map((top, index) => Math.abs(top - (before[index] ?? Number.NaN))))

for (const [width, height] of SIZES) {
  test(`twelve options with several paragraphs still fit the first screen at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    const { drawer, card } = await openQuestion(page, [
      asked({ prompt: 'Which **option** should it be?', fields: [crowdedField] }),
    ])
    await drawer.getByRole('button', { name: 'Waiting for an answer', exact: true }).click()
    const rows = card.locator('.request-option')
    await expect(rows).toHaveCount(12)
    // The labels are what is read; no paragraph of any description stands yet.
    await expect(card).not.toContainText('opening paragraph')
    const last = rows.nth(11).getByText('Option 12', { exact: true })
    await expect(last).toBeInViewport()
    await expect
      .poll(async () => {
        const bounds = await last.boundingBox()
        return (bounds?.y ?? height) + (bounds?.height ?? 0)
      })
      .toBeLessThanOrEqual(height)
    await expectNoSilentClipping(page, `Long descriptions at ${width}px`)
  })
}

test('a description opens on its own press, selects nothing, and two can stand open', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  const third = card.locator('.request-option').nth(2)
  const fifth = card.locator('.request-option').nth(4)
  await expect(third).toContainText('recommended')
  await third.getByRole('button', { name: /Option 3/u }).click()
  await expect(third.getByRole('link', { name: 'a link' })).toBeVisible()
  await expect(third.locator('li')).toHaveCount(3)
  await expect(card.getByRole('radio', { checked: true })).toHaveCount(0)
  await fifth.getByRole('button', { name: /Option 5/u }).click()
  await expect(third).toContainText('second paragraph')
  await expect(fifth).toContainText('second paragraph')
  // Choosing an option does not move the others by opening anything.
  const before = await fifth.boundingBox()
  await card.getByRole('radio', { name: 'Option 3', exact: true }).check()
  await expect
    .poll(async () => {
      const bounds = await fifth.boundingBox()
      return bounds?.y
    })
    .toBe(before?.y)
  await third.getByRole('button', { name: /Option 3/u }).click()
  await expect(third).not.toContainText('second paragraph')
  await expect(card.getByRole('radio', { name: 'Option 3', exact: true })).toBeChecked()
  // Folded in its row, the chosen one is still whole: it can never be sent unread.
  await expect(card.locator('.request-chosen')).toContainText('second paragraph')
})

test('a chosen option’s description stands whole before Send, by the mouse and the keys', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked({ fields: [mixedField] })])
  const chosen = card.locator('.request-chosen')
  await expect(chosen).toHaveCount(0)
  await card.getByRole('radio', { name: 'With a text', exact: true }).check()
  // All of it, past the first words: a condition can stand in what the excerpt cuts.
  await expect(chosen).toContainText('With a text')
  await expect(chosen).toContainText('second paragraph')
  await expect(chosen.locator('li')).toHaveCount(3)
  await expect(chosen.getByRole('link', { name: 'a link' })).toBeVisible()
  expect(requests.writes).toEqual([])
  // A line already stands whole, and an option with none has nothing to show.
  await page.keyboard.press('ArrowUp')
  await expect(card.getByRole('radio', { name: 'With a line', exact: true })).toBeChecked()
  await expect(chosen).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await expect(chosen).toContainText('second paragraph')
  await page.keyboard.press('ArrowDown')
  await expect(card.getByRole('radio', { name: 'With nothing', exact: true })).toBeChecked()
  await expect(chosen).toHaveCount(0)
})

test('in the folded view too it stands between the options and Send, which sends at once', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  await card.getByRole('radio', { name: 'Option 3', exact: true }).check()
  const chosen = card.locator('.request-chosen')
  await expect(chosen).toContainText(opening(3))
  await expect(chosen).toContainText('second paragraph')
  const [last, block, foot] = await Promise.all([
    box(card.locator('.request-option').last()),
    box(chosen),
    box(card.locator('.request-foot')),
  ])
  expect(block.y).toBeGreaterThanOrEqual(last.y + last.height)
  expect(foot.y).toBeGreaterThanOrEqual(block.y + block.height)
  await send(card).click()
  await expect(card.getByRole('radio')).toHaveCount(0)
  expect(requests.writes).toHaveLength(1)
  expect(requests.writes[0]?.body.answers).toEqual({ crowded: 'option-3' })
})

test('moving the choice closes what the choice opened and leaves what a person opened', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  const chosen = card.locator('.request-chosen')
  const fifth = card.locator('.request-option').nth(4)
  const choose = (option: number) =>
    card.getByRole('radio', { name: `Option ${option}`, exact: true }).check()
  await fifth.getByRole('button', { name: /Option 5/u }).click()
  await choose(3)
  await expect(chosen).toContainText(opening(3))
  await choose(7)
  await expect(chosen).toContainText(opening(7))
  await expect(card).not.toContainText(opening(3))
  await expect(fifth).toContainText(opening(5))
  // Chosen while open in its row it stands once, and stays when the choice moves on.
  await choose(5)
  await expect(chosen).toHaveCount(0)
  await expect(card.getByText(opening(5))).toHaveCount(1)
  await choose(7)
  await expect(chosen).toContainText(opening(7))
  await expect(fifth).toContainText(opening(5))
})

test('the chevron of a chosen row moves its description and never hides it', async ({ page }) => {
  const { card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  const chosen = card.locator('.request-chosen')
  const third = card.locator('.request-option').nth(2)
  const toggle = third.getByRole('button', { name: /Option 3/u })
  await card.getByRole('radio', { name: 'Option 3', exact: true }).check()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(third).toContainText(opening(3))
  await expect(chosen).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(third).not.toContainText(opening(3))
  await expect(chosen).toContainText(opening(3))
})

test('ticks show each ticked description, by the mouse and the keys, and take it back', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked({ fields: [ticks] })])
  const chosen = card.locator('.request-chosen')
  await card.getByRole('checkbox', { name: 'Option 4', exact: true }).check()
  await card.getByRole('checkbox', { name: 'Option 2', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(card.getByRole('checkbox', { name: 'Option 2', exact: true })).toBeChecked()
  // In the options' order, whichever was ticked first.
  await expect(chosen).toHaveCount(2)
  await expect(chosen.first()).toContainText(opening(2))
  await expect(chosen.last()).toContainText(opening(4))
  await page.keyboard.press('Space')
  await expect(chosen).toHaveCount(1)
  await expect(card).not.toContainText(opening(2))
  await send(card).click()
  await expect(card.getByRole('checkbox')).toHaveCount(0)
  expect(requests.writes[0]?.body.answers).toEqual({ crowded: ['option-4'] })
})

for (const [width, height] of SIZES) {
  test(`choosing moves no row under the pointer, and scrolls nothing, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    const { drawer, card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
    await drawer.getByRole('button', { name: 'Waiting for an answer', exact: true }).click()
    const rows = card.locator('.request-option')
    const scroller = drawer.locator('.drawer-frame-body')
    await settledBox(rows.first())
    const before = await rowTops(rows)
    const scrolled = await scroller.evaluate((element) => element.scrollTop)
    // Down the list and back up it, so that what closes stands above and below the press.
    for (const option of [3, 5, 2, 12, 1]) {
      const label = await box(rows.nth(option - 1).locator('.request-option-label'))
      await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2)
      await expect(card.locator('.request-chosen')).toContainText(opening(option))
      await settledBox(rows.first())
      expect(drift(await rowTops(rows), before)).toBeLessThanOrEqual(1)
      expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(scrolled, 0)
    }
    await expectNoSilentClipping(page, `A chosen description at ${width}px`)
  })
}

test('the arrows scroll only as far as the chosen row needs, and it stands whole', async ({
  page,
}) => {
  const height = 520
  await page.setViewportSize({ width: 390, height })
  const { drawer, card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  const rows = card.locator('.request-option')
  const scroller = drawer.locator('.drawer-frame-body')
  const top = () => scroller.evaluate((element) => element.scrollTop)
  await card.getByRole('radio', { name: 'Option 1', exact: true }).focus()
  await settledBox(rows.first())
  const going = Array.from({ length: 11 }, (_, index) => index + 2)
  for (const option of going) {
    const row = rows.nth(option - 1)
    const start = await box(row)
    const needed = Math.max(0, start.y + start.height - height)
    const from = await top()
    await page.keyboard.press('ArrowDown')
    await expect(card.getByRole('radio', { name: `Option ${option}`, exact: true })).toBeChecked()
    const stands = await settledBox(row)
    expect(stands.y + stands.height).toBeLessThanOrEqual(height + 1)
    expect((await top()) - from).toBeLessThanOrEqual(needed + 4)
  }
  const tabs = await box(drawer.locator('.drawer-frame-tabs'))
  for (const option of going.map((index) => 13 - index)) {
    const row = rows.nth(option - 1)
    const start = await box(row)
    const needed = Math.max(0, tabs.y + tabs.height - start.y)
    const from = await top()
    await page.keyboard.press('ArrowUp')
    await expect(card.getByRole('radio', { name: `Option ${option}`, exact: true })).toBeChecked()
    const stands = await settledBox(row)
    expect(stands.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1)
    expect(from - (await top())).toBeLessThanOrEqual(needed + 4)
  }
})

test('a press on a row cut by the window’s edge leaves it under the pointer', async ({ page }) => {
  const height = 520
  await page.setViewportSize({ width: 390, height })
  const { drawer, card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  const row = card.locator('.request-option').nth(7)
  const scroller = drawer.locator('.drawer-frame-body')
  await row.scrollIntoViewIfNeeded()
  const shown = await box(row)
  await scroller.evaluate((element, by) => element.scrollBy(0, by), shown.y - (height - 14))
  const cut = await settledBox(row)
  expect(cut.y).toBeCloseTo(height - 14, 0)
  await page.mouse.click(cut.x + cut.width / 2, cut.y + 4)
  await expect(card.getByRole('radio', { name: 'Option 8', exact: true })).toBeChecked()
  // The browser shows the radio it was given; that is a few pixels and the same row.
  const after = await settledBox(row)
  expect(after.y).toBeLessThanOrEqual(cut.y + 4)
  expect(after.y + after.height).toBeGreaterThanOrEqual(cut.y + 4)
})

test('every arrow goes on round the ends, and a modified one is left to the browser', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked({ fields: [mixedField] })])
  const radio = (name: string) => card.getByRole('radio', { name, exact: true })
  await radio('With a line').focus()
  await page.keyboard.press('ArrowUp')
  await expect(radio('With nothing')).toBeChecked()
  await expect(radio('With nothing')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(radio('With a line')).toBeChecked()
  await page.keyboard.press('ArrowLeft')
  await expect(radio('With nothing')).toBeChecked()
  await page.keyboard.press('ArrowDown')
  await expect(radio('With a line')).toBeChecked()
  await page.keyboard.press('Control+ArrowDown')
  await expect(radio('With a line')).toBeChecked()
})

test('the list of everything waiting shows it the same way, and again when reopened', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { drawer } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  const opener = page.getByRole('button', { name: /^Needs my answer/ })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  const chosen = dialog.locator('.request-chosen')
  await dialog.getByRole('radio', { name: 'Option 3', exact: true }).check()
  await expect(chosen).toContainText(opening(3))
  await expect(chosen).toContainText('second paragraph')
  await expectNoSilentClipping(page, 'A chosen description in the list at 390px')
  await dialog.getByRole('button', { name: 'Close questions', exact: true }).click()
  await opener.click()
  await expect(dialog.getByRole('radio', { name: 'Option 3', exact: true })).toBeChecked()
  await expect(chosen).toContainText(opening(3))
})

test('a screen reader hears the label on each arrow, and the description is there to reach', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked({ fields: [mixedField] })])
  const text = card.getByRole('radio', { name: 'With a text', exact: true })
  await expect(text).not.toHaveAttribute('aria-details')
  await text.check()
  await expect(text).toHaveAccessibleName('With a text')
  await expect(text).toHaveAccessibleDescription('')
  const chosen = card.locator('.request-chosen')
  await expect(chosen).toContainText('second paragraph')
  // Named as a detail, which is announced as there, and in no region read out when it changes.
  const details = await chosen.getAttribute('id')
  await expect(text).toHaveAttribute('aria-details', details ?? 'missing')
  await expect(card.locator('[aria-live], [role="status"], [role="alert"]')).toHaveCount(0)
  await card.getByRole('radio', { name: 'With nothing', exact: true }).check()
  await expect(text).not.toHaveAttribute('aria-details')
})

test('with nothing chosen the keyboard still meets one radio and one toggle', async ({ page }) => {
  const { card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  await card.getByRole('radio', { name: 'Option 1', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(card.locator('.request-option').first().getByRole('button')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: "Don't answer", exact: true })).toBeFocused()
  await expect(card.getByRole('radio', { checked: true })).toHaveCount(0)
})

test('the keyboard meets one description on its way to Send, not twelve', async ({ page }) => {
  const { card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  const radio = card.getByRole('radio', { name: 'Option 1', exact: true })
  await radio.focus()
  await page.keyboard.press('ArrowDown')
  await expect(card.getByRole('radio', { name: 'Option 2', exact: true })).toBeChecked()
  await page.keyboard.press('Tab')
  const toggle = card.locator('.request-option').nth(1).getByRole('button')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Tab')
  // The link inside what was just opened comes first, and then the way on.
  await expect(card.locator('.request-option').nth(1).getByRole('link')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: "Don't answer", exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(send(card)).toBeFocused()
})

test('a radio is named by its label alone, and hears a line but not a text', async ({ page }) => {
  const { card } = await openQuestion(page, [asked({ fields: [mixedField] })])
  const line = card.getByRole('radio', { name: 'With a line', exact: true })
  await expect(line).toHaveAccessibleDescription('It says this and no more.')
  const text = card.getByRole('radio', { name: 'With a text', exact: true })
  await expect(text).toHaveAccessibleDescription('')
  // Few options: a long description shows its first words on one quiet line.
  const excerpt = card.locator('.request-option').nth(1).locator('.request-option-excerpt')
  await expect(excerpt).toContainText('The opening paragraph')
  await expect(excerpt).toHaveCSS('white-space', 'nowrap')
  await expect(card.locator('.request-option').nth(2).getByRole('button')).toHaveCount(0)
})

test('pressing a line of a description selects its option, as pressing its label does', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked({ fields: [mixedField] })])
  await card.getByText('It says this and no more.').click()
  await expect(card.getByRole('radio', { name: 'With a line', exact: true })).toBeChecked()
})
