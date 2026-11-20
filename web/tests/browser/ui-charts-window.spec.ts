/**
 * The two chart forms of a window of a limit, in the browser on the panel's ground: the window
 * bar in each state it draws and a window's readings as a step line, with their tables. In the
 * light and the dark theme a bar's fill is as long as the share spent and stops at the track's
 * end, its tick stands where steady use would be and crosses the bar, and the fill, the track and
 * the tick stand apart from each other and the fill from the ground by a contrast a reader can see
 * — a contrast of lightness, so the bar reads in grayscale too; the share spent is solid, silent
 * or fresh, and the forecast alone is hatched, one tail inside the track from a surface gap past
 * the fill to the forecast's high end, with no gap inside it; no word is cut. The step line draws only flat and
 * upright strokes, a mark at each reading where its moment and value put it, painted only for the
 * reading under the pointer or the keyboard's focus, and that reading says itself in a hint over
 * the plot without moving anything. Past its readings «now» and the
 * forecast at the reset each say themselves in a hint at their mark, off the line's head, the
 * corridor between them inside the plot, and nothing moves. A forced palette draws them in its
 * inks, the focused reading and the tail too.
 * Each theme attaches what it measured. Every part is read by the hook its component documents
 * (`WindowBar`, `StepLine`, their tables) or the harness gives it (`data-case`).
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { test } from './test.ts'

/** WCAG's least contrast for a part of a graphic a reader must tell from what is around it. */
const GRAPHIC_CONTRAST = 3

const HARNESS = '/tests/browser/harness.html?lang=en&surface=charts'
const LINE = '[data-harness="step"] [data-chart="steps"]'

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
    return [...section.querySelectorAll<HTMLElement>('[data-case]')].map((bar) => {
      const track = bar.querySelector('[data-mark="track"]')
      const fill = bar.querySelector('[data-mark="fill"]')
      const tick = bar.querySelector('[data-mark="tick"]')
      const tail = [...bar.querySelectorAll('[data-mark="ahead"]')]
      const words = [...bar.querySelectorAll<HTMLElement>('[data-words]')]
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
        // Each part of the tail: where its run starts and where it ends along the track, in
        // whole percents, the run starting where the fill or the part before ends; the ground
        // between them in pixels; and whether it is hatched.
        tail: tail.map((part, index) => {
          const drawn = part.getBoundingClientRect()
          const before = index === 0 ? filled : tail[index - 1]?.getBoundingClientRect()
          const gap = before ? drawn.left - before.right : 0
          return {
            from: share(drawn.left - gap - along.left),
            to: share(drawn.right - along.left),
            gap: before ? Math.round(gap * 10) / 10 : null,
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
        // The words beside the bar, and whether one is cut short: its text wider than its box.
        words: words.length,
        cut: words.some((one) => one.scrollWidth > one.clientWidth + 0.5),
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
    // stands, crossing the bar; its words as the harness gives them, its share and its state, the
    // share alone with no figure and none in a tile; no word cut.
    expect(
      bars.map(({ case: name, used, even, crosses, words, cut }) => ({
        name,
        used,
        even,
        crosses,
        words,
        cut,
      })),
    ).toEqual([
      { name: 'spent', used: 62, even: 40, crosses: true, words: 2, cut: false },
      { name: 'over', used: 100, even: 100, crosses: true, words: 2, cut: false },
      { name: 'zero', used: null, even: 20, crosses: true, words: 2, cut: false },
      { name: 'stale', used: 88, even: 86, crosses: true, words: 2, cut: false },
      { name: 'runs', used: 74, even: 70, crosses: true, words: 2, cut: false },
      { name: 'none', used: null, even: null, crosses: null, words: 1, cut: false },
      { name: 'compact', used: 74, even: 70, crosses: true, words: 0, cut: false },
    ])
    // The share spent is solid, silent or fresh: only the forecast is hatched.
    for (const bar of bars.filter((one) => one.used !== null))
      expect(bar.mask, `${bar.case}: the fill`).toBe('none')
    // The tail, hatched inside the track: one, from 2px past the fill to the faster pace's end,
    // nothing drawn where the slower ends; from the track's start at 0 %; to its end where the
    // window runs out; none past 100 % or with no figure. Each end at its share, to the whole
    // percent.
    const tails = Object.fromEntries(
      bars.map((bar) => [bar.case, bar.tail.map(({ from, to, gap }) => [from, to, gap])]),
    )
    expect(tails).toEqual({
      spent: [[62, 84, 2]],
      over: [],
      zero: [[0, 12, null]],
      stale: [[88, 100, 2]],
      runs: [[74, 100, 2]],
      none: [],
      compact: [[74, 95, 2]],
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
    const rows = page.locator('[data-harness="window-table"] [data-key]')
    await expect(rows).toHaveCount(6)
    await expect(rows.first()).toContainText('62%')
    await expect(rows.first().locator('[data-cell="forecast"]')).toHaveText(
      'By the reset: 70% to 84%',
    )
  })

/** The step line as drawn: its path, its marks against its drawing, and the boxes of its parts. */
function stepLine(page: Page) {
  return page.evaluate((line) => {
    const figure = document.querySelector(line)
    const field = figure?.querySelector('[data-region="field"]')
    if (!figure || !field) throw new Error('the step line is not drawn')
    // The drawing the readings are placed on: the field less the inset that keeps a mark at 0 %
    // and one at the top whole inside it.
    const area = (figure.querySelector('[data-region="drawing"]') ?? field).getBoundingClientRect()
    const plot = figure.querySelector('[data-region="plot"]')?.getBoundingClientRect() ?? area
    const { height } = figure.getBoundingClientRect()
    return {
      name: figure.getAttribute('aria-label') ?? '',
      path: figure.querySelector('[data-mark="line"]')?.getAttribute('d') ?? '',
      stroke: getComputedStyle(figure.querySelector('[data-mark="line"]') ?? figure).stroke,
      marks: [...figure.querySelectorAll<HTMLElement>('[data-mark="reading"]')].map((mark) => {
        const { left, right, top, bottom } = mark.getBoundingClientRect()
        return {
          key: mark.dataset.key ?? '',
          x: ((left + right) / 2 - area.left) / area.width,
          y: (area.bottom - (top + bottom) / 2) / area.height,
        }
      }),
      boxes: ['head', 'plot', 'axis'].map(
        (part) =>
          figure
            .querySelector(`[data-region="${part}"]`)
            ?.getBoundingClientRect()
            .toJSON() as unknown,
      ),
      height,
      // A fifth of the way across the plot, halfway up: where the first reading still holds.
      early: { x: plot.left + plot.width * 0.2, y: plot.top + plot.height / 2 },
    }
  }, LINE)
}

for (const colorScheme of ['light', 'dark'] as const)
  test(`in the ${colorScheme} theme a step line draws its readings as steps and points at one without moving`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await page.setViewportSize({ width: 1024, height: 1400 })
    await page.goto(HARNESS)
    const figure = page.locator(LINE)
    await figure.scrollIntoViewIfNeeded()
    // Every line shows its whole window, which its axis names by its start and its reset; the
    // readings are placed against the whole five hours.
    await expect(figure.locator('[data-region="axis"] [data-moment]')).toHaveText([
      'start 11:00',
      'resets 16:00',
    ])
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
    // Under the pointer a fifth of the way across, the first reading holds and says so in its
    // hint; nothing moves.
    await page.mouse.move(before.early.x, before.early.y)
    await expect(page.getByRole('tooltip')).toHaveText('11:30, 10%, the poll')
    const pointed = await stepLine(page)
    expect(pointed.boxes).toEqual(before.boxes)
    expect(pointed.height).toBe(before.height)
    // The four readings and the forecast after them.
    await expect(page.locator('[data-harness="step-table"] [data-key]')).toHaveCount(5)
  })

/**
 * Which readings of the harness's step line paint their dot, by their place: a dot the browser
 * draws, neither hidden nor transparent. A reading at rest keeps its mark, unpainted, since its
 * hint stands at the mark and the mark takes the pointer for its reading.
 */
const paintedDots = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>('[data-harness="step"] [data-mark="reading"]'),
    ].flatMap((mark, index) =>
      mark.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ? [index] : [],
    ),
  )

/**
 * Moves the pointer to the middle of the step `reach` holds: the field's one layer takes the
 * pointer there for the reading, since the step's own box takes none.
 */
async function pointOnStep(page: Page, reach: Locator) {
  const box = await reach.boundingBox()
  if (!box) throw new Error('the reading is not drawn')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

// A dot on every reading made a busy window a chain of dots over its own line.
test('a step line paints no reading’s dot at rest, only the one pointed at or focused by a key', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 1400 })
  await page.goto(HARNESS)
  const figure = page.locator(LINE)
  await figure.scrollIntoViewIfNeeded()
  await page.mouse.move(1, 1)
  const reach = figure.locator('[data-reading]')
  await expect(figure.locator('[data-mark="reading"]')).toHaveCount(4)
  expect(await paintedDots(page), 'at rest').toEqual([])
  // The pointer on a reading's step paints that reading's dot alone; away from it, none.
  await pointOnStep(page, reach.nth(1))
  await expect(page.getByRole('tooltip')).toHaveText('12:15, 22%, the poll')
  expect(await paintedDots(page), 'the second pointed at').toEqual([1])
  await page.mouse.move(1, 1)
  expect(await paintedDots(page), 'the pointer gone').toEqual([])
  // The line's one Tab stop is the latest reading, which focused paints its dot; the pointer
  // passing over another reading and away leaves it painted while it holds the focus.
  const stop = figure.locator('[tabindex="0"]')
  await expect(stop).toHaveCount(1)
  await expect(stop).toHaveAttribute('data-reading', '3')
  await stop.focus()
  await expect(reach.nth(3)).toBeFocused()
  expect(await paintedDots(page), 'the latest focused').toEqual([3])
  await pointOnStep(page, reach.nth(0))
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
  const figure = page.locator(LINE)
  const mark = figure.locator('[data-mark="reading"]').first()
  const box = await mark.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect)
  await page.evaluate((by) => window.scrollBy(0, by), box.top - top)
  await page.mouse.move(1, 1)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  const at = await mark.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect)
  await page.mouse.move(at.left + at.width / 2, at.top + at.height / 2)
  await expect(page.getByRole('tooltip')).toHaveText('11:30, 10%, the poll')
  return page.evaluate(() => {
    const hint = document.querySelector('[data-hint-surface]')?.getBoundingClientRect()
    const drawn = document
      .querySelector('[data-harness="step"] [data-mark="reading"]')
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
  const figure = page.locator(LINE)
  await figure.scrollIntoViewIfNeeded()
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
      fill: found('[data-case="spent"] [data-mark="fill"]').backgroundColor,
      tick: found('[data-case="spent"] [data-mark="tick"]').backgroundColor,
      tickRing: found('[data-case="spent"] [data-mark="tick"]').outlineColor,
      trackEdge: found('[data-case="spent"] [data-mark="track"]').outlineColor,
      path: found('[data-harness="step"] [data-mark="line"]').stroke,
      mark: found('[data-harness="step"] [data-mark="reading"]').backgroundColor,
      tail: found('[data-case="spent"] [data-mark="ahead"]').backgroundColor,
      ring: found('[data-harness="step"] [data-target="now"] [data-mark="place"]').boxShadow,
      corridor: found('[data-harness="step"] [data-mark="corridor"]').backgroundColor,
      grayText: system('GrayText'),
      now: found('[data-harness="step"] [data-mark="now"]').stroke,
      nowKey: found('[data-harness="step"] [data-key="now"] > :first-child').backgroundColor,
      even: found('[data-harness="step"] [data-mark="even"]').stroke,
      evenKey: found('[data-harness="step"] [data-key="even"] > :first-child').backgroundColor,
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
  // The pace and now are drawn in the palette's inactive ink, and their keys say that ink: kept
  // in their own colours, the keys showed a grey the palette does not have.
  expect([paints.now, paints.even]).toEqual([paints.grayText, paints.grayText])
  expect([paints.nowKey, paints.evenKey]).toEqual([paints.grayText, paints.grayText])
  // The reading a key stands on still shows: its dot painted in the palette's ink, and its step
  // ringed in the palette's own colour for the focus.
  const figure = page.locator(LINE)
  const focused = figure.locator('[data-reading="3"]')
  await expect(focused).toHaveAttribute('tabindex', '0')
  await focused.focus()
  await expect(focused).toBeFocused()
  expect(await paintedDots(page), 'the focused reading').toEqual([3])
  const shown = await focused.evaluate((reach) => {
    const ring = getComputedStyle(reach)
    const mark = reach.querySelector('[data-mark="reading"]')
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
