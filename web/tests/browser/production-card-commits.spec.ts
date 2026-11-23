import { expect } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { now, spaceScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * A card's commits in «Связи»: each by its repository and its hash, with its project's name,
 * the one attached by hand marked as such, and each opening what git says of it through
 * `GET /api/commit`, asked by the repository and the hash.
 */

const commit = (repository: string, name: string, hash: string, subject: string) => ({
  repository,
  display_name: name,
  hash,
  subject,
  committed_at: now,
  session: '',
  agent: '',
  attached_by: 'server' as const,
  label: '',
})

const COMMITS = [
  commit('alpha', 'Alpha', 'a3cc0de4f1b2c3d4e5f6', 'build(web): rebuild the bundled UI'),
  commit(
    'alpha-runtime',
    'Alpha Runtime',
    '5d1e0b97a1b2c3d4e5f6',
    'feat(alerts): deliver a tray alert',
  ),
  {
    ...commit('beta', 'Beta', '39014906c1d2e3f4a5b6', 'docs: record the alert model decision'),
    attached_by: 'manual' as const,
  },
]

for (const width of [1280, 390]) {
  test(`a card's commits stand in Relations with their projects at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installBackend(page, { card: (read) => ({ ...read, commits: COMMITS }) })
    const asked: URLSearchParams[] = []
    await page.route('**/api/commit?*', (route) => {
      const query = new URL(route.request().url()).searchParams
      asked.push(query)
      return route.fulfill({
        json: {
          kind: 'commit',
          value: query.get('hash'),
          resolved: true,
          repository: query.get('repository'),
          detail:
            'a3cc0de4 worker-a\nbuild(web): rebuild the bundled UI\n web/dist/index.html | 2 +-',
        },
      })
    })
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: spaceScope,
        entity: planningWorkItemEntity(workItemRef),
      }),
    )
    const drawer = page.locator('.drawer')
    await drawer.getByRole('tab', { name: 'Relations', exact: true }).click()

    const rows = drawer.locator('[data-commit]')
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('.commit-name')).toHaveText([
      'alpha · a3cc0de4',
      'alpha-runtime · 5d1e0b97',
      'beta · 39014906',
    ])
    await expect(rows.locator('.commit-project')).toHaveText(['Alpha', 'Alpha Runtime', 'Beta'])
    // Only the commit attached by hand says how it came.
    await expect(rows.locator('.commit-manual')).toHaveCount(1)
    await expect(drawer.locator('[data-commit="39014906c1d2e3f4a5b6"] .commit-manual')).toHaveText(
      'attached by hand',
    )

    // Nothing in a row runs past the drawer's edge, the longest name and subject included.
    const edge = await drawer.evaluate((node) => node.getBoundingClientRect().right)
    const rights = await rows.evaluateAll((all) =>
      all.flatMap((row) =>
        [...row.querySelectorAll('*')].map((part) => part.getBoundingClientRect().right),
      ),
    )
    expect(rights.length).toBeGreaterThan(0)
    expect(Math.max(...rights)).toBeLessThanOrEqual(edge + 0.5)

    // A press opens what git says of it, asked by its repository and its hash.
    await rows.nth(0).locator('.commit-name').click()
    const dialog = page.getByRole('dialog', { name: 'Commit' })
    await expect(dialog).toContainText('web/dist/index.html')
    expect(asked.map((query) => [query.get('repository'), query.get('hash')])).toEqual([
      ['alpha', 'a3cc0de4f1b2c3d4e5f6'],
    ])
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
}
