/**
 * Every step line of the quota shows its whole window, in the built app (`StepLine`, `QuotaWindow`;
 * DESIGN.md, Charts, the step line). The oracle is the rule: no line has a choice of span; the
 * axis names its left end as the window's start and its right end as its reset, «resets …» ahead
 * and «reset at …» once passed, dated where it is not the panel's day, so the right end is never a
 * bare time that reads as now; a running window marks now on its line, an upright hairline inside the
 * plot that the legend names «Now»; a window past its reset is drawn in the neutral ink its bar
 * is, with no now; and the top of the scale, «100%», is centred on a hairline at its level, where
 * a line at 100 % runs.
 *
 * The panel's moment is 14:30 on Nov 11 (`NOW`). On the week's panel: «Work»'s week, fresh, four
 * days in; the unnamed account's week, silent three hours, six days in; «Work»'s model's week, made
 * here to have reset two hours ago; and the seated account's week, fresh, three days in. Each run
 * attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { NIGHT_NAME, quotaAt, SEATED_NAME, share } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How far a drawn edge may stand from where it should: the drawing's rounding, a pixel. */
const NEAR = 1

/** The quota fixture with «Work»'s model's week past its reset by two hours. */
function withEnded(): Quota {
  const quota = quotaAt(NOW)
  const work = quota.accounts[0]
  if (!work) throw new Error('«Work» is first')
  work.windows[2] = share(NOW.getTime(), quota.utc_offset, {
    kind: 'week_model',
    model: 'model-a',
    left: -2 * HOUR,
    source: 'poll',
    readings: [
      [6 * DAY, 4],
      [3 * HOUR, 12.5],
    ],
    forecast: null,
  })
  return quota
}

/** What each window's line says and draws, by its account and its kind. */
const linesOf = (page: Page) =>
  page.locator('[data-account] [data-window]').evaluateAll((windows) =>
    windows.map((window) => {
      const line = window.querySelector<HTMLElement>('[data-chart="steps"]')
      const box = (selector: string) =>
        line?.querySelector(selector)?.getBoundingClientRect().toJSON() as DOMRect | undefined
      const field = box('[data-region="field"]')
      const drawn = line?.querySelector('[data-mark="line"]')
      const fill = window.querySelector('[data-mark="fill"]')
      return {
        key: `${window.closest<HTMLElement>('[data-account]')?.dataset.account} ${(window as HTMLElement).dataset.window}`,
        choices: line?.querySelectorAll('[role="radio"], [role="radiogroup"], button').length ?? -1,
        from: line?.querySelector('[data-region="axis"] [data-moment="from"]')?.textContent ?? '',
        to: line?.querySelector('[data-region="axis"] [data-moment="to"]')?.textContent ?? '',
        muted: line?.dataset.muted !== undefined,
        stroke: drawn ? getComputedStyle(drawn).stroke : '',
        fill: fill ? getComputedStyle(fill).backgroundColor : '',
        field,
        lineRight: drawn?.getBoundingClientRect().right ?? Number.NaN,
        nowRule: box('[data-mark="now"]'),
        nowKey: line?.querySelector('[data-region="head"] [data-key="now"]')?.textContent ?? '',
        top: box('[data-region="scale"]'),
        topText: line?.querySelector('[data-region="scale"]')?.textContent ?? '',
        ceiling: box('[data-mark="ceiling"]'),
        drawing: box('[data-region="drawing"]'),
      }
    }),
  )

/** The words at the two ends of each line's axis, and whether the line is muted, by window. */
const EXPECTED = {
  'Work week': ['start Nov 7, 14:30', 'resets Nov 14, 14:30', false],
  'Work week_model': ['start Nov 4, 12:30', 'reset at 12:30', true],
  [`${NIGHT_NAME} week`]: ['start Nov 5, 14:30', 'resets Nov 12, 14:30', false],
  [`${SEATED_NAME} week`]: ['start Nov 8, 14:30', 'resets Nov 15, 14:30', false],
}

for (const width of [1440, 1024, 390])
  test(`at ${width}px every step line shows its whole window and names its start and its reset`, async ({
    page,
  }, info) => {
    await serve(page)
    await serveQuota(page, withEnded())
    await page.setViewportSize({ width, height: 1000 })
    await openPanel(page, pageAt({ by: 'quota_week' }))
    const panel = page.locator('.quota-panel')
    await panel.getByRole('radio', { name: 'Chart' }).check()
    await expect(panel.locator('[data-chart="steps"]')).toHaveCount(4)
    const lines = await linesOf(page)
    await record(info, `quota-whole-${width}`, lines)

    // No line offers a choice of span, and each axis names the window's start and its reset.
    expect(
      Object.fromEntries(lines.map((one) => [one.key, [one.from, one.to, one.muted]])),
    ).toEqual(EXPECTED)
    expect(lines.map((one) => one.choices)).toEqual([0, 0, 0, 0])

    const running = lines.filter((one) => !one.muted)
    expect(running).toHaveLength(3)
    for (const line of running) {
      const field = line.field ?? new DOMRect()
      const rule = line.nowRule ?? new DOMRect(Number.NaN)
      // Now is marked inside the plot, and the legend names its hairline.
      expect(line.nowKey, `${line.key}: the legend's key`).toBe('Now')
      const at = (rule.left - field.left) / field.width
      expect(at, `${line.key}: now inside the plot`).toBeGreaterThan(0)
      expect(at, `${line.key}: now inside the plot`).toBeLessThan(1)
    }
    // A fresh window's line holds to now; a silent one's stops at its last reading, well before.
    const byKey = Object.fromEntries(lines.map((one) => [one.key, one]))
    const work = byKey['Work week']
    const night = byKey[`${NIGHT_NAME} week`]
    expect(Math.abs((work?.lineRight ?? 0) - (work?.nowRule?.left ?? Number.NaN))).toBeLessThan(
      NEAR + 1,
    )
    expect((night?.nowRule?.left ?? 0) - (night?.lineRight ?? Number.NaN)).toBeGreaterThan(0)

    // Past its reset: no now, and its line in the ink its bar is drawn in.
    const ended = byKey['Work week_model']
    expect([ended?.nowRule, ended?.nowKey]).toEqual([undefined, ''])
    expect(ended?.stroke).toBe(ended?.fill)
    expect(work?.stroke, 'the control: a running line in its own hue').not.toBe(ended?.stroke)

    // «100%» centred on the hairline at its level, which is the drawing's top, where 100 % runs.
    for (const line of lines) {
      const top = line.top ?? new DOMRect(Number.NaN)
      const ceiling = line.ceiling ?? new DOMRect(Number.NaN)
      expect(line.topText).toBe('100%')
      expect(Math.abs(ceiling.top - (line.drawing?.top ?? Number.NaN)), line.key).toBeLessThan(NEAR)
      expect(Math.abs(top.top + top.height / 2 - ceiling.top), line.key).toBeLessThan(NEAR)
    }
  })
