/**
 * On a phone-wide screen an icon in a toolbar answers a press across 44px, the target
 * DESIGN.md asks of a control with no words to widen it. The board's «+» drew 41×36 and
 * answered no further. Measured by where a press lands rather than by the drawn box, since
 * the reach is spent around the drawing and the row keeps its height.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { installDiscussionBackend } from './discussionBackend.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** Half the target, less half a pixel so a probe lands inside a 44px box, not on its edge. */
const REACH = 21.5

/**
 * Every control in `within` that shows no more than one character of words, each with the
 * probes a press 22px from its middle — left, right, above, below — that did not land on it.
 */
async function shortReaches(within: Locator) {
  return within.evaluateAll(
    (roots, reach) =>
      roots.flatMap((root) =>
        [...root.querySelectorAll('button')].flatMap((button) => {
          if (!button.checkVisibility()) return []
          const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
          let words = ''
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const box = node.parentElement?.getBoundingClientRect()
            if (box && box.width > 2 && box.height > 2) words += node.textContent ?? ''
          }
          if (words.replaceAll(/\s/gu, '').length > 1) return []
          button.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' })
          const box = button.getBoundingClientRect()
          const [x, y] = [box.left + box.width / 2, box.top + box.height / 2]
          const missed = [
            ['left', x - reach, y],
            ['right', x + reach, y],
            ['above', x, y - reach],
            ['below', x, y + reach],
          ].flatMap(([side, at, on]) => {
            const hit = document.elementFromPoint(Number(at), Number(on))
            return hit && button.contains(hit) ? [] : [String(side)]
          })
          return [
            {
              name:
                button.getAttribute('aria-label') ||
                button.dataset.tooltip ||
                (button.textContent ?? '').trim(),
              missed,
            },
          ]
        }),
      ),
    REACH,
  )
}

test('every icon in the board’s toolbar answers across 44px at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const icons = await shortReaches(page.locator('.workspace-head'))
  expect(icons.map(({ name }) => name)).toContain('New work item')
  expect(icons.filter(({ missed }) => missed.length > 0)).toEqual([])
})

test('with a filter on, every icon of the phone’s bar and its chips answers across 44px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  await serve(page)
  // The grouping toggle gave its word up to the filter's reset here and drew 40×36; the
  // grouping is a choice of the view's menu now, whose button keeps its word.
  await openBoard(page, { labels: 'coordinator' })
  const icons = await shortReaches(page.locator('.workspace-head'))
  expect(icons.map(({ name }) => name)).toContain('New work item')
  expect(icons.filter(({ missed }) => missed.length > 0)).toEqual([])
})

test('every icon in the graph’s bar answers across 44px at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      state: { view: 'graph' },
    }),
  )
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const icons = await shortReaches(page.locator('.workspace-head, .graph-bar'))
  expect(icons.length).toBeGreaterThanOrEqual(2)
  expect(icons.filter(({ missed }) => missed.length > 0)).toEqual([])
})

test('every icon in a comment’s markdown toolbar answers across 44px at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installDiscussionBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const tools = page.locator('.drawer .markdown-tools')
  await expect(tools.first()).toBeVisible()
  // The drawer slides in from the edge; a press is measured where it comes to rest.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map(async (run) => run.finished))
  })
  const icons = await shortReaches(tools)
  expect(icons.length).toBeGreaterThanOrEqual(5)
  expect(icons.filter(({ missed }) => missed.length > 0)).toEqual([])
})
