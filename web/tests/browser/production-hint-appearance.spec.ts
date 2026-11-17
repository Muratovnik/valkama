/**
 * How a hint comes onto the window in the built app: it fades in the first time it shows, after
 * the pointer's rest, and passing on to a neighbour shows the next one already there, with no
 * animation, as the reference's card does. That holds for a hint drawn beside its element and
 * for a cut text's whole words laid over it. Under a preference for reduced motion nothing
 * fades. Both surfaces once came in with no fade at all, the first time as every other.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openRail } from './cutRailPage.ts'
import { middleOf, openDays } from './dayHintPage.ts'
import { boxOf, pass } from './hintFramesPage.ts'
import { test } from './test.ts'

const SURFACES = '.tooltip-hint, .whole-text'

/**
 * Teaches the page to note every animation and transition that starts on a hint's surface, and
 * the opacity of the surface shown in every frame from now on.
 */
const noteMotion = (page: Page) =>
  page.evaluate((surfaces) => {
    const host = window as unknown as { motion: string[]; opacities: number[] }
    host.motion = []
    host.opacities = []
    for (const type of ['animationstart', 'transitionrun'])
      document.addEventListener(
        type,
        (event) => {
          const { target } = event
          if (target instanceof Element && target.matches(surfaces))
            host.motion.push(`${target.classList[0] ?? ''} ${type}`)
        },
        true,
      )
    const frame = () => {
      const shown = document.querySelector(surfaces)
      if (shown) host.opacities.push(Number(getComputedStyle(shown).opacity))
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, SURFACES)

/** The motion noted since the last call, and the opacity of each frame (`noteMotion`). */
const motion = (page: Page) =>
  page.evaluate(() => {
    const host = window as unknown as { motion: string[]; opacities: number[] }
    return { started: host.motion.splice(0), opacities: host.opacities.splice(0) }
  })

/** How many animations and transitions run on the surface now. */
const running = (surface: Locator) => surface.evaluate((node) => node.getAnimations().length)

interface Spot {
  words: string
  x: number
  y: number
}

const NOWHERE: Spot = { words: '', x: 0, y: 0 }

/** Two neighbours with a hint each, the first pointed at first. */
interface Neighbours {
  first: Spot
  next: Spot
}

/** The middle of each of the day chart's legend entries that carries a hint, with its words. */
async function legendOf(page: Page): Promise<Neighbours> {
  const days = await openDays(page, 1440)
  const keys = days.locator('.chart-legend .chart-key[data-tooltip]')
  expect(await keys.count(), 'legend entries with a hint').toBeGreaterThan(1)
  const [first = NOWHERE, next = NOWHERE] = await keys.evaluateAll((all) =>
    all.map((key) => {
      const { left, top, right, bottom } = key.getBoundingClientRect()
      return {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        words: ((key as HTMLElement).dataset.tooltip ?? '').split('\n')[0] ?? '',
      }
    }),
  )
  return { first, next }
}

/** The cut title of the rail's long row, and the cut text of the rail nearest to it. */
async function cutNeighbours(page: Page): Promise<Neighbours> {
  const { title } = await openRail(page, 1440)
  const near = await title.evaluate((own) => {
    const mine = own.getBoundingClientRect()
    const rail = own.closest('.app-nav-shell')
    const cut = [...(rail?.querySelectorAll<HTMLElement>('[data-tooltip-kind="clipped"]') ?? [])]
      .filter((each) => each !== own && each.scrollWidth > each.clientWidth + 1)
      .map((each) => ({ box: each.getBoundingClientRect(), words: each.dataset.tooltip ?? '' }))
      .filter(({ box }) => box.height > 1 && box.top >= 0 && box.bottom <= innerHeight)
      .sort((one, other) => Math.abs(one.box.top - mine.top) - Math.abs(other.box.top - mine.top))
    const [first] = cut
    return first
      ? {
          x: first.box.left + Math.min(12, first.box.width / 2),
          y: (first.box.top + first.box.bottom) / 2,
          words: first.words,
        }
      : null
  })
  expect(near, 'a second cut text in the rail').not.toBeNull()
  const own = await boxOf(title)
  const first = { x: own.left + 12, y: middleOf(own).y, words: (await title.textContent()) ?? '' }
  return { first, next: near ?? NOWHERE }
}

const CASES = [
  { name: 'a hint beside a legend entry', surface: '.tooltip-hint', open: legendOf },
  { name: 'a cut title’s whole words', surface: '.whole-text', open: cutNeighbours },
] as const

for (const { name, surface, open } of CASES) {
  test(`${name} fades in the first time and passes to its neighbour with no animation`, async ({
    page,
  }) => {
    const { first, next } = await open(page)
    const shown = page.locator(surface)
    await page.mouse.move(0, 0)
    await noteMotion(page)

    // At rest on the first: it shows after the delay, fading in.
    await page.mouse.move(first.x, first.y)
    await expect(shown).toHaveCount(1)
    await expect.poll(() => running(shown), 'the fade ends').toBe(0)
    await expect(shown).toHaveCSS('opacity', '1')
    const appeared = await motion(page)

    // On to the neighbour while the hint is up: the next one is already there.
    await page.mouse.move(next.x, next.y, { steps: 8 })
    await expect(shown).toContainText(next.words.split(' ')[0] ?? '')
    expect(await running(shown), 'at the switch').toBe(0)
    await pass(page, 200)
    const passed = await motion(page)

    expect(appeared.started, 'the first show').toEqual([`${surface.slice(1)} animationstart`])
    expect(appeared.opacities[0], 'its first frame, fading in').toBeLessThan(0.8)
    expect(appeared.opacities.at(-1), 'its last frame').toBe(1)
    expect(passed.started, 'passing to the neighbour').toEqual([])
    expect(passed.opacities.length, 'frames noted').toBeGreaterThan(3)
    expect(
      passed.opacities.filter((opacity) => opacity < 1),
      'passing to the neighbour: every frame whole',
    ).toEqual([])
  })

  test(`${name} comes with no fade under a preference for reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { first } = await open(page)
    const shown = page.locator(surface)
    await page.mouse.move(0, 0)
    await noteMotion(page)

    await page.mouse.move(first.x, first.y)
    await expect(shown).toHaveCount(1)
    await pass(page, 200)
    const { started, opacities } = await motion(page)

    // The shell's rule for less motion makes every transition instant, so one may still be
    // reported as started; what is drawn never fades, and no animation starts.
    expect(
      started.filter((one) => one.endsWith('animationstart')),
      'the first show',
    ).toEqual([])
    expect(opacities.length, 'frames noted').toBeGreaterThan(3)
    expect(
      opacities.filter((opacity) => opacity < 1),
      'every frame whole',
    ).toEqual([])
  })
}
