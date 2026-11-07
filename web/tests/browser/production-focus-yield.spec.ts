/**
 * Where an action that waits on the server lands focus, when the person has moved on before it
 * answered. A reply sent, then a click into the comment field while the write was out: the
 * answer took focus to the new reply, and the letters typed after it went nowhere. Focus moved
 * by the person since the action began stays where they put it; with nothing moved, the
 * landing is where it always was. A question's deadline passing is held to the same: it moves
 * focus only off what it disabled.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { asked, openQuestion, send } from './questionBackend.ts'
import { inTheList, pair } from './questionPress.ts'
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

/**
 * A question's answer while the person moves focus to another control of the same question
 * that the answer leaves in place: the task number over the list's card, the reply icon of the
 * card. The move is a press, let go off the control so nothing is clicked, or Shift+Tab, and
 * the answer is sent by a click or by Enter. Without the move, the answer lands as it always did.
 */
const WORDS = {
  en: { list: 'Needs my answer', reply: 'Reply', send: 'Send' },
  ru: { list: 'Ждут моего ответа', reply: 'Ответить', send: 'Отправить' },
} as const
const INPUTS = ['mouse', 'key'] as const
type Input = (typeof INPUTS)[number]
/** The outline the answer's landing draws: none after a press, the ring after a key. */
const RING: Record<Input, string> = { mouse: 'none', key: 'solid' }

const outline = (target: Locator) => target.evaluate((node) => getComputedStyle(node).outlineStyle)

async function sendBy(input: Input, onward: Locator) {
  if (input === 'mouse') await onward.click()
  else {
    await onward.focus()
    await onward.page().keyboard.press('Enter')
  }
  await expect(onward).toHaveAttribute('aria-disabled', 'true')
}

/** Focus to `target` as the person moves it: Shift+Tab, or a press on it let go off it. */
async function moveFocusBy(input: Input, page: Page, target: Locator, scope: Locator) {
  if (input === 'key') {
    for (let presses = 0; presses < 30; presses += 1) {
      if (await target.evaluate((node) => node === document.activeElement)) break
      await page.keyboard.press('Shift+Tab')
    }
  } else {
    await target.hover()
    await page.mouse.down()
    const box = await scope.boundingBox()
    if (!box) throw new Error('The question has no box to let go in')
    // Inside the card's padding: a release there clicks the card, which does nothing.
    await page.mouse.move(box.x + 6, box.y + box.height / 2)
    await page.mouse.up()
  }
  await expect(target).toBeFocused()
}

type Locale = keyof typeof WORDS

async function setUp(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

/** The answer has landed: its state is in sight and two frames have passed. */
async function landed(page: Page, state: Locator) {
  await expect(state).toBeVisible()
  await settled(page)
}

/** A card's question answered by `input`, its write held until `letGo` is called. */
async function heldCard(page: Page, locale: Locale, width: number, input: Input) {
  await setUp(page, locale, width)
  const { card, requests } = await openQuestion(page, [asked()])
  let letGo = doNothing
  requests.holdWrites(new Promise<void>((done) => (letGo = done)))
  await card.getByRole('radio', { name: 'Move them', exact: true }).click()
  await sendBy(input, card.locator('.request-onward'))
  const reply = card
    .locator('.entry-head')
    .getByRole('button', { name: WORDS[locale].reply, exact: true })
  return { card, letGo: () => letGo(), reply }
}

/** Two questions in the list, the upper one answered by `input` with its write held. */
async function heldList(page: Page, locale: Locale, width: number, input: Input) {
  await setUp(page, locale, width)
  const opened = await openQuestion(page, pair(2, 2))
  const { next, top } = await inTheList(page, opened, WORDS[locale].list)
  let letGo = doNothing
  opened.requests.holdWrites(new Promise<void>((done) => (letGo = done)))
  await top.getByRole('radio', { name: 'Choice 1', exact: true }).click()
  await sendBy(input, top.locator('.request-onward'))
  const number = top
    .locator('.request-context')
    .getByRole('link', { name: 'MAIN-264', exact: true })
  return { letGo: () => letGo(), next, number, top }
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390])
    for (const input of INPUTS) {
      const where = `after ${input}, in ${locale} at ${width}`

      test(`in the card, focus moved to the reply icon stays there, ${where}`, async ({ page }) => {
        const { card, letGo, reply } = await heldCard(page, locale, width, input)
        await moveFocusBy(input, page, reply, card)
        letGo()
        await landed(page, card.locator('.request-state'))
        await expect(reply).toBeFocused()
        await expect(card).not.toBeFocused()
      })

      test(`in the card, with no move the answer lands on the question, ${where}`, async ({
        page,
      }) => {
        const { card, letGo } = await heldCard(page, locale, width, input)
        letGo()
        await landed(page, card.locator('.request-state'))
        await expect(card).toBeFocused()
        expect(await outline(card)).toBe(RING[input])
      })

      test(`in the list, focus moved to the task number stays there, ${where}`, async ({
        page,
      }) => {
        const { letGo, next, number, top } = await heldList(page, locale, width, input)
        await moveFocusBy(input, page, number, top)
        letGo()
        await landed(page, top.locator('.request-state'))
        await expect(number).toBeFocused()
        await expect(next).not.toBeFocused()
      })

      test(`in the list, with no move the answer moves on to the next question, ${where}`, async ({
        page,
      }) => {
        const { letGo, next, top } = await heldList(page, locale, width, input)
        letGo()
        await landed(page, top.locator('.request-state'))
        await expect(next).toBeFocused()
        expect(await outline(next)).toBe(RING[input])
      })
    }

/**
 * A deadline passing disables the form, and focus in it goes to the question, which says why;
 * `production-question-step` holds that. Focus the person put on a control the deadline leaves
 * as it was, the reply icon of the card or the task number over the list's card, stays there.
 */
const PASSED = /The deadline has passed/u

/** The page's clock under the test's hand, and a deadline a minute and a half away on it. */
async function soonDue(page: Page, width: number) {
  await setUp(page, 'en', width)
  await page.clock.install()
  return new Date(Date.now() + 90_000).toISOString()
}

/** Shift+Tab goes back from where focus stands, so the keys start in the form; a press anywhere. */
async function startIn(input: Input, control: Locator) {
  if (input === 'key') await control.focus()
}

for (const width of [1280, 390])
  for (const input of INPUTS) {
    const where = `after ${input} at ${width}`

    test(`in the card, a deadline passing leaves focus on the reply icon, ${where}`, async ({
      page,
    }) => {
      const expires = await soonDue(page, width)
      const { card } = await openQuestion(page, [asked({ expires_at: expires })])
      const reply = card.locator('.entry-head').getByRole('button', { name: 'Reply', exact: true })
      await startIn(input, card.getByRole('radio', { name: 'Move them', exact: true }))
      await moveFocusBy(input, page, reply, card)
      await page.clock.fastForward('02:00')
      await expect(card).toHaveAccessibleDescription(PASSED)
      await settled(page)
      await expect(reply).toBeFocused()
    })

    test(`in the list, a deadline passing leaves focus on the task number, ${where}`, async ({
      page,
    }) => {
      const expires = await soonDue(page, width)
      const [upper, lower] = pair(2, 2)
      upper.request.expires_at = expires
      const opened = await openQuestion(page, [upper, lower])
      const { top } = await inTheList(page, opened, 'Needs my answer')
      const number = top
        .locator('.request-context')
        .getByRole('link', { name: 'MAIN-264', exact: true })
      await startIn(input, top.getByRole('radio', { name: 'Choice 1', exact: true }))
      await moveFocusBy(input, page, number, top)
      await page.clock.fastForward('02:00')
      await expect(top).toHaveAccessibleDescription(PASSED)
      await settled(page)
      await expect(number).toBeFocused()
    })
  }
