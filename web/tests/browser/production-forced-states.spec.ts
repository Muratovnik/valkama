import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installAlerts, TRIAL_SHOWN } from './alertsFixtures.ts'
import { installBackend } from './backend.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { blockedWorkItem, planningSpace, projectScope, workItem } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: projectScope })
const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })

/** How far around a control is read, so an edge drawn on its border is inside the picture. */
const MARGIN = 3

/**
 * Fewer changed pixels than this outside the words is not a state. A button whose words change
 * while it waits moves its edge by about fifty; the thinnest mark that says a state, the edge
 * of that button in another colour, changes more than two hundred and fifty.
 */
const DRAWN = 100

interface Drawn {
  png: string
  /** The box the control's contents are drawn in, in the picture's own pixels. */
  words: { bottom: number; left: number; right: number; top: number }
}

/** A control as it was painted, with the box its words take. */
async function drawn(page: Page, control: Locator): Promise<Drawn> {
  await page.mouse.move(0, 0)
  await control.scrollIntoViewIfNeeded()
  const { height, width, x, y } = (await control.boundingBox()) ?? {
    height: 0,
    width: 0,
    x: 0,
    y: 0,
  }
  const words = await control.evaluate((node, margin) => {
    const own = node.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(node)
    const text = range.getBoundingClientRect()
    return {
      bottom: Math.ceil(text.bottom - own.top + margin) + 1,
      left: Math.floor(text.left - own.left + margin) - 1,
      right: Math.ceil(text.right - own.left + margin) + 1,
      top: Math.floor(text.top - own.top + margin) - 1,
    }
  }, MARGIN)
  const shot = await page.screenshot({
    clip: { height: height + MARGIN * 2, width: width + MARGIN * 2, x: x - MARGIN, y: y - MARGIN },
  })
  return { png: shot.toString('base64'), words }
}

/**
 * How many pixels outside the words differ between two paintings of one control.
 *
 * A forced palette repaints every ground and every word in its own few colours, so a state
 * that was a ground alone is gone, and one that was a heavier word is all that is left: the
 * glyphs change and nothing round them does. Counting only outside the words is what tells
 * a state the palette kept from one it reduced to a weight. The pictures are read on a blank
 * page, since the app's own policy refuses an image from data.
 */
async function apartOutsideWords(page: Page, first: Drawn, second: Drawn) {
  const blank = await page.context().newPage()
  const count = await blank.evaluate(
    async ({ one, two, words }) => {
      // Serialized into the blank page, so it cannot live at module scope.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const pixelsOf = async (png: string) => {
        const picture = new Image()
        picture.src = `data:image/png;base64,${png}`
        await picture.decode()
        const surface = new OffscreenCanvas(picture.width, picture.height)
        const paint = surface.getContext('2d')
        paint?.drawImage(picture, 0, 0)
        return {
          data: paint?.getImageData(0, 0, picture.width, picture.height).data ?? [],
          height: picture.height,
          width: picture.width,
        }
      }
      const [left, right] = [await pixelsOf(one), await pixelsOf(two)]
      let apart = 0
      for (let row = 0; row < Math.min(left.height, right.height); row += 1)
        for (let column = 0; column < Math.min(left.width, right.width); column += 1) {
          const inWords =
            column >= words.left && column < words.right && row >= words.top && row < words.bottom
          if (inWords) continue
          const at = (row * left.width + column) * 4
          const there = (row * right.width + column) * 4
          const channels = [0, 1, 2].map((channel) =>
            Math.abs((left.data[at + channel] ?? 0) - (right.data[there + channel] ?? 0)),
          )
          if (Math.max(...channels) >= 48) apart += 1
        }
      return apart
    },
    {
      one: first.png,
      two: second.png,
      // Both boxes, so a control whose words change with its state is read round both.
      words: {
        bottom: Math.max(first.words.bottom, second.words.bottom),
        left: Math.min(first.words.left, second.words.left),
        right: Math.max(first.words.right, second.words.right),
        top: Math.min(first.words.top, second.words.top),
      },
    },
  )
  await blank.close()
  return count
}

/** A work item as the search under `#` answers with it. */
const found = (item: { reference: string; title: string; work_item_id: string }) => ({
  claim_ref: '',
  planning_space_id: planningSpace.planning_space_id,
  reference: item.reference,
  state: { name: 'Doing' },
  title: item.title,
  work_item_id: item.work_item_id,
})

for (const colorScheme of ['dark', 'light'] as const) {
  test(`in the ${colorScheme} forced palette a pressed segment and the current page are drawn, not only heavier`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await installBackend(page)
    await page.goto(SETTINGS)

    const segment = page.getByRole('tablist', { name: 'Settings section' }).getByRole('tab').nth(1)
    await expect(segment).toHaveAttribute('aria-selected', 'false')
    const released = await drawn(page, segment)
    await segment.click()
    await expect(segment).toHaveAttribute('aria-selected', 'true')
    const pressed = await drawn(page, segment)
    expect(await apartOutsideWords(page, released, pressed), 'a pressed segment').toBeGreaterThan(
      DRAWN,
    )

    // The first entry is the planning module, which is not where Settings is.
    const entry = page.locator('.nav-item').first()
    await expect(entry).not.toHaveAttribute('aria-current', 'page')
    const elsewhere = await drawn(page, entry)
    await page.goto(BOARD)
    await expect(entry).toHaveAttribute('aria-current', 'page')
    const here = await drawn(page, entry)
    expect(await apartOutsideWords(page, elsewhere, here), 'the current page').toBeGreaterThan(
      DRAWN,
    )
  })

  test(`in the ${colorScheme} forced palette the suggestion Enter takes is drawn apart`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await installBackend(page)
    await installDiscussionBackend(page)
    await page.route('**/api/planning/search?*', (route) =>
      route.fulfill({
        json: {
          interface_version: 'valkama-planning-api',
          work_items: [found(blockedWorkItem), found(workItem)],
        },
      }),
    )
    await page.goto(BOARD)
    await page.getByRole('button', { name: 'New work item' }).click()
    const dialog = page.getByRole('dialog', { name: 'New work' })
    await dialog.getByRole('textbox', { name: 'Description' }).click()
    await page.keyboard.type('After #b')
    const rows = dialog.getByRole('listbox', { name: 'Tasks' }).getByRole('option')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true')
    const taken = await drawn(page, rows.first())
    await page.keyboard.press('ArrowDown')
    await expect(rows.first()).toHaveAttribute('aria-selected', 'false')
    const passed = await drawn(page, rows.first())
    expect(
      await apartOutsideWords(page, passed, taken),
      'the suggestion Enter takes',
    ).toBeGreaterThan(DRAWN)
  })

  /*
   * A disabled button is one the palette knows, and it greys it itself. One that waits keeps
   * focus through the wait, so it is only `aria-disabled`, and the palette paints it as any
   * button: what told the two apart was the ink and the fill it clears.
   */
  test(`in the ${colorScheme} forced palette a button that waits is drawn as unavailable`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await installBackend(page)
    await installAlerts(page)
    // The send is answered only once the waiting button has been read.
    const waits: Route[] = []
    await page.route('**/api/alerts/test', (route) => {
      waits.push(route)
    })
    await page.goto(SETTINGS)

    // By its place, since its words say it is sending while it waits.
    const send = page.locator('.settings-alerts-test')
    await expect(send).toHaveText('Send a test notification')
    const ready = await drawn(page, send)
    await send.click()
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    const waiting = await drawn(page, send)
    await Promise.all(waits.map((route) => route.fulfill({ json: TRIAL_SHOWN })))
    await expect(send).not.toHaveAttribute('aria-disabled', 'true')
    expect(await apartOutsideWords(page, ready, waiting), 'a button that waits').toBeGreaterThan(
      DRAWN,
    )
  })
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`in the ${colorScheme} forced palette a card's label keeps the edge of its chip`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    await page.setViewportSize({ width: 1500, height: 900 })
    await installDiscussionBackend(page)
    await page.goto(BOARD)
    await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
    const drawer = page.locator('.drawer')
    await expect(drawer).toHaveCSS('transform', 'none')
    const chip = drawer.locator('.card-labels .label-chip').first()
    await expect(chip).toContainText('platform')
    // The palette clears the chip's ground, which was its whole boundary: the label read as a
    // word beside the others. Taken away again, whatever draws the edge must change pixels.
    // Nothing is left out as words: its words are the same in both pictures, and the face
    // they are read from is the chip itself, edge and all.
    const whole = { bottom: 0, left: 0, right: 0, top: 0 }
    const kept = { ...(await drawn(page, chip)), words: whole }
    // Through the style object: the app's policy refuses a style element.
    await chip.locator('.chip-face').evaluate((face) => {
      face.style.setProperty('outline', 'none', 'important')
      face.style.setProperty('border-color', 'transparent', 'important')
    })
    const bare = { ...(await drawn(page, chip)), words: whole }
    expect(await apartOutsideWords(page, kept, bare), 'the chip edge').toBeGreaterThan(DRAWN)
  })
}
