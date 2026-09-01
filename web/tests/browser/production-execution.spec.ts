/**
 * The execution section and the launch form, against the whole built app.
 *
 * Its own file because it belongs to a different module than the shell journey
 * beside it, and because the shell spec had reached the line ceiling: a file
 * that keeps growing by unrelated cases is one nobody reads to the end.
 */
import { expect, test } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { launchedSessionId } from './executionFixtures.ts'
import { globalScope, projectScope, spaceRef, workItemRef } from './planningFixtures.ts'

test('the execution section shows the attempt and the launch form is built per client', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
      state: { view: 'list' },
    }),
  )
  await page.locator('.work-item-list .list-open').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: /^Execution$/i }).click()

  // What the client claimed and what the checkout shows, side by side. The
  // second is the half a delivery is checked against, so it has to be there.
  await expect(drawer).toContainText('The route is dispatched')
  await expect(drawer).toContainText('3 files')
  await expect(drawer).toContainText('+42')

  await drawer.getByRole('button', { name: /Start an attempt/i }).click()
  const dialog = page.getByRole('dialog', { name: /Start an attempt/i })
  await expect(dialog).toBeVisible()
  // The directory comes from the registry that maps the space, not from a
  // remembered path or from wherever the platform happens to be running.
  await expect(dialog.getByLabel(/^Repository$/i)).toHaveValue('C:/work/valkama')

  // The effort list is the chosen client's, not a shared one: `max` is Claude
  // Code's highest setting and Codex refuses it, `minimal` is Codex's lowest
  // and Claude Code has none. One list would offer each client the other's.
  const effort = dialog.getByRole('combobox', { name: /^Effort$/i })
  await effort.click()
  await expect(page.getByRole('option', { name: 'max', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'minimal', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // A client that is not installed stays in the chooser and says why, because
  // hiding it would say Valkama has never heard of it.
  await dialog.getByRole('combobox', { name: /^Client$/i }).click()
  await page.getByRole('option', { name: /codex/ }).click()
  await expect(dialog).toContainText('codex is not on PATH')
  await expect(dialog).toContainText('no switch that removes delegation')

  await effort.click()
  await expect(page.getByRole('option', { name: 'minimal', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'max', exact: true })).toHaveCount(0)
})

test('the usage section says how much of a number anyone actually saw', async ({ page }) => {
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
      state: { view: 'list' },
    }),
  )
  await page.locator('.work-item-list .list-open').first().click()
  const drawer = page.locator('.drawer')
  await drawer.getByRole('button', { name: /^Usage$/i }).click()

  await expect(drawer).toContainText('180,000')
  // A field the journal did not report is a dash, never a zero: zero looks like
  // a measurement, and a reader would conclude the model did no reasoning.
  const reasoning = drawer.locator('.usage-fact', { hasText: 'Reasoning' })
  await expect(reasoning).toContainText('—')
  // Active time is absent for a different reason, and says which: a transcript
  // cannot tell an idle hour from a working one.
  const active = drawer.locator('.usage-fact', { hasText: 'Wall time' })
  await expect(active).toBeVisible()

  // The coverage line is the honest half of every total above it, and the
  // session that answered nothing says so by name.
  await expect(drawer).toContainText('Tokens partial')
  await expect(drawer).toContainText('no exact local journal file')

  // Tools are calls and errors. No token column, because a hook reports that a
  // tool ran and not what it cost.
  const tools = drawer.locator('.tool-table')
  await expect(tools).toContainText('Read')
  await expect(tools).toContainText('42')
  await expect(tools.locator('th')).toHaveCount(5)
})

test('the memory section offers exactly what the provider says it can do', async ({ page }) => {
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
      state: { view: 'list' },
    }),
  )
  await page.locator('.work-item-list .list-open').first().click()
  const drawer = page.locator('.drawer')
  await drawer.getByRole('button', { name: /^Memory$/i }).click()

  await drawer.getByLabel(/Search knowledge/i).fill('ratchet')
  await drawer.getByRole('button', { name: /^Search$/i }).click()

  // The provider and its capability list travel with the answer, so a
  // read-only source is visibly read-only rather than one that refuses later.
  await expect(drawer).toContainText('markdown-knowledge')
  await expect(drawer).toContainText('memory.search')
  await expect(drawer).not.toContainText('memory.write')
  await expect(drawer).toContainText('Store decision')
  await expect(drawer).toContainText('A ratchet only tightens.')
})

test('a session opens the work it served, and the work opens the session back', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'sessions', scope: globalScope }))

  // Session to work item. This direction existed and went nowhere: the page
  // emitted the jump and the shell above it listened for nothing.
  await page.getByText(`${workItemRef.reference} the launched one`).click()
  await page.getByRole('button', { name: new RegExp(`Open ${workItemRef.reference}`) }).click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(workItemRef.reference)

  // And back again, through the attempt that opened it. A session is an entity
  // the route can carry, so this is a link and not a search.
  await drawer.getByRole('button', { name: /^Execution$/i }).click()
  await drawer.getByRole('button', { name: /launched session/i }).click()
  await expect(page).toHaveURL(new RegExp('module_id.*sessions|/modules/sessions'))
  await expect(page.locator('.resizable-inspector')).toBeVisible()
  await expect(page.locator('.resizable-inspector')).toContainText(launchedSessionId.slice(0, 8))
})

test('an unlinked session is attached by a person naming the item', async ({ page }) => {
  const { attachCommands } = await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'sessions', scope: globalScope }))
  await page.getByText('an interactive session nobody launched').click()
  const inspector = page.locator('.resizable-inspector')
  await expect(inspector).toBeVisible()

  const field = inspector.getByLabel(/Attach to a work item/i)
  const confirm = inspector.getByRole('button', { name: /^Attach$/i })
  // A reference is checked against the shape the server accepts before the
  // request, so a typo answers here rather than as a refusal.
  await field.fill('nonsense')
  await expect(confirm).toBeDisabled()
  await field.fill(workItemRef.reference.toLowerCase())
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect.poll(() => attachCommands.length).toBe(1)
  expect(attachCommands[0]).toEqual({
    work_item: workItemRef.reference,
    session_id: '99999999-8888-4777-8666-555555555555',
  })
})
