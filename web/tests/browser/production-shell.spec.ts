import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { PLATFORM_MODULE_IDS } from '@/shared/api/platformModuleContract.ts'
import {
  planningSpaceEntity,
  planningWorkItemEntity,
  planningWorkItemRef,
} from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  actions,
  attachedDataScopeId,
  attachedSpaceRef,
  blockedWorkItem,
  dataScopeId,
  globalScope,
  projectId,
  projectScope,
  resourceRef,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'

const entityRef = planningWorkItemEntity(workItemRef)

test('cold start at "/" restores a canonical route with no error states', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await installBackend(page)
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${projectId}$`))
  await expect(page.locator('.work-item-board')).toBeVisible()
  await expect(
    page.locator('.platform-state-panel[data-tone="danger"], .route-recovery'),
  ).toHaveCount(0)
  await expect(page.locator('.board-scope')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('cold start honors the saved server-side route preference', async ({ page }) => {
  await installBackend(page, { uiPrefs: { module_id: 'skills', scope: globalScope } })
  await page.goto('/')
  await expect(page).toHaveURL(/\/modules\/skills\/global$/u)
  await expect(page.locator('.route-recovery')).toHaveCount(0)
})

test('global Planning opens a mapped project using the current context wire contract', async ({
  page,
}) => {
  const { platformReads } = await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))
  const project = page.locator('.portfolio-project').filter({ hasText: projectId })
  await expect(project).toBeVisible()
  await project.getByRole('button', { name: /Open project/i }).click()
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${projectId}$`))
  await expect(page.locator('.operating-scope [role="combobox"]')).toContainText('Example Project')
  await expect(page.locator('.work-item-board')).toBeVisible()
  expect(platformReads.find((entry) => entry.startsWith('/api/planning?'))).toContain(
    `data_scope_id=${dataScopeId}`,
  )
})

/**
 * Reads the open work item's reference out of the URL.
 *
 * The route carries the entity base64url-encoded, and decoding it through the
 * refs module rather than by hand is what proves the app and the test agree on
 * one encoding. Returned as a thunk so `expect.poll` can re-read it, and defined
 * out here so the decode branch is not a branch inside a test.
 */
function openReferenceReader(page: Page): () => string | null {
  return () => {
    const entity = new URL(page.url()).searchParams.get('entity') ?? ''
    if (!entity) return null
    const decoded = JSON.parse(Buffer.from(entity, 'base64url').toString())
    return planningWorkItemRef(decoded)?.reference ?? null
  }
}

/**
 * What proves a module actually rendered, per module and scope.
 *
 * The four entries are the modules whose own surface has a name; everything
 * else is proven by the stage it mounts into. Choosing here rather than inside
 * the test keeps every generated test asserting one thing unconditionally.
 */
const ROUTE_MARKERS: Record<string, string> = {
  'analytics:global': '.portfolio-total',
  'analytics:project': '.analytics-dashboard',
  'planning:global': '.portfolio-project',
  'planning:project': '.work-item-board',
}

for (const moduleId of PLATFORM_MODULE_IDS) {
  for (const scopeKind of ['global', 'project'] as const) {
    const marker = ROUTE_MARKERS[`${moduleId}:${scopeKind}`] ?? '.module-stage'

    test(`${moduleId} renders at canonical ${scopeKind} route`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await installBackend(page)
      const href = serializePlatformRoute({
        module_id: moduleId,
        scope: scopeKind === 'global' ? globalScope : projectScope,
        ...(moduleId === 'analytics' && scopeKind === 'project'
          ? { entity: planningSpaceEntity(spaceRef) }
          : {}),
      })
      await page.goto(href)
      await expect(page.locator('.app-shell')).toBeVisible()
      await expect(page.locator('.nav-item[aria-current="page"]')).toHaveCount(1)
      await expect(page).toHaveURL(new RegExp(`/modules/${moduleId}/${scopeKind}`))
      await expect(page.locator(marker)).toBeVisible()
      expect(errors).toEqual([])
      // One oracle for a clipped box, in `overflow.ts`. This test used to carry
      // a second copy of the same rule, which had already drifted from it.
      await expectNoSilentClipping(page, `${moduleId} at ${scopeKind} scope`)

      // The rail collapses and the lanes narrow; both change how much room the
      // content has without the viewport changing at all.
      await page.setViewportSize({ width: 390, height: 900 })
      await expect(page.locator('.app-shell')).toBeVisible()
      await expectNoSilentClipping(page, `${moduleId} at ${scopeKind} scope, 390px`)
    })
  }
}

test('planning project workspace switches between board, graph, and list', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await expect(page.locator('.work-item-board')).toBeVisible()
  // The column is named by the state's own key, which is what the space declares.
  await expect(page.locator('.work-item-column[data-state="dev"]')).toContainText(workItem.title)
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  await expect(page.locator('.vue-flow')).toBeVisible()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.locator('.work-item-list')).toBeVisible()
  await expect(page).toHaveURL(/state=/)
})

test('global planning is a portfolio that opens the exact project space', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))
  await expect(page.locator('.portfolio-project')).toHaveCount(1)
  await page.getByRole('button', { name: /Open project/i }).click()
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${projectId}$`))
  await expect(page.locator('.work-item-board')).toBeVisible()
})

test('exact work item journey survives Back/reload and performs generic attach/open actions', async ({
  page,
}) => {
  const { relationCommands, actionCommands } = await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
      state: { view: 'list' },
    }),
  )
  await page.locator('.work-item-list .list-open').first().click()
  await expect(page.locator('.drawer')).toBeVisible()
  // External resources are the Kernel half of the relations section, which sits
  // beside the links between work items rather than in a surface of its own.
  await page
    .locator('.drawer')
    .getByRole('button', { name: /Relations/i })
    .click()
  await expect(page.getByText('Release notes', { exact: true })).toBeVisible()

  const attach = page.getByRole('button', { name: /Attach/i }).first()
  await attach.click()
  const dialog = page.getByRole('dialog', { name: /Attach external resource/i })
  await dialog.getByLabel(/Stable external ID/i).fill('N-265')
  const submit = dialog.getByRole('button', { name: /^Attach$/i })
  await expect(submit).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect.poll(() => relationCommands.length).toBe(1)
  expect(relationCommands[0]).toMatchObject({
    interface_version: 'valkama-relation-command',
    operation: 'attach',
    entity_ref: entityRef,
    resource_ref: { resource_type: 'note', external_id: 'N-265' },
    expected_revision: 3,
    invocation_context: { invocation_scope: projectScope },
    confirmation: true,
  })

  // The attach re-read the item, so the list is rebuilt: wait for the second
  // relation to land and then name the row rather than taking the first button,
  // which is ambiguous once there are two and detaches mid-click.
  const relationRows = page.locator('.platform-relations li')
  await expect(relationRows).toHaveCount(2)
  const releaseRelation = relationRows.filter({ hasText: 'Release notes' })
  await releaseRelation.getByRole('button', { name: /^Open$/i }).click()
  const openDialog = page.getByRole('dialog', { name: /Open external resource/i })
  await expect(openDialog).toBeVisible()
  await expect(openDialog).toContainText(projectId)
  await expect(openDialog).toContainText(dataScopeId)
  await expect(openDialog).toContainText('note:N-264')
  expect(actionCommands).toEqual([])
  expect(
    await page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? []),
  ).toEqual([])
  const openSubmit = openDialog.getByRole('button', { name: /^Open$/i })
  await expect(openSubmit).toBeDisabled()
  await openDialog.getByRole('checkbox').check()
  await expect(openSubmit).toBeEnabled()
  expect(actionCommands).toEqual([])
  await openSubmit.click()
  await expect.poll(() => actionCommands.length).toBe(1)
  expect(actionCommands[0]).toEqual({
    interface_version: 'valkama-action-command',
    action_ref: actions[1],
    confirmation: true,
    invocation_context: {
      view_scope: projectScope,
      invocation_scope: projectScope,
      target: resourceRef,
    },
    input: { entity_ref: entityRef, resource_ref: resourceRef },
  })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? []))
    .toContain('resource-link://entry/N-264')

  await releaseRelation.getByRole('button', { name: /^Remove$/i }).click()
  const removeDialog = page.getByRole('dialog', { name: /Remove external relation/i })
  await expect(removeDialog).toContainText(projectId)
  await expect(removeDialog).toContainText(dataScopeId)
  await expect(removeDialog).toContainText('note:N-264')
  const removeSubmit = removeDialog.getByRole('button', { name: /^Remove$/i })
  await expect(removeSubmit).toBeDisabled()
  await removeDialog.getByRole('checkbox').check()
  await removeSubmit.click()
  await expect.poll(() => relationCommands.length).toBe(2)
  expect(relationCommands[1]).toMatchObject({
    operation: 'remove',
    entity_ref: entityRef,
    confirmation: true,
  })

  // The open item is in the route, so Back closes it and a reload comes back to
  // it. Held in module state, the second of those was impossible.
  await page.goBack()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await page.locator('.work-item-list .list-open').first().click()
  await page.reload()
  await expect(page.locator('.drawer')).toBeVisible()
})

test('a column tile opens the exact work item', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  await expect(page.locator('.drawer')).toBeVisible()
  await expect(page.locator('.drawer .head-reference')).toHaveText(workItemRef.reference)
})

test('a related item opens over the one it came from, and Back returns to it', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toBeVisible()
  // An item opened from a column is the root of its trail: nowhere to go back to.
  await expect(drawer.locator('.head-back')).toHaveCount(0)

  const openReference = openReferenceReader(page)

  await drawer.getByRole('button', { name: /Relations/i }).click()
  await drawer.locator('.link-open').first().click()
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  await expect.poll(openReference).toBe(blockedWorkItem.reference)

  await drawer.locator('.head-back').click()
  await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  await expect.poll(openReference).toBe(workItemRef.reference)
  await expect(drawer.locator('.head-back')).toHaveCount(0)
})

test("a work item's plan anchor is readable and can be opened where it lives", async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const anchor = page.locator('.drawer .source-anchor')
  await expect(anchor).toHaveText('docs/plans/platform.md#kb:arch-plan')

  // No desktop bridge in a browser, so the honest fallback is a copy that says so.
  await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])
  await anchor.click()
  await expect(page.locator('.drawer .source-notice')).toContainText('copied')
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('docs/plans/platform.md#kb:arch-plan')
})

test('an attached same-key space stays readable but never reaches primary-only projections or writes', async ({
  page,
}) => {
  const executionReads: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/execution/')) executionReads.push(path)
  })
  const { legacyRequests, platformReads } = await installBackend(page, {
    includeAttachedDuplicate: true,
    activity: 'unbound',
  })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(attachedSpaceRef),
      state: { view: 'list' },
    }),
  )

  await expect(page.locator('.work-item-list')).toBeVisible()
  await expect(page.getByRole('button', { name: /New work item/i })).toHaveCount(0)
  await expect(page.locator('.workspace-note')).toContainText(
    'attached data stores remain read-only',
  )
  await expect(page.locator('.work-item-list')).toContainText('Attached:')
  expect(platformReads.find((entry) => entry.startsWith('/api/planning?'))).toContain(
    `data_scope_id=${attachedDataScopeId}`,
  )
  await page.locator('.work-item-list .list-open').first().click()
  await expect(page.locator('.drawer')).toBeVisible()
  await expect
    .poll(() =>
      platformReads.findLast((entry) => entry.startsWith('/api/modules/planning/work-item?')),
    )
    .toContain(`data_scope_id=${attachedDataScopeId}`)
  await expect(page.locator('.drawer')).toContainText('Attached:')
  await expect(page.locator('.drawer .head-actions')).toHaveCount(0)
  await expect(page.locator('.drawer').getByRole('button', { name: /^Execution$/i })).toHaveCount(0)
  expect(executionReads).toEqual([])
  await page
    .locator('.drawer')
    .getByRole('button', { name: /Activity/i })
    .click()
  await expect(page.locator('.drawer .note-form')).toHaveCount(0)
  await page
    .locator('.drawer')
    .getByRole('button', { name: /Relations/i })
    .click()
  await expect(page.locator('.drawer')).toContainText('Attached: Release notes')

  const dashboardRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/dashboard') dashboardRequests.push(`${url.pathname}${url.search}`)
  })
  await page.goto(
    serializePlatformRoute({
      module_id: 'analytics',
      scope: projectScope,
      entity: planningSpaceEntity(attachedSpaceRef),
    }),
  )
  await expect(page.getByRole('status').filter({ hasText: 'writable primary store' })).toBeVisible()
  expect(dashboardRequests).toEqual([])

  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
    }),
  )
  await page.locator('.bell-trigger').click()
  // The row names a space no mapped project answers to, so it leads nowhere.
  await expect(page.locator('.activity-panel .activity-list button')).toBeDisabled()
  await expect(page.locator('.drawer')).toHaveCount(0)
  expect(legacyRequests).toEqual([])
})

test('bound neutral activity opens its exact mapped Planning work item', async ({ page }) => {
  await installBackend(page, { activity: 'bound' })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.bell-trigger').click()
  await page.locator('.activity-panel .activity-list button').click()
  await expect(page.locator('.drawer')).toBeVisible()
  await expect(page.locator('.drawer .head-reference')).toHaveText(workItemRef.reference)
})

/**
 * Every module, at the width the shell actually gets, checked for content that
 * is being cut off without saying so. The oracle is in `overflow.ts`; what this
 * adds is the surfaces to point it at and the widths to point it at them from.
 *
 * 1280 is a laptop and 900 is the narrowest the rail still stands beside a
 * board. A column has a 250px floor in both, so a tile is the one thing here
 * that does not get roomier as the window does — which is why it is where a
 * clipped word keeps turning up.
 */
/** Sessions and improvements have no project-scoped read model of their own. */
test('the portfolio combines projects that were not configured alike', async ({ page }) => {
  await installBackend(page)
  // One reading rather than one dashboard request per project.
  const dashboards: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/dashboard')) {
      dashboards.push(`${url.pathname}${url.search}`)
    }
  })
  await page.goto(serializePlatformRoute({ module_id: 'analytics', scope: globalScope }))

  const projects = page.locator('.portfolio-project')
  await expect(projects).toHaveCount(2)
  expect(dashboards).toEqual(['/api/dashboard/portfolio'])

  // The combined figures are the sums, and the coverage is recomputed rather
  // than merged: one project of the two answered, so the portfolio is partial.
  const totals = page.locator('.portfolio-total')
  await expect(totals).toContainText('6')
  await expect(totals).toContainText('claude-journal-telemetry')

  // The project nothing measured says so in its own row, where a zero would
  // have read as a cheap project rather than an unobserved one.
  await expect(projects.nth(1)).toContainText('Unmeasured')
  await expect(projects.nth(1)).toContainText('—')

  await projects.first().getByRole('button').click()
  await expect(page).toHaveURL(/project/)
  await expect
    .poll(() => dashboards.filter((url) => url === '/api/dashboard?space=MAIN'))
    .toHaveLength(1)
})

const GLOBAL_ONLY_MODULES = new Set(['sessions', 'improvements'])
const MODULE_SCOPES = PLATFORM_MODULE_IDS.map((moduleId) => ({
  moduleId,
  scope: GLOBAL_ONLY_MODULES.has(moduleId) ? globalScope : projectScope,
}))

for (const width of [1280, 900]) {
  test(`no module clips its own content at ${width}px`, async ({ page }) => {
    await installBackend(page)
    await page.setViewportSize({ width, height: 900 })
    for (const { moduleId, scope } of MODULE_SCOPES) {
      await page.goto(serializePlatformRoute({ module_id: moduleId, scope }))
      await expect(page.locator('.module-stage')).toBeVisible()
      // Settle on what the module reports about itself. `networkidle` waits for
      // the network to go quiet, which is timing-dependent by Playwright's own
      // guidance and says nothing about whether the stage has finished painting.
      //
      // `aria-busy` only. `.work-dots` looks like a loading indicator and is one
      // inside a state panel, but on a tile it means an agent is working on that
      // item — which stays true for as long as someone holds it.
      await expect(page.locator('.module-stage [aria-busy="true"]')).toHaveCount(0)
      await expectNoSilentClipping(page, `${moduleId} at ${width}px`)
    }
  })
}
