/**
 * A press that stands still. Whatever rises under a pointer that has not moved must not
 * take the press meant for what was there before: declining a question lifts the next
 * one, and its controls arrive exactly where the person is pressing. These presses come
 * from a real mouse, because only a real press has a target decided at the moment it lands.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { centre } from './boardPage.ts'
import { mixedField, openQuestion, question, send } from './questionBackend.ts'
import { test } from './test.ts'

type Point = { x: number; y: number }

const UPPER = '44444444-4444-4444-8444-444444444441'
const LOWER = '44444444-4444-4444-8444-444444444442'

const choices = (count: number): InputRequestField => ({
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options: Array.from({ length: count }, (_, index) => ({
    id: `choice-${index + 1}`,
    label: `Choice ${index + 1}`,
  })),
})

const pair = (upper: number, lower: number) => [
  question({
    request_id: UPPER,
    prompt: 'The upper question',
    fields: [choices(upper)],
    created_at: '2026-10-24T11:00:00Z',
  }),
  question({
    request_id: LOWER,
    prompt: 'The lower question',
    fields: [choices(lower)],
    created_at: '2026-10-24T10:00:00Z',
  }),
]

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

const decline = (scope: Locator) => scope.getByRole('button', { name: "Don't answer", exact: true })

/** One press where the pointer is, down and up; the browser counts a second one as `clickCount`. */
async function press(page: Page, at: Point, clickCount = 1) {
  await page.mouse.move(at.x, at.y)
  await page.mouse.down({ clickCount })
  await page.mouse.up({ clickCount })
}

/** What a press at this point would land on: the question it is in, and the control. */
const under = (page: Page, at: Point) =>
  page.evaluate(({ x, y }) => {
    const control = document.elementFromPoint(x, y)?.closest('button, label')
    const prompt = control?.closest('.request-card')?.querySelector('.request-prompt')
    return `${prompt?.textContent?.trim()}: ${control?.textContent?.trim()}`
  }, at)

const LOWER_DECLINE = "The lower question: Don't answer"

/**
 * Brought into view by no more than it takes, as a person scrolls down to the foot of a
 * question. Below it the last of the card then rises to just where the pointer is.
 */
async function inReach(control: Locator) {
  await control.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'nearest' }))
  return centre(control)
}

/** Two questions in a card, with the mouse on the way out of the upper one. */
async function inCard(page: Page, upper = 5, lower = 2) {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const { card, requests } = await openQuestion(page, pair(upper, lower))
  const top = card.filter({ hasText: 'The upper question' })
  const next = card.filter({ hasText: 'The lower question' })
  return { at: await inReach(decline(top)), next, requests, top }
}

/** Declines the upper question by a press, and waits for the lower one to stand under it. */
async function riseUnder(page: Page, at: Point, top: Locator) {
  await press(page, at)
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toBe(LOWER_DECLINE)
}

const writesTo = (requests: { writes: { body: Record<string, unknown> }[] }) =>
  requests.writes.map((write) => write.body.id)

for (const [upper, lower] of [
  [5, 2],
  [6, 3],
] as const) {
  for (const gap of [180, 350]) {
    test(`a second press ${gap} ms on leaves alone what rose under it, ${upper} options over ${lower}`, async ({
      page,
    }) => {
      const { at, next, requests, top } = await inCard(page, upper, lower)
      await press(page, at)
      await Promise.all([pause(gap), expect(top.locator('.request-state')).toBeVisible()])
      await expect.poll(() => under(page, at)).toBe(LOWER_DECLINE)
      await press(page, at, 2)
      await pause(150)
      expect(writesTo(requests)).toEqual([UPPER])
      await expect(next.getByRole('radio')).toHaveCount(lower)
      // Nor did it take the keyboard away from how the upper question ended.
      await expect(top.locator('.request-state')).toBeFocused()
    })
  }
}

test('a slow write gives a second press no way through, past the double click interval', async ({
  page,
}) => {
  const { at, next, requests, top } = await inCard(page)
  requests.holdWrites(pause(900))
  await press(page, at)
  await pause(950)
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toBe(LOWER_DECLINE)
  await press(page, at)
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  await expect(next.getByRole('radio')).toHaveCount(2)
})

test('a press stays withheld however often it comes, until the pointer has moved more than 3 px', async ({
  page,
}) => {
  const { at, next, requests, top } = await inCard(page)
  await riseUnder(page, at, top)
  await press(page, at, 2)
  await press(page, at, 3)
  await press(page, { x: at.x + 3, y: at.y })
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  await press(page, { x: at.x + 4, y: at.y })
  await expect(next.locator('.request-state')).toContainText('You declined')
  expect(writesTo(requests)).toEqual([UPPER, LOWER])
})

test('a pointer gone and come back has moved', async ({ page }) => {
  const { at, next, requests, top } = await inCard(page)
  await riseUnder(page, at, top)
  await page.mouse.move(at.x + 40, at.y)
  await press(page, at)
  await expect(next.locator('.request-state')).toContainText('You declined')
  expect(writesTo(requests)).toEqual([UPPER, LOWER])
})

test('a second press on Send does not send what is held in the next question', async ({ page }) => {
  const { next, requests, top } = await inCard(page)
  await top.getByRole('radio', { name: 'Choice 2', exact: true }).click()
  await next.getByRole('radio', { name: 'Choice 1', exact: true }).click()
  await page.locator('.drawer-frame-body').evaluate((node) => node.scrollTo({ top: 0 }))
  const at = await inReach(send(top))
  await press(page, at)
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toBe('The lower question: Send')
  await press(page, at, 2)
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  await expect(next.getByRole('radio', { name: 'Choice 1', exact: true })).toBeChecked()
})

test('the wheel takes the guard off as moving does', async ({ page }) => {
  const { at, next, requests, top } = await inCard(page)
  await riseUnder(page, at, top)
  await page.mouse.wheel(0, 1)
  await press(page, at)
  await expect(next.locator('.request-state')).toContainText('You declined')
  expect(writesTo(requests)).toEqual([UPPER, LOWER])
})

test('the keyboard is not held back by a pointer standing still', async ({ page }) => {
  const { at, next, requests, top } = await inCard(page)
  await riseUnder(page, at, top)
  await decline(next).focus()
  await page.keyboard.press('Enter')
  await expect(next.locator('.request-state')).toContainText('You declined')
  expect(writesTo(requests)).toEqual([UPPER, LOWER])
})

test('a press repeated on the same control works as it always did', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const { card } = await openQuestion(page, [
    question({
      request_id: UPPER,
      prompt: 'Which of them',
      fields: [{ ...mixedField, type: 'multi_choice' }],
    }),
  ])
  await card.scrollIntoViewIfNeeded()
  const tick = card.locator('label').filter({ hasText: 'With nothing' })
  const box = card.getByRole('checkbox', { name: 'With nothing', exact: true })
  const atTick = await centre(tick)
  await press(page, atTick)
  await expect(box).toBeChecked()
  await press(page, atTick, 2)
  await expect(box).not.toBeChecked()
  const chevron = card.locator('button[aria-expanded]').first()
  const atChevron = await centre(chevron)
  await press(page, atChevron)
  await expect(chevron).toHaveAttribute('aria-expanded', 'true')
  await press(page, atChevron, 2)
  await expect(chevron).toHaveAttribute('aria-expanded', 'false')
  const own = card.getByRole('button', { name: 'Your own answer', exact: true })
  const atOwn = await centre(own)
  await press(page, atOwn)
  await expect(card.getByRole('textbox')).toBeFocused()
  await press(page, atOwn, 2)
  await expect(card.getByRole('textbox')).toHaveCount(0)
})

test('in the list of everything waiting a second press selects nothing of the next question', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const { drawer, requests } = await openQuestion(page, pair(6, 3))
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^Needs my answer/ }).click()
  const card = page
    .getByRole('dialog', { name: 'Needs my answer', exact: true })
    .locator('.request-card')
  const top = card.filter({ hasText: 'The upper question' })
  const next = card.filter({ hasText: 'The lower question' })
  const at = await inReach(decline(top))
  await press(page, at)
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toBe('The lower question: Choice 1')
  await press(page, at, 2)
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  await expect(next.getByRole('radio', { checked: true })).toHaveCount(0)
})
