/**
 * Where an action that waits on the server lands focus, when the person has moved on before it
 * answered. A reply sent, then a click into the comment field while the write was out: the
 * answer took focus to the new reply, and the letters typed after it went nowhere. Focus moved
 * by the person since the action began stays where they put it; with nothing moved, the
 * landing is where it always was.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { asked, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

const doNothing = () => {}

/** Two frames after the last change, for whatever the answer moves to have moved. */
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  )

/** The card with its discussion, every write of it held until the test lets it go. */
async function heldThread(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const opened = await openCard(page)
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  const thread = opened.drawer
    .locator('.thread-entry')
    .filter({ hasText: 'Should the second report' })
  await expect(thread).toBeVisible()
  let letGo = doNothing
  const released = new Promise<void>((resolve) => (letGo = resolve))
  await page.route('**/api/planning/work-item/**', async (route) => {
    if (route.request().method() !== 'GET') await released
    await route.fallback()
  })
  return { comment: opened.comment, letGo, thread }
}

/** A reply to the thread sent with the mouse, its write held. */
async function sendReply(thread: Locator) {
  await thread.getByRole('button', { name: 'Reply', exact: true }).first().click()
  await thread.getByRole('textbox', { name: 'Your reply' }).fill('Beside it, then.')
  await thread.getByRole('button', { name: 'Send', exact: true }).click()
  return thread.locator('.reply').filter({ hasText: 'Beside it, then.' })
}

test('a click into the comment field while a reply is sent keeps focus and the letters there', async ({
  page,
}) => {
  const { comment, letGo, thread } = await heldThread(page)
  const written = await sendReply(thread)
  await comment.click()
  await page.keyboard.type('one two ')
  letGo()
  await expect(written).toBeVisible()
  await expect(thread.getByRole('textbox', { name: 'Your reply' })).toHaveCount(0)
  await settled(page)
  await expect(comment).toBeFocused()
  await page.keyboard.type('three')
  await expect(comment).toHaveValue('one two three')
})

test('with nothing moved while a reply is sent, focus lands on the reply', async ({ page }) => {
  const { letGo, thread } = await heldThread(page)
  const written = await sendReply(thread)
  letGo()
  await expect(written).toBeFocused()
})

/** A question on the card answered with the mouse, the answer held until `answer` is called. */
async function heldAnswer(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { card, comment, requests } = await openQuestion(page, [asked()])
  let answer = doNothing
  requests.holdWrites(new Promise<void>((done) => (answer = done)))
  await card.getByRole('radio', { name: 'Move them', exact: true }).click()
  await send(card).click()
  await expect(send(card)).toHaveAttribute('aria-disabled', 'true')
  return { answer: () => answer(), card, comment }
}

test('a click into the comment field while a question is answered keeps focus there', async ({
  page,
}) => {
  const { answer, card, comment } = await heldAnswer(page)
  await comment.click()
  await page.keyboard.type('one two ')
  answer()
  await expect(card.locator('.request-state')).toBeVisible()
  await settled(page)
  await expect(comment).toBeFocused()
  await page.keyboard.type('three')
  await expect(comment).toHaveValue('one two three')
})

test('with nothing moved while a question is answered, focus lands on the question', async ({
  page,
}) => {
  const { answer, card } = await heldAnswer(page)
  answer()
  await expect(card.locator('.request-state')).toBeVisible()
  await expect(card).toBeFocused()
})
