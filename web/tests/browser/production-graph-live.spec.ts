/**
 * Live work as the read model carries it, on the whole space's graph: a card
 * an agent's turn works on turns its sign «working», one its session holds aside
 * stands still «held», and the strip above the field offers the switch that
 * stops the motion at every width — and offers none under reduced motion.
 *
 * Served the broad synthetic space with `live_work` for each of its live claims.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { broadSpace, liveWorkFor } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** Holders a live card meets: a name longer than a card, a short one, and a session's. */
const HOLDERS = {
  long: 'an-agent-whose-name-runs-on-past-any-card',
  short: 'codex',
  session: 'claude (session 3f2a9c1e-5b7d-4e2a-9c1f-0a1b2c3d4e5f)',
} as const

/**
 * The suite's space, holding the broad space's work and its live work; with
 * `holder`, every live claim is held under that name.
 */
async function serveLiveSpace(page: Page, { holder = '' } = {}) {
  const { model } = broadSpace()
  const live = liveWorkFor(model)
  const items = holder
    ? model.work_items.map((item) =>
        item.work_item_id in live ? { ...item, claim_ref: holder } : item,
      )
    : model.work_items
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = items
      body.links = model.links
      body.live_work = live
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/** How many animations run on the sign of the first card in that live state. */
const signAnimations = (page: Page, state: string) =>
  page
    .locator(`.graph-flow .graph-live[data-live="${state}"] .session-sign`)
    .first()
    .evaluate((sign) => sign.getAnimations().length)

/** Every animation running in the field. */
const fieldAnimations = (page: Page) =>
  page.evaluate(
    () => document.querySelector('.graph-flow')?.getAnimations({ subtree: true }).length,
  )

for (const width of [1500, 390]) {
  test(`live work from the read model moves on the graph, and the strip stops it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await serveLiveSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    await expect(page.locator('.graph-flow .graph-live[data-live="working"]').first()).toHaveText(
      'working',
    )
    await expect(page.locator('.graph-flow .graph-live[data-live="held"]').first()).toHaveText(
      'held',
    )
    expect(await signAnimations(page, 'working')).toBeGreaterThan(0)
    // Only work going on moves: a held, asking, waiting or silent session's sign stands still.
    for (const still of ['held', 'asks', 'waiting', 'quiet'])
      expect(await signAnimations(page, still), still).toBe(0)
    // The switch stands in the strip above the field, at the phone's width too.
    const toggle = page.locator('.graph-legend-place .graph-motion-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAccessibleName('Stop the motion')
    await toggle.click()
    await expect(toggle).toHaveAccessibleName('Start the motion')
    await expect.poll(() => fieldAnimations(page)).toBe(0)
  })
}

test('under reduced motion live work stands still and no switch is offered', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1500, height: 900 })
  await serveLiveSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(page.locator('.graph-flow .graph-live[data-live="working"]').first()).toBeVisible()
  await expect(page.locator('.graph-motion-toggle')).toHaveCount(0)
  await expect.poll(() => fieldAnimations(page)).toBe(0)
})

for (const width of [1500, 390]) {
  for (const [kind, holder] of Object.entries(HOLDERS)) {
    test(`every live word stands whole beside a ${kind} holder's name at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await serveLiveSpace(page, { holder })
      await page.goto(graphRoute({}))
      await expect(page.locator('.graph-canvas.settled')).toBeVisible()
      const owners = page.locator('.graph-flow .flow-node-owner').filter({
        has: page.locator('.graph-live'),
      })
      await expect(owners.first()).toBeVisible()
      const rows = await owners.evaluateAll((elements) =>
        elements.map((owner) => {
          const row = owner.getBoundingClientRect()
          const live = owner.querySelector<HTMLElement>('.graph-live')
          const word = owner.querySelector<HTMLElement>('.graph-live-word')
          const name = owner.querySelector<HTMLElement>('.flow-node-owner-name')
          const box = word?.getBoundingClientRect()
          return {
            state: live?.dataset.live ?? '',
            word: word?.textContent ?? '',
            // The word is whole in its own box and inside the row, which clips.
            wordWhole:
              word !== null &&
              box !== undefined &&
              word.scrollWidth <= word.clientWidth &&
              box.left >= row.left - 0.5 &&
              box.right <= row.right + 0.5,
            // Nothing is cut by the row without an ellipsis of its own.
            rowWhole: owner.scrollWidth <= owner.clientWidth,
            nameShown: name === null ? 0 : name.getBoundingClientRect().width,
          }
        }),
      )
      expect(new Set(rows.map((row) => row.state))).toEqual(
        new Set(['working', 'held', 'waiting', 'quiet', 'asks']),
      )
      expect(rows.filter((row) => !row.wordWhole || !row.rowWhole)).toEqual([])
      // Some of the holder's name stays, enough to know them by.
      expect(Math.min(...rows.map((row) => row.nameShown))).toBeGreaterThan(40)
      // The whole name is still said to a reader.
      await expect(
        page
          .locator('.graph-flow .flow-node-card')
          .filter({ has: page.locator('.graph-live[data-live="quiet"]') })
          .first(),
      ).toHaveAccessibleName(new RegExp(holder.split(' ')[0], 'u'))
    })
  }
}

for (const width of [1500, 390]) {
  test(`the switch answers a pointer across 44 px at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await serveLiveSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    const toggle = page.locator('.graph-legend-place .graph-motion-toggle')
    await expect(toggle).toBeVisible()
    const reach = await toggle.evaluate((button) => {
      const box = button.getBoundingClientRect()
      const [x, y] = [box.left + box.width / 2, box.top + box.height / 2]
      // Just inside each corner of a 44 px square round the glyph.
      return [
        [-21, -21],
        [21, -21],
        [-21, 21],
        [21, 21],
      ].map(
        ([dx, dy]) =>
          document.elementFromPoint(x + dx, y + dy)?.closest('.graph-motion-toggle') === button,
      )
    })
    expect(reach).toEqual([true, true, true, true])
  })
}
