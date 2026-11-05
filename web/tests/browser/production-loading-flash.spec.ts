/**
 * A read that answers quickly shows no loading block, and one that takes long says it is
 * loading and goes on saying so long enough to be read.
 *
 * The block used to stand in the stage from the first frame of a switch of space to the
 * frame its read answered, so a switch that took a fifth of a second flashed «Loading»
 * for that long; a card's drawer hid it for one surface duration and then faded it in,
 * so a read that answered just after that showed a sliver of it. These watch the page on
 * every frame and every mutation, with each read held for as long as a real one takes.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { installBackend } from './backend.ts'
import { watchLoading } from './loadingWatch.ts'
import type { LoadingWatch } from './loadingWatch.ts'
import { projectScope, workItem } from './planningFixtures.ts'
import { test } from './test.ts'
import { firstProject, inSecond, SECOND_TITLE, serveTwoProjects } from './twoProjects.ts'

/** A read that answers well inside the delay: a board of two megabytes reads in about this. */
const QUICK_READ_MS = 150
/** A read that answers only just after the block came up. */
const JUST_PAST_MS = LOADING_DELAY_MS + 40
const SLOW_READ_MS = 1000
/** One frame and a little: what the watch's sampling can take off a span's ends. */
const FRAME_MS = 25

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Switch from the first project's board to the second's, whose read takes `readMs`. */
async function switchBoard(page: Page, readMs: number): Promise<LoadingWatch> {
  await serveTwoProjects(page, () => pause(readMs))
  await page.goto(firstProject())
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await page.locator('.operating-scope [role="combobox"]').click()
  const watched = await watchLoading(page)
  await page.getByRole('option', { name: new RegExp(SECOND_TITLE, 'u') }).click()
  await inSecond(page)
  // The bar counts the new space as soon as it is read; the stage is done once its view stands.
  await expect(
    page.locator('.workspace-stage .platform-state-panel[aria-busy="true"]'),
  ).toHaveCount(0)
  await expect(page.locator('.work-item-board')).toBeVisible()
  return watched()
}

/** Open a card from the board, with its read taking `readMs`. */
async function openCard(page: Page, readMs: number): Promise<LoadingWatch> {
  await installBackend(page)
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
    await pause(readMs)
    await route.fallback()
  })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  const tile = page.locator('.work-item-tile').filter({ hasText: workItem.title }).first()
  await expect(tile).toBeVisible()
  const watched = await watchLoading(page)
  await tile.click()
  // The card's head stands from the space's own record; its body is done once the wait gives way.
  await expect(page.locator('.drawer .card-facts')).toBeVisible()
  await expect(page.locator('.drawer .platform-state-panel[aria-busy="true"]')).toHaveCount(0)
  return watched()
}

/**
 * What a slow read showed, as the four things it must be: one block, where it belongs;
 * after the delay; for long enough to be read; and in a place that kept its size while
 * the block waited to be drawn.
 */
function blockOf({ heights, pressedAt, spans }: LoadingWatch) {
  const [first] = spans
  return {
    places: spans.map((span) => span.where),
    afterDelay: first !== undefined && first.from - pressedAt >= LOADING_DELAY_MS - FRAME_MS,
    readable: first !== undefined && first.to - first.from >= LOADING_MIN_SHOWN_MS - FRAME_MS,
    steady: heights.length === 1,
  }
}

const surfaces = [
  { name: 'a switch of board', act: switchBoard, where: 'workspace-stage' },
  { name: 'a card opened in the drawer', act: openCard, where: 'overlay-surface' },
] as const

for (const { name, act, where } of surfaces) {
  test(`${name} whose read answers in ${QUICK_READ_MS} ms shows no loading block at any moment`, async ({
    page,
  }) => {
    const { spans } = await act(page, QUICK_READ_MS)
    expect(spans).toEqual([])
  })

  test(`${name} whose read takes a second says it is loading, after the delay`, async ({
    page,
  }) => {
    const watched = await act(page, SLOW_READ_MS)
    expect(blockOf(watched), JSON.stringify(watched)).toEqual({
      places: [where],
      afterDelay: true,
      readable: true,
      steady: true,
    })
  })

  test(`${name} whose read answers just after the delay keeps the block long enough to read`, async ({
    page,
  }) => {
    const watched = await act(page, JUST_PAST_MS)
    expect(blockOf(watched), JSON.stringify(watched)).toEqual({
      places: [where],
      afterDelay: true,
      readable: true,
      steady: true,
    })
  })
}

/** Open the page on the first project's board, with its space read taking `readMs`. */
async function loadCold(page: Page, readMs: number): Promise<LoadingWatch> {
  await serveTwoProjects(page)
  await page.route('**/api/planning?*', async (route) => {
    await pause(readMs)
    await route.fallback()
  })
  const watched = await watchLoading(page, { fromLoad: true })
  await page.goto(firstProject())
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  return watched()
}

test(`a page opened on a board whose space answers in ${QUICK_READ_MS} ms shows no loading block`, async ({
  page,
}) => {
  const { spans } = await loadCold(page, QUICK_READ_MS)
  expect(spans).toEqual([])
})

test('a page opened on a board whose space is slow says it is loading, for long enough', async ({
  page,
}) => {
  const { spans } = await loadCold(page, JUST_PAST_MS)
  expect(spans.map((span) => span.where)).toEqual(['workspace-stage'])
  expect(spans[0].to - spans[0].from).toBeGreaterThanOrEqual(LOADING_MIN_SHOWN_MS - FRAME_MS)
})
