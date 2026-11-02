/**
 * Options with long descriptions: the labels stay what is read on the first screen,
 * and a description opens on its own press, for the mouse and for the keyboard alike.
 */
import { expect } from '@playwright/test'

import { expectNoSilentClipping } from './overflow.ts'
import { asked, crowdedField, mixedField, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'

for (const [width, height] of [
  [1680, 1050],
  [1024, 768],
  [390, 844],
] as const) {
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
    const last = rows.last().getByText('Option 12', { exact: true })
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
})

test('with nothing chosen the keyboard still meets one radio and one toggle', async ({ page }) => {
  const { card } = await openQuestion(page, [asked({ fields: [crowdedField] })])
  await card.getByRole('radio', { name: 'Option 1', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(card.locator('.request-option').first().getByRole('button')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: 'Your own answer', exact: true })).toBeFocused()
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
  await expect(card.getByRole('button', { name: 'Your own answer', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
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
