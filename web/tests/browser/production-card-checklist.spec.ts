/**
 * A step's row, in the built application: the box stands level with the text's first
 * line and the line naming who closed it stands right under that text.
 *
 * Both broke together, because the floor every button inherits beats a height a rule
 * states: the box stayed 40px tall in a row of 28, so the text stood above it and the
 * holder fell below it. The same floor reached the board's tile and the list's row
 * before this, so the second test asks it of every button on the screen.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const steps = [
  {
    id: '123e4567-e89b-42d3-a456-426614174101',
    text: 'A step nobody holds',
    done: false,
    claimed_by: '',
    done_by: '',
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174102',
    text: 'A step somebody closed',
    done: true,
    claimed_by: '',
    done_by: 'own-a (auto/val564-a)',
  },
  {
    id: '123e4567-e89b-42d3-a456-426614174103',
    text: 'A step somebody holds',
    done: false,
    claimed_by: 'own-b',
    done_by: '',
  },
]

async function openCard(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/modules/planning/work-item?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-work-item',
        scope: projectScope,
        work_item_ref: workItemRef,
        state: {
          interface_version: 'valkama-ui-state',
          status: 'ready',
          payload: { work_item: { ...workItem, checklist: steps } },
        },
      },
    }),
  )
  await page.goto(CARD)
  await expect(page.locator('.step-row')).toHaveCount(steps.length)
}

/** Where each row's parts stand, measured from what is drawn rather than from the boxes. */
const rows = (page: Page) =>
  page.locator('.step-row').evaluateAll((nodes) =>
    nodes.map((row) => {
      const mark = row.querySelector('.step-mark')?.getBoundingClientRect()
      const label = row.querySelector('.step-text')
      const range = document.createRange()
      range.selectNodeContents(label as Node)
      const text = range.getClientRects()[0]
      const holder = row.querySelector('.step-holder')
      const holderRange = document.createRange()
      if (holder) holderRange.selectNodeContents(holder)
      const held = holder ? holderRange.getClientRects()[0] : null
      return {
        apart:
          mark && text
            ? Math.abs(mark.top + mark.height / 2 - (text.top + text.height / 2))
            : Number.POSITIVE_INFINITY,
        gap: held && text ? held.top - text.bottom : null,
        height: row.getBoundingClientRect().height,
      }
    }),
  )

for (const width of [1440, 390]) {
  test(`a step's box meets its text and its holder stands under it at ${width}px`, async ({
    page,
  }) => {
    await openCard(page, width)
    const [open, closed, held] = await rows(page)

    for (const row of [open, closed, held]) expect(row.apart).toBeLessThanOrEqual(1)
    expect(open.height).toBe(28)
    expect(open.gap).toBeNull()
    expect(closed.gap).toBeGreaterThanOrEqual(0)
    expect(closed.gap).toBeLessThanOrEqual(6)
    expect(held.gap).toBeGreaterThanOrEqual(0)
    expect(held.gap).toBeLessThanOrEqual(6)
  })
}

test('no button on the card stands taller than the height its own rule states', async ({
  page,
}) => {
  await openCard(page, 1440)
  const beaten = await page.evaluate(() => {
    const rules: CSSStyleRule[] = []
    const walk = (list: CSSRuleList) => {
      for (const rule of list) {
        if (rule instanceof CSSStyleRule) rules.push(rule)
        if ('cssRules' in rule) walk(rule.cssRules as CSSRuleList)
      }
    }
    for (const sheet of document.styleSheets) walk(sheet.cssRules)
    // The base rule names `button` among its selectors; a rule of the control's own says
    // the floor it wants, and then the floor is not what is beating anything.
    const ownRules = rules.filter((rule) => !/(^|,\s*)button(,|$)/u.test(rule.selectorText))
    return [...document.querySelectorAll<HTMLElement>('button')]
      .filter((node) => {
        const mine = ownRules.filter((rule) => node.matches(rule.selectorText))
        const states = mine.some(
          ({ style }) => style.height && style.height !== 'auto' && !style.height.endsWith('%'),
        )
        const lifts = mine.some(({ style }) => style.minHeight || style.minBlockSize)
        if (!states || lifts) return false
        const before = node.getBoundingClientRect().height
        node.style.minBlockSize = '0'
        const after = node.getBoundingClientRect().height
        node.style.minBlockSize = ''
        return after < before
      })
      .map((node) => node.className)
  })
  expect(beaten).toEqual([])
})
