/**
 * The change against the period before with the page narrowed to one account, in the real app at
 * 1440 and 1024 pixels. The oracle is DESIGN's rule for the section's table, which holds for the
 * overview and the rail: accounts that spent in the period, whose organization's work no reading
 * placed on an account came to more in the period before than their own figure there, have «not
 * known before» as their change and no percent; their own figure larger, or the page narrowed to
 * no account, the percent stands. «This week» is compared with the same days of the week before,
 * which the page reads on its own, so the words come through that read too.
 *
 * The words take the percent's place and nothing else: the rail's tile of the overview keeps its
 * box to the pixel and the words whole inside it, and no tile's change is cut. The rail says the
 * words shorter, «Not known before», so its total stands whole beside them at both widths, as it
 * does beside the percent; the cards keep the whole phrase. Each run prints what it
 * measured, the total's cut too. At 1024 pixels the rail is the list of sections, read before the
 * overview's panel is opened over it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { seatValue, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve, shortfalls } from './analyticsPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

const ORG = '5e5e5e5e-1111-4222-8333-444444444444'
const P = seatValue(`${ORG}/6f6f6f6f-1111-4222-8333-444444444444`)
const Q = seatValue(`${ORG}/7a7a7a7a-1111-4222-8333-444444444444`)
const LOOSE = seatValue(`${ORG}/`)
const HOUR = 3600

const on = (day: number) => new Date(2026, 10, day, 10)
const by = (seat: typeof P, number: number) => ({
  seat,
  account: value(ORG),
  work_item: task(number, `Task ${number}`),
  model: value('model-a'),
})

/**
 * This week: P six hours, Q two. The same days of the week before: P ten minutes, Q four hours
 * with four times its tokens and cost now, and three hours of the organization's work no reading
 * placed on an account.
 */
const WEEK: TimedStretch[] = [
  { at: on(9), group: by(P, 1), spend: { seconds: 6 * HOUR, tokens: 3e6, cost: 30 } },
  { at: on(10), group: by(Q, 2), spend: { seconds: 2 * HOUR, tokens: 1e6, cost: 10 } },
  { at: on(2), group: by(P, 1), spend: { seconds: 600, tokens: 1e5, cost: 1 } },
  { at: on(2), group: by(Q, 2), spend: { seconds: 4 * HOUR, tokens: 4e6, cost: 40 } },
  { at: on(3), group: by(LOOSE, 3), spend: { seconds: 3 * HOUR, tokens: 3e6, cost: 30 } },
]

const narrowed = (filter: Record<string, string[]>) =>
  pageAt(Object.keys(filter).length ? { filters: JSON.stringify(filter) } : {})

const OVERVIEW_TILE = '.analytics-rail-entry[data-section="overview"]'
const overviewTile = (page: Page) => page.locator(OVERVIEW_TILE)

/** What the rail's tile of the overview says, and where it and its words stand. */
async function railTile(page: Page) {
  await expect(page.locator('.analytics-rail [aria-busy="true"]')).toHaveCount(0)
  return overviewTile(page).evaluate((entry) => {
    // This body is serialized and evaluated in the page, where no outer helper is in scope.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null) => {
      if (!element) return null
      const { left, right, width } = element.getBoundingClientRect()
      return { left, right, width }
    }
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const words = (element: Element | null) =>
      (element?.textContent ?? '').replaceAll(/\s+/gu, ' ').trim()
    const lead = entry.querySelector<HTMLElement>('.rail-tile-lead')
    const aside = entry.querySelector<HTMLElement>('.rail-tile-aside')
    const padding = Number.parseFloat(getComputedStyle(entry).paddingInlineEnd)
    return {
      entry: box(entry),
      inner: entry.getBoundingClientRect().right - padding,
      lead: words(lead),
      leadCut: lead ? lead.scrollWidth - lead.clientWidth : -1,
      aside: words(aside),
      asideBox: box(aside),
    }
  })
}

/** Each tile's change, as it reads and how much of it is cut, in the order of the tiles. */
async function tileChanges(page: Page) {
  const changes = page.locator('.spending-tiles [data-direction]')
  await expect(changes).toHaveCount(3)
  return changes.evaluateAll((all) =>
    all.map((change) => ({
      direction: (change as HTMLElement).dataset.direction,
      text: (change.textContent ?? '').replaceAll(/\s+/gu, ' ').trim(),
      cut: change.scrollWidth - change.clientWidth,
    })),
  )
}

/**
 * The page at `width`, narrowed by `filter`: the rail's tile of the overview once it says
 * `aside`, with nothing on the rail clipped silently, read before the overview's panel is put on
 * show, which a narrow page opens over the rail.
 */
async function open(page: Page, width: number, filter: Record<string, string[]>, aside: string) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(narrowed(filter))
  await expect(overviewTile(page).locator('.rail-tile-aside')).toHaveText(aside)
  await page.evaluate(() => document.fonts.ready)
  const rail = await railTile(page)
  // The total, measured where its letters are laid: a cut of a fraction of a pixel counts.
  const [lead] = await shortfalls(page, `${OVERVIEW_TILE} .rail-tile-lead`)
  await expectNoSilentClipping(page, `rail saying ${aside} at ${width}px`, '.analytics-rail')
  if (!(await page.locator('.spending-tiles').isVisible())) await overviewTile(page).click()
  await expect(page.locator('.spending-tiles')).toBeVisible()
  return { ...rail, leadShort: lead?.short ?? Number.NaN }
}

for (const width of [1440, 1024])
  test(`at ${width}px an account whose organization's work before was on no account says it was not known before`, async ({
    page,
  }, info) => {
    await serve(page, WEEK)

    // P: three hours on no account against its own ten minutes.
    // The rail says it in its own short words; the cards in the table's whole phrase.
    const words = await open(page, width, { seat: [P.id ?? ''] }, 'Not known before')
    const wordsTiles = await tileChanges(page)
    expect(wordsTiles.map((one) => one.text)).toEqual([
      'Account not known before',
      'Account not known before',
      'Account not known before',
    ])

    // Q, the control: its own four hours outweigh the three, and the percent stands.
    const percent = await open(page, width, { seat: [Q.id ?? ''] }, '↓ 50%')
    const percentTiles = await tileChanges(page)
    expect(percentTiles.map((one) => one.direction)).toEqual(['down', 'down', 'down'])

    // By the organization, and not narrowed at all, the unplaced work is in the figure.
    await open(page, width, { account: [ORG] }, '↑ 12%')
    await open(page, width, {}, '↑ 12%')

    await record(info, `analytics account change ${width}`, {
      words,
      percent,
      wordsTiles,
      percentTiles,
    })
    // The words take the percent's place: the tile's box is the same, the words whole inside it.
    expect(words.entry?.width ?? 0).toBeGreaterThan(0)
    expect(words.entry).toEqual(percent.entry)
    expect(words.lead).toBe('6 h')
    expect(percent.lead).toBe('2 h')
    // The tile's total stands whole beside the words, as beside the percent.
    expect(words.leadShort, 'the total beside the words is cut, in px').toBeLessThanOrEqual(0)
    expect(percent.leadShort, 'the total beside the percent is cut, in px').toBeLessThanOrEqual(0)
    expect(words.asideBox?.right ?? Infinity).toBeLessThanOrEqual(words.inner + 0.5)
    for (const one of [...wordsTiles, ...percentTiles])
      expect(one.cut, `${one.text} is cut`).toBeLessThanOrEqual(0)
  })
