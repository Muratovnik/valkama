/**
 * The zoom a fold takes and gives back, on the built field: a chain's root folded
 * at the whole view raises the camera to the folded drawing's whole view, and
 * opening the root again returns the camera to the zoom it was folded from.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { chainResponse } from '../fixtures/chain.ts'
import { installBackend } from './backend.ts'
import { graphRoute, smallChain } from './chainFixtures.ts'
import { fitWhole, settledCamera, settledZoom } from './graphFieldCamera.ts'
import { workItem } from './planningFixtures.ts'
import { spaceAnswer } from './servedAnswers.ts'
import { test } from './test.ts'

/**
 * The small chain's root and its six children, the root a goal in the space's read as
 * well as in the chain's: the root is the one frame, and folded it leaves only its header,
 * so the folded drawing's whole view is nearer than the open one's.
 */
async function serveGoalChain(page: Page) {
  const small = smallChain()
  const items = small.items.filter((item) => item.parent_id === workItem.work_item_id)
  const inside = new Set(items.map((item) => item.work_item_id))
  const closed = items.filter((item) => item.state.is_terminal).length
  const chain = {
    ...small.chain,
    // The chain's counts are its members', as the answer's contract holds them.
    total: items.length,
    closed,
    open: items.length - closed,
    workable: items.filter((item) => item.workable).length,
    members: small.chain.members.filter((member) => inside.has(member.work_item_id)),
    edges: [],
  }
  await page.route('**/api/planning/work-item/chain?*', (route) =>
    route.fulfill({ json: chainResponse(chain as never) }),
  )
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(
      spaceAnswer(new URL(route.request().url()).searchParams, (model) => ({
        work_items: [
          ...model.work_items.map((entry) =>
            entry.work_item_id === workItem.work_item_id
              ? { ...entry, kind: 'goal', claim_ref: '', claim_state: null }
              : entry,
          ),
          ...items,
        ],
        links: model.links,
      })),
    ),
  )
}

/**
 * The goal's chain on the graph, its camera at the whole view. The window is low enough
 * that the open frame fits only below full size, and high enough that its folds still show.
 */
async function chainAtWholeView(page: Page, width: number) {
  await page.setViewportSize({ width, height: 700 })
  await installBackend(page)
  await serveGoalChain(page)
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  // The chain opened, not the whole space, which draws the same goal's frame.
  await expect(
    page.getByRole('button', { name: 'Leave chain MAIN-264 and show the whole space' }),
  ).toBeVisible()
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await fitWhole(page)
  return settledZoom(page)
}

/** Press the root's fold, named for what it does now, and wait for the field to settle. */
async function pressRootFold(page: Page, label: 'Collapse' | 'Expand') {
  await page.locator(`.graph-frame button[aria-label^="${label} goal MAIN-264"]`).click()
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  return settledCamera(page)
}

/** Drag the field's ground by its bottom-right corner, clear of every frame and card. */
async function dragField(page: Page) {
  const field = await page.locator('.graph-flow').boundingBox()
  if (!field) throw new Error('the field is drawn')
  const start = { x: field.x + field.width - 40, y: field.y + field.height - 40 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x - 60, start.y - 30, { steps: 6 })
  await page.mouse.up()
}

for (const width of [1440, 1024]) {
  test(`a root folded at the whole view gives the zoom back as it opens at ${width}px`, async ({
    page,
  }) => {
    const whole = await chainAtWholeView(page, width)
    const folded = await pressRootFold(page, 'Collapse')
    // Folded, the drawing is smaller, and the camera came up to its whole view.
    expect(folded.zoom).toBeGreaterThan(whole + 0.01)
    const opened = await pressRootFold(page, 'Expand')
    expect(opened.zoom).toBeCloseTo(whole, 3)
  })
}

test('a root folded at the whole view and opened after a pan keeps the zoom the camera has', async ({
  page,
}) => {
  const whole = await chainAtWholeView(page, 1440)
  const folded = await pressRootFold(page, 'Collapse')
  expect(folded.zoom).toBeGreaterThan(whole + 0.01)
  // The operator drags the field: the zoom is theirs now.
  await dragField(page)
  const panned = await settledCamera(page)
  expect(Math.abs(panned.x - folded.x)).toBeGreaterThan(10)
  const opened = await pressRootFold(page, 'Expand')
  expect(opened.zoom).toBeCloseTo(folded.zoom, 3)
})
