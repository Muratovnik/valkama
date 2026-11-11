/**
 * Who spent an item's work and under which organization, on its Agents tab in the real app, at
 * the three widths the card is used at: the strip of organizations with its marks where the
 * organization changed, and each organization with its share. Every box is measured after the
 * last write, and nothing on the tab may clip what it holds. The tab's link opens the Analytics
 * page filtered to the item, and the app takes that address as the page's own.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { DEFAULT_VIEW, readAddress } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

import { usageAnswer } from '../fixtures/analytics.ts'
import { ORG_A, whoUsage } from '../fixtures/usage.ts'
import { CARD, openAgents, serve } from './agentsUsagePage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

interface Box {
  bottom: number
  left: number
  right: number
  top: number
  width: number
}

/** A box to a tenth of a pixel, for the record the run prints. */
const tenth = (value: number) => Math.round(value * 10) / 10
const brief = (box: Box) => `${tenth(box.left)}+${tenth(box.width)}`

/** What the strip and its words measure, read in the page in one pass. */
function measureAccounts(root: Element) {
  const read = (element: Element): Box => {
    const { left, right, top, bottom, width } = element.getBoundingClientRect()
    return { left, right, top, bottom, width }
  }
  const all = (selector: string) => [...root.querySelectorAll(selector)].map((one) => read(one))
  const strip = root.querySelector('.account-strip')
  const drawer = root.closest('.drawer')
  if (!strip || !drawer) throw new Error('the strip or its drawer is missing')
  return {
    strip: read(strip),
    drawer: read(drawer),
    parts: all('.account-part'),
    marks: all('.account-mark'),
    numbers: all('.chart-tick'),
    rows: all('.account-row'),
    changes: all('.account-change'),
  }
}

/** Each row of who did the work: the list's box, the name's and each of its three figures'. */
function measureRoles(list: Element) {
  const read = (element: Element): Box => {
    const { left, right, top, bottom, width } = element.getBoundingClientRect()
    return { left, right, top, bottom, width }
  }
  return [...list.querySelectorAll('.work-usage-row')].map((row) => {
    const name = row.querySelector('.work-usage-name')
    if (!name) throw new Error('a row without its name')
    return {
      list: read(list),
      name: read(name),
      facts: [...row.querySelectorAll('.usage-fact')].map((fact) => read(fact)),
    }
  })
}

/**
 * How far the figures of one column stray from each other down the list, where the drawer gives
 * them columns: time under time, cost under cost. A narrow drawer sets them in a line of their
 * own under each name, where they are not columns and nothing is compared.
 */
function columnSpread(rows: ReturnType<typeof measureRoles>) {
  const inColumns = rows.every((row) => row.facts[0].top < row.name.bottom - 0.5)
  if (!inColumns) return { inColumns: 'lines', spread: 0 }
  const spreads = [0, 1, 2].map((column) => {
    const ends = rows.map((row) => row.facts[column].right)
    return Math.max(...ends) - Math.min(...ends)
  })
  return { inColumns: 'columns', spread: Math.max(...spreads) }
}

test('the tab opens Analytics filtered to the item', async ({ page }) => {
  const usage = whoUsage()
  await page.clock.setFixedTime(new Date(2026, 10, 11, 14, 30))
  await serve(page, usage)
  const asked: URLSearchParams[] = []
  await page.route('**/api/analytics/usage?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    asked.push(query)
    const answer = usageAnswer({
      first: new Date(2026, 10, 9),
      days: 3,
      end: new Date(2026, 10, 11, 14, 30),
      groupBy: [query.get('group_by') as UsageDimension],
      stretches: [],
    })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer) })
  })
  await page.goto(CARD)
  const section = await openAgents(page)
  await section.getByRole('link', { name: 'Open in Analytics' }).click()
  await expect(page).toHaveURL(/\/modules\/analytics\/global\?state=/u)
  // The app takes the address as the page's own: it opens the page, not the route's recovery.
  const analytics = page.locator('.analytics-page')
  await expect(analytics).toBeVisible()
  await expect(page.locator('.route-recovery')).toHaveCount(0)
  // The page reads the view the link wrote, says a filter is set and asks for the item's work.
  const state = new URL(page.url()).searchParams.get('state') ?? ''
  expect(readAddress(JSON.parse(Buffer.from(state, 'base64url').toString('utf8')))).toEqual({
    ...DEFAULT_VIEW,
    filters: { work_item: [usage.work_item_id] },
  })
  await expect(analytics.locator('.disclosure-toggle')).toHaveText('Filters · 1')
  // The page's own read, the period beside the one before, asks for the item's work alone.
  const own = () => asked.filter((query) => query.get('compare') === 'true')
  await expect.poll(() => own().length).toBeGreaterThan(0)
  expect(own().map((query) => query.get('work_item'))).toEqual(own().map(() => usage.work_item_id))
})

for (const width of [1440, 1024, 390]) {
  test(`the organizations the work ran under stand whole at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    const usage = whoUsage()
    await serve(page, usage)
    await page.goto(CARD)
    const section = await openAgents(page)
    const accounts = section.locator('.usage-accounts')
    await expect(accounts.locator('.account-part')).toHaveCount(4)
    await expect(accounts.locator('.account-mark')).toHaveCount(3)
    await expect(accounts.locator('.account-row')).toHaveCount(3)
    await expect(accounts.locator('.account-row').first()).toContainText(ORG_A.slice(0, 8))
    await expect(accounts.locator('.account-change')).toHaveCount(4)
    await accounts.scrollIntoViewIfNeeded()
    const measured = await accounts.evaluate(measureAccounts)
    const { strip, parts, marks, numbers } = measured
    // The parts tile the strip in time order, each as long as its share of the time.
    expect(Math.abs(parts[0].left - strip.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(parts[3].right - strip.right)).toBeLessThanOrEqual(1)
    for (const [index, part] of parts.entries()) {
      const share = usage.account_stretches[index].seconds / usage.agent_seconds
      expect(Math.abs(part.width - strip.width * share)).toBeLessThan(1.5)
    }
    // Each mark stands on the boundary its change begins at, its number over the strip.
    for (const [index, mark] of marks.entries()) {
      expect(Math.abs(mark.left + mark.width / 2 - parts[index + 1].left)).toBeLessThanOrEqual(1)
      expect(numbers[index].bottom).toBeLessThanOrEqual(strip.top + 0.5)
      expect(numbers[index].left).toBeGreaterThanOrEqual(measured.drawer.left)
      expect(numbers[index].right).toBeLessThanOrEqual(measured.drawer.right)
    }
    for (const row of [...measured.rows, ...measured.changes])
      expect(row.right).toBeLessThanOrEqual(strip.right + 0.5)
    info.annotations.push({
      type: 'layout',
      description: `R2 ${width}px: strip ${brief(strip)}, parts ${parts.map((part) => brief(part)).join(' ')}, marks ${marks.map((mark) => tenth(mark.left + mark.width / 2)).join(' ')}, rows end ${measured.rows.map((row) => tenth(row.right)).join(' ')}`,
    })
    console.log(info.annotations.at(-1)?.description)
    await expectNoSilentClipping(page, `organizations at ${width}px`)
    const results = await new AxeBuilder({ page })
      .include('.drawer .agents')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    await page.screenshot(shot(info, `agents-organizations-${width}.png`))
  })

  test(`who did the work stands in its columns at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await serve(page, whoUsage())
    await page.goto(CARD)
    const section = await openAgents(page)
    const roles = section.locator('[data-breakdown="roles"]')
    await expect(roles.locator('.work-usage-row')).toHaveCount(3)
    await expect(roles.locator('.work-usage-row').last()).toContainText('Adviser')
    await roles.scrollIntoViewIfNeeded()
    const rows = await roles.evaluate(measureRoles)
    for (const row of rows) {
      expect(row.facts).toHaveLength(3)
      for (const fact of row.facts) {
        // A figure stands after its name on the name's line, or on a line of its own under it.
        expect(fact.left >= row.name.right - 0.5 || fact.top >= row.name.bottom - 0.5).toBe(true)
        expect(fact.right).toBeLessThanOrEqual(row.list.right + 0.5)
      }
    }
    // Where the drawer gives the figures columns, each lines up down the list.
    const { inColumns, spread } = columnSpread(rows)
    expect(spread).toBeLessThanOrEqual(1)
    // The way to Analytics starts at the lists' edge, on one line, inside the tab.
    const link = section.locator('.work-usage-analytics')
    const { box, size } = await link.evaluate((element) => ({
      box: element.getBoundingClientRect().toJSON() as Box,
      size: Number.parseFloat(getComputedStyle(element).fontSize),
    }))
    expect(Math.abs(box.left - rows[0].list.left)).toBeLessThanOrEqual(1)
    expect(box.right).toBeLessThanOrEqual(rows[0].list.right + 0.5)
    // A second line would make it at least two of its letters tall.
    expect(box.bottom - box.top).toBeLessThan(2 * size)
    info.annotations.push({
      type: 'layout',
      description: `R3 ${width}px (${inColumns}): list ${brief(rows[0].list)}, names ${rows.map((row) => brief(row.name)).join(' ')}, figure ends ${rows[0].facts.map((fact) => tenth(fact.right)).join(' ')}; R4 link ${brief(box)} h ${tenth(box.bottom - box.top)}`,
    })
    console.log(info.annotations.at(-1)?.description)
    await expectNoSilentClipping(page, `who did the work at ${width}px`)
    await page.screenshot(shot(info, `agents-roles-${width}.png`))
  })

  test(`the way to an epic's own work stands whole at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    // Six items do not fit in the page's address, so the link opens the epic's own work.
    const usage = whoUsage()
    const [own] = usage.by_item
    await serve(page, {
      ...usage,
      by_item: [
        own,
        ...Array.from({ length: 5 }, (_, index) => ({
          ...own,
          work_item_id: `7d3e9a10-0000-4000-8000-00000000000${index + 1}`,
        })),
      ],
    })
    await page.goto(CARD)
    const section = await openAgents(page)
    const link = section.getByRole('link', { name: 'Open the epic’s own work in Analytics' })
    await link.scrollIntoViewIfNeeded()
    const { box, list, size } = await link.evaluate((element) => {
      const lists = element.closest('.work-usage')?.querySelector('.work-usage-grid')
      if (!lists) throw new Error('the tab has no list')
      return {
        box: element.getBoundingClientRect().toJSON() as Box,
        list: lists.getBoundingClientRect().toJSON() as Box,
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      }
    })
    expect(Math.abs(box.left - list.left)).toBeLessThanOrEqual(1)
    expect(box.right).toBeLessThanOrEqual(list.right + 0.5)
    const lines = Math.round((box.bottom - box.top) / (size * 1.25))
    info.annotations.push({
      type: 'layout',
      description: `R4 own ${width}px: list ${brief(list)}, link ${brief(box)} h ${tenth(box.bottom - box.top)} (${lines} line)`,
    })
    console.log(info.annotations.at(-1)?.description)
    await expectNoSilentClipping(page, `the way to the epic's own work at ${width}px`)
  })
}
