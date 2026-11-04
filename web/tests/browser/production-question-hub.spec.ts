/**
 * The list of everything waiting reads only what still waits, so a question answered in
 * another window leaves its next read. One this window holds something in — a choice, a
 * word, the keyboard — stays where it was and says how it ended, with what was written
 * under it, until the person removes it; one nobody touched goes as it did.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

import { asked, openQuestion, question, routeField, send } from './questionBackend.ts'
import { test } from './test.ts'

const TOUCHED = '77777777-7777-4777-8777-777777777771'
const UNTOUCHED = '77777777-7777-4777-8777-777777777772'
const NEIGHBOUR = '77777777-7777-4777-8777-777777777773'
/** What the other window sent: the person, in another tab. */
const answeredThere: Partial<InputRequestEntry['request']> = {
  status: 'answered',
  answers: { route: 'move' },
  own: {},
  field_notes: {},
  answer_version: 1,
  answered_by: 'user',
  by_person: true,
  resolved_at: '2026-10-24T10:30:00Z',
}
const WRITTEN = 'Keep them, but say why in the commit.'
const POLL = 30_000

const listed = (id: string, prompt: string, created: string) =>
  asked({ request_id: id, prompt, created_at: created })

/** The list open over the board, with the clock under the test's hand from the first load. */
async function openList(page: Page, entries: InputRequestEntry[]) {
  await page.clock.install()
  const opened = await openQuestion(page, entries)
  await page.keyboard.press('Escape')
  await expect(opened.drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^Needs my answer/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Needs my answer', exact: true })
  const card = (prompt: string) => dialog.locator('.request-card').filter({ hasText: prompt })
  return { ...opened, dialog, card }
}

const activeTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? '')

test('a question answered elsewhere while this window wrote in it stays, saying how it ended', async ({
  page,
}) => {
  const { card, dialog, requests } = await openList(page, [
    listed(TOUCHED, 'The touched question', '2026-10-24T10:02:00Z'),
    listed(UNTOUCHED, 'The untouched question', '2026-10-24T10:01:00Z'),
  ])
  const touched = card('The touched question')
  await touched.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
  await touched.getByRole('button', { name: 'Comment on the question', exact: true }).click()
  const note = touched.getByRole('textbox', { name: 'Comment on the question', exact: true })
  await note.fill(WRITTEN)
  await expect(note).toBeFocused()

  requests.settle(TOUCHED, answeredThere)
  requests.settle(UNTOUCHED, answeredThere)
  await page.clock.runFor(POLL)

  // The one nobody touched leaves, as a question that stopped waiting does.
  await expect(card('The untouched question')).toHaveCount(0)
  // The touched one is still there, folded to what the other window said, with the words.
  await expect(touched).toHaveCount(1)
  await expect(touched.locator('.request-state')).toContainText('You answered')
  await expect(touched.locator('.request-option.is-chosen')).toContainText('Move them')
  await expect(touched.locator('.request-unsent')).toContainText(
    'Not sent. This is what you had written:',
  )
  await expect(touched.locator('.request-unsent')).toContainText(WRITTEN)
  // Focus went with the form to how it ended, never to the page.
  await expect(touched.locator('.request-state')).toBeFocused()
  expect(await activeTag(page)).not.toBe('BODY')
  // Nothing waits any more, and the list says so above the question it kept.
  await expect(dialog.locator('.request-status')).toHaveText('No questions need your answer.')
  // It stays across the next read too, until the person removes it.
  await page.clock.runFor(POLL)
  await expect(touched).toHaveCount(1)
})

test('a send refused because the question closed keeps the promise that the draft is kept', async ({
  page,
}) => {
  const { card, requests } = await openList(page, [
    listed(TOUCHED, 'The touched question', '2026-10-24T10:02:00Z'),
  ])
  const touched = card('The touched question')
  await touched.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
  await touched.getByRole('button', { name: 'Comment on the question', exact: true }).click()
  await touched.getByRole('textbox', { name: 'Comment on the question', exact: true }).fill(WRITTEN)
  requests.settle(TOUCHED, answeredThere)
  await send(touched).click()
  await expect(touched.getByRole('alert')).toHaveText(
    'This request changed or closed. Check its status; your draft is kept.',
  )
  await page.clock.runFor(POLL)
  await expect(touched).toHaveCount(1)
  await expect(touched.locator('.request-state')).toContainText('You answered')
  await expect(touched.locator('.request-unsent')).toContainText(WRITTEN)
  await expect(touched.locator('.request-state')).toBeFocused()
})

test('a question the keyboard is in stays when answered elsewhere, even with nothing written', async ({
  page,
}) => {
  const { card, requests } = await openList(page, [
    listed(TOUCHED, 'The touched question', '2026-10-24T10:02:00Z'),
  ])
  const touched = card('The touched question')
  await touched.getByRole('button', { name: 'Comment on the question', exact: true }).focus()
  requests.settle(TOUCHED, answeredThere)
  await page.clock.runFor(POLL)
  await expect(touched.locator('.request-state')).toBeFocused()
  await expect(touched.locator('.request-unsent')).toHaveCount(0)
})

test('removing a question that stopped waiting takes focus to its neighbour, or to the list', async ({
  page,
}) => {
  const { card, dialog, requests } = await openList(page, [
    listed(TOUCHED, 'The touched question', '2026-10-24T10:02:00Z'),
    question({
      request_id: NEIGHBOUR,
      prompt: 'The neighbour',
      fields: [routeField],
      created_at: '2026-10-24T10:01:00Z',
    }),
  ])
  const touched = card('The touched question')
  await touched.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
  requests.settle(TOUCHED, answeredThere)
  await page.clock.runFor(POLL)
  const remove = touched.getByRole('button', { name: 'Remove from list', exact: true })
  await remove.click()
  await expect(touched).toHaveCount(0)
  await expect(card('The neighbour').locator('.request-title')).toBeFocused()
  // Removed for good: the next read does not bring it back.
  await page.clock.runFor(POLL)
  await expect(touched).toHaveCount(0)

  // The last one goes too: focus stays in the list, on the way to read it again.
  const neighbour = card('The neighbour')
  await neighbour.getByRole('radio', { name: 'Drop them', exact: true }).check()
  await send(neighbour).click()
  await neighbour.getByRole('button', { name: 'Remove from list', exact: true }).click()
  await expect(dialog.locator('.request-card')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeFocused()
})
