/**
 * However a drag ends, the next click on a tile opens its card, and the release itself
 * opens nothing.
 *
 * The drop library sets a flag at the start of a drag to swallow the click a release ends
 * with, and only that click or a later reading of another tile clears it. A release here
 * ends with no click at all, so the flag stood until the person's next click, on any tile,
 * and swallowed that. These presses come from a real pointer, in the built application,
 * and the click follows the release as closely as a test can make it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { centre, openBoard, serve } from './boardPage.ts'
import { frames } from './frames.ts'
import { test } from './test.ts'

const REFUSAL = 'MAIN-402 is at revision 2, not 1'
const HELD = 'MAIN-402'
const OTHER = 'MAIN-403'

const tile = (where: Locator, reference: string) =>
  where.locator(`li[data-reference="${reference}"]`)

/** Press on the tile and carry it far enough to be a drag; where the press went down. */
async function pickUp(page: Page, where: Locator) {
  const { x, y } = await centre(tile(where, HELD))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 8, y + 8, { steps: 4 })
  await expect(page.locator('body > .sortable-fallback')).toBeAttached()
  return { x, y }
}

/** The library's beat has read the pointer over another stack: the tile stands there. */
const standsIn = (where: Locator, state: string) =>
  expect(where.locator(`ul[data-state="${state}"] > li[data-reference="${HELD}"]`)).toBeAttached()

/** Every way a drag can end, each with the pointer where a hand would leave it. */
const ENDINGS: Record<string, (page: Page, where: Locator) => Promise<void>> = {
  'in another column, read by the board': async (page, where) => {
    await pickUp(page, where)
    const to = await centre(where.locator('ul[data-state="dev"]'))
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await standsIn(where, 'dev')
    await page.mouse.up()
  },
  'in another column, before the board read it': async (page, where) => {
    await pickUp(page, where)
    const to = await centre(where.locator('ul[data-state="dev"]'))
    await page.mouse.move(to.x, to.y)
    await page.mouse.up()
  },
  'lower in its own column': async (page, where) => {
    await pickUp(page, where)
    const box = await tile(where, 'MAIN-404').boundingBox()
    if (!box) throw new Error('nothing to drop beside')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4, { steps: 12 })
    await expect
      .poll(() =>
        tile(where, HELD).evaluate(
          (held) => (held.previousElementSibling as HTMLElement | null)?.dataset.reference,
        ),
      )
      .toBe('MAIN-404')
    await page.mouse.up()
  },
  'back where it was picked up': async (page, where) => {
    const { x, y } = await pickUp(page, where)
    await page.mouse.move(x, y, { steps: 2 })
    await page.mouse.up()
  },
  'over nothing that takes it': async (page, where) => {
    await pickUp(page, where)
    await page.mouse.move(5, 5, { steps: 8 })
    await page.mouse.up()
  },
  'after Escape, which does not cancel a drag': async (page, where) => {
    await pickUp(page, where)
    await page.keyboard.press('Escape')
    await page.mouse.up()
  },
}

/** One press and release on the tile's title, with no move in between and no wait before it. */
async function clickOnce(page: Page, reference: string) {
  const { x, y } = await centre(page.locator(`[data-reference="${reference}"] .tile-open`))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
}

async function expectCard(page: Page, before: string) {
  await expect(page.locator('.drawer')).toBeVisible()
  expect(page.url()).not.toBe(before)
}

for (const shape of [
  { name: 'on the flat board', state: {} as Record<string, string> },
  { name: 'by epic', state: undefined },
]) {
  const whereOf = (page: Page) =>
    shape.state ? page.locator('.work-item-board') : page.locator('.board-lane').first()

  async function board(page: Page, refuse: { message: string | null } = { message: null }) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installBackend(page)
    const writes = await serve(page, refuse)
    await openBoard(page, shape.state)
    return writes
  }

  for (const [ending, end] of Object.entries(ENDINGS))
    for (const next of [HELD, OTHER])
      test(`${shape.name}: let go ${ending}, one click opens ${next === HELD ? 'that tile' : 'another'}`, async ({
        page,
      }) => {
        await board(page)
        const where = whereOf(page)
        const before = page.url()
        await end(page, where)
        await expect(page.locator('body > .sortable-fallback')).toHaveCount(0)
        // The release opened nothing.
        await expect(page.locator('.drawer')).toHaveCount(0)
        await clickOnce(page, next)
        await expectCard(page, before)
      })

  for (const next of [HELD, OTHER])
    test(`${shape.name}: a move the server refused, one click opens ${next === HELD ? 'that tile' : 'another'}`, async ({
      page,
    }) => {
      const writes = await board(page, { message: REFUSAL })
      const where = whereOf(page)
      const before = page.url()
      await ENDINGS['in another column, read by the board'](page, where)
      await expect.poll(() => writes.length).toBe(1)
      await expect(page.locator('.notice')).toContainText(REFUSAL)
      await expect(page.locator('.drawer')).toHaveCount(0)
      await clickOnce(page, next)
      await expectCard(page, before)
    })

  test(`${shape.name}: a browser that does send the release’s click opens nothing with it`, async ({
    page,
  }) => {
    const writes = await board(page)
    const where = whereOf(page)
    // Chromium sends none, because the element the press went down on has moved; the
    // standard leaves that open. So the click is sent here, in the release's own task, on
    // a tile that stayed in its stack: one that went to another is drawn anew, and no
    // release's click can land on an element the press did not go down on.
    await page.evaluate((held) => {
      document.addEventListener(
        'mouseup',
        () => document.querySelector<HTMLElement>(`[data-reference="${held}"] .tile-open`)?.click(),
        { once: true },
      )
    }, HELD)
    await ENDINGS['lower in its own column'](page, where)
    await expect.poll(() => writes.length).toBe(1)
    // A card that was going to open has started to by the time two frames are drawn.
    await frames(page.locator(':root'))
    await expect(page.locator('.drawer')).toHaveCount(0)
  })

  test(`${shape.name}: a press with a hand’s shake in it is a click, not a drag`, async ({
    page,
  }) => {
    await board(page)
    const before = page.url()
    const { x, y } = await centre(page.locator(`[data-reference="${HELD}"] .tile-open`))
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 2, y + 1)
    await page.mouse.up()
    await expect(page.locator('.drawer')).toBeVisible()
    expect(page.url()).not.toBe(before)
  })

  test(`${shape.name}: after a drag the keyboard still moves and opens a tile`, async ({
    page,
  }) => {
    const writes = await board(page)
    const where = whereOf(page)
    const before = page.url()
    await ENDINGS['back where it was picked up'](page, where)
    const open = tile(where, OTHER).locator('.tile-open')
    await open.focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => writes.length).toBe(1)
    await expect(open).toBeFocused()
    await page.keyboard.press('Enter')
    await expectCard(page, before)
  })
}
