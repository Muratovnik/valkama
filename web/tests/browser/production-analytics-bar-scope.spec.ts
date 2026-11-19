/**
 * Which projects the figures are of, in the bar of the real app over the browser double. The
 * oracle is the requirement (`DESIGN.md`, Analytics): under the period the bar says «project
 * <name>», by the name the context bar gives the project, on a page scoped to one, and «all
 * projects» on the global page. At 1440 and 1024 pixels, in both languages, this week and the
 * reader's own days, the words stand whole on one line inside the bar, the read again inside it
 * too, and the bar is as high and its line as many rows with a project's name as with «all
 * projects»: the words take nothing from the line. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { record, serve, shortfalls } from './analyticsPage.ts'
import { globalScope, projectId, projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** An hour of one task on Tuesday, in the project the double holds. */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'One'), project: { id: projectId, unknown: false } },
    spend: { seconds: 3600 },
  },
]

const WORDS = {
  en: { project: 'project Example Project', all: 'all projects' },
  ru: { project: 'проект Example Project', all: 'все проекты' },
}

const PERIODS: Record<string, Record<string, string>> = {
  week: {},
  days: { period: 'custom', from: '2026-11-09', to: '2026-11-11' },
}

/** Where the bar's projects stand, how high the bar is, and whether its line gave itself up. */
async function measured(page: Page) {
  const scope = page.locator('.analytics-bar-scope')
  await expect(scope).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const short = await shortfalls(page, '.analytics-bar-scope')
  const text = await scope.textContent()
  return {
    text: text?.trim(),
    short: short.map((one) => one.short),
    ...(await scope.evaluate((element) => {
      const bar = element.closest('.analytics-bar')?.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const refresh = document.querySelector('.analytics-refresh')?.getBoundingClientRect()
      return {
        lines: Math.round(box.height / Number.parseFloat(getComputedStyle(element).lineHeight)),
        inside: Boolean(bar && box.left >= bar.left && box.right <= bar.right + 0.5),
        refreshInside: Boolean(bar && refresh && refresh.right <= bar.right + 0.5),
        barHeight: Math.round(bar?.height ?? 0),
        rows: Boolean(element.closest('.analytics-bar-rows')),
      }
    })),
  }
}

async function open(page: Page, scope: typeof globalScope | typeof projectScope, period: string) {
  await page.goto(
    serializePlatformRoute({ module_id: 'analytics', scope, state: PERIODS[period] ?? {} }),
  )
  return measured(page)
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    for (const period of Object.keys(PERIODS))
      test(`in ${locale} at ${width}px over ${period}, the bar names the projects whole on one line inside it`, async ({
        page,
      }, info) => {
        await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
        await page.setViewportSize({ width, height: 900 })
        await serve(page, WORLD)
        const project = await open(page, projectScope, period)
        const all = await open(page, globalScope, period)
        await record(info, `bar scope ${locale} ${width} ${period}`, { project, all })

        expect(project.text).toBe(WORDS[locale].project)
        expect(all.text).toBe(WORDS[locale].all)
        for (const one of [project, all]) {
          expect(one.short, 'the words whole').toEqual([expect.any(Number)])
          expect(one.short[0] ?? 1, 'the words whole').toBeLessThanOrEqual(0.5)
          expect(one.lines, 'on one line').toBe(1)
          expect(one.inside, 'inside the bar').toBe(true)
          expect(one.refreshInside, 'the read again inside the bar').toBe(true)
        }
        expect(project.barHeight, 'a project’s name takes no row of its own').toBe(all.barHeight)
        expect(project.rows, 'the line as many rows').toBe(all.rows)
      })
