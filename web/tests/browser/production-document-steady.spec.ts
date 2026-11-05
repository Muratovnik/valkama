import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { aCardAsking, HUB_TITLE, LINK, linkIn } from './documentBackend.ts'
import { test } from './test.ts'

/**
 * What lies under a document as it arrives and leaves, as the screen draws it: the built app,
 * filmed frame by frame while the document moves. The strip the film reads is the part of the
 * main screen no surface ever reaches at this width.
 *
 * The dimming may move only one way, and only by what the layer on top adds: down as a
 * document arrives and back up to where it stood as it leaves. A jump the other way is what a
 * reader sees as the screen blinking, and no class or property says it happened, because each
 * layer's own fade is correct and only the sum of them is not.
 */

/** A document stands this wide at each width here, flush with the window's right edge. */
const DOCUMENT_WIDTH = 720

/** The rounding a frame can differ by from the one before with nothing moving, in 0-255. */
const STILL = 0.25

/** Enough frames to have seen the fade under way, of the sixteen or so it takes at 60 a second. */
const FEWEST_FRAMES = 4

/** The mean luminance of the window's left `strip` pixels in each of these PNG images. */
async function brightness(page: Page, images: readonly string[], strip: number) {
  const reader = await page.context().newPage()
  const lit = await reader.evaluate(
    async (given) => {
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      const each: number[] = []
      for (const image of given.images) {
        const response = await fetch(`data:image/png;base64,${image}`)
        const bitmap = await createImageBitmap(await response.blob())
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        context?.drawImage(bitmap, 0, 0)
        const { data } = context?.getImageData(0, 0, given.strip, bitmap.height) ?? { data: [] }
        let sum = 0
        for (let at = 0; at < data.length; at += 4)
          sum +=
            0.2126 * (data[at] ?? 0) + 0.7152 * (data[at + 1] ?? 0) + 0.0722 * (data[at + 2] ?? 0)
        each.push(sum / (data.length / 4))
      }
      return each
    },
    { images, strip },
  )
  await reader.close()
  return lit
}

/** The strip as it stands, with nothing moving. */
async function still(page: Page, strip: number) {
  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  )
  const shot = await page.screenshot()
  const [lit = 0] = await brightness(page, [shot.toString('base64')], strip)
  return lit
}

/** Each frame of `action`, oldest first, as the mean luminance of the strip it shows. */
async function filmed(page: Page, strip: number, action: () => Promise<unknown>) {
  const session = await page.context().newCDPSession(page)
  const frames: { at: number; data: string }[] = []
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ at: metadata.timestamp ?? 0, data })
    void session.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await session.send('Page.startScreencast', { format: 'png' })
  await action()
  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  )
  await session.send('Page.stopScreencast')
  await session.detach()
  const images = frames.toSorted((a, b) => a.at - b.at).map(({ data }) => data)
  return brightness(page, images, strip)
}

/** The frames that moved against `direction`: a step down where it must only rise, or up. */
const against = (film: readonly number[], direction: 'down' | 'up') =>
  film.flatMap((value, index) => {
    const before = film[index - 1] ?? value
    const step = direction === 'down' ? value - before : before - value
    return step > STILL ? [{ frame: index, from: before, to: value }] : []
  })

/**
 * What must not happen to the main screen while `action` runs: an element of it mounted or
 * taken away, a change in where it stands, or a read of anything but the document.
 */
async function mainScreenHoldsThrough(page: Page, action: () => Promise<unknown>) {
  const reads: string[] = []
  const heard = (request: { url: () => string }) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/documents/'))
      reads.push(pathname)
  }
  page.on('request', heard)
  await page.evaluate(() => {
    const stage = document.querySelector('.module-stage')
    const shell = document.querySelector('.app-shell')
    if (!stage || !shell) throw new Error('No main screen')
    const place = () => JSON.stringify(stage.getBoundingClientRect())
    const first = place()
    const watch = { boxes: new Set([first]), mutated: 0, running: true, stage }
    new MutationObserver((records) => {
      watch.mutated += records.length
    }).observe(shell, { childList: true, subtree: true })
    const tick = () => {
      watch.boxes.add(place())
      if (watch.running) requestAnimationFrame(tick)
    }
    tick()
    Object.assign(window, { held: watch })
  })
  await action()
  const held = await page.evaluate(() => {
    const { held: watch } = window as unknown as {
      held: { boxes: Set<string>; mutated: number; running: boolean; stage: Element }
    }
    watch.running = false
    return {
      boxes: watch.boxes.size,
      mutated: watch.mutated,
      same: watch.stage === document.querySelector('.module-stage'),
    }
  })
  page.off('request', heard)
  expect(held).toEqual({ boxes: 1, mutated: 0, same: true })
  expect(reads).toEqual([])
}

/** A document opened from `link` and closed again, twice, with the film read each way. */
async function openAndCloseSteadily(page: Page, link: Locator) {
  const viewer = page.locator('.document-drawer')
  await link.scrollIntoViewIfNeeded()
  // Left of the surface the link is on and of where the document will stand.
  const surface = await page.locator('.overlay-surface').first().boundingBox()
  const window = page.viewportSize()?.width ?? 0
  const strip = Math.min(surface?.x ?? 0, window - DOCUMENT_WIDTH)
  const before = await still(page, strip)
  for (const round of [1, 2]) {
    await mainScreenHoldsThrough(page, async () => {
      const arriving = await filmed(page, strip, async () => {
        await link.click()
        await expect(viewer).toHaveCSS('transform', 'none')
      })
      expect(arriving.length, `round ${round}`).toBeGreaterThanOrEqual(FEWEST_FRAMES)
      expect
        .soft(against(arriving, 'down'), `round ${round}: it rose as a document arrived`)
        .toEqual([])

      const leaving = await filmed(page, strip, async () => {
        await page.keyboard.press('Escape')
        await expect(viewer).toHaveCount(0)
      })
      expect(leaving.length, `round ${round}`).toBeGreaterThanOrEqual(FEWEST_FRAMES)
      expect
        .soft(against(leaving, 'up'), `round ${round}: it fell as the document left`)
        .toEqual([])

      // It comes back to where it stood.
      expect(Math.abs((await still(page, strip)) - before)).toBeLessThanOrEqual(STILL)
    })
  }
}

for (const width of [800, 1000, 1280]) {
  test(`at ${width}, from a card: the main screen dims one way and comes back`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await openAndCloseSteadily(page, linkIn(drawer, LINK))
    await expect(drawer).toBeVisible()
  })
}

test('from the questions waiting for an answer, with no card: the same', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^Needs my answer/u }).click()
  const hub = page.getByRole('dialog', { name: HUB_TITLE })
  await expect(hub).toBeVisible()
  await openAndCloseSteadily(page, linkIn(hub, LINK))
  await expect(hub).toBeVisible()
})
