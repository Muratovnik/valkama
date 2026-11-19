/**
 * What a step line draws and points at past its readings, in the browser on the panel's ground:
 * the harness's five hours, read at 14:30, its forecast's corridor running from «now» to the reset
 * at 16:00, opened on now and a third past it and over the whole window. The corridor's every
 * corner stands inside the plot; «now» and the forecast at the reset paint their marks only while
 * pointed at or focused, each saying itself in a hint beside its mark and level with it, clear of
 * the line's head, with nothing of the line moving; opened on now, the forecast's hint says the
 * reset stands past the plot's edge; the keyboard walks on from the latest reading to both. Each
 * view attaches what it measured. Each part is read by the hook `StepLine` documents for it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { aheadOfLines, cornersOutside } from './stepAhead.ts'
import { test } from './test.ts'

const HARNESS = '/tests/browser/harness.html?lang=en&surface=charts'
const LINE = '[data-harness="step"] [data-chart="steps"]'

/** The harness's one step line past its readings (`aheadOfLines`). */
async function aheadOfLine(page: Page) {
  const [line] = await page.evaluate(aheadOfLines, LINE)
  if (!line) throw new Error('the harness draws no step line')
  return line
}

/** The words of each place's hint: its name, its figure and the lines under them. */
const NOW_HINT = ['Now', '58%', 'Last reading at 14:00, 30 min ago, from the poll']
const RESET_HINT = [
  'Forecast by the reset',
  '84%–100%',
  'May run out before the reset: 84% or more by then',
  'Resets 16:00, in 1 h 30 min',
]

const VIEWS = [
  {
    view: 'To now and the forecast',
    title: 'opened on now',
    hints: { now: NOW_HINT, reset: [...RESET_HINT, 'The reset is past the right edge'] },
  },
  {
    view: 'Whole window',
    title: 'over the whole window',
    hints: { now: NOW_HINT, reset: RESET_HINT },
  },
] as const

for (const { view, title, hints } of VIEWS)
  test(`${title}, a step line points at now and at its forecast, each hinted at its mark, its corridor inside the plot`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 1400 })
    await page.goto(HARNESS)
    const figure = page.locator(LINE)
    await figure.scrollIntoViewIfNeeded()
    await figure.getByRole('radio', { name: view }).click()
    await page.mouse.move(1, 1)
    // The legend names the hatch of the corridor.
    await expect(figure.locator('[data-key="ahead"]')).toHaveText('Forecast')
    const rest = await aheadOfLine(page)
    await testInfo.attach(`ahead-${title}`, {
      body: JSON.stringify(rest, null, 2),
      contentType: 'application/json',
    })
    // The corridor's every corner inside the plot's field, to half a pixel.
    expect(rest.corners.length).toBeGreaterThanOrEqual(4)
    expect(cornersOutside(rest), 'corners outside the field').toEqual([])
    // At rest neither place paints its mark.
    expect(rest.places.map(({ kind, painted }) => [kind, painted])).toEqual([
      ['now', false],
      ['reset', false],
    ])
    // Each is pointed at 4px into its stretch, from its start for «now» and from its end for the
    // forecast, at its mark's height.
    const [now, reset] = rest.places
    const aims = [
      {
        kind: 'now',
        x: (now?.reach?.left ?? 0) + 4,
        y: (now?.mark?.top ?? 0) + 4,
        words: hints.now,
      },
      {
        kind: 'reset',
        x: (reset?.reach?.right ?? 0) - 4,
        y: (reset?.mark?.top ?? 0) + 4,
        words: hints.reset,
      },
    ]
    for (const [index, aim] of aims.entries()) {
      await page.mouse.move(aim.x, aim.y)
      const tooltip = page.getByRole('tooltip')
      for (const line of aim.words) await expect(tooltip).toContainText(line)
      const pointed = await aheadOfLine(page)
      const place = pointed.places[index]
      expect(place?.painted, `${aim.kind}: its mark painted`).toBe(true)
      expect(
        pointed.places.filter((one) => one.painted),
        `${aim.kind}: one mark painted`,
      ).toHaveLength(1)
      const hint = await page
        .locator('[data-hint-surface]')
        .evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect)
      const mark = place?.mark ?? hint
      // Beside its mark, on whichever side has the room, level with its top, under the head.
      const across = Math.min(Math.abs(hint.left - mark.right), Math.abs(mark.left - hint.right))
      expect(across, `${aim.kind}: the hint beside its mark`).toBeLessThan(12)
      expect(
        Math.abs(hint.top - mark.top),
        `${aim.kind}: the hint level with its mark`,
      ).toBeLessThan(12)
      expect(hint.top, `${aim.kind}: the hint under the line’s head`).toBeGreaterThanOrEqual(
        pointed.head?.bottom ?? 0,
      )
      // Nothing of the line moved.
      expect(pointed.boxes, `${aim.kind}: the line held still`).toEqual(rest.boxes)
      expect(pointed.height).toBe(rest.height)
      await page.mouse.move(1, 1)
    }
    // The keyboard walks on from the latest reading to «now» and to the forecast, and paints the
    // mark of the place it stands on.
    await figure.getByRole('radio', { name: view }).focus()
    await page.keyboard.press('Tab')
    await expect(figure.locator('[data-reading="3"]')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(figure.locator('[data-target="now"]')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(figure.locator('[data-target="reset"]')).toBeFocused()
    const walked = await aheadOfLine(page)
    expect(walked.places.map(({ painted }) => painted)).toEqual([false, true])
  })
