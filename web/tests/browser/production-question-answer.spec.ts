/**
 * The whole of an answer by the real keyboard, at the widths and in the palette a person may
 * have: your own option in the radio group, comments, what an answered question shows, and
 * changing an answer with every way back out of it.
 */
import { expect } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { expectDateHeld } from './metaLine.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  asked,
  mixedField,
  openQuestion,
  QUESTION_ID,
  routeField,
  send,
} from './questionBackend.ts'
import { test } from './test.ts'

const OWN = 'Your own option'
const OWN_TEXT = /^Your own option: /u
const yesNo: InputRequestField = {
  id: 'go',
  label: 'Go ahead',
  type: 'boolean',
  required: true,
  options: [],
}
const ticks: InputRequestField = {
  ...mixedField,
  id: 'ticks',
  label: 'Areas',
  type: 'multi_choice',
  required: false,
}
const words: InputRequestField = {
  id: 'why',
  label: 'Why',
  type: 'text',
  required: false,
  options: [],
}
const whole: Parameters<typeof asked>[0] = {
  status: 'answered',
  fields: [routeField, ticks, yesNo, words],
  answers: { route: 'move', ticks: ['short', 'long'], why: 'Because the **digest** reads them.' },
  own: { go: 'Only after acceptance' },
  field_notes: { route: 'Threads serve the digest too.' },
  note: 'On the whole question.',
  answered_by: 'user',
  by_person: true,
  resolved_at: '2026-10-24T12:00:00Z',
  revision: 3,
  answer_version: 2,
  history: [
    {
      version: 1,
      answers: { route: 'keep', ticks: ['bare'], go: true },
      own: {},
      field_notes: {},
      note: 'First **thoughts**',
      answered_by: 'claude',
      by_person: false,
      answered_at: '2026-10-24T10:30:00Z',
    },
  ],
}

test('the arrows walk your own option with the rest, and focus stays in the group', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked()])
  const radio = (name: string) => card.getByRole('radio', { name, exact: true })
  await radio('Keep the comments').focus()
  await page.keyboard.press('ArrowUp')
  await expect(radio(OWN)).toBeChecked()
  await expect(radio(OWN)).toBeFocused()
  const text = card.getByRole('textbox', { name: OWN_TEXT })
  await expect(text).toBeVisible()
  await page.keyboard.press('ArrowUp')
  await expect(radio('Drop them')).toBeChecked()
  await expect(radio('Drop them')).toBeFocused()
  await expect(text).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(radio('Keep the comments')).toBeChecked()
  await expect(text).toHaveCount(0)
})

test('Tab goes from your own option straight into its text, and Shift+Tab straight back', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked()])
  const own = card.getByRole('radio', { name: OWN, exact: true })
  await own.focus()
  await page.keyboard.press('Space')
  await expect(own).toBeChecked()
  await expect(own).toBeFocused()
  await page.keyboard.press('Tab')
  const text = card.getByRole('textbox', { name: OWN_TEXT })
  await expect(text).toBeFocused()
  await page.keyboard.type('In a week')
  await page.keyboard.press('Shift+Tab')
  await expect(own).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Control+Enter')
  await expect(card.locator('.request-state')).toBeFocused()
  expect(requests.writes[0]?.body).toMatchObject({ answers: {}, own: { route: 'In a week' } })
})

test('a tick of your own opens its text too, and stands beside the others', async ({ page }) => {
  const { card, requests } = await openQuestion(page, [asked({ fields: [ticks] })])
  await card.getByRole('checkbox', { name: 'With a line', exact: true }).focus()
  await page.keyboard.press('Space')
  const own = card.getByRole('checkbox', { name: OWN, exact: true })
  await own.focus()
  await page.keyboard.press('Space')
  await expect(own).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(card.getByRole('textbox', { name: OWN_TEXT })).toBeFocused()
  await page.keyboard.type('And this')
  await send(card).click()
  expect(requests.writes[0]?.body).toMatchObject({
    answers: { ticks: ['short'] },
    own: { ticks: 'And this' },
  })
})

test('yes and no stand in a column with your own option, whatever the width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { card } = await openQuestion(page, [asked({ fields: [yesNo] })])
  const rows = card.locator('.request-option')
  await expect(rows).toHaveCount(3)
  const lefts = await rows.evaluateAll((all) => all.map((row) => row.getBoundingClientRect().left))
  const tops = await rows.evaluateAll((all) => all.map((row) => row.getBoundingClientRect().top))
  expect(new Set(lefts).size).toBe(1)
  expect(new Set(tops).size).toBe(3)
})

test('your own option with no words is refused at its text, and says so to the keyboard', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked()])
  await card.getByRole('radio', { name: OWN, exact: true }).check()
  await send(card).click()
  const text = card.getByRole('textbox', { name: OWN_TEXT })
  await expect(text).toBeFocused()
  await expect(text).toHaveAttribute('aria-invalid', 'true')
  await expect(text).toHaveAccessibleDescription('Write your own option, or choose another.')
  expect(requests.writes).toEqual([])
  await page.keyboard.type('Now it says')
  await expect(text).not.toHaveAttribute('aria-invalid', 'true')
})

test('a press on a reference in a row selects, and nothing pressable stands in a label', async ({
  page,
}) => {
  const described: InputRequestField = {
    ...routeField,
    options: [
      { id: 'keep', label: 'Keep', description: 'As MAIN-265 says' },
      { id: 'move', label: 'Move', description: 'See [the notes](https://example.com/notes).' },
    ],
  }
  const { card, drawer } = await openQuestion(page, [asked({ fields: [described] })])
  await expect(card.locator('label button, label a')).toHaveCount(0)
  await card.getByText('As MAIN-265 says').click()
  await expect(card.getByRole('radio', { name: 'Keep', exact: true })).toBeChecked()
  await expect(drawer).toBeVisible()
  // The link did not stop being one: it opens from its own press, outside the label.
  await card.getByRole('button', { name: /Move/u }).click()
  const link = card.getByRole('link', { name: 'the notes' })
  await expect(link).toBeVisible()
  await expect(card.getByRole('radio', { name: 'Keep', exact: true })).toBeChecked()
})

test('a comment on a field goes under it with its own name, and is sent beside the choice', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked()])
  await card.getByRole('radio', { name: 'Move them', exact: true }).check()
  const toggle = card.getByRole('button', { name: /^Comment on this field: Route/u })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByRole('textbox', { name: /^Comment on this field: Route/u })).toBeFocused()
  await page.keyboard.type('Why this one')
  await send(card).click()
  expect(requests.writes[0]?.body).toMatchObject({
    answers: { route: 'move' },
    field_notes: { route: 'Why this one' },
  })
})

for (const width of [390, 1280]) {
  test(`at ${width} a whole answer shows everything offered, with nothing clipped`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const { card } = await openQuestion(page, [asked(whole)])
    await expect(card.getByRole('radio')).toHaveCount(0)
    await expect(card.getByRole('list')).toHaveCount(3)
    const answers = card.locator('.request-answer')
    await expect(answers.nth(0).getByRole('listitem')).toHaveCount(3)
    await expect(answers.nth(0).locator('.request-option.is-chosen')).toHaveCount(1)
    await expect(answers.nth(0).locator('.request-option.is-chosen')).toContainText('Move them')
    await expect(answers.nth(0).locator('.request-option.is-chosen')).toContainText('selected')
    // A comment on a field is signed as the comment on the question is, in words on screen.
    const fieldNote = answers.nth(0).locator('blockquote')
    await expect(fieldNote.locator('.request-answer-note-label')).toHaveText(
      'Comment on this field',
    )
    await expect(fieldNote).toContainText('Threads serve the digest too.')
    await expect(card.locator('.request-reply-note-label')).toHaveText('Comment on the question')
    await expect(answers.nth(2).locator('.request-option.is-chosen')).toContainText(
      'Only after acceptance',
    )
    await expect(card.locator('.request-reply-note')).toContainText('On the whole question.')
    await expect(card.locator('.request-state')).toContainText('changed ·')
    await expectNoSilentClipping(page, `Answered question at ${width}px`)
    await card.getByRole('button', { name: 'Previous answers (1)', exact: true }).click()
    const version = card.locator('.request-history-version')
    await expect(version).toContainText('claude')
    await expect(version).toContainText('Route: Keep the comments')
    await expect(version).toContainText('Areas: With nothing')
    await expect(version).toContainText('Go ahead: Yes')
    await expect(version).toContainText('Comment on the question: First thoughts')
    await expectNoSilentClipping(page, `Previous answers at ${width}px`)
  })

  test(`at ${width} the change form and its asking fit, with nothing clipped`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { card } = await openQuestion(page, [asked(whole)])
    await card.getByRole('button', { name: 'Change answer', exact: true }).click()
    await expectNoSilentClipping(page, `Change form at ${width}px`)
    await card.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
    await card.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Continue', exact: true })).toBeInViewport()
    await expectNoSilentClipping(page, `The asking at ${width}px`)
  })
}

for (const width of [1500, 390]) {
  test(`a long name in the previous answers leaves the date in its place at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const [first] = whole.history ?? []
    const long = 'an-agent-with-a-remarkably-long-working-name-that-runs-past-the-line'
    const { card } = await openQuestion(page, [
      asked({ ...whole, history: [{ ...first, answered_by: long } as NonNullable<typeof first>] }),
    ])
    await card.getByRole('button', { name: 'Previous answers (1)', exact: true }).click()
    const meta = card.locator('.request-history-meta')
    await expect(meta).toContainText(long)
    await expectDateHeld(meta, 'a previous answer')
  })

  test(`a long name over a question and over its answer leaves the date in its place at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const long = 'an-agent-with-a-remarkably-long-working-name-that-runs-past-the-line'
    const { card } = await openQuestion(page, [
      asked({ ...whole, answered_by: long, by_person: false, author: long }),
    ])
    const reply = card.locator('.request-reply-meta')
    await expect(reply).toContainText(long)
    await expectDateHeld(reply, 'the answer in force')
    const asking = card.locator('.request-meta')
    await expect(asking).toContainText(long)
    await expectDateHeld(asking, 'the question')
  })
}

test('a chosen row keeps its mark in a forced palette, and the others read at full contrast', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  const { card } = await openQuestion(page, [asked(whole)])
  const chosen = card.locator('.request-option.is-chosen').first()
  await expect(chosen).toHaveCSS('outline-style', 'solid')
  await expect(chosen).toContainText('selected')
  const other = card.locator('.request-option:not(.is-chosen)').first()
  await expect(other).toHaveCSS('outline-style', 'none')
})

test('the way into a change, by the keyboard: the same form, and Save off until it differs', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked(whole)])
  const change = card.getByRole('button', { name: 'Change answer', exact: true })
  await change.focus()
  await page.keyboard.press('Enter')
  const move = card.getByRole('radio', { name: 'Move them', exact: true })
  await expect(move).toBeChecked()
  await expect(move).toBeFocused()
  await expect(card.getByRole('radio', { name: OWN, exact: true }).nth(1)).toBeChecked()
  await expect(card.getByRole('textbox', { name: OWN_TEXT })).toHaveValue('Only after acceptance')
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0)
  const save = card.getByRole('button', { name: 'Save change', exact: true })
  await expect(save).toBeDisabled()
  await page.keyboard.press('ArrowDown')
  await expect(save).toBeEnabled()
  await page.keyboard.press('ArrowUp')
  await expect(move).toBeChecked()
  await expect(save).toBeDisabled()
  await page.keyboard.press('ArrowDown')
  await save.click()
  await expect(card.locator('.request-state')).toBeFocused()
  expect(requests.writes.at(-1)).toMatchObject({
    action: 'change',
    body: {
      answers: { route: 'drop' },
      expected_revision: 3,
      own: { go: 'Only after acceptance' },
      note: 'On the whole question.',
    },
  })
  await expect(card.locator('.request-option.is-chosen').first()).toContainText('Drop them')
  await expect(
    card.getByRole('button', { name: 'Previous answers (2)', exact: true }),
  ).toBeVisible()
})

test('Escape with nothing changed leaves the form at once, and the card stays open', async ({
  page,
}) => {
  const { card, drawer } = await openQuestion(page, [asked(whole)])
  const change = card.getByRole('button', { name: 'Change answer', exact: true })
  await change.click()
  await expect(card.getByRole('radio', { name: 'Move them', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card.getByRole('radio')).toHaveCount(0)
  await expect(change).toBeFocused()
  await expect(drawer).toBeVisible()
})

test('Escape with something changed asks first, on the way back, and a second Escape goes back', async ({
  page,
}) => {
  const { card, drawer } = await openQuestion(page, [asked(whole)])
  await card.getByRole('button', { name: 'Change answer', exact: true }).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  const going = card.getByRole('button', { name: 'Continue', exact: true })
  await expect(going).toBeFocused()
  await expect(card.getByText('Discard the change to this answer?')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(going).toHaveCount(0)
  // Back on the radio it was asked from, ready to walk on.
  await expect(card.getByRole('radio', { name: 'Drop them', exact: true })).toBeFocused()
  await expect(card.getByRole('radio', { name: 'Drop them', exact: true })).toBeChecked()
  await expect(drawer).toBeVisible()
})

test('Cancel with something changed asks, a reflexive Enter keeps it, and discarding restores', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked(whole)])
  const change = card.getByRole('button', { name: 'Change answer', exact: true })
  await change.click()
  await card.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
  const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
  await cancel.focus()
  await page.keyboard.press('Enter')
  await expect(card.getByRole('button', { name: 'Continue', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(cancel).toBeFocused()
  await expect(card.getByRole('radio', { name: 'Keep the comments', exact: true })).toBeChecked()
  await page.keyboard.press('Enter')
  await card.getByRole('button', { name: 'Discard change', exact: true }).click()
  await expect(change).toBeFocused()
  await expect(card.locator('.request-option.is-chosen').first()).toContainText('Move them')
  expect(requests.writes).toEqual([])
})

test('a conflict keeps the draft, and Check status lets it go on from the new answer', async ({
  page,
}) => {
  const { card, requests } = await openQuestion(page, [asked(whole)])
  await card.getByRole('button', { name: 'Change answer', exact: true }).click()
  await card.getByRole('radio', { name: 'Drop them', exact: true }).check()
  requests.settle(QUESTION_ID, { note: 'Elsewhere' })
  const save = card.getByRole('button', { name: 'Save change', exact: true })
  await save.click()
  const reason = card.locator('.request-foot').getByRole('alert')
  await expect(reason).toContainText('your draft is kept')
  await expect(reason).toBeFocused()
  await expect(save).toBeDisabled()
  await expect(card.getByRole('radio', { name: 'Drop them', exact: true })).toBeChecked()
  await card.getByRole('button', { name: 'Check status', exact: true }).click()
  await expect(reason).toHaveCount(0)
  await expect(card.getByRole('radio', { name: 'Drop them', exact: true })).toBeChecked()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(card.locator('.request-state')).toBeFocused()
  expect(requests.writes.at(-1)?.body.expected_revision).toBe(4)
})

test('a task closed under the form is said as that, and the draft stays', async ({ page }) => {
  const { card, requests } = await openQuestion(page, [asked(whole)])
  await card.getByRole('button', { name: 'Change answer', exact: true }).click()
  await card.getByRole('radio', { name: 'Drop them', exact: true }).check()
  requests.refuseNext('[task_closed] the work item is closed; reopen it to change the answer')
  await card.getByRole('button', { name: 'Save change', exact: true }).click()
  await expect(card.locator('.request-foot').getByRole('alert')).toContainText('The task is closed')
  await expect(card.getByRole('radio', { name: 'Drop them', exact: true })).toBeChecked()
})
