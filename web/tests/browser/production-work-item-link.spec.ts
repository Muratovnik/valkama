import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { dataScopeId, projectId, spaceRef, workItem, workItemRef } from './planningFixtures.ts'

type Coverage = { reason: string | null; status: 'searched' | 'unavailable' }

/** The mapped search as the page reads it, for one query and the sources it covered. */
async function serveSearch(page: Page, found: boolean, coverage: Coverage[]) {
  await page.route('**/api/modules/planning/search?*', (route) => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? ''
    return route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query,
        limit: 50,
        has_more: false,
        items: found
          ? [
              {
                target: {
                  project_id: projectId,
                  space_ref: spaceRef,
                  reference: workItemRef.reference,
                  writable: true,
                },
                item: {
                  work_item_id: workItem.work_item_id,
                  planning_space_id: workItem.planning_space_id,
                  reference: workItemRef.reference,
                  title: workItem.title,
                  state: { name: 'Dev', category: 'active', is_terminal: false },
                  claim_ref: '',
                },
              },
            ]
          : [],
        coverage: coverage.map((source) => ({
          project_id: projectId,
          space_ref: { data_scope_id: dataScopeId, space_key: spaceRef.space_key },
          ...source,
        })),
      },
    })
  })
}

const SEARCHED: Coverage[] = [{ status: 'searched', reason: null }]

test('a missing number says so, marks no section and offers the space', async ({ page }) => {
  await installBackend(page)
  await serveSearch(page, false, SEARCHED)
  await page.goto(`/open/${spaceRef.space_key}-999`)
  const main = page.locator('.work-item-link')
  await expect(main).toContainText(`There is no task ${spaceRef.space_key}-999`)
  await expect(page.locator('.context-bar, .app-context-bar').first()).toContainText('Task link')
  await expect(page.locator('[aria-current="page"]')).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/open/${spaceRef.space_key}-999$`))

  await main.getByRole('button', { name: `Open space ${spaceRef.space_key}` }).click()
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${projectId}\\?entity=`))
  await expect(page.locator('.work-item-link')).toHaveCount(0)
  await page.goBack()
  await expect(page.locator('.work-item-link')).toContainText('There is no task')
})

test('an address the app has to resolve itself replaces itself with the card', async ({ page }) => {
  await installBackend(page)
  await serveSearch(page, true, SEARCHED)
  await page.goto('/modules/settings/global')
  await page.goto(`/open/${workItemRef.reference.toLowerCase()}`)
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${projectId}\\?entity=`))
  await expect(page.getByRole('heading', { name: workItem.title })).toBeVisible()
  // The address took no place in history: Back leaves the card for where it was.
  await page.goBack()
  await expect(page).toHaveURL(/\/modules\/settings\/global$/u)
})

test('a malformed address shows its own text as text, at the width of a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  await installBackend(page)
  const typed = `<img src=x onerror=alert(1)>${'y'.repeat(50)}`
  await page.goto(`/open/${encodeURIComponent(typed)}`)
  const main = page.locator('.work-item-link')
  await expect(main).toContainText('This link does not name a task')
  await expect(main).toContainText('<img src=x onerror=alert(1)>')
  await expect(main.locator('img')).toHaveCount(0)
  await expectNoSilentClipping(page, '.work-item-link')
  expect(dialogs).toEqual([])
  await main.getByRole('button', { name: 'Find a task' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('a store that cannot answer offers another try rather than calling it missing', async ({
  page,
}) => {
  await installBackend(page)
  await serveSearch(page, false, [{ status: 'unavailable', reason: 'store_unreadable' }])
  await page.goto(`/open/${spaceRef.space_key}-7`)
  const main = page.locator('.work-item-link')
  await expect(main).toContainText(`Space ${spaceRef.space_key} cannot be read right now`)
  await expect(main).not.toContainText('There is no task')
  // On a phone the buttons take their own row and the message keeps its width.
  await page.setViewportSize({ width: 390, height: 844 })
  const message = main.locator('.platform-state-reason')
  await expect.poll(async () => (await message.boundingBox())?.width ?? 0).toBeGreaterThan(180)
  await main.getByRole('button', { name: 'Go to Work' }).click()
  await expect(page.locator('.work-item-link')).toHaveCount(0)
})
