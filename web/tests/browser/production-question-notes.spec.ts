/**
 * The presses that open a comment: a quiet glyph at the end of a line that is already there,
 * with no line of their own, whose words are for the pointer that rests on it and for a reader.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { answersTap } from './commentListBackend.ts'
import { box, settledBox } from './editorPage.ts'
import { workItem } from './planningFixtures.ts'
import { asked, mixedField, openQuestion, routeField, send } from './questionBackend.ts'
import { test } from './test.ts'

const ON_FIELD = 'Comment on the question: Route'
/** The comment on the whole block: its press is named by the block's title as well. */
const ON_QUESTION = 'Comment on the block of questions'
const ON_SECOND = 'Comment on the question: Option'
const SEVERAL = { fields: [routeField, mixedField] }
const ONE = { fields: [routeField] }
const middle = (bounds: { height: number; y: number }) => bounds.y + bounds.height / 2
const across = (bounds: { width: number; x: number }) => bounds.x + bounds.width / 2
const fillOf = (button: Locator) =>
  button.locator('svg').evaluate((glyph) => getComputedStyle(glyph).fill)
const named = (scope: Locator, role: 'button' | 'textbox', name: string) =>
  scope.getByRole(role, { name, exact: true })
/** The press of the comment on the block, whatever the block's title. */
const blockPress = (scope: Locator, written = false) =>
  scope.getByRole('button', {
    name: new RegExp(`^${ON_QUESTION}: .+${written ? ': written' : ''}$`, 'u'),
  })

for (const [width, target, finger] of [
  [1280, 24, false],
  [390, 44, true],
] as const) {
  test(`a comment's press is a glyph at the end of a line it shares, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1400 })
    const { card } = await openQuestion(page, [asked(SEVERAL)])
    const onField = named(card, 'button', ON_FIELD)
    const onQuestion = blockPress(card)
    // Named by the block it is on, which a list of several blocks needs to tell them apart.
    await expect(onQuestion).toHaveAccessibleName(`${ON_QUESTION}: ${workItem.title}`)
    for (const [press, title] of [
      [onField, 'Comment on this question'],
      [onQuestion, ON_QUESTION],
    ] as const) {
      await expect(press).toHaveText('')
      await expect(press.locator('svg')).toBeVisible()
      await expect(press).toHaveAttribute('data-tooltip', title)
      await expect(press).toHaveAttribute('aria-expanded', 'false')
    }
    // Both grow their own box to the target where a finger presses: the label's, since rows
    // stand right under it, and the block's, as the other icons of the entry's head do.
    for (const press of [onField, onQuestion]) {
      const size = await box(press)
      expect(size.width).toBeGreaterThanOrEqual(target)
      expect(size.height).toBeGreaterThanOrEqual(target)
    }
    expect(await answersTap(onQuestion), 'the head press takes a 44 px tap').toBe(finger)
    // At the right end of the line naming the field, over the toggles of the rows under it, and
    // no line of its own under the options.
    const legend = await box(card.locator('legend').first())
    const field = await box(onField)
    const rows = card.locator('fieldset').first().locator('.request-option')
    const row = await box(rows.first())
    expect(Math.abs(middle(field) - middle(legend))).toBeLessThanOrEqual(1)
    expect(field.y + field.height).toBeLessThanOrEqual(row.y)
    const chevron = await box(
      card.locator('fieldset').nth(1).locator('.request-option').nth(1).getByRole('button'),
    )
    const second = await box(named(card, 'button', ON_SECOND))
    expect(Math.abs(across(second) - across(chevron))).toBeLessThanOrEqual(1)
    // In the head of the block, on the axis of its line, and none in the row of buttons.
    const question = await box(onQuestion)
    const head = await box(card.locator('.request-meta'))
    expect(Math.abs(middle(question) - middle(head))).toBeLessThanOrEqual(1)
    await expect(card.locator('.request-foot .request-note-toggle')).toHaveCount(0)
    await expect(card.locator('.request-fields > .request-note')).toHaveCount(0)
  })

  test(`a comment on the block opens above the buttons and moves none, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1400 })
    const { card } = await openQuestion(page, [asked(SEVERAL)])
    const onQuestion = blockPress(card)
    const before = await box(send(card))
    const toggle = await box(onQuestion)
    await onQuestion.click()
    const text = named(card, 'textbox', ON_QUESTION)
    await expect(text).toBeFocused()
    await settledBox(card)
    const after = await box(send(card))
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
    const { x } = await box(onQuestion)
    expect(Math.abs(x - toggle.x)).toBeLessThanOrEqual(1)
    const { y, height } = await box(text)
    expect(y + height).toBeLessThanOrEqual(after.y)
  })
}

test('a comment written says so in its words and its shape, and stays open', async ({ page }) => {
  const { card } = await openQuestion(page, [asked(SEVERAL)])
  for (const [press, written, editor, title] of [
    [
      named(card, 'button', ON_FIELD),
      named(card, 'button', `${ON_FIELD}: written`),
      ON_FIELD,
      'Comment on this question: written',
    ],
    [blockPress(card), blockPress(card, true), ON_QUESTION, `${ON_QUESTION}: written`],
  ] as const) {
    const empty = await fillOf(press)
    await press.click()
    const text = named(card, 'textbox', editor)
    await text.fill('Because of the digest')
    const pressed = written
    await expect(pressed).toHaveAttribute('data-tooltip', title)
    await expect(pressed).toHaveAttribute('aria-expanded', 'true')
    expect(await fillOf(pressed)).not.toBe(empty)
    // Closes only empty, whatever the press.
    await pressed.click()
    await expect(text).toBeVisible()
    await expect(text).toBeFocused()
  }
})

test('one field has one comment: the question’s, and its press says nothing else', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked(ONE)])
  await expect(card.getByRole('button', { name: /^Comment on the question:/u })).toHaveCount(0)
  await expect(blockPress(card)).toBeVisible()
})

test('a comment an older answer has on its one field stays to read and to change', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [
    asked({
      ...ONE,
      status: 'answered',
      answers: { route: 'keep' },
      own: {},
      field_notes: { route: 'Threads serve the digest too.' },
      answered_by: 'user',
      by_person: true,
      resolved_at: '2026-10-24T12:00:00Z',
    }),
  ])
  await expect(card.locator('.request-answer blockquote')).toContainText(
    'Threads serve the digest too.',
  )
  await card.getByRole('button', { name: 'Change answer', exact: true }).click()
  const text = named(card, 'textbox', ON_FIELD)
  await expect(text).toHaveValue('Threads serve the digest too.')
  await expect(named(card, 'button', `${ON_FIELD}: written`)).toBeVisible()
  // Emptied, it stays where it is being written, and only then its press can close it.
  await text.fill('')
  await expect(text).toBeVisible()
})

test('the keyboard meets the presses in the order they are read, and comes back to them', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked(SEVERAL)])
  const onField = named(card, 'button', ON_FIELD)
  const onQuestion = blockPress(card)
  await onField.focus()
  await page.keyboard.press('Tab')
  await expect(card.getByRole('radio', { name: 'Keep the comments', exact: true })).toBeFocused()
  await onField.focus()
  await page.keyboard.press('Enter')
  const fieldText = named(card, 'textbox', ON_FIELD)
  await expect(fieldText).toBeFocused()
  await onField.focus()
  await page.keyboard.press('Enter')
  await expect(fieldText).toHaveCount(0)
  await expect(onField).toBeFocused()

  // The block's press is read in its head, before its fields, with the head's other icons.
  await onQuestion.focus()
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAccessibleName('Reply')
  await page.keyboard.press('Shift+Tab')
  await expect(onQuestion).toBeFocused()
  await page.keyboard.press('Enter')
  const questionText = named(card, 'textbox', ON_QUESTION)
  await expect(questionText).toBeFocused()
  // Its field is the block's last, right before the buttons.
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: "Don't answer", exact: true })).toBeFocused()
  await onQuestion.focus()
  await page.keyboard.press('Enter')
  await expect(questionText).toHaveCount(0)
  await expect(onQuestion).toBeFocused()
})

test.describe('under a coarse pointer', () => {
  test.use({ hasTouch: true })

  test('a wide window still gives each press the whole target', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 })
    const { card } = await openQuestion(page, [asked(SEVERAL)])
    const { width, height } = await box(named(card, 'button', ON_FIELD))
    expect(width).toBeGreaterThanOrEqual(44)
    expect(height).toBeGreaterThanOrEqual(44)
    expect(await answersTap(blockPress(card))).toBe(true)
  })
})
