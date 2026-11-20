/**
 * Two windows of one account side by side line their parts up row by row, in the built app
 * (`PanelLevel`'s `rows`, `QuotaWindow`, `QuotaPastWindow`). The oracle is the rule (DESIGN.md,
 * Analytics, the quota's panel): in every pair of window cards the heading, what stands now, the
 * line's head and the plot each start level with the neighbour's, whatever each holds, so the
 * plots start at one height; and the air inside each card is what it was, 12px under the heading,
 * 12px from what stands now to the line, 8px from the line's head to its plot and from the axis to
 * the line under it.
 *
 * At 1440px «Work»'s week and its model's week share a row. The week runs: one line leads it and
 * its forecast and its reset stand under its bar. The model's week is made here to have reset two
 * hours ago: two lines lead it, that it reset and its share before, and it forecasts nothing. So
 * what stands over the two plots differs by more than a line, the control that each card laid out
 * on its own starts its plot at another height. Its line is the account's current week, the
 * running week's, with nothing read in it yet; it shows its past window too, opened in its place
 * beside the running week. As tables, the week's readings' table and the model's words that its
 * week has none start level. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { momentAt } from '../fixtures/analytics.ts'
import { quotaAt, share } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How far two parts may start apart and still be level: the layout's rounding. */
const LEVEL = 0.5

const offset = -NOW.getTimezoneOffset()

/** The model's week of «Work» before the one shown, which reset 7 days and 2 hours ago. */
const BEFORE = share(NOW.getTime() - 7 * DAY, offset, {
  kind: 'week_model',
  model: 'model-a',
  left: -2 * HOUR,
  source: 'poll',
  readings: [
    [6 * DAY, 2],
    [3 * HOUR, 30],
  ],
  forecast: null,
})

/** The quota fixture with «Work»'s model's week past its reset, and how the one before it ended. */
function withEnded(): Quota {
  const quota = quotaAt(NOW)
  const work = quota.accounts[0]
  if (!work) throw new Error('«Work» is first')
  work.windows[2] = share(NOW.getTime(), offset, {
    kind: 'week_model',
    model: 'model-a',
    left: -2 * HOUR,
    source: 'poll',
    readings: [
      [6 * DAY, 4],
      [3 * HOUR, 12.5],
    ],
    forecast: null,
    previous: {
      started_at: BEFORE.started_at ?? '',
      resets_at: BEFORE.resets_at ?? '',
      latest: BEFORE.latest,
      ran_out: false,
    },
  })
  return quota
}

/** Answers the read of a past window with the model's week before the one shown. */
async function servePast(page: Page) {
  await page.route('**/api/analytics/quota/window?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    await route.fulfill({
      json: {
        interface_version: 'valkama-analytics-api',
        quota_window: {
          now: momentAt(NOW.getTime(), offset),
          utc_offset: offset,
          fresh_for_seconds: 900,
          retained_from: momentAt(NOW.getTime() - 365 * DAY, offset),
          account: query.get('account'),
          kind: query.get('kind'),
          model: query.get('model'),
          before: query.get('before'),
          window: { ...BEFORE, even_percent: null },
        },
      },
    })
  })
}

/**
 * Where each part of «Work»'s two weeks starts and ends, by the hooks the components document:
 * the heading row, what stands now (its leading lines and its bar, or a past window's heading),
 * the step line's head and field and its axis, the readings' table or the words that there is
 * none, and the line under it all.
 */
const partsOf = (page: Page) =>
  page.locator('[data-account="Work"] [data-window]').evaluateAll((windows) =>
    windows.map((window) => {
      const shown = (selector: string) =>
        [...window.querySelectorAll(selector)]
          .map((one) => one.getBoundingClientRect())
          .find((box) => box.height > 0)
      const head = shown(':scope > [data-level-head]')
      const says = shown('[data-lead], [data-past="shown"]')
      const lineHead = shown('[data-chart="steps"] [data-region="head"]')
      const field = shown('[data-chart="steps"] [data-region="field"]')
      const axis = shown('[data-chart="steps"] [data-region="axis"]')
      const under = shown('[data-past="line"], [data-past="none"]')
      const said = [...window.querySelectorAll('[data-lead], [data-mark="track"], [data-fact]')]
        .map((one) => one.getBoundingClientRect())
        .filter((box) => box.height > 0)
      return {
        kind: (window as HTMLElement).dataset.window ?? '',
        left: window.getBoundingClientRect().left,
        leads: window.querySelectorAll('[data-lead]').length,
        head: head?.top ?? Number.NaN,
        headBottom: head?.bottom ?? Number.NaN,
        says: says?.top ?? Number.NaN,
        saidBottom: Math.max(...said.map((box) => box.bottom)),
        lineHead: lineHead?.top ?? Number.NaN,
        lineHeadBottom: lineHead?.bottom ?? Number.NaN,
        field: field?.top ?? Number.NaN,
        axisBottom: axis?.bottom ?? Number.NaN,
        under: under?.top ?? Number.NaN,
        table: shown('[data-region="table-frame"], [data-region="table-empty"]')?.top ?? Number.NaN,
      }
    }),
  )

async function open(page: Page) {
  await serve(page)
  await serveQuota(page, withEnded())
  await servePast(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_week' }))
  const panel = page.locator('.quota-panel')
  await panel.getByRole('radio', { name: 'Chart' }).check()
  await expect(page.locator('[data-account="Work"] [data-window]')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  return panel
}

/** The two windows of the pair, the running week first, side by side. */
async function pairOf(page: Page) {
  const parts = await partsOf(page)
  expect(parts.map(({ kind }) => kind)).toEqual(['week', 'week_model'])
  const [week, model] = parts
  if (!week || !model) throw new Error('the pair is two windows')
  expect(model.left, 'side by side').toBeGreaterThan(week.left + 100)
  return { week, model }
}

test('two windows side by side start their heading, what stands now, the line’s head and its plot level', async ({
  page,
}, info) => {
  await open(page)
  const { week, model } = await pairOf(page)
  await record(info, 'quota pair', { week, model })
  // The control: what stands over the two plots differs by more than a line.
  expect([week.leads, model.leads]).toEqual([1, 2])
  expect(Math.abs(model.saidBottom - week.saidBottom), 'what stands now, apart').toBeGreaterThan(10)
  for (const part of ['head', 'says', 'lineHead', 'field', 'under'] as const)
    expect(Math.abs(week[part] - model[part]), `${part} level`).toBeLessThan(LEVEL)
  // The air inside each card is its own: 12px under the heading, 12px from what stands now to the
  // line's head in the taller card, 8px from the line's head to its plot and from the axis to the
  // line under it in both.
  expect(model.says - model.headBottom).toBeCloseTo(12, 0)
  const taller = Math.max(week.saidBottom, model.saidBottom)
  expect(week.lineHead - taller, 'what stands now to the line').toBeCloseTo(12, 0)
  for (const one of [week, model]) {
    expect(one.field - one.lineHeadBottom, `${one.kind}: line's head to plot`).toBeCloseTo(8, 0)
    expect(one.under - one.axisBottom, `${one.kind}: axis to the line under it`).toBeCloseTo(8, 0)
  }
})

test('a past window open beside a running one starts its plot level with the neighbour’s', async ({
  page,
}, info) => {
  const panel = await open(page)
  await panel.locator('[data-account="Work"] [data-window="week_model"] [data-past="line"]').click()
  const view = panel.locator('[data-account="Work"] [data-window="week_model"] [data-past="view"]')
  await expect(view.locator('[data-reading]')).toHaveCount(2)
  const { week, model } = await pairOf(page)
  await record(info, 'quota pair, past open', { week, model })
  for (const part of ['head', 'says', 'lineHead', 'field'] as const)
    expect(Math.abs(week[part] - model[part]), `${part} level`).toBeLessThan(LEVEL)
})

test('as tables, two windows side by side start their readings’ tables level', async ({
  page,
}, info) => {
  const panel = await open(page)
  await panel.getByRole('radio', { name: 'Table' }).check()
  const work = page.locator('[data-account="Work"]')
  await expect(work.locator('[data-window="week"] [data-region="table-frame"] table')).toHaveCount(
    1,
  )
  await expect(work.locator('[data-window="week_model"] [data-region="table-empty"]')).toHaveCount(
    1,
  )
  const { week, model } = await pairOf(page)
  await record(info, 'quota pair, tables', { week, model })
  for (const part of ['head', 'table', 'under'] as const)
    expect(Math.abs(week[part] - model[part]), `${part} level`).toBeLessThan(LEVEL)
})
