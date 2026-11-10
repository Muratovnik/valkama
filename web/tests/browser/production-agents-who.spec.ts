/**
 * Who spent an item's work and under which organization, on its Agents tab in the real app, at
 * the three widths the card is used at: the strip of organizations with its marks where the
 * organization changed, and each organization with its share. Every box is measured after the
 * last write, and nothing on the tab may clip what it holds.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

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
    info.annotations.push({
      type: 'layout',
      description: `R3 ${width}px (${inColumns}): list ${brief(rows[0].list)}, names ${rows.map((row) => brief(row.name)).join(' ')}, figure ends ${rows[0].facts.map((fact) => tenth(fact.right)).join(' ')}`,
    })
    console.log(info.annotations.at(-1)?.description)
    await expectNoSilentClipping(page, `who did the work at ${width}px`)
    await page.screenshot(shot(info, `agents-roles-${width}.png`))
  })
}
