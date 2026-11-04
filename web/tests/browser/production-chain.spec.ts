/**
 * A chain read end to end in the built application: the card's section for an
 * epic shaped like MAIN-384, its branch map for a six-lane chain and a small one,
 * the graph scoped to a chain and back, and the chain held in the address, so a
 * reload, a link and Back come back to the same field.
 *
 * Each test saves what it looked at under its own output folder, so a reader can
 * see the composed result and not only that the assertions held.
 */
import { writeFile } from 'node:fs/promises'

import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { branchedChain, smallBranchedChain } from '../fixtures/chainMap.ts'
import { installBackend } from './backend.ts'
import {
  graphRoute,
  largeChainHere,
  longChainHere,
  pointAtWorkUnderWay,
  rootFramed,
  routeState,
  serve,
  smallChain,
} from './chainFixtures.ts'
import { drawnColours } from './contrast.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { attachedWorkItemRef, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

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
  test(`the card reads a MAIN-384-shaped chain at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await installBackend(page)
    await serve(page, largeChainHere())
    const section = await openCard(page)
    // The map leads; one line of totals and the verdict follow it, and what the
    // verdict rests on is one action away.
    const map = await section.locator('.branch-map').boundingBox()
    const line = await section.locator('.chain-summary-line').boundingBox()
    expect((map?.y ?? Infinity) < (line?.y ?? 0)).toBe(true)
    await expect(section.locator('.branch-key-entry').first()).toHaveText(/Done\s*483/u)
    await expect(section.locator('.chain-summary-line')).toContainText('Under the root')
    await expect(section.locator('.chain-forecast')).toHaveText(
      'New work arrives faster than it closes: to converge, more than 7.6 a day must close',
    )
    await expect(section.locator('.chain-chart')).toHaveCount(0)
    const details = section.getByRole('button', { name: 'Chart and pace' })
    await details.click()
    await expect(section.locator('.chain-pace')).toHaveText('Last 7 days: +53 added, −42 done')
    await expect(section.getByRole('img')).toHaveAttribute('aria-label', /616 now/u)
    // Workable is the norm of its group, so no row prints it. A member that
    // waits on an open blocker names what it waits on, in the danger tone.
    await expect(section.locator('.chain-members').getByText('Workable')).toHaveCount(0)
    await expect(section.locator('.chain-row-waiting').first()).toContainText('Waiting on')
    const tone = (selector: string) =>
      section
        .locator(selector)
        .first()
        .evaluate((node) => getComputedStyle(node).color)
    expect(await tone('.chain-row-waiting')).not.toBe(await tone('.chain-row-title'))
    // At a phone's width a row gives the holder's room to the title; the
    // state word and the waiting mark stay.
    const holder = section.locator('.chain-row-holder').first()
    await expect(holder).toBeVisible({ visible: width >= 480 })
    await section.screenshot(shot(info, `chain-card-${width}.png`))
    await section.getByRole('button', { name: 'Show all · 107' }).click()
    await section.getByRole('button', { name: 'Done · 483' }).click()
    await expect(section.locator('.chain-row.is-done')).toHaveCount(8)
    const done = section.locator('.chain-row.is-done').first()
    await done.scrollIntoViewIfNeeded()
    // Only the drawer's body scrolls to bring a row into view; the drawer
    // itself has nothing past its height, so no blank band opens under it.
    const drawerScroll = await page
      .locator('.drawer')
      .evaluate((drawer) => [drawer.scrollTop, drawer.scrollHeight - drawer.clientHeight])
    expect(drawerScroll).toEqual([0, 0])
    await page.locator('.drawer').screenshot(shot(info, `chain-card-expanded-${width}.png`))
  })
}

const mapRoot = {
  id: workItem.work_item_id,
  reference: workItemRef.reference,
  title: workItem.title,
}

/** What a lane's slider and the drawing say in the browser, read at once. */
async function mapReading(page: Page) {
  const section = page.locator('.drawer section.chain')
  return {
    labels: await section.locator('.branch-map-label').allTextContents(),
    lanes: await section.getByRole('slider').count(),
    // Every label line and target stays inside the map's own width.
    outside: await section.locator('.branch-map-canvas').evaluate((canvas) => {
      const edge = canvas.getBoundingClientRect()
      return [...canvas.querySelectorAll('.branch-map-head, .branch-map-lane')]
        .map((node) => node.getBoundingClientRect())
        .filter((box) => box.left < edge.left - 1 || box.right > edge.right + 1).length
    }),
  }
}

for (const width of [1440, 390]) {
  test(`the branch map draws a chain of six lanes at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1400 })
    await installBackend(page)
    await serve(page, branchedChain(mapRoot, 'MAIN'))
    const section = await openCard(page)
    expect(await mapReading(page)).toEqual({
      labels: ['MAIN-264', 'MAIN-7001', 'MAIN-4000', 'MAIN-7002', 'MAIN-4001', 'no epic'],
      lanes: 6,
      outside: 0,
    })
    await expect(section.locator('figcaption')).toHaveText(
      'Branch map: 6 lanes, 617 items; Done 485, Code review 2, Development 11, Blocked 1, Todo 20, Backlog 98.',
    )
    await expectNoSilentClipping(page, `chain map at ${width}px`)
    await section.locator('.branch-map').screenshot(shot(info, `chain-map-large-${width}.png`))

    // Work under way is raised out of the dense lane, and the pointer names it.
    const raised = section.locator('.branch-map-run.raised').first()
    const box = await raised.boundingBox()
    expect(box).not.toBeNull()
    const { x, y, width: across, height: tall } = box ?? { x: 0, y: 0, width: 0, height: 0 }
    await page.mouse.move(x + across / 2, y + tall / 2)
    await expect(section.locator('.branch-tip')).toContainText(/Code review|Development|Blocked/u)
    await page.mouse.move(0, 0)
    await expect(section.locator('.branch-tip')).toHaveCount(0)

    // A lane label narrows the list below to its lane.
    await section.getByRole('button', { name: 'Show only lane MAIN-4000' }).click()
    await expect(section.locator('.chain-lane-chip')).toHaveText('Lane MAIN-4000')
    // The narrowed list is in view, not a chart's height below the label, and
    // the map marks its lane by stepping every other lane back.
    await expect(section.locator('.chain-lane-chip')).toBeInViewport()
    await expect(section.locator('.chain-row').first()).toBeInViewport()
    await expect(section.locator('.branch-map-head.receded')).toHaveCount(5)
    await expect(section.locator('.chain-group-title')).toHaveText([
      'Development · 8',
      'Code review · 1',
      'Todo · 14',
      'Backlog · 56',
      'Blocked · 1',
    ])
    // The lanes that stepped back still read: their labels are not faded, and
    // their quiet tone keeps AA contrast on the drawer's ground.
    const receded = section.locator('.branch-map-head.receded .branch-map-label').first()
    const recededInk = await receded.evaluate(drawnColours)
    expect(recededInk.contrast).toBeGreaterThanOrEqual(4.5)
    await section.locator('.chain-lane-chip').click()
    await expect(section.locator('.chain-lane-chip')).toHaveCount(0)

    const results = await new AxeBuilder({ page })
      .include('.drawer section.chain')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])

    // The keyboard walks the root's lane to its last task and opens it.
    await section.getByRole('slider').first().focus()
    await page.keyboard.press('End')
    await expect(section.getByRole('slider').first()).toHaveAttribute(
      'aria-valuetext',
      '273 of 273',
    )
    await page.keyboard.press('Enter')
    const opened = serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity({ ...workItemRef, reference: 'MAIN-2272' }),
    })
    await expect.poll(() => new URL(page.url()).search).toBe(new URL(opened, page.url()).search)
  })
}

test('the readout of the first lane stays inside a panel scrolled to the map', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page, branchedChain(mapRoot, 'MAIN'))
  const section = await openCard(page)
  const lane = section.getByRole('slider').first()
  // Hovering waits for the card to finish sliding in; then the pointer leaves.
  await lane.hover()
  await page.mouse.move(0, 0)
  // Scroll the card's panel until the map's first lane is the first thing shown.
  const panelTop = await section.locator('.branch-map-canvas').evaluate((canvas) => {
    let panel = canvas.parentElement
    while (panel && !/auto|scroll/u.test(getComputedStyle(panel).overflowY))
      panel = panel.parentElement
    if (!panel) return 0
    panel.scrollTop += canvas.getBoundingClientRect().top - panel.getBoundingClientRect().top
    return panel.getBoundingClientRect().top
  })
  const box = (await lane.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
  expect(box.y - panelTop).toBeLessThan(40)
  // The point is resolved against the lane when the pointer moves, and only
  // once the lane holds still: a box measured beforehand can be stale by then.
  await lane.hover({ position: { x: 200, y: box.height / 2 } })
  await expect(section.locator('.branch-tip')).toBeVisible()
  const tip = await section.locator('.branch-tip').boundingBox()
  expect(tip).not.toBeNull()
  // Above the lane it would rise past the panel's top edge and be cut off.
  expect(tip?.y ?? 0).toBeGreaterThanOrEqual(panelTop)
})

test('the tip the map shows names a state in ink that reads on its ground', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  await installBackend(page)
  await serve(page, branchedChain(mapRoot, 'MAIN'))
  const section = await openCard(page)
  const word = section.locator('.branch-tip .semantic-state[data-state="active"] .state-label')
  await pointAtWorkUnderWay(page, section, word)
  await expect(word).toBeVisible()
  const { contrast } = await word.evaluate(drawnColours, 'own' as const)
  expect(contrast).toBeGreaterThanOrEqual(4.5)
})

test('the branch map gives a small chain a segment, a dot and a name per task', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installBackend(page)
  await serve(page, smallBranchedChain(mapRoot, 'MAIN'))
  const section = await openCard(page)
  expect(await mapReading(page)).toEqual({ labels: ['MAIN-264', 'no epic'], lanes: 2, outside: 0 })
  await expect(section.locator('.branch-map-dot')).not.toHaveCount(0)
  await expect(section.locator('.branch-map-reference').first()).toHaveText('MAIN-1013')
  await expect(section.locator('.branch-map-count').first()).toHaveText('12 of 20 done')
  await expectNoSilentClipping(page, 'small chain map')
  await section.locator('.branch-map').screenshot(shot(info, 'chain-map-small-1440.png'))
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
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
  await expect(page.locator('.flow-node-card')).toHaveCount(10)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  const closed = page.getByRole('switch', { name: 'Draw the closed members of the chain' })
  await expect(closed).toHaveText('Closed · 7')
  await expect(closed).toHaveAttribute('aria-checked', 'false')
  const root = page.getByRole('button', { name: /^MAIN-264 .* · chain root$/u })
  await expect(root).toHaveCount(1)
  await expect(root.locator('.flow-node-root')).toHaveText('root')
  // The card made way for the graph it asked for, and the root is in the frame.
  await expect(page.locator('.drawer')).toHaveCount(0)
  expect(await rootFramed(page)).toBe(true)
  // Its children are filed under the root, which the chip already names.
  await expect(page.locator('.flow-node-epic')).toHaveCount(0)
  await expect(page.locator('.flow-node-card.recessed')).toHaveCount(0)
  await page.locator('.graph').screenshot(shot(info, 'chain-graph-default.png'))

  await closed.click()
  // Every member and the root, closed work recessed.
  await expect(page.locator('.flow-node-card')).toHaveCount(17)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await expect(page.locator('.flow-node-card.recessed')).toHaveCount(7)
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
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
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
  await expect
    .poll(() => routeState(page))
    .toEqual({
      view: 'graph',
      chain: 'MAIN-264',
      chain_scope: 'chain',
    })
  await expect(page.locator('.drawer')).toHaveCount(0)

  await page.reload()
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
  await expect(page.locator('.flow-node-card')).toHaveCount(10)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  // A reload frames the root again, as entering from the card did.
  expect(await rootFramed(page)).toBe(true)

  // The closed switch is in the address too, and a reload keeps it.
  await page.getByRole('switch', { name: 'Draw the closed members of the chain' }).click()
  await expect
    .poll(() => routeState(page))
    .toEqual({
      view: 'graph',
      chain: 'MAIN-264',
      chain_scope: 'chain',
      closed: true,
    })
  await page.reload()
  await expect(page.locator('.flow-node-card')).toHaveCount(17)
  await expect(
    page.getByRole('switch', { name: 'Draw the closed members of the chain' }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('switch', { name: 'Draw the closed members of the chain' }).click()
  await expect
    .poll(() => routeState(page))
    .toEqual({
      view: 'graph',
      chain: 'MAIN-264',
      chain_scope: 'chain',
    })

  // Another view keeps the chain: the board draws only its members and root,
  // and carries the same chip to leave it.
  await page.getByRole('radio', { name: 'Kanban', exact: true }).click()
  const kept = { view: 'kanban', chain: 'MAIN-264', chain_scope: 'chain' }
  await expect.poll(() => routeState(page)).toEqual(kept)
  await expect(page.locator('.workspace-chip')).toHaveText('Chain MAIN-264 · 17')
  await expect(page.locator('.work-item-board [data-reference]')).toHaveCount(17)
  await page.locator('.workspace-chip').click()
  await expect.poll(() => routeState(page)).toEqual({ view: 'kanban' })
  await page.getByRole('radio', { name: 'Graph', exact: true }).click()
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  await expect(chip).toHaveCount(0)

  // Back in the chain from a link, the chip is the other way out.
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
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
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
  // The card closed on its own, a step after the chain was named: Back is the
  // card again, over the same chain.
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(chip).toBeVisible()

  await page.goBack()
  await expect(page.locator('.drawer section.chain')).toBeVisible()
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
  await page.goForward()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(chip).toHaveText('Chain MAIN-264 · 17')

  // Leaving by the chip replaces the place rather than adding one, as a view
  // switch does, so Back is the card that was open before it.
  await chip.click()
  await expect(chip).toHaveCount(0)
  await page.goBack()
  await expect(page.locator('.drawer section.chain')).toBeVisible()
  await expect(chip).toHaveText('Chain MAIN-264 · 17')
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
  await expect(chip).toHaveText('Chain MAIN-264 · 610')
  // The root, the 120 open members, the closed epic three of them are under and
  // the epic that closed with all of its work.
  await expect(page.locator('.flow-node-card')).toHaveCount(123)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  timings.push(`default, 123 nodes: link to settled ${Date.now() - started} ms`)
  const whole = page.getByRole('button', { name: 'Fit whole graph' })
  await page.locator('.graph').screenshot(shot(info, 'long-chain-default.png'))
  await whole.click()
  await page.locator('.graph').screenshot(shot(info, 'long-chain-default-whole.png'))

  const closed = page.getByRole('switch', { name: 'Draw the closed members of the chain' })
  await expect(closed).toHaveText('Closed · 487')
  let toggled = Date.now()
  await closed.click()
  await expect(page.locator('.flow-node-card')).toHaveCount(610, { timeout: 60_000 })
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u, { timeout: 60_000 })
  timings.push(`closed shown, 610 nodes: switch to settled ${Date.now() - toggled} ms`)
  await page.locator('.graph').screenshot(shot(info, 'long-chain-closed.png'))
  await whole.click()
  await page.locator('.graph').screenshot(shot(info, 'long-chain-closed-whole.png'))

  toggled = Date.now()
  await closed.click()
  await expect(page.locator('.flow-node-card')).toHaveCount(123)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  timings.push(`closed hidden again, 123 nodes: switch to settled ${Date.now() - toggled} ms`)
  // Kept beside the screenshots, so a reader sees what the change cost and saved.
  await writeFile(info.outputPath('timings.txt'), timings.join('\n'))
})
