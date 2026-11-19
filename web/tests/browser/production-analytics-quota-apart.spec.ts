/**
 * Two windows of one account side by side on the quota's panel, in the real app at the widths the
 * page is used at beside its rail. The oracle is the rule (`DESIGN.md`, Analytics, the quota's
 * panel): neighbouring windows stand 32px apart with a hairline in the rule's ink midway between
 * them, so the moments ending one window's axis and starting the next are at least that far apart
 * and never read as one axis; a window that starts a row has no hairline before it, and at 1280px,
 * where the panel is narrower than two windows and their gap, every window starts one; and each
 * window's forecast line is its words alone, starting where the reset's under them do, nothing of
 * it in the card's inset. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { quotaOfEdges } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { forecastLines } from './quotaForecastLine.ts'
import { test } from './test.ts'

/** How far apart two windows side by side stand (`--space-8`). */
const APART = 32

/**
 * Each account's windows in their order: the window's box, the boxes its step line's axis says
 * its moments in, and the hairline before it, where one is drawn, as the browser resolves it.
 */
const windowsOf = (page: Page) =>
  page.locator('[data-account]').evaluateAll((accounts) =>
    accounts.map((account) => ({
      account: (account as HTMLElement).dataset.account ?? '',
      windows: [...account.querySelectorAll<HTMLElement>('[data-window]')].map((window) => {
        const box = window.getBoundingClientRect()
        const moments = [
          ...window.querySelectorAll('[data-chart="steps"] [data-region="axis"] [data-moment]'),
        ].map((moment) => moment.getBoundingClientRect())
        const rule = getComputedStyle(window, '::before')
        const drawn = rule.display !== 'none' && rule.content !== 'none'
        const offset = Number.parseFloat(rule.left)
        const width = Number.parseFloat(rule.borderLeftWidth)
        return {
          kind: window.dataset.window ?? '',
          left: box.left,
          right: box.right,
          top: box.top,
          moments: moments.length,
          momentsLeft: Math.min(...moments.map((one) => one.left)),
          momentsRight: Math.max(...moments.map((one) => one.right)),
          rule: drawn
            ? {
                from: box.left + offset,
                to: box.left + offset + width,
                top: box.top,
                height: Number.parseFloat(rule.height),
                colour: rule.borderLeftColor,
              }
            : null,
        }
      }),
    })),
  )

/** The rule's ink as the page resolves it (`--color-rule`). */
const ruleInk = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--color-rule)'
    document.body.append(probe)
    const ink = getComputedStyle(probe).color
    probe.remove()
    return ink
  })

/**
 * The accounts whose windows stand side by side at each width: «Work» and «Edge» each have their
 * week and a model's week, which share a row at 1440px; at 1280px the panel is under two windows
 * of 24rem and the gap between them, so they stack.
 */
const SIDE_BY_SIDE: Record<number, string[]> = { 1280: [], 1440: ['Work', 'Edge'] }

for (const width of [1280, 1440])
  test(`at ${width}px neighbouring windows stand ${APART}px apart with a hairline between, and the forecast line stays in its column`, async ({
    page,
  }, info) => {
    await serve(page)
    await serveQuota(page, quotaOfEdges(NOW))
    await page.setViewportSize({ width, height: 1000 })
    await openPanel(page, pageAt({ by: 'quota_week' }))
    await expect(page.locator('[data-account]')).toHaveCount(5)
    await drawLined(page.locator('.chart-section').first())
    await page.evaluate(() => document.fonts.ready)

    const accounts = await windowsOf(page)
    const ink = await ruleInk(page)
    const pairs = accounts.flatMap(({ account, windows }) =>
      windows.slice(1).flatMap((right, index) => {
        const left = windows[index]
        return left && Math.abs(left.top - right.top) < 1 ? [{ account, left, right }] : []
      }),
    )
    const starts = accounts.flatMap(({ account, windows }) =>
      windows
        .filter(
          (one, index) => index === 0 || Math.abs((windows[index - 1]?.top ?? 0) - one.top) >= 1,
        )
        .map((one) => ({ account, one })),
    )
    const lines = await forecastLines(page)
    await record(info, `quota windows apart ${width}`, { ink, pairs, starts, lines })

    expect(
      pairs.map(({ account }) => account),
      'the neighbouring windows',
    ).toEqual(SIDE_BY_SIDE[width])
    for (const { account, left, right } of pairs) {
      const at = `${account} ${left.kind} | ${right.kind}`
      expect([left.moments, right.moments], `${at}: the moments of each axis`).toEqual([2, 2])
      expect(right.left - left.right, `${at}: the gap between the windows`).toBeCloseTo(APART, 0)
      expect(
        right.momentsLeft - left.momentsRight,
        `${at}: the gap between their axes' moments`,
      ).toBeGreaterThanOrEqual(APART)
      // The hairline before the second, midway in the gap, as tall as the window, in the rule's ink.
      expect(right.rule, `${at}: the hairline`).not.toBeNull()
      const middle = ((right.rule?.from ?? 0) + (right.rule?.to ?? 0)) / 2
      expect(middle, `${at}: the hairline midway`).toBeCloseTo((left.right + right.left) / 2, 0)
      expect(right.rule?.to ?? 0, `${at}: the hairline clear of the second`).toBeLessThan(
        right.left,
      )
      expect(right.rule?.from ?? 0, `${at}: the hairline clear of the first`).toBeGreaterThan(
        left.right,
      )
      expect(right.rule?.colour, `${at}: the hairline's ink`).toBe(ink)
    }
    // A window that starts a row has none: there is no neighbour before it.
    const shown = accounts.filter(({ windows }) => windows.length > 0)
    expect(starts.length, 'the windows that start a row').toBeGreaterThanOrEqual(shown.length)
    for (const { account, one } of starts)
      expect(one.rule, `${account} ${one.kind}: no hairline before a row's first`).toBeNull()

    // The forecast line is its words alone, flush with the reset's, nothing of it to their left.
    expect(lines.length, 'the forecast lines').toBeGreaterThan(0)
    for (const one of lines) {
      expect(
        Math.abs(one.forecast - one.reset),
        `${one.key}: flush with the reset`,
      ).toBeLessThanOrEqual(0.5)
      expect(one.leftmost, `${one.key}: the leftmost of its line`).toBeGreaterThanOrEqual(
        one.reset - 0.5,
      )
      expect(one.marks, `${one.key}: what it draws besides its words`).toBe(0)
    }
  })
