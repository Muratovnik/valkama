/**
 * The ring says where focus is when the keyboard or the app put it there. A press of the
 * pointer draws none, since the reader already knows what they pressed, and a field shows
 * that it holds focus by its own edge, the same for a press as for Tab.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { focusColour } from './editorPage.ts'
import { asked, openQuestion, question, routeField, send } from './questionBackend.ts'
import { inTheList, pair } from './questionPress.ts'
import { test } from './test.ts'

const outline = (target: Locator) => target.evaluate((node) => getComputedStyle(node).outlineStyle)
const edge = (target: Locator) => target.evaluate((node) => getComputedStyle(node).borderTopColor)

const focused = (page: Page) => page.locator('*:focus')

/** The comment field and the frame its editor draws around it. */
function composer(page: Page, drawer: Locator) {
  const named = { name: 'Comment', exact: true }
  return {
    comment: drawer.getByRole('textbox', named),
    frame: drawer.locator('.markdown-surface').filter({ has: page.getByRole('textbox', named) }),
  }
}

const answered = question({
  request_id: '66666666-6666-4666-8666-666666666661',
  prompt: 'Already answered',
  fields: [routeField],
  status: 'answered',
  answers: { route: 'keep' },
  answered_by: 'this client',
  by_person: true,
  resolved_at: '2026-10-24T10:30:00Z',
})

test('a press rings nothing it lands on: a button, how a question ended, its sheet, the comment field', async ({
  page,
}) => {
  const { card, drawer } = await openQuestion(page, [asked(), answered])
  const outcome = card.filter({ hasText: 'Already answered' }).locator('.request-state')
  const sheet = card.filter({ hasText: 'Where should the comments go?' })
  const { comment, frame } = composer(page, drawer)
  // Each takes focus from the press, so the absent ring is not an absent focus.
  const tab = drawer.getByRole('button', { name: 'Overview', exact: true })
  await tab.click()
  await expect(tab).toBeFocused()
  expect(await outline(tab)).toBe('none')
  await outcome.click()
  await expect(outcome).toBeFocused()
  expect(await outline(outcome)).toBe('none')
  await sheet.locator('.request-meta').click()
  await expect(sheet).toBeFocused()
  expect(await outline(sheet)).toBe('none')
  await comment.click()
  await expect(comment).toBeFocused()
  expect(await outline(frame)).toBe('none')
  expect(await edge(frame)).toBe(await focusColour(page))
})

test('the keyboard rings what it reaches, and a field answers it with its edge alone', async ({
  page,
}) => {
  const { drawer } = await openQuestion(page, [asked()])
  const { comment, frame } = composer(page, drawer)
  const resting = await edge(frame)
  await comment.click()
  // Off the frame, whose hover draws an edge of its own.
  await page.mouse.move(0, 0)
  await page.keyboard.press('Shift+Tab')
  await expect(comment).not.toBeFocused()
  await expect(focused(page)).toHaveJSProperty('tagName', 'BUTTON')
  expect(await outline(focused(page))).toBe('solid')
  expect(await edge(frame)).toBe(resting)
  await page.keyboard.press('Tab')
  await expect(comment).toBeFocused()
  expect(await outline(frame)).toBe('none')
  expect(await edge(frame)).toBe(await focusColour(page))
})

test('focus the app moves after a press is ringed, since it is the one sign of where it went', async ({
  page,
}) => {
  const { card } = await openQuestion(page, [asked()])
  await card.getByRole('radio', { name: 'Move them', exact: true }).click()
  await send(card).click()
  // The question folds under the pointer, and focus goes to how it ended.
  const outcome = card.locator('.request-state')
  await expect(outcome).toBeFocused()
  expect(await outline(outcome)).toBe('solid')
})

test('in the list a press on a heading rings nothing, and answering rings the next one', async ({
  page,
}) => {
  const opened = await openQuestion(page, pair(2, 2))
  const { next, top } = await inTheList(page, opened)
  const heading = top.locator('.request-title')
  await heading.click()
  await expect(heading).toBeFocused()
  expect(await outline(heading)).toBe('none')
  await top.getByRole('radio', { name: 'Choice 1', exact: true }).click()
  await send(top).click()
  const following = next.locator('.request-title')
  await expect(following).toBeFocused()
  expect(await outline(following)).toBe('solid')
})
