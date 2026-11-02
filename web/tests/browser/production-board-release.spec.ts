/**
 * A tile let go lands in the stack under the pointer, whether or not the board
 * had read the pointer there, in a column and in a lane's cell alike.
 *
 * The drop library reads the pointer on its own beat, every 50ms, and a release
 * can come between two readings. Here the beat is held and struck by hand, so a
 * test says exactly what the board had read when the tile was let go instead of
 * racing the clock. Holding it fails the test when the library stops beating at
 * 50ms: this file then no longer tests what it says, and its reading of the
 * release has to be looked at again.
 *
 * The server is the board suite's double, which keeps the order it is told.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { LONG_EPIC } from './boardFixtures.ts'
import { cell, lane, openBoard, serve, tiles } from './boardPage.ts'
import { test } from './test.ts'

interface Beat {
  /** Run the library's reading once, and say how many beats have been started. */
  strike: () => number
}

/** Take the library's beat out of the clock's hands. A beat started before this is not held. */
function holdTheBeat(page: Page) {
  return page.evaluate(() => {
    const own = window.setInterval
    const started: (() => void)[] = []
    window.setInterval = ((run: () => void, every?: number) => {
      if (every !== 50) return own(run, every)
      started.push(run)
      // A handle the library can clear; it never comes due.
      return own(Function.prototype as () => void, 2 ** 30)
    }) as typeof window.setInterval
    const beat: Beat = {
      strike() {
        started.at(-1)?.()
        return started.length
      },
    }
    Object.assign(window, { beat })
  })
}

async function read(page: Page) {
  const started = await page.evaluate(() => (window as unknown as { beat: Beat }).beat.strike())
  expect(started, 'the library reads the pointer on a 50ms beat').toBeGreaterThan(0)
}

/** A point in the upper or lower half of something on screen, measured as the hand sees it. */
async function point(what: Locator, half: 'lower' | 'upper') {
  const box = await what.boundingBox()
  if (!box) throw new Error('nothing to point at on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height * (half === 'upper' ? 0.25 : 0.75) }
}

/** Pick a tile up, so the pointer's copy of it is drawn and the board has read nothing yet. */
async function pickUp(page: Page, what: Locator) {
  const { x, y } = await point(what, 'upper')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 8, y + 8, { steps: 4 })
  await expect(page.locator('body > .sortable-fallback')).toBeAttached()
}

/** The tiles a reading moved glide to their places; a hand aims at where they end up. */
function settled(page: Page) {
  return page.evaluate(async () => {
    const gliding = document.querySelector('.work-item-board')?.getAnimations({ subtree: true })
    await Promise.allSettled((gliding ?? []).map((animation) => animation.finished))
  })
}

/** Carry the held tile over something and let the board read it there. */
async function pass(page: Page, what: Locator, half: 'lower' | 'upper' = 'upper') {
  const { x, y } = await point(what, half)
  await page.mouse.move(x, y)
  await read(page)
  await settled(page)
}

/** Move straight to something and let go, before the board reads the pointer again. */
async function letGo(page: Page, what: Locator, half: 'lower' | 'upper') {
  const { x, y } = await point(what, half)
  await page.mouse.move(x, y)
  await page.mouse.up()
}

async function board(page: Page, state?: Record<string, string>) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const refuse = { message: null as string | null }
  const writes = await serve(page, refuse)
  await openBoard(page, state)
  await holdTheBeat(page)
  return { refuse, writes }
}

/**
 * What the board says of a move, in the same step as it hands the move up. A write
 * goes out a moment later, so a test of nothing moving reads this as well.
 */
const said = (page: Page) => page.locator('.work-item-board [role="status"]')

const TRANSITION = '/api/planning/work-item/transition'
const REORDER = '/api/planning/work-item/update'

for (const shape of [
  { name: 'a column', state: {}, where: (page: Page) => page.locator('.work-item-board') },
  { name: 'a lane’s cell', state: undefined, where: (page: Page) => lane(page, LONG_EPIC) },
]) {
  test.describe(`let go over ${shape.name}`, () => {
    test('a tile lands there after only passing another', async ({ page }) => {
      const { writes } = await board(page, shape.state)
      const where = shape.where(page)
      const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)

      await pickUp(page, tile('MAIN-402'))
      await pass(page, cell(where, 'dev'))
      // The board has read the column it passes, and draws the tile's place there.
      await expect(cell(where, 'dev').locator('li[data-reference="MAIN-402"]')).toBeAttached()
      // A lane's closed Done cell draws no tiles, and the library takes a tile
      // into an empty stack at the move; a column's Done waits for the beat.
      await letGo(page, cell(where, 'done'), 'upper')

      await expect.poll(() => writes.length).toBe(1)
      expect(writes[0].path).toBe(TRANSITION)
      expect(writes[0].body).toEqual(expect.objectContaining({ id: 'MAIN-402', state: 'done' }))
      expect(writes[0].body).not.toHaveProperty('rank')
    })

    test('a tile takes the place the pointer points at among that stack’s tiles', async ({
      page,
    }) => {
      const { writes } = await board(page, shape.state)
      const where = shape.where(page)
      const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)

      await pickUp(page, tile('MAIN-405'))
      await pass(page, cell(where, 'done'))
      await letGo(page, tile('MAIN-403'), 'upper')
      await expect.poll(() => writes.length).toBe(1)
      expect(writes[0].path).toBe(TRANSITION)
      expect(writes[0].body).toEqual(
        expect.objectContaining({ id: 'MAIN-405', state: 'backlog', rank: 'before:MAIN-403' }),
      )
      await expect.poll(() => tiles(cell(where, 'backlog'))).toContain('MAIN-405')
    })

    test('a tile lands there though the board read nothing at all', async ({ page }) => {
      const { writes } = await board(page, shape.state)
      const where = shape.where(page)
      const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)

      await pickUp(page, tile('MAIN-402'))
      await letGo(page, tile('MAIN-405'), 'lower')
      await expect.poll(() => writes.length).toBe(1)
      expect(writes[0].path).toBe(TRANSITION)
      expect(writes[0].body).toEqual(
        expect.objectContaining({ id: 'MAIN-402', state: 'dev', rank: 'after:MAIN-405' }),
      )
      await expect.poll(() => tiles(cell(where, 'dev'))).toContain('MAIN-402')
    })

    test('a tile carried away and back to the place it left moves nothing', async ({ page }) => {
      const { writes } = await board(page, shape.state)
      const where = shape.where(page)
      const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)
      const backlog = await tiles(cell(where, 'backlog'))

      await pickUp(page, tile('MAIN-402'))
      await pass(page, cell(where, 'dev'))
      await letGo(page, tile('MAIN-403'), 'upper')
      await expect(page.locator('.work-item-board')).not.toHaveClass(/dragging/u)
      await expect(said(page)).toBeEmpty()
      expect(writes).toHaveLength(0)
      expect(await tiles(cell(where, 'backlog'))).toEqual(backlog)
    })

    test('a tile carried away and back to another place reorders its own stack', async ({
      page,
    }) => {
      const { writes } = await board(page, shape.state)
      const where = shape.where(page)
      const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)

      await pickUp(page, tile('MAIN-402'))
      await pass(page, cell(where, 'dev'))
      await letGo(page, tile('MAIN-404'), 'upper')
      await expect.poll(() => writes.length).toBe(1)
      expect(writes[0].path).toBe(REORDER)
      expect(writes[0].body).toEqual(
        expect.objectContaining({ id: 'MAIN-402', rank: 'before:MAIN-404' }),
      )
    })

    test('in the stack a tile stands in, the place drawn is the place it takes', async ({
      page,
    }) => {
      const { writes } = await board(page, shape.state)
      const where = shape.where(page)
      const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)

      // Its neighbours may still be gliding from the last reading, so the pointer's
      // height among them at the release is not asked: the hand sees the drawn place.
      await pickUp(page, tile('MAIN-404'))
      await pass(page, tile('MAIN-403'), 'lower')
      const drawn = await tiles(cell(where, 'backlog'))
      expect(drawn.indexOf('MAIN-404')).toBeLessThan(drawn.indexOf('MAIN-403'))
      await letGo(page, tile('MAIN-402'), 'upper')
      await expect.poll(() => writes.length).toBe(1)
      expect(writes[0].path).toBe(REORDER)
      expect(writes[0].body).toEqual(
        expect.objectContaining({ id: 'MAIN-404', rank: 'before:MAIN-403' }),
      )
    })

    test('a drop the server refuses leaves the tile where it was', async ({ page }) => {
      const { refuse, writes } = await board(page, shape.state)
      refuse.message = 'MAIN-402 is at revision 2, not 1'
      const where = shape.where(page)
      const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)
      const backlog = await tiles(cell(where, 'backlog'))

      await pickUp(page, tile('MAIN-402'))
      await letGo(page, tile('MAIN-405'), 'upper')
      await expect.poll(() => writes.length).toBe(1)
      await expect(page.locator('.notice')).toContainText('MAIN-402 is at revision 2, not 1')
      await expect.poll(() => tiles(cell(where, 'backlog'))).toEqual(backlog)
    })
  })
}

test('a tile let go over its own glide lands in the stack beneath it', async ({ page }) => {
  const { writes } = await board(page)
  const epic = lane(page, LONG_EPIC)
  const held = epic.locator('li[data-reference="MAIN-402"]')
  const left = await point(held, 'lower')

  await pickUp(page, held)
  const { x, y } = await point(cell(epic, 'dev'), 'upper')
  await page.mouse.move(x, y)
  // Just read, the element starts its glide from the cell it left and, a lane's cells
  // clipping nothing, lies over it, under a pointer come back there. Read and released
  // in one task, because the glide runs on its own clock: on a busy machine it ended
  // before a separate release, which then named the cell the tile had reached.
  await page.evaluate((at) => {
    ;(window as unknown as { beat: Beat }).beat.strike()
    document.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: at.x, clientY: at.y }),
    )
  }, left)
  await page.mouse.up()
  await expect(page.locator('.work-item-board')).not.toHaveClass(/dragging/u)
  await expect(said(page)).not.toContainText('in Dev')
  expect(writes.filter((write) => write.body.state === 'dev')).toHaveLength(0)
  await expect.poll(() => tiles(cell(epic, 'backlog'))).toContain('MAIN-402')
})

test('a Done tile carried away and back asks for nothing and keeps its place', async ({ page }) => {
  const { writes } = await board(page, {})
  const where = page.locator('.work-item-board')
  const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)
  const done = await tiles(cell(where, 'done'))
  expect(done[2]).toBe('MAIN-420')

  await pickUp(page, tile('MAIN-420'))
  await pass(page, cell(where, 'dev'))
  // The first place of Done is not this tile's, and Done has no order to change.
  await letGo(page, tile('MAIN-422'), 'upper')
  await expect(where).not.toHaveClass(/dragging/u)
  await expect(said(page)).toBeEmpty()
  expect(writes).toHaveLength(0)
  expect(await tiles(cell(where, 'done'))).toEqual(done)
})

test('a tile let go over another lane stays with what the board read of its own', async ({
  page,
}) => {
  const { writes } = await board(page)
  const epic = lane(page, LONG_EPIC)
  const tile = (reference: string) => epic.locator(`li[data-reference="${reference}"]`)
  const loose = page.locator('li[data-reference="MAIN-430"]')

  // With nothing read, the tile is still home: the other lane does not take it.
  await pickUp(page, tile('MAIN-402'))
  await letGo(page, loose, 'upper')
  await expect(page.locator('.work-item-board')).not.toHaveClass(/dragging/u)
  await expect(said(page)).toBeEmpty()
  expect(writes).toHaveLength(0)

  await pickUp(page, tile('MAIN-402'))
  await pass(page, cell(epic, 'dev'))
  await letGo(page, loose, 'upper')
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual(expect.objectContaining({ id: 'MAIN-402', state: 'dev' }))
})

const columnHead = (where: Locator, state: string) =>
  where.locator(`.work-item-column[data-state="${state}"] .column-head`)

test.describe('let go over a column’s head', () => {
  test('a tile lands on top of that column after only passing another', async ({ page }) => {
    const { writes } = await board(page, {})
    const where = page.locator('.work-item-board')
    const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)
    const [first] = await tiles(cell(where, 'backlog'))

    await pickUp(page, tile('MAIN-405'))
    await pass(page, cell(where, 'done'))
    await letGo(page, columnHead(where, 'backlog'), 'upper')
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].path).toBe(TRANSITION)
    expect(writes[0].body).toEqual(
      expect.objectContaining({ id: 'MAIN-405', state: 'backlog', rank: `before:${first}` }),
    )
    await expect
      .poll(async () => {
        const [top] = await tiles(cell(where, 'backlog'))
        return top
      })
      .toBe('MAIN-405')
  })

  test('a column scrolled down still takes it on top, not at what is in sight', async ({
    page,
  }) => {
    const { writes } = await board(page, {})
    await page.setViewportSize({ width: 1440, height: 420 })
    const where = page.locator('.work-item-board')
    const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)
    const [first] = await tiles(cell(where, 'backlog'))
    const scrolled = await where
      .locator('.work-item-column[data-state="backlog"] .column-scroll')
      .evaluate((scroller) => {
        scroller.scrollTop = scroller.scrollHeight
        return scroller.scrollTop
      })
    expect(scrolled, 'the column has somewhere to scroll at this height').toBeGreaterThan(0)

    await tile('MAIN-405').scrollIntoViewIfNeeded()
    await pickUp(page, tile('MAIN-405'))
    await pass(page, cell(where, 'done'))
    await letGo(page, columnHead(where, 'backlog'), 'upper')
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].body).toEqual(
      expect.objectContaining({ id: 'MAIN-405', state: 'backlog', rank: `before:${first}` }),
    )
  })

  test('Done’s head closes the tile, with no place to name', async ({ page }) => {
    const { writes } = await board(page, {})
    const where = page.locator('.work-item-board')

    await pickUp(page, where.locator('li[data-reference="MAIN-402"]'))
    await pass(page, cell(where, 'dev'))
    await letGo(page, columnHead(where, 'done'), 'upper')
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].path).toBe(TRANSITION)
    expect(writes[0].body).toEqual(expect.objectContaining({ id: 'MAIN-402', state: 'done' }))
    expect(writes[0].body).not.toHaveProperty('rank')
  })

  test('the head of the column it stands in moves it nowhere the board did not draw', async ({
    page,
  }) => {
    const { writes } = await board(page, {})
    const where = page.locator('.work-item-board')
    const backlog = await tiles(cell(where, 'backlog'))

    await pickUp(page, where.locator('li[data-reference="MAIN-403"]'))
    await letGo(page, columnHead(where, 'backlog'), 'upper')
    await expect(where).not.toHaveClass(/dragging/u)
    await expect(said(page)).toBeEmpty()
    expect(writes).toHaveLength(0)
    expect(await tiles(cell(where, 'backlog'))).toEqual(backlog)
  })

  test('the head above a board’s lanes answers nothing: every lane shares it', async ({ page }) => {
    const { writes } = await board(page)
    const epic = lane(page, LONG_EPIC)

    await pickUp(page, epic.locator('li[data-reference="MAIN-402"]'))
    await pass(page, cell(epic, 'dev'))
    await letGo(page, page.locator('.lanes-state').last(), 'upper')
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].body).toEqual(expect.objectContaining({ id: 'MAIN-402', state: 'dev' }))
  })
})

test('a tile let go where no stack lies stays with what the board read', async ({ page }) => {
  const { writes } = await board(page, {})
  const where = page.locator('.work-item-board')
  const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)

  await pickUp(page, tile('MAIN-402'))
  await pass(page, cell(where, 'dev'))
  await letGo(page, page.locator('.app-main > :first-child'), 'upper')
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual(expect.objectContaining({ id: 'MAIN-402', state: 'dev' }))
})

test('a press the browser takes back says nothing about where the pointer is', async ({ page }) => {
  const { writes } = await board(page, {})
  const where = page.locator('.work-item-board')
  const tile = (reference: string) => where.locator(`li[data-reference="${reference}"]`)

  await pickUp(page, tile('MAIN-402'))
  await pass(page, cell(where, 'dev'))
  const over = await point(cell(where, 'done'), 'upper')
  await page.mouse.move(over.x, over.y)
  // What a touch screen does when it takes the gesture for a scroll.
  await page.evaluate(
    ({ x, y }) =>
      document.dispatchEvent(new PointerEvent('pointercancel', { clientX: x, clientY: y })),
    over,
  )
  await page.mouse.up()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual(expect.objectContaining({ id: 'MAIN-402', state: 'dev' }))
})
