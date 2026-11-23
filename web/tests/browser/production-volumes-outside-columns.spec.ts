/**
 * The work outside goals in Volumes, by project and by label, at every width where its tables
 * stand as columns, from 1920px down to where they stack and back up, in both languages. The
 * oracle is DESIGN.md (Rows and tables): repeated comparable records use aligned columns, and the
 * tables of one section stand at one step and on one set of columns, so a category stands at one
 * edge in both. Each table laid out by its own words, the label's column stood wider than the
 * project's and every category after it moved, up to 25px apart where the columns came down to
 * their least.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { volumesAnswer } from '../support/volumesDouble.ts'
import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

const OUTSIDE_WORDS = { en: 'Outside goals', ru: 'Вне целей' } as const

/** Every category of a row at four figures. */
const FIGURES = {
  triage: 1234,
  deferred: 234,
  ready: 3456,
  active: 45,
  review: 5678,
  completed: 678,
  blocked: 7890,
  cancelled: 89,
}

/**
 * The projects under short words, the labels under one long run: laid out alone, the label's
 * column needs more room than the project's at every step.
 */
const OUTSIDE = {
  byProject: [
    { project: 'alpha', name: 'Alpha app', categories: FIGURES },
    { project: 'beta', name: 'Beta lib', categories: FIGURES },
    { project: null, categories: FIGURES },
  ],
  byLabel: [
    { label: 'release-candidate-blocker', categories: FIGURES },
    { label: 'ui', categories: FIGURES },
    { label: null, categories: FIGURES },
  ],
}

/** Nine columns a table: the name, then the eight categories. */
const COLUMNS = 9

const WIDTHS = [
  1920, 1600, 1440, 1280, 1240, 1200, 1160, 1120, 1080, 1040, 1000, 960, 920, 880, 840, 800, 760,
  800, 880, 960, 1040, 1120, 1200, 1280, 1600, 1920,
] as const

async function openPage(page: Page) {
  await installBackend(page)
  // Routed after the backend's own, so these answer.
  await page.route('**/api/planning/volumes?*', (route) =>
    route.fulfill({ json: volumesAnswer({ outside: OUTSIDE }) }),
  )
  await page.route('**/api/planning/commits/unattached?*', (route) =>
    route.fulfill({ json: { total: 0, items: [] } }),
  )
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'volumes', scope: spaceScope, state: {} }))
}

/**
 * The section's step, and the edges of each table's column headings, a table a list. A stacked
 * section's heading row is cut away and read only aloud, so it has no edges to compare.
 */
const columnEdges = (section: Locator) =>
  section.evaluate((root) => ({
    fit: root.closest<HTMLElement>('[data-fit]')?.dataset.fit,
    tables: [...root.querySelectorAll('table')].map((table) =>
      [...table.querySelectorAll('th[scope="col"]')].map((heading) => {
        const box = heading.getBoundingClientRect()
        return [box.left, box.right] as const
      }),
    ),
  }))

/** Every column whose edges in the second table miss the first's by more than half a pixel. */
function misses(tables: (readonly (readonly [number, number])[])[]) {
  const [first = [], second = []] = tables
  return first.flatMap(([left, right], at) => {
    const other = second[at]
    if (!other) return [`column ${at}: missing in the second table`]
    const [otherLeft, otherRight] = other
    return Math.abs(left - otherLeft) <= 0.5 && Math.abs(right - otherRight) <= 0.5
      ? []
      : [`column ${at}: ${left}..${right} against ${otherLeft}..${otherRight}`]
  })
}

for (const locale of ['en', 'ru'] as const)
  test(`the work outside goals stands on one set of columns at every width in ${locale}`, async ({
    page,
  }) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await openPage(page)
    const outside = page.getByRole('region', { name: OUTSIDE_WORDS[locale], exact: true })
    await expect(outside.locator('tr[data-row]')).toHaveCount(
      OUTSIDE.byProject.length + OUTSIDE.byLabel.length,
    )
    await page.evaluate(() => document.fonts.ready)
    const steps = new Set<string | undefined>()
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expect
        .poll(
          async () => {
            const { fit, tables } = await columnEdges(outside)
            steps.add(fit)
            if (fit === 'stack') return []
            const counts = tables.map((table) => table.length)
            return counts.join(',') === `${COLUMNS},${COLUMNS}`
              ? misses(tables)
              : [`tables of ${counts.join(' and ')} columns`]
          },
          { message: `${locale} at ${width}px` },
        )
        .toEqual([])
    }
    // The walk met both column steps and the blocks, so each was compared where it stands.
    expect(steps).toEqual(new Set(['one', 'least', 'stack']))
  })
