/**
 * A control a write disables while it waits stays disabled, after a write that went through,
 * until the card has been read again (DESIGN.md, «Accessibility»): until then the card shows
 * what the write changed as it was, and a control enabled over it sent the same write again.
 * A second press, by key or pointer, sends nothing, and the focus a key left there comes back
 * once the read has answered, ringed, with the next Tab going where it went before.
 *
 * Read on a card — a link's remove, a report made the outcome and a thread's mark taken off —
 * at a desktop's two widths in both languages. Served by `discussionBackend.ts`'s double, each
 * write and the card's read after it held back by the test.
 *
 * A form the write closes as it answers — a reply, points made steps — leaves no control of
 * its own to wait on: its thread holds the focus, in sight, at every frame of the read, and once
 * the card is read again focus lands on the reply written, or on the icon that opened the form,
 * ringed. A report made the outcome takes away the icon pressed, and focus goes to the comment
 * form, in sight, at a desktop's two widths and a phone's.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { cardWithThreads, openCard } from './editorPage.ts'
import { frames } from './frames.ts'
import {
  focusedByKey,
  framesOnNothing,
  inSightClear,
  readHeldAfter,
  tabGoesOn,
  wentThrough,
} from './heldWrite.ts'
import { blockedWorkItem } from './planningFixtures.ts'
import { test } from './test.ts'
import { root } from './threadFixtures.ts'

const WORDS = {
  en: {
    unlink: `Remove link to ${blockedWorkItem.reference}`,
    relations: 'Relations',
    makeOutcome: 'Make task outcome',
    expand: 'Expand',
    reopen: 'Reopen',
    resolve: 'Resolve',
  },
  ru: {
    unlink: `Удалить связь с ${blockedWorkItem.reference}`,
    relations: 'Связи',
    makeOutcome: 'Сделать итогом задачи',
    expand: 'Развернуть',
    reopen: 'Снять отметку',
    resolve: 'Разобрано',
  },
} as const

const MORE = {
  en: {
    replyField: 'Your reply',
    makeSteps: 'Make conditions',
    addSteps: 'Add 2 conditions',
    composer: 'Write a comment',
  },
  ru: {
    replyField: 'Ваш ответ',
    makeSteps: 'В условия',
    addSteps: 'Добавить 2 условия',
    composer: 'Написать комментарий',
  },
} as const

/** The id the double gives the next comment: the record holds ten from `talkedOn`. */
const NEXT_COMMENT = 11

/** A comment holding a list of two points, neither a step of the card yet. */
const LISTED = ['What is left:', '1. Wire the route', '2. Review the copy'].join('\n')

/** A wait or a press of this spec's own gives up after this long. */
const WAIT = { timeout: 10_000 }

/** The card's thread with a mark, opened out to the button that takes the mark off. */
async function markedThread(page: Page, words: (typeof WORDS)[keyof typeof WORDS]) {
  const { drawer } = await cardWithThreads(page)
  const thread = drawer.locator('.thread-entry').filter({ hasText: 'step claims' })
  await thread.getByRole('button', { name: words.expand, exact: true }).click()
  return { drawer, reopen: thread.getByRole('button', { name: words.reopen, exact: true }), thread }
}

for (const width of [1440, 1024] as const)
  for (const lang of ['en', 'ru'] as const)
    test.describe(`a write that went through at ${String(width)} in ${lang}`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
      const words = WORDS[lang]

      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
      })

      test('a link’s remove that went through stays disabled until the card is read again', async ({
        page,
      }) => {
        const { backend, drawer } = await openCard(page)
        await drawer.getByRole('tab', { name: words.relations, exact: true }).click()
        const remove = drawer.getByRole('button', { name: words.unlink, exact: true })
        const { release, sent } = await wentThrough(
          page,
          remove,
          {
            key: 'Enter',
            path: '/api/planning/work-item/link',
            answer: (route) => {
              backend.item.links = []
              backend.item.revision += 1
              return route.fulfill({ json: backend.item })
            },
          },
          'key',
        )
        release()
        await expect(remove).toHaveCount(0)
        expect(sent).toHaveLength(1)
      })

      for (const second of ['key', 'pointer'] as const) {
        test(`a report made the outcome stays disabled until the card is read again, pressed again by ${second}`, async ({
          page,
        }) => {
          const { drawer } = await cardWithThreads(page)
          const make = drawer.getByRole('button', { name: words.makeOutcome, exact: true })
          const { release, sent } = await wentThrough(
            page,
            make,
            { key: 'Enter', path: '/api/planning/work-item/summary/select' },
            second,
          )
          release()
          // Read again, the report is the outcome and offers to be made it no more.
          await expect(make).toHaveCount(0)
          expect(sent).toHaveLength(1)
        })

        test(`a thread’s mark taken off stays disabled until the card is read again, pressed again by ${second}`, async ({
          page,
        }) => {
          const { reopen, thread } = await markedThread(page, words)
          const { release, sent } = await wentThrough(
            page,
            reopen,
            { key: 'Enter', path: '/api/planning/work-item/comment/resolve' },
            second,
          )
          release()
          // Read again, the thread is open, and the same button now marks it.
          await expect(
            thread.getByRole('button', { name: words.resolve, exact: true }),
          ).toBeEnabled()
          expect(sent).toHaveLength(1)
        })
      }

      test('a thread’s mark taken off with Enter has the focus back once the card is read again', async ({
        page,
      }) => {
        const { drawer, reopen, thread } = await markedThread(page, words)
        const { onward, release, sent } = await wentThrough(
          page,
          reopen,
          { key: 'Enter', path: '/api/planning/work-item/comment/resolve' },
          'key',
        )
        release()
        const resolve = thread.getByRole('button', { name: words.resolve, exact: true })
        await expect(resolve).toBeEnabled()
        await frames(drawer)
        await focusedByKey(resolve)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      // The form goes as the write answers, and what opened it waits on the read disabled.
      test('a reply sent with Ctrl+Enter leaves the focus on its thread until the card is read again, then on the reply', async ({
        page,
      }) => {
        const more = MORE[lang]
        const { drawer } = await cardWithThreads(page)
        // The thread asking whether the second report should replace the first, and its Reply.
        const thread = drawer.locator('#work-report-3')
        await thread.locator('#thread-reply-comment-3').click(WAIT)
        const field = thread.getByRole('textbox', { name: more.replyField, exact: true })
        await expect(field).toBeFocused(WAIT)
        await field.fill('Beside it, then.')
        const read = await readHeldAfter(page, '/api/planning/work-item/comment')
        const onNothing = await framesOnNothing(page, field)

        await page.keyboard.press('Control+Enter')
        await expect.poll(read.asked, WAIT).toBeGreaterThan(0)
        await expect(field).toHaveCount(0, WAIT)
        await frames(drawer)
        await expect(thread).toBeFocused(WAIT)
        expect(await inSightClear(thread, false)).toBe(true)

        read.release()
        const written = drawer.locator(`#thread-comment-${String(NEXT_COMMENT)}`)
        await expect(written).toBeFocused(WAIT)
        await frames(drawer)
        await focusedByKey(written)
        expect(await inSightClear(written)).toBe(true)
        const counted = await onNothing()
        expect(counted.gone).toBeGreaterThan(0)
        expect(counted.onNothing).toBe(0)
      })

      test('points made steps with Enter leave the focus on their thread until the card is read again, then on the icon', async ({
        page,
      }) => {
        const more = MORE[lang]
        const { backend, drawer } = await openCard(page)
        backend.item.comments.push(root(1, LISTED))
        await page.reload()
        const thread = drawer.locator('#work-report-1')
        const action = thread.getByRole('button', { name: more.makeSteps, exact: true })
        await action.click(WAIT)
        const add = thread.getByRole('button', { name: more.addSteps, exact: true })
        const read = await readHeldAfter(page, '/api/planning/work-item/checklist')
        const onNothing = await framesOnNothing(page, add)

        await add.focus(WAIT)
        await page.keyboard.press('Enter')
        await expect.poll(read.asked, WAIT).toBeGreaterThan(0)
        await expect(add).toHaveCount(0, WAIT)
        await frames(drawer)
        await expect(thread).toBeFocused(WAIT)
        expect(await inSightClear(thread, false)).toBe(true)

        read.release()
        await expect(action).toBeEnabled(WAIT)
        await expect(action).toBeFocused(WAIT)
        await frames(drawer)
        await focusedByKey(action)
        expect(await inSightClear(action)).toBe(true)
        const counted = await onNothing()
        expect(counted.gone).toBeGreaterThan(0)
        expect(counted.onNothing).toBe(0)
      })
    })

// A desktop's widths and a phone's: at a phone's only that nothing is cut, overlaps or scrolls
// sideways, and that focus stands in sight.
for (const lang of ['en', 'ru'] as const)
  test.describe(`a report made the outcome in ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1440, 1024, 390, 320] as const)
      test(`with Enter leaves the focus on the comment form, in sight, at ${String(width)}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const { drawer } = await cardWithThreads(page)
        const make = drawer.getByRole('button', { name: WORDS[lang].makeOutcome, exact: true })
        await make.focus(WAIT)
        await page.keyboard.press('Enter')
        await expect(make).toHaveCount(0, WAIT)
        const composer = drawer.getByRole('form', { name: MORE[lang].composer, exact: true })
        await expect(composer).toBeFocused(WAIT)
        await frames(drawer)
        expect(await inSightClear(composer)).toBe(true)
        expect(await drawer.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBe(0)
      })
  })
