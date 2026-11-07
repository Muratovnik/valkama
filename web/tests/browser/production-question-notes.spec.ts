/**
 * The presses that open a comment: a quiet glyph at the end of a line that is already there,
 * with no line of their own, whose words are for the pointer that rests on it and for a reader.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { answersTap } from './commentListBackend.ts'
import { box, settledBox } from './editorPage.ts'
import { asked, mixedField, openQuestion, routeField, send } from './questionBackend.ts'
import { test } from './test.ts'

const ON_FIELD = 'Comment on this field: Route'
const ON_QUESTION = 'Comment on the question'
const ON_SECOND = 'Comment on this field: Option'
const SEVERAL = { fields: [routeField, mixedField] }
const ONE = { fields: [routeField] }
const middle = (bounds: { height: number; y: number }) => bounds.y + bounds.height / 2
const across = (bounds: { width: number; x: number }) => bounds.x + bounds.width / 2
const fillOf = (button: Locator) =>
  button.locator('svg').evaluate((glyph) => getComputedStyle(glyph).fill)
const named = (scope: Locator, role: 'button' | 'textbox', name: string) =>
  scope.getByRole(role, { name, exact: true })

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
    const onQuestion = named(card, 'button', ON_QUESTION)
    for (const [press, title] of [
      [onField, 'Comment on this field'],
      [onQuestion, ON_QUESTION],
    ] as const) {
      await expect(press).toHaveText('')
      await expect(press.locator('svg')).toBeVisible()
      await expect(press).toHaveAttribute('title', title)
      await expect(press).toHaveAttribute('aria-expanded', 'false')
    }
    // The label's press grows its own box to the target, since rows stand right under it; the
    // one at the buttons' start keeps its drawn box and reaches past it where a finger presses.
    const size = await box(onField)
    expect(size.width).toBeGreaterThanOrEqual(target)
    expect(size.height).toBeGreaterThanOrEqual(target)
    expect(await answersTap(onQuestion), 'the foot press takes a 44 px tap').toBe(finger)
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
    // On the left end of the row of buttons, over the radios, and nothing is drawn for it above;
    // on a phone at the start of the line above them, kept for the asking, not a line of its own.
    const question = await box(onQuestion)
    const onward = await box(send(card))
    const beside = Math.abs(middle(question) - middle(onward)) <= 1
    const above = question.y + question.height <= onward.y
    expect({ above, beside }, 'the press beside the buttons, or above them on a phone').toEqual({
      above: finger,
      beside: !finger,
    })
    const radio = await box(card.getByRole('radio').first())
    expect(Math.abs(across(question) - across(radio))).toBeLessThanOrEqual(1)
    await expect(card.locator('.request-fields > .request-note')).toHaveCount(0)
  })

  test(`a comment on the question opens above the buttons and moves none, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1400 })
    const { card } = await openQuestion(page, [asked(SEVERAL)])
    const onQuestion = named(card, 'button', ON_QUESTION)
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
  for (const [button, editor, title] of [
    [ON_FIELD, ON_FIELD, 'Comment on this field: written'],
    [ON_QUESTION, ON_QUESTION, 'Comment on the question: written'],
  ] as const) {
    const press = named(card, 'button', button)
    const empty = await fillOf(press)
    await press.click()
    const text = named(card, 'textbox', editor)
    await text.fill('Because of the digest')
    const pressed = named(card, 'button', `${button}: written`)
    await expect(pressed).toHaveAttribute('title', title)
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
  await expect(card.getByRole('button', { name: /^Comment on this field/u })).toHaveCount(0)
  await expect(named(card, 'button', ON_QUESTION)).toBeVisible()
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
  const onQuestion = named(card, 'button', ON_QUESTION)
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

  await onQuestion.focus()
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: "Don't answer", exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(onQuestion).toBeFocused()
  await page.keyboard.press('Enter')
  const questionText = named(card, 'textbox', ON_QUESTION)
  await expect(questionText).toBeFocused()
  // The field stands right before its press: one step away, and one back.
  await page.keyboard.press('Tab')
  await expect(onQuestion).toBeFocused()
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
    expect(await answersTap(named(card, 'button', ON_QUESTION))).toBe(true)
  })
})
