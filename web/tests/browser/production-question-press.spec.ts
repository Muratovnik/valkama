/**
 * A press that stands still, on what can still do harm. Folding a question lifts the next
 * one, and its controls arrive exactly where the person is pressing: an option in it would
 * be chosen, and a Send over a choice it holds would send it. So the lower question holds a
 * choice here. What a press does to a question holding nothing is in the decline spec. These
 * presses come from a real mouse, because only a real press has a target decided at the
 * moment it lands.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { centre } from './boardPage.ts'
import { mixedField, openQuestion, question, send } from './questionBackend.ts'
import {
  decline,
  inCard,
  inReach,
  inTheList,
  LOWER,
  pair,
  pause,
  press,
  under,
  UPPER,
  writesTo,
} from './questionPress.ts'
import type { Point } from './questionPress.ts'
import { test } from './test.ts'

const LOWER_SEND = 'The lower question: Send'

const held = (scope: Locator) => scope.getByRole('radio', { name: 'Choice 1', exact: true })

/** The upper question asked whether to decline, the lower holding a choice, the mouse free. */
async function aboutToDecline(page: Page, upper = 6, lower = 2) {
  const scene = await inCard(page, upper, lower)
  await held(scene.next).click()
  await page.locator('.drawer-frame-body').evaluate((node) => node.scrollTo({ top: 0 }))
  await press(page, await inReach(decline(scene.top)))
  return { ...scene, at: await centre(decline(scene.top)) }
}

/** Declines the upper question by a press, and waits for the lower one to stand under it. */
async function riseUnder(page: Page, at: Point, top: Locator) {
  await press(page, at)
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toBe(LOWER_SEND)
}

for (const [upper, lower] of [
  [6, 2],
  [7, 3],
] as const) {
  for (const gap of [180, 350]) {
    test(`a second press ${gap} ms on leaves alone what rose under it, ${upper} options over ${lower}`, async ({
      page,
    }) => {
      const { at, next, requests, top } = await aboutToDecline(page, upper, lower)
      await press(page, at)
      await Promise.all([pause(gap), expect(top.locator('.request-state')).toBeVisible()])
      await expect.poll(() => under(page, at)).toBe(LOWER_SEND)
      await press(page, at, 2)
      await pause(150)
      expect(writesTo(requests)).toEqual([UPPER])
      await expect(next.getByRole('radio')).toHaveCount(lower + 1)
      // Nor did it take the keyboard away from how the upper question ended.
      await expect(top.locator('.request-state')).toBeFocused()
    })
  }
}

test('a slow write gives a second press no way through, past the double click interval', async ({
  page,
}) => {
  const { at, next, requests, top } = await aboutToDecline(page)
  requests.holdWrites(pause(900))
  await press(page, at)
  await pause(950)
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toBe(LOWER_SEND)
  await press(page, at)
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  await expect(held(next)).toBeChecked()
})

test('a press stays withheld however often it comes, until the pointer has moved more than 3 px', async ({
  page,
}) => {
  const { at, next, requests, top } = await aboutToDecline(page)
  await riseUnder(page, at, top)
  await press(page, at, 2)
  await press(page, at, 3)
  await press(page, { x: at.x + 3, y: at.y })
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  await press(page, { x: at.x + 4, y: at.y })
  await expect(next.locator('.request-state')).toContainText('You answered')
  expect(writesTo(requests)).toEqual([UPPER, LOWER])
})

test('a pointer gone and come back has moved', async ({ page }) => {
  const { at, next, requests, top } = await aboutToDecline(page)
  await riseUnder(page, at, top)
  await page.mouse.move(at.x + 40, at.y)
  await press(page, at)
  await expect(next.locator('.request-state')).toContainText('You answered')
  expect(writesTo(requests)).toEqual([UPPER, LOWER])
})

test('a second press on Send opens nothing and sends nothing, in this question or the next', async ({
  page,
}) => {
  const { next, requests, top } = await inCard(page)
  await top.getByRole('radio', { name: 'Choice 2', exact: true }).click()
  await held(next).click()
  await page.locator('.drawer-frame-body').evaluate((node) => node.scrollTo({ top: 0 }))
  const at = await inReach(send(top))
  await press(page, at)
  await expect(top.locator('.request-state')).toBeVisible()
  await press(page, at, 2)
  await pause(150)
  expect(writesTo(requests)).toEqual([UPPER])
  await expect(held(next)).toBeChecked()
  await expect(top.getByRole('radio')).toHaveCount(0)
})

test('the wheel takes the guard off as moving does', async ({ page }) => {
  const { at, next, requests, top } = await aboutToDecline(page)
  await riseUnder(page, at, top)
  await page.mouse.wheel(0, 1)
  await press(page, at)
  await expect(next.locator('.request-state')).toContainText('You answered')
  expect(writesTo(requests)).toEqual([UPPER, LOWER])
})

test('the keyboard is not held back by a pointer standing still', async ({ page }) => {
  const { at, next, requests, top } = await aboutToDecline(page)
  await riseUnder(page, at, top)
  // A press stopped just now says nothing about the key that comes after it.
  await press(page, at, 2)
  await send(next).focus()
  await page.keyboard.press('Enter')
  await expect(next.locator('.request-state')).toContainText('You answered')
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
  const own = card.getByRole('button', { name: 'Comment on the question', exact: true })
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
  const opened = await openQuestion(page, pair(6, 3))
  const { next, top } = await inTheList(page, opened)
  await press(page, await inReach(decline(top)))
  const at = await centre(decline(top))
  await press(page, at)
  await expect(top.locator('.request-state')).toBeVisible()
  await expect.poll(() => under(page, at)).toMatch(/^The lower question: Choice/u)
  await press(page, at, 2)
  await pause(150)
  expect(writesTo(opened.requests)).toEqual([UPPER])
  await expect(next.getByRole('radio', { checked: true })).toHaveCount(0)
})
