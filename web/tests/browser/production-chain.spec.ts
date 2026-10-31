/**
 * A chain read end to end in the built application: the card's section for an
 * epic shaped like VAL-384, the graph scoped to a chain and back, and the chain
 * held in the address, so a reload, a link and Back come back to the same field.
 *
 * Each test saves what it looked at under its own output folder, so a reader can
 * see the composed result and not only that the assertions held.
 */
import { writeFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainResponse } from '../fixtures/chain.ts'
import { installBackend } from './backend.ts'
import { largeChainHere, longChainHere, smallChain } from './chainFixtures.ts'
import { attachedWorkItemRef, projectScope, spaceRef, workItemRef } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

/** What the address's module state says, decoded. */
function routeState(page: Page): Record<string, unknown> {
  const encoded = new URL(page.url()).searchParams.get('state')
  return encoded === null
    ? {}
    : (JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>)
}

/** The space's graph, at an address naming `state` beside the graph view. */
function graphRoute(state: Record<string, string>) {
  return serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningSpaceEntity(spaceRef),
    state: { view: 'graph', ...state },
  })
}

async function serve(
  page: Page,
  chain: unknown,
  extraItems: unknown[] = [],
  extraLinks: unknown[] = [],
) {
  await page.route('**/api/planning/work-item/chain?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(chainResponse(chain as never)),
    }),
  )
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      response.body.work_items = [...response.body.work_items, ...(extraItems as never[])]
      response.body.links = [...response.body.links, ...(extraLinks as never[])]
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

async function openCard(page: Page, view?: 'graph') {
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
      ...(view ? { state: { view } } : {}),
    }),
  )
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  return section
}

function shot(info: TestInfo, name: string) {
  return { path: info.outputPath(name), animations: 'disabled' as const }
}

for (const width of [1440, 390]) {
  test(`the card reads a VAL-384-shaped chain at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await installBackend(page)
    await serve(page, largeChainHere())
    const section = await openCard(page)
    await expect(section.locator('.chain-headline')).toHaveText('616 in all · 483 closed')
    await expect(section.locator('.chain-breakdown')).toHaveText(
      '133 open: development 11 · code review 1 · todo 14 · backlog 107; workable: 115 — unheld and unblocked, backlog included',
    )
    await expect(section.locator('.chain-trend')).toContainText('scope is growing')
    await expect(section.getByRole('img')).toHaveAttribute('aria-label', /616 now/u)
    await section.screenshot(shot(info, `chain-card-${width}.png`))
    await section.getByRole('button', { name: 'Show all · 107' }).click()
    await section.getByRole('button', { name: 'Done · 483' }).click()
    await expect(section.locator('.chain-row.is-done')).toHaveCount(8)
    const done = section.locator('.chain-row.is-done').first()
    await done.scrollIntoViewIfNeeded()
    await page.locator('.drawer').screenshot(shot(info, `chain-card-expanded-${width}.png`))
  })
}

test('a wrapped origins line never ends on a separator', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  await installBackend(page)
  await serve(page, largeChainHere())
  const section = await openCard(page)
  const line = section.locator('.chain-origin-later')
  await expect(line).toBeVisible()
  // Each entry's box, and what its two pseudo-elements draw, read in the browser.
  const entries = await line.locator('.chain-origin-entry').evaluateAll((nodes) =>
    nodes.map((node) => ({
      top: Math.round(node.getBoundingClientRect().top),
      before: getComputedStyle(node, '::before').content,
      after: getComputedStyle(node, '::after').content,
      text: node.textContent,
    })),
  )
  expect(entries).toHaveLength(3)
  // At this width the line does wrap, so the case under test is on screen.
  expect(new Set(entries.map((entry) => entry.top)).size).toBeGreaterThan(1)
  // The separator opens every entry but the first and closes none.
  expect(entries.map((entry) => [entry.before, entry.after])).toEqual([
    ['none', 'none'],
    ['"·"', 'none'],
    ['"·"', 'none'],
  ])
  // What a reader hears keeps each piece's own space and dash, and one separator
  // between two entries.
  await expect(line).toMatchAriaSnapshot(`
    - listitem:
      - text: "Discovered later:"
      - button "MAIN-779"
      - text: — 242 (open 100) · no epic — 88 (open 30) ·
      - button "MAIN-900"
      - text: — 13 (open 3)
  `)
  await line.screenshot(shot(info, 'chain-origins-390.png'))
})

test('an attached store item says where a chain is read, and asks for none', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  await installBackend(page, { includeAttachedDuplicate: true })
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/planning/work-item/chain')) asked.push(request.url())
  })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(attachedWorkItemRef),
    }),
  )
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  await expect(section.locator('.chain-quiet')).toHaveText(
    'The chain is available only for work items of the primary store.',
  )
  await page.locator('.drawer').screenshot(shot(info, 'chain-attached-390.png'))
  expect(asked).toEqual([])
})

test('Show on graph draws the open part of the chain, its root marked, and the rest on request', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  const section = await openCard(page)
  await section.getByRole('button', { name: 'Show on graph' }).click()
  const chip = page.locator('.graph-chip')
  // The chip counts the whole chain; the field draws the root and the 9 open members.
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  await expect(page.locator('.flow-node-card')).toHaveCount(10)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  const closed = page.getByRole('switch', { name: 'Draw the closed members of the chain' })
  await expect(closed).toHaveText('Closed · 7')
  await expect(closed).toHaveAttribute('aria-checked', 'false')
  const root = page.getByRole('button', { name: /^MAIN-264 .* · chain root$/u })
  await expect(root).toHaveCount(1)
  await expect(root.locator('.flow-node-root')).toHaveText('root')
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(page.locator('.flow-node-card.recessed')).toHaveCount(0)
  await page.locator('.graph').screenshot(shot(info, 'chain-graph-default.png'))

  await closed.click()
  // Every member and the root, closed work recessed.
  await expect(page.locator('.flow-node-card')).toHaveCount(17)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await expect(page.locator('.flow-node-card.recessed')).toHaveCount(7)
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  await page.locator('.graph').screenshot(shot(info, 'chain-graph-closed.png'))

  await chip.click()
  await expect(chip).toHaveCount(0)
  // The whole space again: its items, with the unlinked ones left out.
  await expect(page.getByRole('switch', { name: 'Draw items with no links' })).toBeVisible()
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await expect(page.locator('.flow-node-root')).toHaveCount(0)
  await page.locator('.graph').screenshot(shot(info, 'space-graph-linked-only.png'))
})

test('the chain is held in the address: a reload keeps it, and leaving removes it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  const section = await openCard(page)
  await section.getByRole('button', { name: 'Show on graph' }).click()
  const chip = page.locator('.graph-chip')
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  expect(routeState(page)).toEqual({ view: 'graph', chain: 'MAIN-264', chain_scope: 'chain' })

  await page.reload()
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  await expect(page.locator('.flow-node-card')).toHaveCount(10)
  // The card is in the address too, and came back with the chain.
  await expect(page.locator('.drawer section.chain')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)

  // Another view of the space is the whole space, and the address says so.
  await page.getByRole('button', { name: 'Kanban', exact: true }).click()
  await expect.poll(() => routeState(page)).toEqual({ view: 'kanban' })
  await page.getByRole('button', { name: 'Graph', exact: true }).click()
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  await expect(chip).toHaveCount(0)

  // Back in the chain from a link, the chip is the other way out.
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  await chip.click()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => routeState(page)).toEqual({ view: 'graph' })
})

test('Back and Forward land on the field the address names', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  const section = await openCard(page)
  await section.getByRole('button', { name: 'Show on graph' }).click()
  const chip = page.locator('.graph-chip')
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  // Closing the card is a step of its own; the chain stays.
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(chip).toBeVisible()

  await page.goBack()
  await expect(page.locator('.drawer section.chain')).toBeVisible()
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  await page.goForward()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(chip).toHaveText('Chain MAIN-264 · 16')

  // Leaving by the chip replaces the place rather than adding one, as a view
  // switch does, so Back is the card that was open before it.
  await chip.click()
  await expect(chip).toHaveCount(0)
  await page.goBack()
  await expect(page.locator('.drawer section.chain')).toBeVisible()
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
})

test('a link naming a chain the space cannot show draws the whole space with a notice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  const asked: string[] = []
  await page.route('**/api/planning/work-item/chain?*', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('id') ?? '')
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'invalid_request', message: 'no work item MAIN-9999' },
      }),
    })
  })
  const notice = page.locator('.notice')
  const chip = page.locator('.graph-chip')

  await page.goto(graphRoute({ chain: 'MAIN-9999', chain_scope: 'chain' }))
  await expect(notice).toHaveText(
    'Chain MAIN-9999 cannot be shown here: no work item MAIN-9999. The graph shows the whole space.',
  )
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.flow-node-card').first()).toBeVisible()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => routeState(page)).toEqual({ view: 'graph' })

  // A value that is no reference at all is refused without asking the server.
  await page.goto(graphRoute({ chain: 'not a reference' }))
  await expect(notice).toHaveText(
    'This link names no chain this space can read; the graph shows the whole space.',
  )
  await expect(page.locator('.flow-node-card').first()).toBeVisible()
  await expect(chip).toHaveCount(0)
  await expect.poll(() => routeState(page)).toEqual({ view: 'graph' })
  expect(asked).toEqual(['MAIN-9999'])
})

test('a long chain opened from a link draws its open part, and all of it on request', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = longChainHere()
  await serve(page, chain, items, edges)
  const timings: string[] = []
  const started = Date.now()
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  const chip = page.locator('.graph-chip')
  await expect(chip).toHaveText('Chain MAIN-264 · 600')
  // The root, the 120 open members and the closed epic three of them are under.
  await expect(page.locator('.flow-node-card')).toHaveCount(122)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  timings.push(`default, 122 nodes: link to settled ${Date.now() - started} ms`)
  const whole = page.getByRole('button', { name: 'Fit whole graph' })
  await page.locator('.graph').screenshot(shot(info, 'long-chain-default.png'))
  await whole.click()
  await page.locator('.graph').screenshot(shot(info, 'long-chain-default-whole.png'))

  const closed = page.getByRole('switch', { name: 'Draw the closed members of the chain' })
  await expect(closed).toHaveText('Closed · 479')
  let toggled = Date.now()
  await closed.click()
  await expect(page.locator('.flow-node-card')).toHaveCount(601, { timeout: 60_000 })
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u, { timeout: 60_000 })
  timings.push(`closed shown, 601 nodes: switch to settled ${Date.now() - toggled} ms`)
  await page.locator('.graph').screenshot(shot(info, 'long-chain-closed.png'))
  await whole.click()
  await page.locator('.graph').screenshot(shot(info, 'long-chain-closed-whole.png'))

  toggled = Date.now()
  await closed.click()
  await expect(page.locator('.flow-node-card')).toHaveCount(122)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  timings.push(`closed hidden again, 122 nodes: switch to settled ${Date.now() - toggled} ms`)
  // Kept beside the screenshots, so a reader sees what the change cost and saved.
  await writeFile(info.outputPath('timings.txt'), timings.join('\n'))
})
