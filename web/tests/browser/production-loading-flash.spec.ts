/**
 * A read that answers quickly shows no loading block, and one that takes long says it is
 * loading and goes on saying so long enough to be read.
 *
 * The block used to stand in the stage from the first frame of a switch of space to the
 * frame its read answered, so a switch that took a fifth of a second flashed «Loading»
 * for that long; a card's drawer hid it for one surface duration and then faded it in,
 * so a read that answered just after that showed a sliver of it. These watch the page on
 * every frame and every mutation, with each read held for as long as a real one takes.
 *
 * A quick read is one that answers inside the delay, which is a timer of the page's, so it is
 * timed on the page's clock: the clock stands from before the press, the read is held until the
 * test has run the clock as long as the read takes, and the clock then runs past the delay. Held
 * on the wall, a busy machine let the answer reach the page after the delay, and the block came.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { installBackend } from './backend.ts'
import { CARD_CHUNK, cardCodeResident } from './cardCode.ts'
import { watchLoading } from './loadingWatch.ts'
import type { LoadingWatch } from './loadingWatch.ts'
import { standClock } from './pageClock.ts'
import { spaceScope, workItem } from './planningFixtures.ts'
import { test } from './test.ts'
import { firstSpace, inSecond, SECOND_TITLE, serveTwoSpaces } from './twoSpaces.ts'

/** A read that answers well inside the delay: a board of two megabytes reads in about this. */
const QUICK_READ_MS = 150
/** A read that answers only just after the block came up. */
const JUST_PAST_MS = LOADING_DELAY_MS + 40
const SLOW_READ_MS = 1000
/** One frame and a little: what the watch's sampling can take off a span's ends. */
const FRAME_MS = 25

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * How a held read answers: `hold` is what its route waits on; `pressing` runs just before the press
 * that starts it, `pressed` once the press has landed, and `stood` once the view stands.
 */
interface Read {
  hold: () => Promise<unknown>
  pressed?: () => Promise<void>
  pressing?: () => Promise<void>
  stood?: () => Promise<void>
}

/** A read held `ms` of the test process's wall: long enough either way of the delay. */
const onTheWall = (ms: number): Read => ({ hold: () => pause(ms) })

/**
 * A read that takes `ms` of the page's clock, which stands from just before the press: held from
 * its request until the test has run the clock that far, then let go; once the view stands the
 * clock runs past the delay and the least a block would stay, so a block the read did not stop
 * would have come and gone by then. The spec installs the clock before the page opens.
 */
function onThePageClock(page: Page, ms: number): Read {
  const read = { ask: () => {}, answer: () => {} }
  const asked = new Promise<void>((done) => (read.ask = done))
  const answered = new Promise<void>((done) => (read.answer = done))
  return {
    hold: () => {
      read.ask()
      return answered
    },
    pressing: () => standClock(page),
    pressed: async () => {
      await asked
      await page.clock.runFor(ms)
      read.answer()
    },
    stood: () => page.clock.runFor(LOADING_DELAY_MS + LOADING_MIN_SHOWN_MS),
  }
}

/** Switch from the first project's board to the second's, whose read answers as `read` does. */
async function switchBoard(page: Page, read: Read): Promise<LoadingWatch> {
  await serveTwoSpaces(page, read.hold)
  await page.goto(firstSpace())
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await page.locator('.operating-scope [role="combobox"]').click()
  const watched = await watchLoading(page)
  await read.pressing?.()
  await page.getByRole('option', { name: new RegExp(SECOND_TITLE, 'u') }).click()
  await read.pressed?.()
  await inSecond(page)
  // The bar counts the new space as soon as it is read; the stage is done once its view stands.
  await expect(
    page.locator('.workspace-stage .platform-state-panel[aria-busy="true"]'),
  ).toHaveCount(0)
  await expect(page.locator('.work-item-board')).toBeVisible()
  await read.stood?.()
  return watched()
}

/**
 * Open a card from the board, with its read answering as `read` does. The card's code is
 * resident first, as the board's download leaves it: a card opened while it still downloads
 * waits on the download too, which `production-lazy.spec.ts` reads, and a page clock stood across
 * that download would date it from before the stand's leap ahead (`standClock`).
 */
async function openCard(page: Page, read: Read): Promise<LoadingWatch> {
  await installBackend(page)
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
    await read.hold()
    await route.fallback()
  })
  const code = page.waitForResponse(CARD_CHUNK)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
  const tile = page.locator('.work-item-tile').filter({ hasText: workItem.title }).first()
  await expect(tile).toBeVisible()
  await cardCodeResident(page, code)
  const watched = await watchLoading(page)
  await read.pressing?.()
  await tile.click()
  await read.pressed?.()
  // The card's head stands from the space's own record; its body is done once the wait gives way.
  await expect(page.locator('.drawer .card-facts')).toBeVisible()
  await expect(page.locator('.drawer .platform-state-panel[aria-busy="true"]')).toHaveCount(0)
  await read.stood?.()
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
  { name: 'a card opened in the drawer', act: openCard, where: 'drawer' },
] as const

for (const { name, act, where } of surfaces) {
  test(`${name} whose read answers in ${QUICK_READ_MS} ms shows no loading block at any moment`, async ({
    page,
  }) => {
    await page.clock.install()
    const { spans } = await act(page, onThePageClock(page, QUICK_READ_MS))
    expect(spans).toEqual([])
  })

  test(`${name} whose read takes a second says it is loading, after the delay`, async ({
    page,
  }) => {
    const watched = await act(page, onTheWall(SLOW_READ_MS))
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
    const watched = await act(page, onTheWall(JUST_PAST_MS))
    expect(blockOf(watched), JSON.stringify(watched)).toEqual({
      places: [where],
      afterDelay: true,
      readable: true,
      steady: true,
    })
  })
}

/** Open the page on the first project's board, with its space read answering as `read` does. */
async function loadCold(page: Page, read: Read): Promise<LoadingWatch> {
  await serveTwoSpaces(page)
  await page.route('**/api/planning?*', async (route) => {
    await read.hold()
    await route.fallback()
  })
  const watched = await watchLoading(page, { fromLoad: true })
  await read.pressing?.()
  await page.goto(firstSpace())
  await read.pressed?.()
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await read.stood?.()
  return watched()
}

test(`a page opened on a board whose space answers in ${QUICK_READ_MS} ms shows no loading block`, async ({
  page,
}) => {
  // The page opens on a clock that already stands, and its first read is held on it.
  await page.clock.install()
  const { spans } = await loadCold(page, onThePageClock(page, QUICK_READ_MS))
  expect(spans).toEqual([])
})

test('a page opened on a board whose space is slow says it is loading, for long enough', async ({
  page,
}) => {
  const { spans } = await loadCold(page, onTheWall(JUST_PAST_MS))
  expect(spans.map((span) => span.where)).toEqual(['workspace-stage'])
  expect(spans[0].to - spans[0].from).toBeGreaterThanOrEqual(LOADING_MIN_SHOWN_MS - FRAME_MS)
})
