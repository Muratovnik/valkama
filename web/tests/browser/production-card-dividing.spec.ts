/**
 * Dividing work from its card, in the built application.
 *
 * «…» on the card's bar offers what the item's place allows, before the pin. Splitting a part
 * off a task opens a window that names the part and chooses the open conditions it takes; the
 * card then reads the task again, without them, and says in Relations where they went.
 * Converting a task into a stage, converting a stage with nothing under it back into a task and
 * moving work out of its goal each ask in the band under the bar, and moving out asks why first.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import type { BackendOptions } from './backend.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import {
  CONDITIONS,
  GOAL,
  goalSpace,
  leftSpace,
  movedOutCard,
  PART,
  placedCard,
  splitCard,
  stageCard,
} from './served/dividing.ts'
import { stepBoxOffsets } from './stepBoxes.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: spaceScope,
  entity: planningWorkItemEntity(workItemRef),
})
const shot = (path: string) => ({ path, animations: 'disabled' as const })
type Read = Record<string, unknown>
type Sent = Record<string, unknown>

async function openCard(page: Page, width: number, options: BackendOptions) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, options)
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  // The drawer slides in: measured on its way, it stands past the window's edge.
  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  )
  return drawer
}

type Answer = (read: Read) => object

/**
 * The card read as `before` says until a write to `path` is answered, and as `after` says from
 * then on, the space read as `space` and then as `spaceAfter`; every write, in order, as the
 * server receives it.
 */
async function readsAround(
  page: Page,
  width: number,
  write: { after: Answer; before: Answer; path: string; spaceAfter?: Answer },
) {
  const { path, before, after, spaceAfter = goalSpace } = write
  let written = false
  const drawer = await openCard(page, width, {
    space: (model) => (written ? spaceAfter : goalSpace)(model),
    card: (read) => (written ? after : before)(read),
  })
  const sent: Sent[] = []
  await page.route(`**${path}`, async (route) => {
    sent.push(route.request().postDataJSON() as Sent)
    written = true
    await route.fulfill({ json: {} })
  })
  return { drawer, sent }
}

async function choose(page: Page, drawer: Locator, entry: string) {
  await drawer
    .locator('.drawer-frame-bar')
    .getByRole('button', { name: 'More', exact: true })
    .click()
  await page.getByRole('menuitem', { name: entry, exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** Nothing on the page is wider than the window, and `box` stands inside it. */
async function fitsWindow(page: Page, box: Locator) {
  const width = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const rect = await box.boundingBox()
  expect(rect?.x).toBeGreaterThanOrEqual(0)
  expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(width)
}

for (const width of [1280, 390]) {
  test(`«…» offers a task under a goal its split, its stage and its move out before the pin at ${width}px`, async ({
    page,
  }, info) => {
    const drawer = await openCard(page, width, { space: goalSpace, card: placedCard })
    await drawer
      .locator('.drawer-frame-bar')
      .getByRole('button', { name: 'More', exact: true })
      .click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Split off a part…',
      'Turn into a stage',
      'Move out of the goal…',
    ])
    await fitsWindow(page, menu)
    await page.screenshot(shot(info.outputPath(`menu-${width}-dividing.png`)))
  })
}

for (const width of [1280, 620, 390]) {
  test(`a part is split off with the conditions chosen and the card says where they went at ${width}px`, async ({
    page,
  }, info) => {
    const { drawer, sent } = await readsAround(page, width, {
      path: '/api/planning/work-items',
      before: placedCard,
      after: splitCard,
    })
    await choose(page, drawer, 'Split off a part…')
    const dialog = page.getByRole('dialog', { name: 'Split off a part' })
    // Only the open conditions are offered: the done one stays with the task.
    await expect(dialog.locator('[data-step]')).toHaveText([CONDITIONS[1].text, CONDITIONS[2].text])
    const create = dialog.getByRole('button', { name: 'Create', exact: true })
    await expect(create).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Alert settings survive a restart')
    await expect(dialog).toContainText('Choose a condition: a part takes at least one.')
    await dialog.locator(`[data-step="${CONDITIONS[2].id}"]`).getByRole('checkbox').click()
    await expect(create).toBeEnabled()
    await fitsWindow(page, dialog)
    // Each box stands on its condition's first line, the wrapped one included.
    const offsets = await stepBoxOffsets(dialog)
    expect(offsets).toHaveLength(2)
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1)
    await page.screenshot(shot(info.outputPath(`dialogs-${width}-split.png`)))

    await create.click()
    await expect(dialog).toBeHidden()
    expect(sent).toEqual([
      {
        author: 'user',
        split_from: workItemRef.reference,
        title: 'Alert settings survive a restart',
        steps: [CONDITIONS[2].id],
      },
    ])
    // The card reads the task again: the condition went, and Relations says where.
    await expect(drawer.getByText(CONDITIONS[2].text)).toHaveCount(0)
    await expect(drawer.getByText(CONDITIONS[1].text).first()).toBeVisible()
    await drawer.getByRole('tab', { name: 'Relations', exact: true }).click()
    const moved = drawer.locator(`[data-moved="${PART}"]`)
    await moved.scrollIntoViewIfNeeded()
    await expect(moved.locator('span')).toHaveText([PART, '1 condition'])
    await drawer.screenshot(shot(info.outputPath(`card-${width}-split-moved.png`)))
  })
}

for (const width of [1280, 390]) {
  test(`a task under a goal converts into a stage, asked in place, at ${width}px`, async ({
    page,
  }, info) => {
    const { drawer, sent } = await readsAround(page, width, {
      path: '/api/planning/work-item/convert',
      before: placedCard,
      after: stageCard,
    })
    await choose(page, drawer, 'Turn into a stage')
    const strip = drawer.locator('[data-dividing="convert"]')
    await expect(strip).toContainText(`Turn ${workItemRef.reference} into a stage?`)
    await fitsWindow(page, strip)
    await drawer.screenshot(shot(info.outputPath(`confirm-${width}-convert-stage.png`)))
    await strip.getByRole('button', { name: 'Turn into a stage', exact: true }).click()
    await expect(strip).toHaveCount(0)
    expect(sent).toEqual([{ author: 'user', id: workItemRef.reference, to: 'stage' }])
    // The card reads a stage now, in the state it derives.
    await expect(drawer.locator('.card-identity')).toContainText('Stage')
    await expect(drawer.locator('.card-facts .card-state').first()).toHaveText('Not started')
  })

  test(`a stage with nothing under it converts back into a task at ${width}px`, async ({
    page,
  }, info) => {
    const { drawer, sent } = await readsAround(page, width, {
      path: '/api/planning/work-item/convert',
      before: stageCard,
      after: placedCard,
    })
    await choose(page, drawer, 'Return to a task')
    const strip = drawer.locator('[data-dividing="to-task"]')
    await expect(strip).toContainText(
      `Return stage ${workItemRef.reference} to a task? Nothing is inside; its goal and its place in it stay.`,
    )
    await fitsWindow(page, strip)
    await drawer.screenshot(shot(info.outputPath(`confirm-${width}-convert-task.png`)))
    await strip.getByRole('button', { name: 'Return to a task', exact: true }).click()
    await expect(strip).toHaveCount(0)
    expect(sent).toEqual([{ author: 'user', id: workItemRef.reference, to: 'task' }])
    // The card reads a task again, in the state it stands in.
    await expect(drawer.locator('.card-identity')).toContainText('Task')
    await expect(drawer.locator('.card-facts .card-state').first()).toHaveText('In progress')
  })

  test(`work moves out of its goal with its reason at ${width}px`, async ({ page }, info) => {
    const { drawer, sent } = await readsAround(page, width, {
      path: '/api/planning/work-item/move-out',
      before: placedCard,
      after: movedOutCard,
      spaceAfter: leftSpace,
    })
    await expect(drawer.locator('[data-fact="parent"]')).toContainText(GOAL.reference)
    await choose(page, drawer, 'Move out of the goal…')
    const strip = drawer.locator('[data-dividing="move-out"]')
    await expect(strip.getByRole('textbox')).toBeFocused()
    await expect(strip).toContainText(
      `Move ${workItemRef.reference} out of ${GOAL.reference}? The card goes to the top level, to «Backlog».`,
    )
    const press = strip.getByRole('button', { name: 'Move out', exact: true })
    await press.click()
    await expect(strip.getByRole('alert')).toHaveText(
      `Say why it leaves: ${GOAL.reference} keeps the reason.`,
    )
    expect(sent).toEqual([])

    await strip.getByRole('textbox').fill('It belongs to the release, not to the alerts')
    await expect(strip.getByRole('alert')).toBeHidden()
    await fitsWindow(page, strip)
    await drawer.screenshot(shot(info.outputPath(`confirm-${width}-move-out.png`)))
    await press.click()
    await expect(strip).toHaveCount(0)
    expect(sent).toEqual([
      {
        author: 'user',
        id: workItemRef.reference,
        reason: 'It belongs to the release, not to the alerts',
      },
    ])
    // The card reads it at the top level: no parent, in the triage state.
    await expect(drawer.locator('.card-facts .card-state').first()).toHaveText('Backlog')
    await expect(drawer.locator('[data-fact="parent"]')).toHaveCount(0)
  })
}
