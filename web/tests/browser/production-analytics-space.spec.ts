/**
 * Analytics in the space the context bar chose: every read of its usage names that space, its
 * figures are that space's work, and choosing another space there reads the page again with the
 * other space's figures. The double answers each space with its own work, so a read that kept
 * the first space, or named none, would draw the wrong figure.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { record, serve } from './analyticsPage.ts'
import {
  dataScopeId,
  globalScope,
  shellSpaceFor,
  spaceRef,
  spaceScope,
} from './planningFixtures.ts'
import { test } from './test.ts'

const SIDE = { data_scope_id: dataScopeId, space_key: 'SIDE' }
const HOUR = 3600

/** Each space's work this week: two hours in MAIN on Monday, five in SIDE on Tuesday. */
const BY_SPACE: Record<string, TimedStretch[]> = {
  MAIN: [
    {
      at: new Date(2026, 10, 9, 10),
      group: { work_item: task(1, 'Main work'), project: value('example-project') },
      spend: { seconds: 2 * HOUR },
    },
  ],
  SIDE: [
    {
      at: new Date(2026, 10, 10, 10),
      group: { work_item: task(2, 'Side work'), project: value('side-project') },
      spend: { seconds: 5 * HOUR },
    },
  ],
}

/** The page's double, with two spaces in the context bar; returns the space each read named. */
async function serveSpaces(page: Page, locale: 'en' | 'ru') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await serve(page, [])
  await page.route(
    (url) => url.pathname === '/api/platform/context',
    (route) =>
      route.fulfill({
        json: {
          interface_version: 'valkama-context',
          scope: globalScope,
          state: {
            interface_version: 'valkama-ui-state',
            status: 'ready',
            payload: {
              primary: { data_scope_id: dataScopeId, is_writable: true },
              spaces: [
                shellSpaceFor(spaceRef),
                {
                  ...SIDE,
                  name: 'Side space',
                  default_project: 'side-project',
                  projects: [{ project_id: 'side-project', display_name: 'Side project' }],
                  other_space_projects: [],
                },
              ],
              ui_prefs: null,
            },
          },
        },
      }),
  )
  const named: (string | null)[] = []
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    const space = query.get('space')
    named.push(space)
    await route.fulfill({ json: serveUsage(BY_SPACE[space ?? ''] ?? [], query) })
  })
  return named
}

/** The overview's figure of time, its panel reached as a reader reaches it on a narrow screen. */
async function timeFigure(page: Page) {
  const analytics = page.locator('.analytics-page')
  await analytics.locator('.analytics-rail:visible, .analytics-panel:visible').first().waitFor()
  if (!(await analytics.locator('.analytics-panel').isVisible()))
    await analytics.locator('.analytics-rail [aria-current="page"]').click()
  return analytics.locator('.analytics-panel .overview-panel .tile-figure[data-measure="time"]')
}

const hours = (count: number, locale: 'en' | 'ru') =>
  new RegExp(`^${count}\\s${locale === 'ru' ? 'ч' : 'h'}$`, 'u')

const runs = [
  { width: 1280, locale: 'en' as const },
  { width: 390, locale: 'en' as const },
  { width: 390, locale: 'ru' as const },
]

for (const { width, locale } of runs) {
  test(`at ${width}px in ${locale}, choosing another space reads its figures`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const named = await serveSpaces(page, locale)
    await page.goto(serializePlatformRoute({ module_id: 'analytics', scope: spaceScope }))
    await expect(await timeFigure(page)).toHaveText(hours(2, locale))
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((space) => space !== 'MAIN')).toEqual([])
    await page.screenshot({ path: info.outputPath(`analytics-space-main-${locale}-${width}.png`) })

    const before = named.length
    await page.locator('[data-scope-choice="space"] [role="combobox"]').click()
    await page.getByRole('option', { name: /^SIDE/u }).click()
    await expect(page).toHaveURL(new RegExp(`/modules/analytics/space/${dataScopeId}/SIDE`, 'u'))
    await expect(await timeFigure(page)).toHaveText(hours(5, locale))
    const after = named.slice(before)
    expect(after.length).toBeGreaterThan(0)
    expect(after.filter((space) => space !== 'SIDE')).toEqual([])
    await page.screenshot({ path: info.outputPath(`analytics-space-side-${locale}-${width}.png`) })
    await record(info, `analytics space ${locale} ${width}`, { before, after: after.length })
  })
}
