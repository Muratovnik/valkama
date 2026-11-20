/**
 * Every place of a step line is reached by the pointer at its own mark, in the browser: each
 * reading, the first and the last, «now» and the forecast at the reset, whose rings stand centred
 * on the plot's right edge. The pointer at a mark's centre opens that place's own hint and paints
 * that mark alone, and what it stands on there is the line's one layer over its field, never the
 * drawing or the page around the plot. Two readings five minutes apart, closer than a pointer is
 * wide, are each found by the pointer nearer to its mark. The rings on the edge once stood half
 * outside every target, and a reading's reach at least 24 px wide covered its neighbour's mark.
 * Each part is read by the hook `StepLine` documents for it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { test } from './test.ts'

const HARNESS = '/tests/browser/harness.html?lang=en&surface=charts'

interface Place {
  /** The words the place says, its name for assistive technology and its hint. */
  words: string
  x: number
  y: number
}

/** Each stop of the line, by its order: the centre of its mark and the words it says. */
const placesOf = (line: Locator) =>
  line.evaluate((figure) =>
    [...figure.querySelectorAll<HTMLElement>('[data-stop]')].map((stop) => {
      const mark = stop.querySelector('[data-mark="reading"], [data-mark="place"]')
      const box = mark?.getBoundingClientRect() ?? new DOMRect()
      return {
        words: stop.getAttribute('aria-label') ?? '',
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      }
    }),
  )

/** Words as a reader reads them, every run of space one space. */
const plain = (words: string) => words.replaceAll(/\s+/gu, ' ').trim()

/**
 * Points at `x, y` from a place with no hint, and reads what is there: what the pointer stands on,
 * the words of the hint that shows, and which stops paint their mark.
 */
async function pointAt(page: Page, line: Locator, { x, y }: { x: number; y: number }) {
  await page.mouse.move(1, 1)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.move(x, y, { steps: 2 })
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toHaveCount(1)
  const hint = plain((await tooltip.textContent()) ?? '')
  const seen = await line.evaluate(
    (figure, at) => ({
      under: document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>('[data-region]')?.dataset
        .region,
      inLine: figure.contains(document.elementFromPoint(at.x, at.y)),
      painted: [...figure.querySelectorAll<HTMLElement>('[data-stop]')].flatMap((stop, index) =>
        stop
          .querySelector('[data-mark="reading"], [data-mark="place"]')
          ?.checkVisibility({ opacityProperty: true })
          ? [index]
          : [],
      ),
    }),
    { x, y },
  )
  return { hint, ...seen }
}

/** The harness's two step lines, each over its whole window: five hours with a forecast, and the close one. */
const LINES = [
  { name: 'with a forecast', line: '[data-harness="step"]', past: ['now', 'reset'] },
  { name: 'read at its reset', line: '[data-harness="step-close"]', past: ['now'] },
] as const

/** Every line has four readings (`windowCases`). */
const READINGS = 4

/** Opens the harness at `width` and the line in `section`. */
async function openLine(page: Page, width: number, section: string) {
  await page.setViewportSize({ width, height: 1400 })
  await page.goto(HARNESS)
  const line = page.locator(`${section} [data-chart="steps"]`)
  await line.scrollIntoViewIfNeeded()
  return line
}

/** The two readings of the close line that stand minutes apart, the second and the third. */
async function closeReadings(line: Locator) {
  const [, earlier, later] = await placesOf(line)
  if (!earlier || !later) throw new Error('the close readings are not drawn')
  return { earlier, later }
}

for (const width of [1024, 1440])
  for (const { name, line: section, past } of LINES)
    test(`at ${width}px, ${name}, the pointer at each mark of a step line opens that place's hint`, async ({
      page,
    }, info) => {
      const line = await openLine(page, width, section)
      const places: Place[] = await placesOf(line)
      const kinds = await line
        .locator('[data-stop]')
        .evaluateAll((stops) =>
          stops.map((stop) => stop.dataset.target ?? `reading ${stop.dataset.reading}`),
        )
      // The readings, then «now», then the forecast where the line has one.
      await expect(line.locator('[data-reading]')).toHaveCount(READINGS)
      expect(kinds.slice(READINGS)).toEqual(past)
      expect(places).toHaveLength(READINGS + past.length)
      const field = await line
        .locator('[data-region="field"]')
        .evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect)
      const seen: unknown[] = []
      for (const [index, place] of places.entries()) {
        const found = await pointAt(page, line, place)
        seen.push({ kind: kinds[index], place, found })
        expect(found.hint, `${kinds[index]}: its own hint`).toBe(plain(place.words))
        expect(found.painted, `${kinds[index]}: its mark alone painted`).toEqual([index])
        expect(found.inLine && found.under, `${kinds[index]}: the layer under the pointer`).toBe(
          'hover',
        )
      }
      await info.attach(`step-reach-${width}-${name}`, {
        body: JSON.stringify({ field, seen }, null, 2),
        contentType: 'application/json',
      })
      // The last place's ring stands on the field's right edge, its right half past it.
      expect(Math.abs((places.at(-1)?.x ?? 0) - field.right), 'a ring on the edge').toBeLessThan(1)
    })

/** How far from a mark the pointer stands, inside the half mark it is found within. */
const BESIDE = 3

for (const width of [1024, 1440])
  test(`at ${width}px, of two readings closer than a pointer is wide, the pointer finds the one nearer to it`, async ({
    page,
  }, info) => {
    const line = await openLine(page, width, '[data-harness="step-close"]')
    const { earlier, later } = await closeReadings(line)
    const apart = later.x - earlier.x
    // Closer than the 24 px a reading's reach once took at least, and far enough apart that a
    // point beside each, toward the other, is nearer to it.
    expect(apart, 'the two readings apart').toBeLessThan(24)
    expect(apart, 'the two readings apart').toBeGreaterThan(2 * BESIDE)
    // Beside the later mark, on the earlier reading's step, which that reach once covered.
    const nearEarlier = await pointAt(page, line, { x: earlier.x + BESIDE, y: earlier.y })
    const nearLater = await pointAt(page, line, { x: later.x - BESIDE, y: earlier.y })
    await info.attach(`close-readings-${width}`, {
      body: JSON.stringify({ earlier, later, apart, nearEarlier, nearLater }, null, 2),
      contentType: 'application/json',
    })
    expect(nearEarlier.hint).toBe(plain(earlier.words))
    expect(nearEarlier.painted).toEqual([1])
    expect(nearLater.hint).toBe(plain(later.words))
    expect(nearLater.painted).toEqual([2])
  })
