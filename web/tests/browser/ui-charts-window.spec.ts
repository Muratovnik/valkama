/**
 * The two chart forms of a window of a limit, in the browser on the panel's ground: the window
 * bar in each state it draws and a window's readings as a step line, with their tables. In the
 * light and the dark theme a bar's fill is as long as the share spent and stops at the track's
 * end, its tick stands where steady use would be and crosses the bar, and the fill, the track and
 * the tick stand apart from each other and the fill from the ground by a contrast a reader can see
 * — a contrast of lightness, so the bar reads in grayscale too; a window that is not fresh is
 * hatched and a fresh one is not; no word is cut. The step line draws only flat and upright
 * strokes, a mark at each reading where its moment and value put it, and the reading under the
 * pointer says itself in a hint over the plot without moving anything, with no line over the plot.
 * A forced palette draws them in its inks.
 * Each theme attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

/** WCAG's least contrast for a part of a graphic a reader must tell from what is around it. */
const GRAPHIC_CONTRAST = 3

const HARNESS = '/tests/browser/harness.html?lang=en&surface=charts'

/** Each bar as drawn: its boxes, its paints and their contrasts, and whether its words fit. */
function windowBars(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('no canvas to read colours with')
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [red = 0, green = 0, blue = 0] = Array.from(
        context.getImageData(0, 0, 1, 1).data.subarray(0, 3),
      ).map((channel) => {
        const unit = channel / 255
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const contrast = (first: string, second: string) => {
      const [light = 0, dark = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a)
      return (light + 0.05) / (dark + 0.05)
    }
    const section = document.querySelector('[data-harness="window"]')
    if (!section) throw new Error('the window bars are not drawn')
    const ground = getComputedStyle(section).backgroundColor
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null) => {
      if (!element) return null
      const { left, right, top, bottom, width } = element.getBoundingClientRect()
      return { left, right, top, bottom, width }
    }
    return [...section.querySelectorAll<HTMLElement>('.window-bar')].map((bar) => {
      const track = bar.querySelector('.window-track')
      const fill = bar.querySelector('.window-fill')
      const tick = bar.querySelector('.window-tick')
      const paint = (element: Element | null) =>
        element ? getComputedStyle(element).backgroundColor : null
      const [trackPaint, fillPaint, tickPaint] = [paint(track), paint(fill), paint(tick)]
      const [along, filled, ticked] = [box(track), box(fill), box(tick)]
      if (!along) throw new Error('a bar with no track')
      /** Where a length or a place stands along the track, in whole percents of it. */
      const share = (length: number) => Math.round((length / along.width) * 100)
      return {
        case: bar.dataset.case ?? '',
        name: track?.getAttribute('aria-label') ?? '',
        used: filled ? share(filled.width) : null,
        even: ticked ? share((ticked.left + ticked.right) / 2 - along.left) : null,
        // The tick crosses the bar, standing over and under it.
        crosses: ticked ? ticked.top < along.top && ticked.bottom > along.bottom : null,
        mask: fill ? getComputedStyle(fill).maskImage : null,
        fillOnGround: fillPaint ? contrast(fillPaint, ground) : null,
        fillOnTrack: fillPaint && trackPaint ? contrast(fillPaint, trackPaint) : null,
        tickOnFill: tickPaint && fillPaint ? contrast(tickPaint, fillPaint) : null,
        tickOnTrack: tickPaint && trackPaint ? contrast(tickPaint, trackPaint) : null,
        // A word cut short: its text wider than the box it is given.
        cut: [...bar.querySelectorAll<HTMLElement>('.window-value, .window-note')].some(
          (words) => words.scrollWidth > words.clientWidth + 0.5,
        ),
      }
    })
  })
}

for (const colorScheme of ['light', 'dark'] as const)
  test(`in the ${colorScheme} theme a window bar fills to its share, ticks its pace and stands apart from its ground`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await page.setViewportSize({ width: 1024, height: 1400 })
    await page.goto(HARNESS)
    const section = page.locator('[data-harness="window"]')
    await expect(
      section.getByRole('img', { name: 'Five hours: 62% used, steady use 40%, fresh' }),
    ).toBeVisible()
    const bars = await windowBars(page)
    await testInfo.attach(`window-bars-${colorScheme}`, {
      body: JSON.stringify(bars, null, 2),
      contentType: 'application/json',
    })
    // A fill as long as the share, none at 0 or with no figure, and the tick where steady use
    // stands, crossing the bar; no word cut.
    expect(
      bars.map(({ case: name, used, even, crosses, cut }) => ({ name, used, even, crosses, cut })),
    ).toEqual([
      { name: 'spent', used: 62, even: 40, crosses: true, cut: false },
      { name: 'over', used: 100, even: 100, crosses: true, cut: false },
      { name: 'zero', used: null, even: 20, crosses: true, cut: false },
      { name: 'held', used: 88, even: 86, crosses: true, cut: false },
      { name: 'none', used: null, even: null, crosses: null, cut: false },
      { name: 'compact', used: 74, even: 70, crosses: true, cut: false },
    ])
    // Not fresh is hatched, fresh is not.
    const masks = Object.fromEntries(bars.map((bar) => [bar.case, bar.mask]))
    expect(masks.held).toContain('repeating-linear-gradient')
    expect(masks.spent).toBe('none')
    // Apart by lightness: the fill from its ground and its track, the tick from both.
    for (const bar of bars.filter((one) => one.used !== null)) {
      expect(bar.fillOnGround, `${bar.case}: fill on ground`).toBeGreaterThanOrEqual(
        GRAPHIC_CONTRAST,
      )
      expect(bar.fillOnTrack, `${bar.case}: fill on track`).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST)
    }
    for (const bar of bars.filter((one) => one.used !== null && one.even !== null))
      expect(bar.tickOnFill, `${bar.case}: tick on fill`).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST)
    for (const bar of bars.filter((one) => one.even !== null))
      expect(bar.tickOnTrack, `${bar.case}: tick on track`).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST)
    // The table holds a row a window with each figure in words.
    const table = page.locator('[data-harness="window-table"] table')
    await expect(table.locator('tbody tr')).toHaveCount(5)
    await expect(table.locator('tbody tr').first()).toContainText('62%')
  })

/** The step line as drawn: its path, its marks against the field, and the boxes of its parts. */
function stepLine(page: Page) {
  return page.evaluate(() => {
    const figure = document.querySelector('[data-harness="step"] .step-line')
    const field = figure?.querySelector('.step-field')
    if (!figure || !field) throw new Error('the step line is not drawn')
    const area = field.getBoundingClientRect()
    const plot = figure.querySelector('.step-plot')?.getBoundingClientRect() ?? area
    const { height } = figure.getBoundingClientRect()
    return {
      name: figure.getAttribute('aria-label') ?? '',
      path: figure.querySelector('.step-path')?.getAttribute('d') ?? '',
      stroke: getComputedStyle(figure.querySelector('.step-path') ?? figure).stroke,
      marks: [...figure.querySelectorAll<HTMLElement>('.step-mark')].map((mark) => {
        const { left, right, top, bottom } = mark.getBoundingClientRect()
        return {
          key: mark.dataset.key ?? '',
          x: ((left + right) / 2 - area.left) / area.width,
          y: (area.bottom - (top + bottom) / 2) / area.height,
        }
      }),
      readouts: figure.querySelectorAll('.step-readout').length,
      boxes: ['.step-head', '.step-plot', '.step-axis'].map(
        (part) => figure.querySelector(part)?.getBoundingClientRect().toJSON() as unknown,
      ),
      height,
      // A fifth of the way across the plot, halfway up: where the first reading still holds.
      early: { x: plot.left + plot.width * 0.2, y: plot.top + plot.height / 2 },
    }
  })
}

for (const colorScheme of ['light', 'dark'] as const)
  test(`in the ${colorScheme} theme a step line draws its readings as steps and points at one without moving`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await page.setViewportSize({ width: 1024, height: 1400 })
    await page.goto(HARNESS)
    const figure = page.locator('[data-harness="step"] .step-line')
    await figure.scrollIntoViewIfNeeded()
    const before = await stepLine(page)
    await testInfo.attach(`step-line-${colorScheme}`, {
      body: JSON.stringify(before, null, 2),
      contentType: 'application/json',
    })
    expect(before.name).toContain('58% at 14:00')
    // Steps only: after the first point every stroke is flat (H) or upright (V).
    expect(before.path).toMatch(/^M[\d.]+,[\d.]+(?: [HV][\d.]+)+$/u)
    // A mark at each reading: half an hour in at 10%, … three hours in at 58%, of five hours.
    const placed = [
      [0.1, 0.1],
      [0.25, 0.22],
      [0.4, 0.225],
      [0.6, 0.58],
    ]
    expect(before.marks).toHaveLength(placed.length)
    for (const [index, [x = 0, y = 0]] of placed.entries()) {
      expect(Math.abs((before.marks[index]?.x ?? 0) - x), `mark ${index} across`).toBeLessThan(0.01)
      expect(Math.abs((before.marks[index]?.y ?? 0) - y), `mark ${index} up`).toBeLessThan(0.03)
    }
    expect(before.readouts, 'a line over the plot').toBe(0)
    // Under the pointer a fifth of the way across, the first reading holds and says so in its
    // hint; nothing moves.
    await page.mouse.move(before.early.x, before.early.y)
    await expect(page.getByRole('tooltip')).toHaveText('11:30, 10%, the poll')
    const pointed = await stepLine(page)
    expect(pointed.boxes).toEqual(before.boxes)
    expect(pointed.height).toBe(before.height)
    await expect(page.locator('[data-harness="step-table"] tbody tr')).toHaveCount(4)
  })

test('in a forced palette a window bar and a step line keep their marks in the palette’s inks', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto(HARNESS)
  const paints = await page.evaluate(() => {
    const probe = document.createElement('i')
    document.body.append(probe)
    const system = (name: string) => {
      probe.style.color = name
      return getComputedStyle(probe).color
    }
    const found = (selector: string) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`${selector} is not drawn`)
      return getComputedStyle(element)
    }
    const result = {
      canvasText: system('CanvasText'),
      canvas: system('Canvas'),
      fill: found('[data-case="spent"] .window-fill').backgroundColor,
      tick: found('[data-case="spent"] .window-tick').backgroundColor,
      tickRing: found('[data-case="spent"] .window-tick').outlineColor,
      trackEdge: found('[data-case="spent"] .window-track').outlineColor,
      path: found('[data-harness="step"] .step-path').stroke,
      mark: found('[data-harness="step"] .step-mark').backgroundColor,
    }
    probe.remove()
    return result
  })
  expect(paints.fill).toBe(paints.canvasText)
  expect(paints.tick).toBe(paints.canvasText)
  expect(paints.tickRing).toBe(paints.canvas)
  expect(paints.trackEdge).toBe(paints.canvasText)
  expect(paints.path).toBe(paints.canvasText)
  expect(paints.mark).toBe(paints.canvasText)
})
