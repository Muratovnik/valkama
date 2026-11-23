/**
 * The counts line of the work views' bar at a phone's width, in both languages, on the
 * board, the list and the graph, which share the bar.
 *
 * «… открытых из … и 2 из других пространств» is the longest the line says without a filter:
 * where it does not fit on one line it breaks between its facts, before «и 2 из других
 * пространств», and its words stand whole inside the bar. Held as one fact, they ran past the
 * bar and past the screen, their end cut.
 *
 * Served `served/workspaceCounts.ts`.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { countsRead } from './served/workspaceCounts.ts'
import { spaceAnswer } from './servedAnswers.ts'
import { test } from './test.ts'

const ELSEWHERE = { en: 'and 2 from other spaces', ru: 'и 2 из других пространств' } as const

async function open(page: Page, locale: 'en' | 'ru', view: string) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((language) => localStorage.setItem('valkama-locale', language), locale)
  await installBackend(page)
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(spaceAnswer(new URL(route.request().url()).searchParams, countsRead())),
  )
  await page.goto(boardRoute({ view }))
}

for (const locale of ['en', 'ru'] as const)
  for (const view of ['kanban', 'list', 'graph'])
    test(`the counts line stands inside the bar at 390px (${view}, ${locale})`, async ({
      page,
    }) => {
      await open(page, locale, view)
      const counts = page.getByRole('status').filter({ hasText: ELSEWHERE[locale] })
      await expect(counts).toHaveCount(1)
      const bar = page.locator('header', { has: counts })
      await expect(bar).toHaveCount(1)
      // The words' own boxes, line by line: the line's box shrinks with the bar, and words
      // that do not break run past it while it stays inside.
      const words = await counts.evaluate(
        (line, head) => {
          const frame = (head as Element).getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(line)
          const rects = [...range.getClientRects()].filter((rect) => rect.width > 0)
          return {
            lines: rects.length,
            outside: rects.filter(
              (rect) =>
                rect.left < frame.left - 1 ||
                rect.right > frame.right + 1 ||
                rect.right > document.documentElement.clientWidth,
            ).length,
          }
        },
        await bar.elementHandle(),
      )
      expect(words.lines).toBeGreaterThan(0)
      expect(words.outside).toBe(0)
    })
