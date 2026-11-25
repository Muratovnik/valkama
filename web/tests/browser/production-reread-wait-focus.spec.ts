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
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { cardWithThreads, openCard } from './editorPage.ts'
import { frames } from './frames.ts'
import { focusedByKey, tabGoesOn, wentThrough } from './heldWrite.ts'
import { blockedWorkItem } from './planningFixtures.ts'
import { test } from './test.ts'

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
    })
