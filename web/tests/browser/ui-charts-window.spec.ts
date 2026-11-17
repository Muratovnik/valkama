/**
 * The two chart forms of a window of a limit, in the browser on the panel's ground: the window
 * bar in each state it draws and a window's readings as a step line, with their tables. In the
 * light and the dark theme a bar's fill is as long as the share spent and stops at the track's
 * end, its tick stands where steady use would be and crosses the bar, and the fill, the track and
 * the tick stand apart from each other and the fill from the ground by a contrast a reader can see
 * — a contrast of lightness, so the bar reads in grayscale too; the share spent is solid, silent
 * or fresh, and the forecast alone is hatched, a tail inside the track from a surface gap past
 * the fill, parted where its slower pace ends; no word is cut. The step line draws only flat and
 * upright strokes, a mark at each reading where its moment and value put it, painted only for the
 * reading under the pointer or the keyboard's focus, and that reading says itself in a hint over
 * the plot without moving anything, with no line over the plot. Past its readings «now» and the
 * forecast at the reset each say themselves in a hint at their mark, off the line's head, the
 * corridor between them inside the plot, and nothing moves. A forced palette draws them in its
 * inks, the focused reading and the tail too.
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
      const tail = [...bar.querySelectorAll('.window-ahead')]
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
        // Each part of the tail: where it starts and ends along the track, in whole percents and
        // in pixels from the fill's end or the part before, and whether it is hatched.
        tail: tail.map((part, index) => {
          const drawn = part.getBoundingClientRect()
          const before = index === 0 ? filled : tail[index - 1]?.getBoundingClientRect()
          return {
            from: share(drawn.left - along.left),
            to: share(drawn.right - along.left),
            gap: before ? Math.round((drawn.left - before.right) * 10) / 10 : null,
            inside:
              drawn.left >= along.left - 0.5 &&
              drawn.right <= along.right + 0.5 &&
              drawn.top >= along.top - 0.5 &&
              drawn.bottom <= along.bottom + 0.5,
            hatched: getComputedStyle(part).maskImage.includes('repeating-linear-gradient'),
          }
        }),
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
      section.getByRole('img', {
        name: 'Week: 62% used, steady use 40%, fresh. Forecast · By the reset: 70% to 84%',
      }),
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
      { name: 'stale', used: 88, even: 86, crosses: true, cut: false },
      { name: 'runs', used: 74, even: 70, crosses: true, cut: false },
      { name: 'none', used: null, even: null, crosses: null, cut: false },
      { name: 'compact', used: 74, even: 70, crosses: true, cut: false },
    ])
    // The share spent is solid, silent or fresh: only the forecast is hatched.
    for (const bar of bars.filter((one) => one.used !== null))
      expect(bar.mask, `${bar.case}: the fill`).toBe('none')
    // The tail, hatched inside the track: from 2px past the fill to the slower pace's end, and
    // 2px on to the faster's; from the track's start at 0 %; to its end where the window runs
    // out; none past 100 % or with no figure. Each end within a percent of its share.
    const tails = Object.fromEntries(
      bars.map((bar) => [bar.case, bar.tail.map(({ from, to, gap }) => [from, to, gap])]),
    )
    expect(tails).toEqual({
      spent: [
        [62, 70, 2],
        [70, 84, 2],
      ],
      over: [],
      zero: [[0, 12, null]],
      stale: [
        [88, 98, 2],
        [98, 100, 2],
      ],
      runs: [[74, 100, 2]],
      none: [],
      compact: [
        [74, 86, 2],
        [86, 95, 2],
      ],
    })
    for (const bar of bars)
      for (const part of bar.tail) {
        expect(part.inside, `${bar.case}: a part inside its track`).toBe(true)
        expect(part.hatched, `${bar.case}: a part hatched`).toBe(true)
      }
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
    // The table holds a row a window with each figure in words, its forecast too.
    const table = page.locator('[data-harness="window-table"] table')
    await expect(table.locator('tbody tr')).toHaveCount(6)
    await expect(table.locator('tbody tr').first()).toContainText('62%')
    await expect(table.locator('tbody tr').first().locator('[data-cell="forecast"]')).toHaveText(
      'By the reset: 70% to 84%',
    )
  })

/** The step line as drawn: its path, its marks against its drawing, and the boxes of its parts. */
function stepLine(page: Page) {
  return page.evaluate(() => {
    const figure = document.querySelector('[data-harness="step"] .step-line')
    const field = figure?.querySelector('.step-field')
    if (!figure || !field) throw new Error('the step line is not drawn')
    // The drawing the readings are placed on: the field less the inset that keeps a mark at 0 %
    // and one at the top whole inside it.
    const area = (figure.querySelector('.step-svg') ?? field).getBoundingClientRect()
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
    // The window is running, so it opens on its start to now and the forecast; the readings are
    // placed here against the whole five hours.
    await figure.getByRole('radio', { name: 'Whole window' }).click()
    await expect(figure.locator('.step-axis span')).toHaveText(['11:00', '16:00'])
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
    // The four readings and the forecast after them.
    await expect(page.locator('[data-harness="step-table"] tbody tr')).toHaveCount(5)
  })

/**
 * Which readings of the harness's step line paint their dot, by their place: a dot the browser
 * draws, neither hidden nor transparent. A reading at rest keeps its mark, unpainted, since its
 * hint stands at the mark and the mark takes the pointer for its reading.
 */
const paintedDots = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-harness="step"] .step-mark')].flatMap(
      (mark, index) =>
        mark.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? [index] : [],
    ),
  )

// A dot on every reading made a busy window a chain of dots over its own line.
test('a step line paints no reading’s dot at rest, only the one pointed at or focused by a key', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 1400 })
  await page.goto(HARNESS)
  const figure = page.locator('[data-harness="step"] .step-line')
  await figure.scrollIntoViewIfNeeded()
  const whole = figure.getByRole('radio', { name: 'Whole window' })
  await whole.click()
  await page.mouse.move(1, 1)
  const reach = figure.locator('.step-reach')
  await expect(figure.locator('.step-mark')).toHaveCount(4)
  expect(await paintedDots(page), 'at rest').toEqual([])
  // The pointer on a reading's step paints that reading's dot alone; away from it, none.
  await reach.nth(1).hover()
  await expect(page.getByRole('tooltip')).toHaveText('12:15, 22%, the poll')
  expect(await paintedDots(page), 'the second pointed at').toEqual([1])
  await page.mouse.move(1, 1)
  expect(await paintedDots(page), 'the pointer gone').toEqual([])
  // Tab from the switch lands on the latest reading and paints its dot; the pointer passing over
  // another reading and away leaves it painted while it holds the focus.
  await whole.focus()
  await page.keyboard.press('Tab')
  await expect(reach.nth(3)).toBeFocused()
  expect(await paintedDots(page), 'the latest focused').toEqual([3])
  await reach.nth(0).hover()
  expect(await paintedDots(page), 'the latest focused, the first pointed at').toEqual([0, 3])
  await page.mouse.move(1, 1)
  expect(await paintedDots(page), 'the latest still focused').toEqual([3])
  await page.keyboard.press('ArrowLeft')
  await expect(reach.nth(2)).toBeFocused()
  expect(await paintedDots(page), 'walked to the third').toEqual([2])
  await page.keyboard.press('Shift+Tab')
  expect(await paintedDots(page), 'the focus gone').toEqual([])
})

/**
 * Where the first reading's hint stands against its mark, pointed at in its middle with the
 * page scrolled until the mark's top stands `top` pixels under the window's: the room from the
 * mark's right edge to the hint's left, and from the mark's top to the hint's bottom, or from
 * its bottom to the hint's top where the hint stands under it.
 */
async function firstReadingHint(page: Page, top: number) {
  const figure = page.locator('[data-harness="step"] .step-line')
  const mark = figure.locator('.step-mark').first()
  const box = await mark.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect)
  await page.evaluate((by) => window.scrollBy(0, by), box.top - top)
  await page.mouse.move(1, 1)
  await expect(page.locator('.tooltip-hint')).toHaveCount(0)
  const at = await mark.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect)
  await page.mouse.move(at.left + at.width / 2, at.top + at.height / 2)
  await expect(page.getByRole('tooltip')).toHaveText('11:30, 10%, the poll')
  return page.evaluate(() => {
    const hint = document.querySelector('.tooltip-hint')?.getBoundingClientRect()
    const drawn = document
      .querySelector('[data-harness="step"] .step-mark')
      ?.getBoundingClientRect()
    if (!hint || !drawn) throw new Error('no hint or no mark')
    return {
      across: hint.left - drawn.right,
      over: drawn.top - hint.bottom,
      under: hint.top - drawn.bottom,
    }
  })
}

test('a reading’s hint stands at the top right of its mark, and at its bottom right with no room over it', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 600 })
  await page.goto(HARNESS)
  const figure = page.locator('[data-harness="step"] .step-line')
  await figure.scrollIntoViewIfNeeded()
  await figure.getByRole('radio', { name: 'Whole window' }).click()
  const roomy = await firstReadingHint(page, 300)
  const cramped = await firstReadingHint(page, 12)
  await testInfo.attach('reading-hint-corners', {
    body: JSON.stringify({ roomy, cramped }, null, 2),
    contentType: 'application/json',
  })
  // 6px past the mark's right edge and over its top (`OFFSET`); under it 6px where the window
  // has no room over it.
  expect(Math.abs(roomy.across - 6), 'across, with room over it').toBeLessThan(1)
  expect(Math.abs(roomy.over - 6), 'over it').toBeLessThan(1)
  expect(Math.abs(cramped.across - 6), 'across, with no room over it').toBeLessThan(1)
  expect(Math.abs(cramped.under - 6), 'under it').toBeLessThan(1)
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
      tail: found('[data-case="spent"] .window-ahead').backgroundColor,
      ring: found('[data-harness="step"] .step-now-mark').boxShadow,
      corridor: found('[data-harness="step"] .step-ahead').backgroundColor,
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
  expect(paints.tail).toBe(paints.canvasText)
  expect(paints.corridor).toBe(paints.canvasText)
  expect(paints.ring).toContain(paints.canvasText)
  // The reading a key stands on still shows: its dot painted in the palette's ink, and its step
  // ringed in the palette's own colour for the focus.
  const figure = page.locator('[data-harness="step"] .step-line')
  await figure.getByRole('radio', { name: 'Whole window' }).focus()
  await page.keyboard.press('Tab')
  const focused = figure.locator('.step-reach').nth(3)
  await expect(focused).toBeFocused()
  expect(await paintedDots(page), 'the focused reading').toEqual([3])
  const shown = await focused.evaluate((reach) => {
    const ring = getComputedStyle(reach)
    const mark = reach.querySelector('.step-mark')
    return {
      ring: ring.outlineStyle,
      ringWidth: Number.parseFloat(ring.outlineWidth),
      mark: mark ? getComputedStyle(mark).backgroundColor : '',
    }
  })
  expect(shown.mark).toBe(paints.canvasText)
  expect(shown.ring).toBe('solid')
  expect(shown.ringWidth).toBeGreaterThan(0)
})
