/**
 * Every window of the quota on a phone, in the built app. The oracle is the owner's rule for
 * narrow widths: at 390 and 320 pixels nothing breaks — no sideways scroll, nothing past an
 * edge. The line under a window (`QuotaPastWindow`) that says no window before it was read is
 * words, and a window narrower than them gives them a second row (DESIGN.md, the quota's
 * windows), as it does the line that names a window: kept on one row, «Прошлое окно: показаний не
 * было» ran 30px past its window at 320 pixels in Russian, a run of text past every box, and
 * scrolled the panel 4px sideways.
 *
 * Both sections of the quota are opened at 390 and 320 pixels in both languages, with the
 * scrollbars a desktop draws: the panel does not scroll sideways, and the words of every line
 * under a window (`data-past`) stand inside that window (`data-window`). The breakdown of each
 * kind of window is opened from its window (`data-spend`): its side panel does not scroll
 * sideways either. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { quotaAt } from '../fixtures/quota.ts'
import { NOW, openPanel, record, serve } from './analyticsPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

// Playwright hides scrollbars; the panel's own takes room a desktop's screen gives it.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/** How far two edges may stand apart and still be one place: the layout's rounding. */
const NEAR = 0.5

/** The kinds of window each section of the quota shows. */
const KINDS = { quota_five_hour: ['five_hour'], quota_week: ['week', 'week_model'] } as const

/** How many lines under a window the fixture gives a section: one under each of its windows. */
function linesOf(section: keyof typeof KINDS) {
  const kinds: readonly string[] = KINDS[section]
  return quotaAt(NOW)
    .accounts.flatMap((account) => account.windows)
    .filter((window) => 'readings' in window && kinds.includes(window.kind)).length
}

/** The words of each line under a window against that window, and the panel's sideways room. */
const measured = (page: Page) =>
  page.evaluate((near) => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const lines = [...document.querySelectorAll<HTMLElement>('.analytics-panel [data-past]')]
      .filter((line) => line.checkVisibility())
      .map((line) => {
        const range = document.createRange()
        range.selectNodeContents(line)
        const words = range.getBoundingClientRect()
        const window = line.closest('[data-window]')?.getBoundingClientRect()
        return {
          text: line.textContent.trim(),
          past: window ? words.right - window.right : null,
          inside:
            window !== undefined &&
            words.left >= window.left - near &&
            words.right <= window.right + near,
        }
      })
    return {
      lines,
      scroll: panel ? `${panel.scrollWidth}/${panel.clientWidth}` : null,
      sideways: panel ? panel.scrollWidth > panel.clientWidth : null,
    }
  }, NEAR)

/** Each box of the open side panel that scrolls, against the width it shows. */
const sidePanel = (page: Page) =>
  page
    .getByRole('dialog')
    .evaluate((dialog) =>
      [dialog, ...dialog.querySelectorAll<HTMLElement>('*')]
        .filter((one) => ['auto', 'scroll'].includes(getComputedStyle(one).overflowY))
        .map((one) => ({ scroll: one.scrollWidth, client: one.clientWidth })),
    )

for (const locale of ['en', 'ru'] as const)
  for (const width of [390, 320])
    test(`in ${locale} at ${width}px, no window of the quota scrolls the page sideways`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.setViewportSize({ width, height: 900 })
      await serve(page)
      const seen: Record<string, unknown> = {}
      for (const section of ['quota_five_hour', 'quota_week'] as const) {
        await openPanel(
          page,
          serializePlatformRoute({
            module_id: 'analytics',
            scope: globalScope,
            state: { by: section },
          }),
        )
        const lines = page.locator('.analytics-panel [data-past]:visible')
        await expect(lines).toHaveCount(linesOf(section), { timeout: 10_000 })
        await page.evaluate(() => document.fonts.ready)
        const now = await measured(page)
        seen[section] = now
        expect.soft(now.lines, section).toHaveLength(linesOf(section))
        for (const line of now.lines)
          expect.soft(line.inside, `${section}: «${line.text}» inside its window`).toBe(true)
        expect.soft(now.sideways, `${section}: no sideways scroll (${now.scroll})`).toBe(false)

        for (const kind of KINDS[section]) {
          await page
            .locator(`.analytics-panel [data-window="${kind}"] [data-spend]`)
            .first()
            .click({ timeout: 10_000 })
          const dialog = page.getByRole('dialog')
          await expect(dialog).toHaveCSS('transform', 'none', { timeout: 10_000 })
          await expect(dialog.getByRole('radiogroup').first()).toBeVisible({ timeout: 10_000 })
          const scrollers = await sidePanel(page)
          seen[`${section} ${kind}`] = scrollers
          expect.soft(scrollers.length, `${kind}: the side panel's scroller`).toBeGreaterThan(0)
          for (const one of scrollers)
            expect
              .soft(one.scroll, `${kind}: the side panel does not scroll sideways`)
              .toBeLessThanOrEqual(one.client)
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden({ timeout: 10_000 })
        }
      }
      await record(info, `quota narrow ${locale} ${width}`, seen)
    })
