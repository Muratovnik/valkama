/**
 * The Memory module against the whole built app.
 *
 * Its own file for the reason the execution spec got one: it belongs to a
 * different module than the shell journey beside it, and a spec that keeps
 * growing by unrelated cases is one nobody reads to the end.
 *
 * The journey is the point rather than any single screen. Globally the module
 * shows which project's knowledge can be reached at all; picking one is what
 * changes the scope; and inside a project the two halves answer to different
 * owners — a provider's search, and Valkama's own attached pointers.
 */
import { expect, test } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { globalScope, projectScope } from './planningFixtures.ts'

test('the global screen names every project and the one that cannot be asked', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'memory', scope: globalScope }))

  const rows = page.locator('.provider-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('C:/projects/sample/docs')
  // Listed rather than omitted, with the sentence that says why: a project
  // with nothing to say and one that cannot be asked are different facts.
  await expect(rows.nth(1)).toContainText('The project has no docs directory')
  await expect(rows.nth(1).getByRole('button')).toBeDisabled()
})

test('opening a project moves the scope and shows both halves of the module', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'memory', scope: globalScope }))
  await page.locator('.provider-row').first().getByRole('button').click()

  // The scope reached the URL, so this screen survives a reload and a link.
  await expect(page).toHaveURL(/project/)
  await expect(page.locator('.memory-search')).toBeVisible()

  const attached = page.locator('.link-row')
  await expect(attached).toHaveCount(1)
  await expect(attached).toContainText('Why the cutover was one-way')
  await expect(attached).toContainText('memory://record/abc123')
})

test('a search shows what matched and where it came from, never the document', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'memory', scope: projectScope }))

  await page.locator('.search-row input').fill('ratchet')
  await page.locator('.search-row').getByRole('button').click()

  const result = page.locator('.result-row')
  await expect(result).toHaveCount(1)
  await expect(result).toContainText('Store decision')
  await expect(result).toContainText('decisions/0001-store.md')
  await expect(result).toContainText('A ratchet only tightens.')
  await expect(page.locator('.search-provider')).toContainText('C:/projects/sample/docs')

  // The query is in the URL, so the search is a place rather than a state the
  // reload throws away.
  await page.reload()
  await expect(page.locator('.search-row input')).toHaveValue('ratchet')
})
