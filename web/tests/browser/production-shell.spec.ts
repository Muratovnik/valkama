import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { PLATFORM_MODULE_IDS } from '@/shared/api/platformModuleContract.ts'
import { planningSpaceEntity, planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  attachedDataScopeId,
  attachedSpaceRef,
  blockedWorkItem,
  dataScopeId,
  globalScope,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'

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
  await installBackend(page, { uiPrefs: { module_id: 'settings', scope: globalScope } })
  await page.goto('/')
  await expect(page).toHaveURL(/\/modules\/settings\/global$/u)
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

test('exact work item journey survives Back and reload', async ({ page }) => {
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
  await expect(page.locator('.drawer')).toBeVisible()

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

/** The vertical centre of a box; NaN when there is none, so a comparison on it fails. */
function centreY(box: { height: number; y: number } | null): number {
  return box === null ? Number.NaN : box.y + box.height / 2
}

/** Opens a related card from the one in the column, so Back has a card to return to. */
async function openRelatedCard(page: Page, width: number) {
  await page.setViewportSize({ width, height: 700 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await drawer.getByRole('button', { name: /Relations/i }).click()
  await drawer.locator('.link-open').first().click()
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  return drawer
}

for (const width of [1440, 390]) {
  test(`Back stays visible in the condensed head of a related card at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openRelatedCard(page, width)
    const head = drawer.locator('.drawer-frame-head')
    const back = drawer.locator('.head-back')
    await expect(back).toBeVisible()

    // Read down the body until the head condenses: the reference steps out, Back stays.
    await drawer.locator('.drawer-frame-body').hover()
    for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, 80)
    await expect(head).toHaveClass(/condensed/u)
    await expect(drawer.locator('.head-reference')).toBeHidden()
    await expect(back).toBeVisible()

    await back.click()
    await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
    await expect(back).toHaveCount(0)
  })

  test(`Back sits beside Close in the head's top row at ${width}px, and comes before it`, async ({
    page,
  }) => {
    const drawer = await openRelatedCard(page, width)
    const back = drawer.locator('.head-back')
    const close = drawer.locator('.drawer-frame-close')
    const backBox = await back.boundingBox()
    const closeBox = await close.boundingBox()
    expect(Math.abs(centreY(backBox) - centreY(closeBox))).toBeLessThan(1)
    // As tall as Close, and with the same top: one row, not two controls nearly aligned.
    expect(backBox?.height).toBe(closeBox?.height)
    expect(backBox?.y).toBe(closeBox?.y)
    // The shared labelled ghost, resting on the control fill rather than a bare button.
    await expect(back).toHaveClass(/\bbutton\b.*\bvariant-ghost\b/u)
    expect(await back.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    )
    await expect(back).toHaveText('Back')

    // Keyboard order in the head is Back, then Close.
    await back.focus()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
  })
}

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
  await expect(page.locator('.drawer .discussion-form')).toHaveCount(0)
  await expect(
    page.locator('.drawer').getByRole('button', { name: 'Edit description' }),
  ).toHaveCount(0)
  await page.locator('.drawer').getByRole('button', { name: 'System events', exact: true }).click()
  await expect(page.locator('.drawer .discussion-form')).toHaveCount(0)
  expect(legacyRequests).toEqual([])
})

const MODULE_SCOPES = PLATFORM_MODULE_IDS.map((moduleId) => ({
  moduleId,
  scope: projectScope,
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
