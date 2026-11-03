import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * A part of a card's bar that has begun to fade takes no press, and one a press already
 * went down on keeps it until the release. Both are read with the fade held where the
 * race used to be, so neither depends on how fast the machine draws.
 */

/** What the card put on the clipboard, kept in the page: nothing reaches the system's. */
async function keepCopies(page: Page) {
  await page.addInitScript(() => {
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        },
      },
    })
    Object.assign(window, { copied })
  })
}

const COPY_REFERENCE = `Copy ${workItemRef.reference}`

const copies = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { copied: string[] }).copied])

async function openLongCard(page: Page) {
  await keepCopies(page)
  await page.setViewportSize({ width: 1024, height: 844 })
  await installBackend(page, { longRead: true })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  // The drawer has stopped sliding in: the pointer below lands on what it was aimed at.
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

async function centreOf(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

/**
 * Scrolls the big title past the scroller's top and comes back once the card has heard
 * it. The card's own observer was made first, so it hears the crossing first, and the
 * bar it redraws from that is in place before this one hears it.
 */
function scrollTitleAway(body: Locator) {
  return body.evaluate(
    (scroller) =>
      new Promise<void>((done) => {
        const title = scroller.querySelector('.drawer-frame-name')
        if (!title) throw new Error('no title')
        const observer = new IntersectionObserver(
          (entries) => {
            const entry = entries.at(-1)
            if (
              entry &&
              !entry.isIntersecting &&
              entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0)
            ) {
              observer.disconnect()
              done()
            }
          },
          { root: scroller },
        )
        observer.observe(title)
        scroller.scrollTo({ top: scroller.scrollHeight })
      }),
  )
}

test('a press on the part of the bar that has begun to fade does nothing', async ({ page }) => {
  const drawer = await openLongCard(page)
  const bar = drawer.locator('.drawer-frame-bar')
  const identity = bar.locator('.drawer-frame-identity')
  const reference = identity.getByRole('button', { name: COPY_REFERENCE, exact: true })
  const at = await centreOf(reference)

  // In sight, the same press copies: it is aimed where the reference stands.
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.up()
  expect(await copies(page)).toEqual([workItemRef.reference])

  await scrollTitleAway(drawer.locator('.drawer-frame-body'))
  // The fade is held at its very start: the identity still shows in full and the title
  // that takes its place has not come in over it yet.
  const held = await bar.evaluate((node) => {
    const fades = node.getAnimations({ subtree: true })
    for (const fade of fades) {
      fade.pause()
      fade.currentTime = 0
    }
    return fades.length
  })
  expect(held).toBeGreaterThan(0)
  await expect(identity).toHaveCSS('visibility', 'visible')
  await expect(identity).toHaveCSS('opacity', '1')
  await expect(bar.locator('.drawer-frame-pinned-title')).toHaveCSS('visibility', 'hidden')

  await page.mouse.down()
  await page.mouse.up()
  expect(await copies(page)).toEqual([workItemRef.reference])
})

test('a press held on the bar keeps its control through the scroll, and the bar answers after', async ({
  page,
}) => {
  const drawer = await openLongCard(page)
  const bar = drawer.locator('.drawer-frame-bar')
  const reference = bar.getByRole('button', { name: COPY_REFERENCE, exact: true })
  const at = await centreOf(reference)

  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await scrollTitleAway(drawer.locator('.drawer-frame-body'))
  // However long the press is held, any fade that started under it has run its course.
  await bar.evaluate((node) => {
    for (const fade of node.getAnimations({ subtree: true })) fade.finish()
  })
  await page.mouse.up()
  expect(await copies(page)).toEqual([workItemRef.reference])

  // Released, the bar says what the scroller has said all along.
  await expect(bar).toHaveClass(/title-away/u)
  await expect(bar.locator('.drawer-frame-pinned-title')).toBeVisible()
})
