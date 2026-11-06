/**
 * How long the step of declining stands: only while the person's attention is on its question
 * and its buttons stand where the press left them. A step left standing turns a place on the
 * page into one that declines for good, and a question folding above can bring that place
 * under a pointer aimed at something else. These presses come from a real mouse.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { centre } from './boardPage.ts'
import { openQuestion, question, send } from './questionBackend.ts'
import {
  answeredElsewhere,
  asked,
  closedElsewhere,
  decline,
  inCard,
  inMiddle,
  inReach,
  inTheList,
  LOWER,
  pair,
  pause,
  press,
  THIRD,
  threeInCard,
  under,
  UPPER,
  writesTo,
} from './questionPress.ts'
import type { Point } from './questionPress.ts'
import { test } from './test.ts'

const asking = (scope: Locator | Page) => scope.locator('.request-asked')
const onward = (scope: Locator) => scope.locator('.request-onward')
const wayOut = (scope: Locator) => scope.locator('.request-way-out')

async function raise(page: Page, card: Locator) {
  await press(page, await inMiddle(decline(card)))
  await expect(asking(card)).toBeVisible()
}

async function choose(page: Page, card: Locator) {
  await press(page, await inMiddle(card.getByText('Choice 1', { exact: true })))
  await expect(card.getByRole('radio', { name: 'Choice 1' })).toBeChecked()
}

/** Whether the point lies in this question's way on, whichever word it bears by then. */
async function onWayOn(card: Locator, at: Point) {
  const box = await onward(card).boundingBox()
  return (
    box !== null &&
    at.x > box.x &&
    at.x < box.x + box.width &&
    at.y > box.y &&
    at.y < box.y + box.height
  )
}

/** The first question ends elsewhere, and the third comes to stand at this point. */
async function folds(page: Page, at: Point, opened: Awaited<ReturnType<typeof threeInCard>>) {
  opened.requests.settle(UPPER, closedElsewhere)
  await opened.stream.signal('agents')
  await expect.poll(() => under(page, at)).toMatch(/^The third question: /u)
}

// On a phone 844px tall the browser's scroll anchoring holds everything below still as the
// first question folds: nothing rises, so there is no press to guard. A taller phone puts the
// question itself at the top, and what is under it rises.
for (const [width, height, options] of [
  [1680, 1050, 5],
  [390, 932, 6],
] as const) {
  test(`at ${width} a question folding brings no refusal under a pointer aimed at Send in another`, async ({
    page,
  }) => {
    const opened = await threeInCard(page, options, width, height)
    const { requests, second, third } = opened
    await raise(page, third)
    await choose(page, second)
    const at = await inMiddle(send(second))
    await page.mouse.move(at.x, at.y)
    await folds(page, at, opened)
    expect(await onWayOn(third, at)).toBe(true)
    // The step is down before the press: what stands there now only sends, and sends nothing.
    await expect.poll(() => under(page, at)).toBe('The third question: Send')
    await press(page, at)
    await pause(200)
    expect(writesTo(requests)).toEqual([])
    await expect(asking(page)).toHaveCount(0)
    await expect(second.getByRole('radio', { name: 'Choice 1' })).toBeChecked()
  })
}

test('in the list of everything waiting a row ending brings no refusal under the pointer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  // A long row below keeps the list at its full height, so the row below rises by all it can.
  // The two rows are as tall as each other, so the lower one's Send comes to stand exactly
  // where the upper one's stood: with a second option above, it stopped one row short, and
  // only the dialog scrolling inside itself, which it no longer does, brought it back.
  const opened = await openQuestion(page, [...pair(1, 1), asked(THIRD, 'A long question', 12, 9)])
  const { dialog, next, top } = await inTheList(page, opened)
  await raise(page, next)
  // A press outside both ends the step and leaves nothing in the upper row, which is what
  // lets it leave the list: a row with a choice or the keyboard in it stays (below).
  await press(page, await inMiddle(dialog.locator('.request-status')))
  await expect(asking(next)).toHaveCount(0)
  const at = await inMiddle(send(top))
  await page.mouse.move(at.x, at.y)
  opened.requests.settle(UPPER, closedElsewhere)
  // The list reads again on its timer and whenever the window comes back to the front.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => onWayOn(next, at)).toBe(true)
  await expect.poll(() => under(page, at)).toBe('The lower question: Send')
  await press(page, at)
  await pause(200)
  expect(writesTo(opened.requests)).toEqual([])
  await expect(asking(page)).toHaveCount(0)
})

test('in the list a row kept because something was chosen in it folds, and lifts no refusal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const opened = await openQuestion(page, [...pair(1, 1), asked(THIRD, 'A long question', 12, 9)])
  const { next, top } = await inTheList(page, opened)
  await raise(page, next)
  await choose(page, top)
  const at = await inMiddle(send(top))
  await page.mouse.move(at.x, at.y)
  opened.requests.settle(UPPER, closedElsewhere)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(top.locator('.request-state')).toBeVisible()
  await press(page, at)
  await pause(200)
  expect(writesTo(opened.requests)).toEqual([])
  await expect(asking(page)).toHaveCount(0)
})

test('the same with no press between: a pointer that only went elsewhere finds no refusal when the question moves', async ({
  page,
}) => {
  const opened = await threeInCard(page, 5)
  const { requests, second, third } = opened
  await choose(page, second)
  const at = await inMiddle(send(second))
  // In view together, so that nothing has to scroll between the step and the pointer leaving.
  await press(page, await centre(decline(third)))
  await expect(asking(third)).toBeVisible()
  await page.mouse.move(at.x, at.y)
  await folds(page, at, opened)
  expect(await onWayOn(third, at)).toBe(true)
  await expect.poll(() => under(page, at)).toBe('The third question: Send')
  await press(page, at)
  await pause(200)
  expect(writesTo(requests)).toEqual([])
  await expect(asking(page)).toHaveCount(0)
})

test('a pointer resting on the confirm of a question that moves finds no refusal either', async ({
  page,
}) => {
  const opened = await threeInCard(page, 5)
  const { requests, second } = opened
  await raise(page, second)
  const at = await centre(onward(second))
  await page.mouse.move(at.x, at.y)
  await folds(page, at, opened)
  await expect(asking(page)).toHaveCount(0)
  await press(page, at)
  await pause(200)
  expect(writesTo(requests)).toEqual([])
})

/**
 * Holds back the page's own frames: what it asks of `requestAnimationFrame` waits until
 * `release`, while the browser still lays out and hit-tests. A press sent meanwhile lands
 * after the page changed and before any check made on a frame has seen it, which is the
 * moment a person cannot aim at but a slow frame or a busy page stretches.
 */
async function holdFrames(page: Page) {
  await page.evaluate(() => {
    const native = window.requestAnimationFrame.bind(window)
    const held: FrameRequestCallback[] = []
    window.requestAnimationFrame = (callback) => {
      held.push(callback)
      return 0
    }
    Object.assign(window, {
      heldFrames: () => held.length,
      releaseFrames: () => {
        window.requestAnimationFrame = native
        for (const callback of held.splice(0)) native(callback)
      },
    })
  })
  // The frame asked for before the hold comes once more; after it nothing runs until release.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heldFrames(): number }).heldFrames()))
    .toBeGreaterThan(0)
  return () => page.evaluate(() => (window as unknown as { releaseFrames(): void }).releaseFrames())
}

/** The step stands on the second question, which holds a choice, so Send there would answer. */
async function chosenAndAsked(page: Page) {
  const opened = await threeInCard(page, 6)
  await choose(page, opened.second)
  await raise(page, opened.second)
  return { ...opened, release: await holdFrames(page) }
}

test('a press on the confirm in the instant its question moved, before any frame, writes nothing', async ({
  page,
}) => {
  const { first, release, requests, second, stream } = await chosenAndAsked(page)
  requests.settle(UPPER, answeredElsewhere)
  await stream.signal('agents')
  await expect(first.locator('.request-state')).toBeVisible()
  // The fold is laid out, and the step has not yet been measured against it.
  await expect(asking(second)).toBeVisible()
  const at = await centre(onward(second))
  await expect.poll(() => under(page, at)).toBe("The second question: Don't answer")
  await press(page, at)
  await pause(200)
  expect(requests.writes.map((write) => write.action)).toEqual([])
  await expect(asking(page)).toHaveCount(0)
  await release()
  await pause(100)
  expect(writesTo(requests)).toEqual([])
  await expect(second.getByRole('radio', { name: 'Choice 1' })).toBeChecked()
})

test('with the same frames held back, a confirm whose question stayed put declines', async ({
  page,
}) => {
  const { release, requests, second } = await chosenAndAsked(page)
  await press(page, await centre(onward(second)))
  await expect(second.locator('.request-state')).toContainText('You declined')
  expect(writesTo(requests)).toEqual([LOWER])
  expect(requests.writes[0]?.action).toBe('decline')
  await release()
})

test('a press anywhere outside its question ends the step, and only there', async ({ page }) => {
  const { requests, top, next } = await inCard(page)
  await raise(page, top)
  // On its own words, which is still its question, and focus falls on the question itself.
  await press(page, await centre(top.locator('.request-prompt')))
  await expect(asking(top)).toBeVisible()
  await press(page, await centre(next.locator('.request-prompt')))
  await expect(asking(top)).toHaveCount(0)
  await expect(decline(top)).toBeVisible()
  expect(writesTo(requests)).toEqual([])
})

test('a press outside that reaches nothing ends the step as well', async ({ page }) => {
  const { requests, second, stream, third } = await threeInCard(page, 3)
  const at = await inMiddle(third.getByText('Choice 1', { exact: true }))
  await press(page, at)
  await decline(second).focus()
  await page.keyboard.press('Enter')
  await expect(asking(second)).toBeVisible()
  // What the last press landed on is gone from under the pointer, so this one is held back,
  // and focus stays where it was.
  requests.settle(THIRD, answeredElsewhere)
  await stream.signal('agents')
  await expect(third.locator('.request-state')).toBeVisible()
  await expect(wayOut(second)).toBeFocused()
  await expect(asking(second)).toBeVisible()
  await press(page, at)
  await expect(wayOut(second)).toBeFocused()
  await expect(asking(second)).toHaveCount(0)
  expect(writesTo(requests)).toEqual([])
})

test('the page holds one step at most', async ({ page }) => {
  const { drawer, next, requests, top } = await inCard(page)
  await raise(page, top)
  await raise(page, next)
  await expect(asking(drawer)).toHaveCount(1)
  await expect(asking(next)).toBeVisible()
  await expect(decline(top)).toBeVisible()
  expect(writesTo(requests)).toEqual([])
})

test('focus leaving its question ends the step, and focus moving inside it does not', async ({
  page,
}) => {
  const { next, requests, top } = await inCard(page)
  // The next question in view too, so that going there by Tab scrolls nothing.
  await inMiddle(decline(top))
  await expect(next.getByRole('radio').first()).toBeInViewport({ ratio: 1 })
  await decline(top).focus()
  await page.keyboard.press('Enter')
  await expect(asking(top)).toBeVisible()
  await expect(wayOut(top)).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(asking(top)).toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(onward(top)).toBeFocused()
  await expect(asking(top)).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(asking(top)).toHaveCount(0)
  // The way out of a question is the next one, whose head comes first.
  await expect(page.locator(':focus')).toHaveAccessibleName('Reply')
  await page.keyboard.press('Tab')
  await expect(next.getByRole('radio').first()).toBeFocused()
  expect(writesTo(requests)).toEqual([])
})

test('scrolling the question away ends the step, and a read that moves nothing does not', async ({
  page,
}) => {
  const { requests, stream, top } = await inCard(page)
  await raise(page, top)
  await stream.signal('agents')
  await pause(150)
  await expect(asking(top)).toBeVisible()
  await expect(wayOut(top)).toBeFocused()
  await page.mouse.wheel(0, -60)
  await expect(asking(top)).toHaveCount(0)
  expect(writesTo(requests)).toEqual([])
})

test('a deadline passing while the step stands takes focus to the question, which the line describes', async ({
  page,
}) => {
  const { requests, stream, top } = await inCard(page)
  // Its line stands before the step does, or it would move the buttons and end the step itself.
  requests.settle(UPPER, { expires_at: new Date(Date.now() + 3000).toISOString() })
  await stream.signal('agents')
  await expect(top.getByText(/^Answer before/u)).toBeVisible()
  await raise(page, top)
  const line = top.getByText(/The deadline has passed/u)
  await expect(line).toBeVisible({ timeout: 6000 })
  await expect(top).toBeFocused()
  await expect(top).toHaveAccessibleDescription(/The deadline has passed/u)
  // A press of the pointer came last, so no ring: the owner chose no ring after a pointer
  // action. Focus is on the question, not on the line, round which a ring stood as a capsule.
  await expect(top).toHaveCSS('outline-style', 'none')
  await expect(line).toHaveCSS('outline-style', 'none')
  await expect(asking(top)).toHaveCount(0)
  await expect(top.getByRole('button', { name: 'Check status', exact: true })).toBeVisible()
  expect(writesTo(requests)).toEqual([])
  // A later deadline brings the question back, and not the step with it.
  requests.settle(UPPER, { expires_at: '2099-01-01T10:00:00Z' })
  await stream.signal('agents')
  await expect(top.getByRole('button', { name: 'Check status', exact: true })).toHaveCount(0)
  await expect(send(top)).toBeVisible()
  await expect(asking(top)).toHaveCount(0)
})

test('a deadline passing after a key takes focus to the question, ringed', async ({ page }) => {
  const { requests, stream, top } = await inCard(page)
  requests.settle(UPPER, { expires_at: new Date(Date.now() + 3000).toISOString() })
  await stream.signal('agents')
  await expect(top.getByText(/^Answer before/u)).toBeVisible()
  const choice = top.getByRole('radio', { name: 'Choice 1' })
  await choice.focus()
  await page.keyboard.press('Space')
  await expect(choice).toBeChecked()
  const line = top.getByText(/The deadline has passed/u)
  await expect(line).toBeVisible({ timeout: 6000 })
  await expect(top).toBeFocused()
  // A key came last, so the ring stands round the question, where focus was taken; the line
  // that says why describes it and stays bare.
  await expect(top).toHaveCSS('outline-style', 'solid')
  await expect(line).toHaveCSS('outline-style', 'none')
  expect(writesTo(requests)).toEqual([])
})

type Box = { height: number; width: number; x: number; y: number } | null

/** Whether two boxes share any of the window. */
function overlap(one: Box, other: Box) {
  if (!one || !other) return false
  const across = one.x < other.x + other.width && other.x < one.x + one.width
  return across && one.y < other.y + other.height && other.y < one.y + one.height
}

/** What the foot would otherwise lie on, and the buttons that must not move for it. */
async function layout(card: Locator) {
  return {
    onward: await onward(card).boundingBox(),
    own: await card.locator('.request-note').last().boundingBox(),
    wayOut: await wayOut(card).boundingBox(),
  }
}

for (const [width, height] of [
  [1680, 1050],
  [1024, 768],
  [390, 844],
] as const) {
  for (const locale of ['en', 'ru'] as const) {
    test(`at ${width} in ${locale} the asking leaves a comment open to be read, and nothing moves`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      const { card } = await openQuestion(page, pair(2, 2))
      const lower = card.nth(1)
      await lower.locator('.request-note-toggle').last().click()
      await page.keyboard.insertText('First line of the note\nSecond line\nThird line, the last')
      await inReach(wayOut(lower))
      const before = await layout(lower)
      await wayOut(lower).click()
      const asked = await asking(lower).boundingBox()
      expect(await layout(lower)).toEqual(before)
      expect(asked?.y).toBeGreaterThanOrEqual((before.own?.y ?? 0) + (before.own?.height ?? 0))
      // Beside the buttons where their row has room, above them where it has none: on neither.
      expect(overlap(asked, before.wayOut)).toBe(false)
      expect(overlap(asked, before.onward)).toBe(false)
      await expect(asking(lower)).toBeInViewport({ ratio: 1 })
      await page.keyboard.press('Escape')
      expect(await layout(lower)).toEqual(before)
    })
  }
}

for (const locale of ['en', 'ru'] as const) {
  test(`on a phone in ${locale} the asking stays off the text of a field above a comment closed`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    const { card } = await openQuestion(page, [
      question({
        request_id: LOWER,
        prompt: 'The only question',
        fields: [{ id: 'words', label: 'Words', type: 'text', required: true, options: [] }],
      }),
    ])
    await inReach(wayOut(card))
    await wayOut(card).click()
    const asked = await asking(card).boundingBox()
    const field = await card.locator('.request-fields textarea').boundingBox()
    expect(asked?.y).toBeGreaterThanOrEqual((field?.y ?? 0) + (field?.height ?? 0))
  })
}
