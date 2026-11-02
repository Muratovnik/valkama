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

/**
 * Going from a card to a card the panel does not close, so it does not open either:
 * the surface is one element across a link and Back, and only the first open slides.
 * The starts are counted as they happen: on a busy machine the first open can end
 * before anything reads it, and a replay could too.
 */
for (const width of [1440, 390]) {
  test(`a link and Back keep the panel, and only the first open animates, at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const count = (event: Event) => {
        if (!(event.target instanceof Element && event.target.matches('.drawer'))) return
        const root = document.documentElement
        root.dataset.surfaceStarts = String(Number(root.dataset.surfaceStarts ?? 0) + 1)
      }
      document.addEventListener('animationstart', count, true)
      document.addEventListener('transitionrun', count, true)
    })
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(CARD)
    const drawer = page.locator('.drawer')
    const moving = () => drawer.evaluate((node) => node.getAnimations().length)
    const starts = () =>
      page.evaluate(() => Number(document.documentElement.dataset.surfaceStarts ?? 0))
    await expect.poll(starts).toBeGreaterThan(0)
    await expect.poll(moving).toBe(0)
    const opened = await starts()
    await drawer.evaluate((node) => {
      node.dataset.firstSurface = ''
    })

    await drawer.getByRole('button', { name: /Relations/iu }).click()
    await drawer.locator('.link-open').first().click()
    const back = drawer.locator('.head-back')
    await expect(back).toBeVisible()
    await expect(page.locator('.drawer[data-first-surface]')).toHaveCount(1)
    expect(await moving()).toBe(0)
    expect(await starts()).toBe(opened)
    // Focus went with the card, to its first control, as it does on any open.
    await expect(back).toBeFocused()

    await back.click()
    await expect(back).toHaveCount(0)
    await expect(page.locator('.drawer[data-first-surface]')).toHaveCount(1)
    expect(await moving()).toBe(0)
    expect(await starts()).toBe(opened)
    await expect(drawer.locator('.drawer-frame-close')).toBeFocused()

    // Closing leaves through the guard's door and the surface goes with it.
    await drawer.locator('.drawer-frame-close').click()
    await expect(drawer).toHaveCount(0)
  })
}

/**
 * The panel outlives the card, and the card still answers for its own drafts: Escape,
 * the scrim, Close and a link all ask first, whichever of them the panel heard.
 */
test('every way out of a card with a draft asks first, and the panel stays while it does', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  const strip = drawer.locator('.confirm-strip')
  const comment = drawer.getByRole('textbox', { name: 'Comment', exact: true })
  await comment.fill('Half a thought')
  await expect(drawer).toHaveCSS('transform', 'none')
  await drawer.evaluate((node) => {
    node.dataset.firstSurface = ''
  })

  const keep = async () => {
    await expect(strip).toContainText('Unsaved changes will be lost: comment')
    await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(strip).toHaveCount(0)
    await expect(comment).toHaveValue('Half a thought')
  }
  await page.keyboard.press('Escape')
  await keep()
  await page.locator('.overlay-scrim').click({ position: { x: 8, y: 8 } })
  await keep()
  await drawer.locator('.drawer-frame-close').click()
  await keep()

  await drawer.getByRole('button', { name: /Relations/iu }).click()
  await drawer.locator('.link-open').first().click()
  await strip.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(drawer.locator('.head-back')).toBeVisible()
  await expect(page.locator('.drawer[data-first-surface]')).toHaveCount(1)
  await expect(comment).toHaveValue('')
})

async function xOf(locator: Locator) {
  const box = await locator.boundingBox()
  return box?.x ?? 0
}

/** The card opened from its tile, standing still, and long enough on the token to be seen. */
async function openFromBoard(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.addInitScript(() => {
    const heard: ((route: string) => void)[] = []
    Object.assign(window, {
      handOver: (route: string) => {
        for (const listener of heard) listener(route)
      },
      valkamaDesktop: { onOpenRoute: (listener: (route: string) => void) => heard.push(listener) },
    })
  })
  await page.goto(BOARD)
  const opener = page.locator('.work-item-column[data-state="dev"] .tile-open').first()
  await opener.click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--duration-surface', '0.6s')
  })
  return { drawer, opener, openX: await xOf(drawer) }
}

/** Where the surface stood and how far the scrim had faded, on each frame `act` took. */
async function framesOfLeaving(page: Page, drawer: Locator, act: () => Promise<unknown>) {
  const sampler = await page.evaluateHandle(() => {
    const frames: { held: boolean; scrim: number; x: number }[] = []
    let running = true
    const sample = () => {
      if (!running) return
      const surface = document.querySelector('.drawer')
      const scrim = document.querySelector('.overlay-scrim')
      if (surface && scrim)
        frames.push({
          held: surface.querySelector('.card-facts') !== null,
          x: surface.getBoundingClientRect().x,
          scrim: Number(getComputedStyle(scrim).opacity),
        })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    return {
      stop: () => {
        running = false
        return frames
      },
    }
  })
  await act()
  await expect(drawer).toHaveCount(0)
  return sampler.evaluate((running) => running.stop())
}

const WAYS_OUT = [
  {
    way: 'Close',
    narrow: true,
    leave: (page: Page) => page.locator('.drawer-frame-close').click(),
  },
  { way: 'Escape', narrow: true, leave: (page: Page) => page.keyboard.press('Escape') },
  { way: 'the scrim', narrow: false, leave: (page: Page) => page.mouse.click(8, 8) },
  { way: 'browser Back', narrow: true, leave: (page: Page) => page.goBack() },
  {
    way: 'a route to the board',
    narrow: true,
    leave: (page: Page) =>
      page.evaluate(
        (route) => (window as unknown as { handOver(to: string): void }).handOver(route),
        BOARD,
      ),
  },
]

for (const width of [1440, 390]) {
  for (const { way, leave } of WAYS_OUT.filter(({ narrow }) => narrow || width > 620)) {
    test(`${way} slides the surface out, fades the scrim and gives focus back at ${width}px`, async ({
      page,
    }) => {
      const { drawer, opener, openX } = await openFromBoard(page, width)
      const frames = await framesOfLeaving(page, drawer, () => leave(page))
      // Frames on the way, not just a start and an end: it left by moving.
      expect(frames.filter(({ x }) => x > openX + 1 && x < width - 1).length).toBeGreaterThan(5)
      expect(frames.filter(({ scrim }) => scrim > 0.02 && scrim < 0.98).length).toBeGreaterThan(5)
      expect(frames.every(({ x }, index) => x >= (frames[index - 1]?.x ?? 0))).toBe(true)
      // What leaves is the card that was there, not an empty panel.
      expect(frames.every(({ held }) => held)).toBe(true)
      await expect(page.locator('.overlay-host')).toHaveCount(0)
      await expect(opener).toBeFocused()
    })
  }
}

test('under reduced motion the surface and the scrim are gone at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { drawer, openX } = await openFromBoard(page, 1440)
  const frames = await framesOfLeaving(page, drawer, () =>
    drawer.locator('.drawer-frame-close').click(),
  )
  expect(frames.filter(({ x }) => x > openX + 1)).toHaveLength(0)
})

test('a tile pressed while the surface leaves opens the card again, on one surface', async ({
  page,
}) => {
  const { drawer, opener, openX } = await openFromBoard(page, 1440)
  await drawer.locator('.drawer-frame-close').click()
  await expect.poll(() => xOf(drawer)).toBeGreaterThan(openX + 20)
  // Through what is leaving: it no longer takes a press, and the board has the next one.
  const box = await opener.boundingBox()
  await page.mouse.click((box?.x ?? 0) + 10, (box?.y ?? 0) + 10)
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCount(1)
  await expect(drawer).toHaveCSS('transform', 'none')
  expect(await xOf(drawer)).toBe(openX)
  await expect(page.locator('.overlay-scrim')).toHaveCount(1)
  await expect(drawer.locator('.drawer-frame-close')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.overlay-host')).toHaveCount(0)
  await expect(opener).toBeFocused()
})

/**
 * Leaving the module replaces the whole page under the panel in one frame, and the panel
 * goes with the page that held it: there is nothing to slide out over, and nothing stays.
 */
test('a route out of the module takes the panel with the page, and leaves nothing behind', async ({
  page,
}) => {
  const { drawer } = await openFromBoard(page, 1440)
  await page.evaluate(
    (route) => (window as unknown as { handOver(to: string): void }).handOver(route),
    serializePlatformRoute({ module_id: 'settings', scope: projectScope }),
  )
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(drawer).toHaveCount(0)
  await expect(page.locator('.overlay-host')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})
