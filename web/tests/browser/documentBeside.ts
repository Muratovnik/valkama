import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { aCardAsking, LINK } from './documentBackend.ts'

/** What the journeys of a document beside what it was opened from measure and press. */

export const WINDOW = { width: 1500, height: 900 }
export const CARD_TITLE = /^Valkama platform execution/u
export const CARD_EDGE = 'Resize the work item'

/** The pane, by the name it is announced with. */
export function paneOf(page: Page) {
  const pane = page.getByRole('region', { name: /^Document: / })
  return {
    pane,
    body: pane.locator('.document-body'),
    title: pane.locator('.overlay-header-name'),
    target: pane.locator('.document-block.is-target'),
    edge: page.getByRole('separator', { name: 'Document width' }),
    close: pane.getByRole('button', { name: 'Close the document' }),
  }
}

/** Where a shot goes when a person asks for shots: with whatever was moving at rest. */
export async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (!folder) return
  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  )
  await page.screenshot({ path: `${folder}/${name}.png` })
}

export async function settled(surface: Locator) {
  await expect(surface).toHaveCSS('transform', 'none')
}

/** Every box is measured against the window it must stay inside. */
export async function inWindow(page: Page, target: Locator) {
  const box = await target.boundingBox()
  const { width } = page.viewportSize() ?? WINDOW
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
  return box
}

/**
 * The first block whose top is in view, and how far under the scroller's edge it stands:
 * the place the reader is at, to the pixel that rounding leaves, whichever host draws it.
 */
export const leading = (scroller: Locator) =>
  scroller.evaluate((node) => {
    const top = node.getBoundingClientRect().top
    const blocks = [...node.querySelectorAll<HTMLElement>('.document-block')]
    const block = blocks.find((each) => each.getBoundingClientRect().top >= top - 1)
    return {
      text: block?.textContent,
      below: Math.round((block?.getBoundingClientRect().top ?? 0) - top),
    }
  })

/** The same block, at most a pixel away from where it stood. */
export async function samePlace(scroller: Locator, before: Awaited<ReturnType<typeof leading>>) {
  await expect
    .poll(async () => {
      const now = await leading(scroller)
      return now.text === before.text && Math.abs(now.below - before.below) <= 1
    })
    .toBe(true)
}

/** Tab until the card holds focus again, and where focus stood on the way. */
export async function tabRound(page: Page) {
  const seen = new Set<string>()
  for (let press = 0; press < 40 && !seen.has('card'); press++) {
    await page.keyboard.press('Tab')
    seen.add(
      await page.evaluate(() => {
        const active = document.activeElement
        if (active?.closest('.overlay-pane-main')) return 'card'
        if (active?.closest('.overlay-pane')) return 'pane'
        return active?.closest('.overlay-host') ? 'surface' : 'out'
      }),
    )
  }
  return seen
}

export async function openBesideCard(page: Page, prompt = `Read \`${LINK}\` first.`) {
  await page.setViewportSize(WINDOW)
  const { drawer, comment } = await aCardAsking(page, prompt)
  return { drawer, comment }
}
