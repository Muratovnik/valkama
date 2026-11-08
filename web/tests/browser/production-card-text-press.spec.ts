import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})
const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })

async function cardBeingRead(page: Page) {
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

const placeOf = (body: Locator) => body.evaluate((node) => node.scrollTop)

/**
 * The body's place once it has stopped moving. The keys that read scroll smoothly, so a
 * place read as soon as the body has started is a place on the way, 497 on the way to 69,
 * and passes for a focus that jumped. Counted in frames: a place only changes with a frame,
 * so on a loaded machine two reads a moment apart agree in mid-flight.
 */
const restingPlace = (body: Locator) =>
  body.evaluate(
    (node) =>
      new Promise<number>((done) => {
        let place = node.scrollTop
        let still = 0
        const look = () => {
          still = node.scrollTop === place ? still + 1 : 0
          place = node.scrollTop
          if (still === 10) done(place)
          else requestAnimationFrame(look)
        }
        requestAnimationFrame(look)
      }),
  )

const openLongRead = async (page: Page, width = 1440) => {
  await page.setViewportSize({ width, height: 700 })
  await installBackend(page, { longRead: true })
  return cardBeingRead(page)
}

interface Press {
  scrollTo: number
  where: string
  /** Reads on with the keys after the press: where the keys left it is not where it was. */
  readOn?: boolean
  /** Brings up what is pressed, when it is not there from the start. */
  bringUp?: (drawer: Locator) => Promise<void>
  text: (drawer: Locator) => Locator
}

const BODY_TEXT = (drawer: Locator) => drawer.getByText('Paragraph 12 of a description').first()
const PRESSES: Press[] = [
  { where: 'a fact in the bar', scrollTo: 0, text: (d) => d.locator('.identity-fact').first() },
  {
    where: "the bar's title, read down",
    scrollTo: 400,
    text: (d) => d.locator('.drawer-frame-pinned-title'),
  },
  {
    where: 'a notice',
    scrollTo: 0,
    text: (d) => d.locator('.confirm-message'),
    bringUp: async (d) => d.locator('.card-action').getByRole('button').click(),
  },
  { where: 'the title', scrollTo: 0, text: (d) => d.locator('.drawer-frame-name') },
  { where: 'the facts', scrollTo: 0, text: (d) => d.locator('.card-facts .card-row-label') },
  { where: 'the text, read down', scrollTo: 400, text: BODY_TEXT },
  { where: 'the text, read on with the keys', scrollTo: 400, readOn: true, text: BODY_TEXT },
]

/** Where a key goes after a press: the stop it reaches, and where the card then stands. */
async function afterPress(page: Page, press: Press, key: string, holdersTakeFocus: boolean) {
  const drawer = await cardBeingRead(page)
  const body = drawer.locator('.drawer-frame-body')
  await press.bringUp?.(drawer)
  await body.evaluate((node, top) => node.scrollTo({ top }), press.scrollTo)
  await restingPlace(body)
  // What the bar shows has finished arriving, or a stop would depend on the moment of the key.
  await drawer.evaluate(() => Promise.all(document.getAnimations().map((run) => run.finished)))
  // Nothing here can hold a press on text, which is the page the card is measured against.
  if (!holdersTakeFocus)
    await drawer.evaluate((node) => {
      for (const holder of [node, ...node.querySelectorAll('[tabindex="-1"]')])
        holder.removeAttribute('tabindex')
    })
  const line = await press.text(drawer).boundingBox()
  await page.mouse.click((line?.x ?? 0) + 4, (line?.y ?? 0) + 6)
  if (press.readOn) {
    await page.keyboard.press('PageDown')
    await expect.poll(() => placeOf(body)).toBeGreaterThan(press.scrollTo)
    const read = await restingPlace(body)
    await page.keyboard.press('PageUp')
    await expect.poll(() => placeOf(body)).toBeLessThan(read)
    await restingPlace(body)
  }
  await page.keyboard.press(key)
  const stop = await drawer.evaluate((node) => {
    const focused = document.activeElement
    const label = focused?.getAttribute('aria-label') ?? focused?.textContent
    return `${String(focused && [...node.querySelectorAll('*')].indexOf(focused))} ${String(label)}`
  })
  return { stop, place: await restingPlace(body) }
}

for (const press of PRESSES) {
  for (const key of ['Tab', 'Shift+Tab']) {
    test(`after a press on ${press.where}, ${key} goes on from there as on a page with no trap`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 700 })
      await installBackend(page, { longRead: true })
      const plainPage = await afterPress(page, press, key, false)
      const card = await afterPress(page, press, key, true)
      expect(card.stop).toBe(plainPage.stop)
      // The keys that read come to rest a pixel apart from one load to the next; a jump
      // to either end of the card is hundreds of them.
      expect(Math.abs(card.place - plainPage.place)).toBeLessThanOrEqual(2)
    })
  }
}

const THE_END = (drawer: Locator) => drawer.getByText('No comments or reports yet.')

test('a press on the last text sends Shift+Tab to the control before it', async ({ page }) => {
  const drawer = await openLongRead(page)
  const body = drawer.locator('.drawer-frame-body')
  await body.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
  const line = await THE_END(drawer).boundingBox()
  await page.mouse.click((line?.x ?? 0) + 20, (line?.y ?? 0) + 6)
  const place = await placeOf(body)
  await page.keyboard.press('Shift+Tab')
  await expect(drawer.getByRole('textbox', { name: 'Comment' })).toBeFocused()
  expect(await placeOf(body)).toBe(place)
})

for (const [width, first] of [
  [1440, '.overlay-resizer'],
  [390, '.drawer-frame-close'],
] as const) {
  test(`past the last text a Tab comes round to the first control at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongRead(page, width)
    await drawer
      .locator('.drawer-frame-body')
      .evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    const line = await THE_END(drawer).boundingBox()
    await page.mouse.click((line?.x ?? 0) + 20, (line?.y ?? 0) + 6)
    await page.keyboard.press('Tab')
    await expect(drawer.locator(first)).toBeFocused()
    // And back round the other way, from the real edge.
    await page.keyboard.press('Shift+Tab')
    await expect(drawer.getByRole('textbox', { name: 'Comment' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(drawer.locator(first)).toBeFocused()
  })
}

/**
 * Where focus goes over every stop there is and a few more, in one direction: each stop that
 * left the surface, by what holds focus there.
 *
 * A reference's card is portalled out of the surface, and a Tab from the reference goes
 * through the card's controls and on from the reference (`ReferencePreview`), so a stop in a
 * card that describes a reference in the surface is still in it. Any other stop outside is not.
 */
async function roundTheTrap(page: Page, surface: Locator, key: string) {
  const stops: { at: string; held: boolean }[] = []
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press(key)
    stops.push(
      await surface.evaluate((node) => {
        const active = document.activeElement
        const card = active?.closest('.reference-preview')
        const ofReference = [...node.querySelectorAll('[aria-describedby]')].some((reference) =>
          (reference.getAttribute('aria-describedby') ?? '')
            .split(' ')
            .some((id) => id && card?.querySelector(`[id="${id}"]`)),
        )
        return {
          held: node.contains(active) || Boolean(card && ofReference),
          at: active?.outerHTML.slice(0, 80) ?? 'nothing',
        }
      }),
    )
  }
  return stops.filter(({ held }) => !held).map(({ at }) => at)
}

for (const key of ['Tab', 'Shift+Tab']) {
  test(`${key} from a press stays in the card, all the way round`, async ({ page }) => {
    const drawer = await openLongRead(page)
    const line = await drawer.locator('.drawer-frame-name').boundingBox()
    await page.mouse.click((line?.x ?? 0) + 4, (line?.y ?? 0) + 6)
    expect(await roundTheTrap(page, drawer, key)).toEqual([])
  })

  test(`${key} from a press stays in a dialog, all the way round`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 })
    await installBackend(page)
    await page.goto(BOARD)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Go to a task', exact: true })
    await expect(dialog.getByRole('combobox')).toBeFocused()
    const box = await dialog.boundingBox()
    await page.mouse.click((box?.x ?? 0) + 6, (box?.y ?? 0) + (box?.height ?? 0) - 6)
    expect(await roundTheTrap(page, dialog, key)).toEqual([])
  })
}

/** A surface may hold more than one scroller, and each holds a press on its own text. */
test('a press in a second pane goes on from there, and not from the first', async ({ page }) => {
  const drawer = await openLongRead(page)
  await drawer.evaluate((node) => {
    const pane = document.createElement('div')
    pane.tabIndex = -1
    pane.style.cssText = 'position: fixed; inset: 0 auto auto 0; z-index: 9; width: 200px;'
    pane.innerHTML =
      '<button id="ahead">Ahead</button><p id="said">Said</p><button id="after">After</button>'
    node.append(pane)
  })
  const said = page.locator('#said')
  await said.click()
  await page.keyboard.press('Tab')
  await expect(page.locator('#after')).toBeFocused()
  await said.click()
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('#ahead')).toBeFocused()
})
