import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { dataScopeId, projectId, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

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
  await main.getByRole('button', { name: 'Go to a task' }).click()
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
  await expect
    .poll(async () => {
      const box = await message.boundingBox()
      return box?.width ?? 0
    })
    .toBeGreaterThan(180)
  await main.getByRole('button', { name: 'Go to Work' }).click()
  await expect(page.locator('.work-item-link')).toHaveCount(0)
})

const SEARCH_FAILED = {
  status: 500,
  json: { error: { code: 'request_failed', message: 'Search failed' } },
}

/** The page after a failed search, and the search: it fails until told what to answer. */
async function failedPage(page: Page) {
  await installBackend(page)
  const search = { reads: 0, answer: null as ((route: Route) => Promise<void>) | null }
  await page.route('**/api/modules/planning/search?*', (route) => {
    search.reads += 1
    return search.answer?.(route) ?? route.fulfill(SEARCH_FAILED)
  })
  await page.goto(`/open/${spaceRef.space_key}-7`)
  const main = page.locator('.work-item-link')
  await expect(main).toContainText('could not check this link')
  return { main, retry: main.getByRole('button', { name: 'Retry', exact: true }), search }
}

test.describe('another try', () => {
  test('that fails again puts focus back on Retry, as often as it is pressed', async ({ page }) => {
    const { main, retry, search } = await failedPage(page)
    await retry.focus()
    const asked = search.reads
    await page.keyboard.press('Enter')
    await expect.poll(() => search.reads).toBe(asked + 1)
    await expect(main).toContainText('could not check this link')
    await expect(retry).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => search.reads).toBe(asked + 2)
    await expect(main).toContainText('could not check this link')
    await expect(retry).toBeFocused()
  })

  test('pressed with the mouse puts focus back on Retry too', async ({ page }) => {
    const { main, retry, search } = await failedPage(page)
    const asked = search.reads
    await retry.click()
    await expect.poll(() => search.reads).toBe(asked + 1)
    await expect(main).toContainText('could not check this link')
    await expect(retry).toBeFocused()
  })

  test('answered with a missing number leaves focus on the page’s region', async ({ page }) => {
    const { main, retry, search } = await failedPage(page)
    search.answer = (route) =>
      route.fulfill({
        json: {
          interface_version: 'valkama-planning-search',
          query: `${spaceRef.space_key}-7`,
          limit: 50,
          has_more: false,
          items: [],
          coverage: [
            {
              project_id: projectId,
              space_ref: { data_scope_id: dataScopeId, space_key: spaceRef.space_key },
              status: 'searched',
              reason: null,
            },
          ],
        },
      })
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(main).toContainText(`There is no task ${spaceRef.space_key}-7`)
    await expect(main).toBeFocused()
  })

  test('leaves alone a reader who moved on while it ran', async ({ page }) => {
    const { main, retry, search } = await failedPage(page)
    let held: Route | undefined
    search.answer = (route) => {
      held = route
      return Promise.resolve()
    }
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => held).toBeDefined()
    await expect(retry).toHaveCount(0)
    const elsewhere = page.getByRole('link').first()
    await elsewhere.focus()
    await held?.fulfill(SEARCH_FAILED)
    await expect(main).toContainText('could not check this link')
    await expect(elsewhere).toBeFocused()
  })
})
