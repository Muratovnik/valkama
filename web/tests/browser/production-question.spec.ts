/**
 * A question in the discussion, answered with real input: the choice is only a choice
 * until Send, the answer folds under the question, and nothing typed is lost on the way.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { asRoot } from '../support/threads.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { now } from './planningFixtures.ts'
import {
  asked,
  openQuestion,
  question,
  QUESTION_ID,
  ROUTE_ASKED,
  routeField,
  send,
} from './questionBackend.ts'
import { test } from './test.ts'

const navCount = (page: Page) =>
  page.getByRole('button', { name: /^Needs my answer/ }).locator('.action-count')

test('a choice is only a choice until Send, then folds under the question and leaves the count', async ({
  page,
}) => {
  const { drawer, card, requests } = await openQuestion(page, [asked()])
  await expect(navCount(page)).toHaveText('1')
  const group = card.getByRole('radiogroup', { name: new RegExp(ROUTE_ASKED, 'u') })
  await expect(group.getByRole('radio')).toHaveCount(4)
  // Recommended or not, nothing is chosen for the person.
  await expect(group.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(card.locator('.request-option').first()).toContainText('recommended')
  await expect(card.locator('.request-option').first()).toContainText(
    'They stay where they are and nothing moves.',
  )

  const move = group.getByRole('radio', { name: 'Move them', exact: true })
  await move.check()
  await expect(move).toBeChecked()
  expect(requests.writes).toEqual([])

  await send(card).click()
  // Folded: the prompt, and under it the reply with who gave it and when.
  await expect(card.getByRole('radio')).toHaveCount(0)
  await expect(card).toContainText(ROUTE_ASKED)
  await expect(card.locator('.request-option.is-chosen')).toContainText('Move them')
  await expect(card.locator('.request-state')).toBeFocused()
  expect(requests.writes).toHaveLength(1)
  expect(requests.writes[0]?.action).toBe('answer')
  expect(requests.writes[0]?.body.answers).toEqual({ route: 'move' })
  expect(requests.writes[0]?.body).not.toHaveProperty('note')
  // Nothing waits here any more, in the card's facts or in the rail.
  await expect(drawer.getByRole('button', { name: 'Waiting for an answer' })).toHaveCount(0)
  await expect(navCount(page)).toHaveCount(0)
  // The old section is gone with its heading.
  await expect(page.getByRole('region', { name: 'Questions and decisions' })).toHaveCount(0)
})

test('the options are a radio group by the keyboard, and Tab reaches Send', async ({ page }) => {
  const { card, requests } = await openQuestion(page, [asked()])
  const group = card.getByRole('radiogroup')
  await expect(group).toHaveAccessibleName(new RegExp(ROUTE_ASKED, 'u'))
  const first = group.getByRole('radio').first()
  await first.focus()
  // Taking focus chooses nothing; only the arrows do.
  await expect(group.getByRole('radio', { checked: true })).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await expect(group.getByRole('radio', { name: 'Move them', exact: true })).toBeChecked()
  expect(requests.writes).toEqual([])
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: /^Comment on this field/u })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    card.getByRole('button', { name: 'Comment on the question', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: "Don't answer", exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(send(card)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(card.locator('.request-state')).toBeFocused()
  expect(requests.writes[0]?.body.answers).toEqual({ route: 'move' })
})

test('a pending question stands under the form however old, a closed one takes its place by time', async ({
  page,
}) => {
  const closedId = '66666666-6666-4666-8666-666666666666'
  const { drawer, backend } = await openQuestion(page, [
    asked({ created_at: '2020-01-01T10:00:00Z' }),
    question({
      request_id: closedId,
      prompt: 'An old one',
      fields: [routeField],
      status: 'declined',
      answered_by: 'user',
      by_person: true,
      resolved_at: '2020-01-03T10:00:00Z',
      created_at: '2020-01-02T10:00:00Z',
    }),
  ])
  await expect(drawer.locator('.thread > li')).toHaveCount(2)
  backend.item.comments.push(
    {
      id: 901,
      author: 'user',
      at: now,
      kind: 'comment',
      ...asRoot,
      report: null,
      body: 'A fresh comment',
    },
    {
      id: 902,
      author: 'user',
      at: '2019-01-01T10:00:00Z',
      kind: 'comment',
      ...asRoot,
      report: null,
      body: 'An older comment',
    },
  )
  await drawer.locator('.discussion-form').getByRole('textbox').fill('News')
  await drawer.getByRole('button', { name: 'Add note', exact: true }).click()
  await expect(drawer.locator('.thread > li')).toHaveCount(5)
  const rows = await drawer.locator('.thread > li').allInnerTexts()
  expect(rows[0]).toContain(ROUTE_ASKED)
  expect(rows[1]).toContain('A fresh comment')
  expect(rows[2]).toContain('News')
  expect(rows[3]).toContain('An old one')
  expect(rows[4]).toContain('An older comment')
})

test('several fields go through one form, and a refused one takes focus', async ({ page }) => {
  const { card, requests } = await openQuestion(page, [
    asked({
      fields: [
        { id: 'go', label: 'Go ahead', type: 'boolean', required: true, options: [] },
        {
          id: 'parts',
          label: 'Which parts',
          type: 'multi_choice',
          required: false,
          options: [
            { id: 'one', label: 'Part one' },
            { id: 'two', label: 'Part two', description: 'The bigger one.' },
          ],
        },
        { id: 'why', label: 'Why', type: 'text', required: true, options: [] },
      ],
    }),
  ])
  await send(card).click()
  await expect(card.getByRole('radio', { name: 'Yes', exact: true })).toBeFocused()
  expect(requests.writes).toEqual([])
  await card.getByRole('radio', { name: 'No', exact: true }).check()
  await card.getByRole('checkbox', { name: 'Part two', exact: true }).check()
  await send(card).click()
  const why = card.getByRole('textbox', { name: /^Why/u })
  await expect(why).toBeFocused()
  await why.pressSequentially('Because')
  await send(card).click()
  await expect(card.getByRole('radio')).toHaveCount(0)
  expect(requests.writes[0]?.body.answers).toEqual({ go: false, parts: ['two'], why: 'Because' })
  const reply = card.locator('.request-reply')
  await expect(reply).toContainText('Go ahead')
  await expect(reply).toContainText('No')
  await expect(reply).toContainText('Part two')
  await expect(reply).toContainText('Because')
})

test('a comment on the question opens under the options and answers nothing', async ({ page }) => {
  const { card, requests } = await openQuestion(page, [asked()])
  const own = card.getByRole('button', { name: 'Comment on the question', exact: true })
  await expect(own).toHaveAttribute('aria-expanded', 'false')
  await own.click()
  await expect(own).toHaveAttribute('aria-expanded', 'true')
  const field = card.getByRole('textbox', { name: 'Comment on the question', exact: true })
  await expect(field).toBeFocused()
  await page.keyboard.insertText('Neither: *ask* me later')
  await send(card).click()
  expect(requests.writes).toEqual([])
  await expect(card.getByText('Choose one of the options.', { exact: true })).toBeVisible()
  await card.getByRole('radio', { name: 'Move them', exact: true }).check()
  await send(card).click()
  await expect(card.getByRole('radio')).toHaveCount(0)
  expect(requests.writes[0]?.body.answers).toEqual({ route: 'move' })
  expect(requests.writes[0]?.body.note).toBe('Neither: *ask* me later')
  // Drawn as the markdown it is.
  await expect(card.locator('.request-reply em')).toHaveText('ask')
})

test('an empty comment closes again, and one with text in it never hides it', async ({ page }) => {
  const { card } = await openQuestion(page, [asked()])
  const own = card.getByRole('button', { name: 'Comment on the question', exact: true })
  const field = card.getByRole('textbox', { name: 'Comment on the question', exact: true })
  await own.click()
  await own.click()
  await expect(field).toHaveCount(0)
  await own.click()
  await page.keyboard.insertText('Something')
  await own.click()
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('Something')
})

test('declining is the quiet way out, and an expired question folds the same way', async ({
  page,
}) => {
  const otherId = '77777777-7777-4777-8777-777777777777'
  const { card, requests } = await openQuestion(page, [
    asked({ created_at: '2026-10-24T11:00:00Z' }),
    question({
      request_id: otherId,
      prompt: 'Too late for this',
      fields: [routeField],
      status: 'expired',
      expired_reason: 'deadline',
      expires_at: '2026-10-24T09:30:00Z',
      resolved_at: '2026-10-24T09:30:00Z',
      created_at: '2026-10-24T09:00:00Z',
    }),
  ])
  const pending = card.filter({ hasText: ROUTE_ASKED })
  // The first press only asks, and the same words stand on the way on.
  await pending.getByRole('button', { name: "Don't answer", exact: true }).click()
  await expect(pending.getByRole('radio')).toHaveCount(4)
  expect(requests.writes).toEqual([])
  await pending.getByRole('button', { name: "Don't answer", exact: true }).click()
  await expect(pending.locator('.request-state')).toContainText('You declined')
  await expect(pending.getByRole('radio')).toHaveCount(0)
  expect(requests.writes[0]?.action).toBe('decline')
  const expired = card.filter({ hasText: 'Too late for this' })
  await expect(expired.locator('.request-state')).toContainText('Closed')
  await expect(expired.getByRole('radio')).toHaveCount(0)
  await expect(expired.getByRole('button')).toHaveCount(0)
})

for (const failure of [503, 'abort'] as const) {
  test(`a send that fails with ${failure} keeps everything and does not look sent`, async ({
    page,
  }) => {
    const { drawer, card, requests } = await openQuestion(page, [asked()])
    await card.getByRole('radio', { name: 'Move them', exact: true }).check()
    await card.getByRole('button', { name: 'Comment on the question', exact: true }).click()
    await page.keyboard.insertText('And quickly')
    requests.failNext(failure)
    await send(card).click()
    const reason = card.locator('.request-foot').getByRole('alert')
    await expect(reason).toContainText('could not be confirmed')
    await expect(reason).toBeFocused()
    await expect(card.getByRole('radio', { name: 'Move them', exact: true })).toBeChecked()
    await expect(
      card.getByRole('textbox', { name: 'Comment on the question', exact: true }),
    ).toHaveValue('And quickly')
    await expect(card.locator('.request-state')).toHaveCount(0)
    await expect(navCount(page)).toHaveText('1')
    await expect(drawer.getByRole('button', { name: 'Waiting for an answer' })).toBeVisible()
  })
}

test('a held selection or note is a draft the guard asks about', async ({ page }) => {
  const { drawer, card } = await openQuestion(page, [asked()])
  const close = drawer.getByRole('button', { name: 'Close', exact: true })
  await card.getByRole('radio', { name: 'Move them', exact: true }).check()
  await close.click()
  const band = drawer.getByText(/answer/iu).first()
  await expect(band).toBeVisible()
  await drawer.getByRole('button', { name: /keep/iu }).click()
  await expect(card.getByRole('radio', { name: 'Move them', exact: true })).toBeChecked()
  await close.click()
  await drawer.getByRole('button', { name: /discard/iu }).click()
  await expect(drawer).toHaveCount(0)
})

test('an answer from another window folds it and keeps the note without pretending it went', async ({
  page,
}) => {
  const { drawer, card, requests, stream } = await openQuestion(page, [asked()])
  await card.getByRole('button', { name: 'Comment on the question', exact: true }).click()
  await page.keyboard.insertText('What I was writing')
  requests.settle(QUESTION_ID, {
    status: 'answered',
    answers: { route: 'keep' },
    answered_by: 'claude',
    by_person: false,
    resolved_at: '2026-10-24T10:30:00Z',
  })
  await stream.signal('agents')
  await expect(card.getByRole('radio')).toHaveCount(0)
  const reply = card.locator('.request-reply')
  // The field the person was writing in has gone; the keyboard stays on the question.
  await expect(card.locator('.request-state')).toBeFocused()
  await expect(reply.locator('.request-option.is-chosen')).toContainText('Keep the comments')
  await expect(reply).toContainText('claude')
  await expect(reply).not.toContainText('What I was writing')
  const unsent = card.locator('.request-unsent')
  await expect(unsent).toContainText('Not sent')
  await expect(unsent).toContainText('What I was writing')
  expect(requests.writes).toEqual([])
  // It is still the only copy, so leaving still asks.
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer.getByRole('button', { name: /discard/iu })).toBeVisible()
})

for (const [width, height] of [
  [1680, 1050],
  [1024, 768],
  [390, 844],
] as const) {
  test(`the mark in the facts brings the question into view at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const { drawer, card, backend } = await openQuestion(page, [asked()])
    backend.item.description = Array.from(
      { length: 60 },
      (_, index) => `Paragraph ${index} of a description long enough to push the rest away.`,
    ).join('\n\n')
    await drawer.locator('.discussion-form').getByRole('textbox').fill('')
    const mark = drawer.getByRole('button', { name: 'Waiting for an answer', exact: true })
    await expect(mark).toBeVisible()
    await mark.click()
    await expect(card.getByRole('radio').first()).toBeFocused()
    // Not under the tabs and not under the fold, by its first line.
    const tabs = await drawer.locator('.inspector-tabs').boundingBox()
    await expect
      .poll(async () => {
        const bounds = await card.boundingBox()
        return bounds?.y ?? -1
      })
      .toBeGreaterThanOrEqual(Math.floor((tabs?.y ?? 0) + (tabs?.height ?? 0)))
    const first = await card.getByRole('radio').first().boundingBox()
    expect((first?.y ?? height) + (first?.height ?? 0)).toBeLessThanOrEqual(height)
    await expectNoSilentClipping(page, `Question at ${width}px`)
  })
}

test('the mark brings the question back from another section', async ({ page }) => {
  const { drawer, card } = await openQuestion(page, [asked()])
  await drawer
    .locator('.inspector-tabs')
    .getByRole('button', { name: 'Relations', exact: true })
    .click()
  await expect(card).toBeHidden()
  await drawer.getByRole('button', { name: 'Waiting for an answer', exact: true }).click()
  await expect(card.getByRole('radio').first()).toBeFocused()
  await expect(card).toBeInViewport()
})

test('the hub shows the same widget, and an answer there reaches the card', async ({ page }) => {
  const { drawer, card } = await openQuestion(page, [asked()])
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: /^Needs my answer/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  const hubCard = dialog.locator('.request-card')
  await expect(hubCard.getByRole('radiogroup')).toHaveAccessibleName(new RegExp(ROUTE_ASKED, 'u'))
  await hubCard.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
  await send(hubCard).click()
  await expect(hubCard.locator('.request-option.is-chosen')).toContainText('Keep the comments')
  await expect(navCount(page)).toHaveCount(0)
  await hubCard.getByRole('button', { name: 'Open task', exact: true }).click()
  await expect(card.locator('.request-option.is-chosen')).toContainText('Keep the comments')
})

test('a question long unanswered at phone width is not clipped, open or folded', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { card } = await openQuestion(page, [
    asked({
      prompt: `${'A prompt long enough to wrap, several times over. '.repeat(6)}`,
      fields: [
        {
          ...routeField,
          options: routeField.options.map((option) => ({
            ...option,
            label: `${option.label} and a label that runs well past the width of a phone`,
          })),
        },
      ],
    }),
  ])
  await card.getByRole('button', { name: 'Comment on the question', exact: true }).click()
  await expectNoSilentClipping(page, 'Question open at 390px')
  await card.getByRole('radio').first().check()
  await send(card).click()
  await expect(card.locator('.request-state')).toBeVisible()
  await expectNoSilentClipping(page, 'Question folded at 390px')
})

test('a long unbroken task title does not push the hub’s card out of a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { drawer } = await openQuestion(page, [
    asked({ title: 'loading/empty/error/unavailable/permission-denied/and/on/and/on/again' }),
  ])
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: /^Needs my answer/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  await expect(send(dialog)).toBeInViewport({ ratio: 1 })
  await expectNoSilentClipping(page, 'The hub at 390px')
})
