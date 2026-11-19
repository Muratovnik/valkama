/**
 * The two times of an item's work on its card, measured in the real app at 1440 and 1024
 * pixels. The oracle is the requirement (`DESIGN.md`): the line names the time on the clock and,
 * where agents worked side by side, the agents' time beside it, each fact whole on one line
 * inside the line's room, none clipped. Each run prints what it measured.
 */
import { expect } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { richUsage, usageAnswer } from '../fixtures/usage.ts'
import { record } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

for (const width of [1440, 1024])
  test(`at ${width}px both times stand whole in the line, each with its name`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.route('**/api/planning/work-item/usage?*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(usageAnswer(richUsage())),
      }),
    )
    await page.goto(CARD)
    const line = page.locator('.drawer .usage-line')
    await expect(line.locator('[data-fact="agents"]')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const facts = await line.evaluate((element) => {
      const room = element.querySelector('.usage-facts')?.getBoundingClientRect()
      return [...element.querySelectorAll<HTMLElement>('[data-fact]')].map((fact) => {
        // The words' own box: a fact's box reaches back over the dot's room, which the line clips.
        const words = document.createRange()
        words.selectNodeContents(fact)
        const box = words.getBoundingClientRect()
        return {
          fact: fact.dataset.fact,
          text: fact.textContent,
          inside: Boolean(room && box.left >= room.left - 0.5 && box.right <= room.right + 0.5),
          lines: Math.round(box.height / Number.parseFloat(getComputedStyle(fact).lineHeight)),
        }
      })
    })
    await record(info, `usage line ${width}`, facts)
    expect(facts.map((one) => one.fact)).toEqual(['time', 'agents', 'cost', 'tokens'])
    for (const one of facts) {
      expect(one.inside, `${one.fact} inside the line`).toBe(true)
      expect(one.lines, `${one.fact} on one line`).toBe(1)
    }
    await expectNoSilentClipping(page, `usage line at ${width}px`, '.drawer .usage-line')
  })
