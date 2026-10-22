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

test('an old exact session link resolves its work and opens compact native context', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'sessions',
      scope: globalScope,
      entity: { kind: 'session', session_id: launchedSessionId, client_family: 'codex' },
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(workItemRef.reference)
  await drawer.getByRole('button', { name: /^Execution$/i }).click()
  await drawer.getByRole('button', { name: /launched session/i }).click()
  const context = page.getByRole('dialog', { name: 'Session', exact: true })
  await expect(context).toBeVisible()
  await expect(context).toContainText(launchedSessionId)
  await expect(context.getByRole('button', { name: 'Open session' })).toBeVisible()
  await expect(page).toHaveURL(/modules\/planning/)
})

test('an unlinked exact session is attached by a person naming the item', async ({ page }) => {
  const { attachCommands } = await installBackend(page)
  const id = '99999999-8888-4777-8666-555555555555'
  await page.goto(
    serializePlatformRoute({
      module_id: 'sessions',
      scope: globalScope,
      entity: { kind: 'session', session_id: id, client_family: 'claude' },
    }),
  )
  const context = page.getByRole('dialog', { name: 'Session', exact: true })
  await expect(context).toBeVisible()
  const field = context.getByRole('textbox', { name: 'Work item', exact: true })
  const confirm = context.getByRole('button', { name: 'Attach', exact: true })
  await field.fill('nonsense')
  await expect(confirm).toBeDisabled()
  await field.fill(workItemRef.reference.toLowerCase())
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect.poll(() => attachCommands.length).toBe(1)
  expect(attachCommands[0]).toEqual({ work_item: workItemRef.reference, session_id: id })
})
