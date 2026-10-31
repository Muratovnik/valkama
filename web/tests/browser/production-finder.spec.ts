import { expect, test } from '@playwright/test'

import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  attachedDataScopeId,
  attachedSpaceRef,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'

type Row = { project: string; reference: string; title: string; writable: boolean }

/** One finder row; `n` keeps each row's identity distinct. */
function finderRow({ project, reference, title, writable }: Row, n: number) {
  return {
    target: {
      project_id: project,
      space_ref: writable ? spaceRef : attachedSpaceRef,
      reference,
      writable,
    },
    item: {
      work_item_id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
      planning_space_id: workItem.planning_space_id,
      reference,
      title,
      state: { name: n % 2 ? 'Dev' : 'Backlog' },
      claim_ref: '',
    },
  }
}

const LONG_TITLE =
  'Read an attached planning store that an older build wrote without migrating it, and name every scope the read had to skip instead of dropping it'

test('the task finder opens an exact hit on Enter and keeps every state legible', async ({
  page,
}, testInfo) => {
  await installBackend(page)
  type Mode = 'results' | 'empty' | 'partial-empty' | 'failed' | 'loading'
  let mode: Mode = 'results'
  let release: (() => void) | undefined
  await page.route('**/api/modules/planning/search?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? ''
    if (mode === 'failed')
      return route.fulfill({
        status: 409,
        json: { error: { code: 'unavailable', message: 'project_registry_unavailable' } },
      })
    if (mode === 'loading') await new Promise<void>((done) => (release = done))
    const rows =
      mode === 'results' || mode === 'loading'
        ? [
            finderRow(
              {
                project: projectId,
                reference: workItemRef.reference,
                title: LONG_TITLE,
                writable: true,
              },
              1,
            ),
            finderRow(
              {
                project: 'second-project',
                reference: workItemRef.reference,
                title: `Attached copy: ${LONG_TITLE}`,
                writable: false,
              },
              2,
            ),
            ...Array.from({ length: 6 }, (_, index) =>
              finderRow(
                {
                  project: projectId,
                  reference: `MAIN-${300 + index}`,
                  title: `Follows up ${workItemRef.reference}`,
                  writable: true,
                },
                3 + index,
              ),
            ),
          ]
        : []
    return route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query,
        limit: 50,
        has_more: mode === 'results',
        items: rows,
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
          ...(mode === 'empty'
            ? []
            : [
                {
                  project_id: 'demo-project',
                  space_ref: { data_scope_id: attachedDataScopeId, space_key: 'AWAY' },
                  status: 'unavailable',
                  reason: 'store_not_attached',
                },
              ]),
        ],
      },
    })
  })
  const shot = (name: string) =>
    page.screenshot({ path: testInfo.outputPath(`w-search-${name}.png`) })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        entity: planningSpaceEntity(spaceRef),
      }),
    )
    await expect(page.locator('.work-item-board')).toBeVisible()
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Find a task', exact: true })
    const search = dialog.getByRole('combobox')
    const status = dialog.getByRole('status')
    await expect(status).toContainText('Type a task reference')
    // The dialog fades in; a text check passes while it is still transparent.
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.finished)),
    )
    await shot(`prompt-${width}`)

    mode = 'results'
    await search.fill(workItemRef.reference.toLowerCase())
    const first = dialog.getByRole('option').first()
    await expect(first).toContainText(LONG_TITLE)
    await expect(first).toHaveAttribute('data-highlighted', '')
    await expect(status).toContainText('Store not attached: demo-project · AWAY')
    await expect(status).toContainText('More matches are available.')
    // The search field stays where it was while the rows come and go.
    const fieldBox = await search.boundingBox()
    await expectNoSilentClipping(page, `Finder results at ${width}px`)
    await shot(`results-${width}`)
    await dialog.getByRole('option').nth(2).hover()
    await expect(dialog.getByRole('option').nth(2)).toHaveAttribute('data-highlighted', '')
    await shot(`hover-${width}`)

    mode = 'empty'
    await search.fill('nothing like it')
    await expect(status).toContainText('No matching tasks.')
    const emptyBox = await search.boundingBox()
    expect(emptyBox?.y).toBe(fieldBox?.y)
    await shot(`empty-${width}`)

    mode = 'partial-empty'
    await search.fill('nothing here either')
    await expect(status).toContainText('No matching tasks in the projects that were searched.')
    await expect(status).toContainText('Store not attached: demo-project · AWAY')
    await shot(`partial-empty-${width}`)

    mode = 'failed'
    await search.fill('a failing search')
    await expect(status).toContainText('The project list could not be read')
    const retry = dialog.getByRole('button', { name: 'Retry search', exact: true })
    await expect(retry).toBeVisible()
    const retryBox = await retry.boundingBox()
    expect(retryBox?.width).toBeLessThan(width / 2)
    await expectNoSilentClipping(page, `Finder failure at ${width}px`)
    await shot(`failed-${width}`)
    // Keyboard only: Tab from the field reaches Retry, and Enter runs it.
    mode = 'results'
    await search.focus()
    await page.keyboard.press('Tab')
    await expect(retry).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('option').first()).toBeVisible()

    mode = 'loading'
    // The request leaves after the debounce; hold it until it is in the route.
    const held = page.waitForRequest('**/api/modules/planning/search?*')
    await search.fill('a slow search')
    await held
    await expect(status).toContainText('Searching mapped projects')
    await shot(`loading-${width}`)
    await expect.poll(() => release).toBeDefined()
    release?.()
    release = undefined
    await expect(dialog.getByRole('option').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }

  // Keyboard only: open, type the reference, press Enter while the search is
  // still out, and land on the item once the rows arrive. The answer is held,
  // so Enter cannot reach a row that is already there.
  mode = 'loading'
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Find a task', exact: true })
  await expect(dialog.getByRole('combobox')).toBeFocused()
  const held = page.waitForRequest('**/api/modules/planning/search?*')
  await page.keyboard.type(workItemRef.reference)
  await held
  await expect(dialog.getByRole('status')).toContainText('Searching mapped projects')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expect.poll(() => release).toBeDefined()
  release?.()
  release = undefined
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
})

test.describe('in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('the finder names a skipped project in plain Russian at 390px', async ({
    page,
  }, testInfo) => {
    await installBackend(page)
    await page.route('**/api/modules/planning/search?*', (route) =>
      route.fulfill({
        json: {
          interface_version: 'valkama-planning-search',
          query: workItemRef.reference,
          limit: 50,
          has_more: true,
          items: [
            finderRow(
              {
                project: projectId,
                reference: workItemRef.reference,
                title: LONG_TITLE,
                writable: true,
              },
              1,
            ),
          ],
          coverage: [
            { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
            {
              project_id: 'demo-project',
              space_ref: { data_scope_id: attachedDataScopeId, space_key: 'AWAY' },
              status: 'unavailable',
              reason: 'store_not_attached',
            },
          ],
        },
      }),
    )
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto(
      serializePlatformRoute({
        module_id: 'planning',
        scope: projectScope,
        entity: planningSpaceEntity(spaceRef),
      }),
    )
    await expect(page.locator('.work-item-board')).toBeVisible()
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Найти задачу', exact: true })
    await dialog.getByRole('combobox').fill(workItemRef.reference)
    const status = dialog.getByRole('status')
    await expect(status).toContainText('Проверены не все проекты')
    await expect(status).toContainText('Хранилище не подключено: demo-project · AWAY')
    await expect(dialog.getByRole('option').first()).toHaveAttribute('data-highlighted', '')
    await expectNoSilentClipping(page, 'Russian finder at 390px')
    await page.screenshot({ path: testInfo.outputPath('w-search-ru-results-390.png') })
  })
})
