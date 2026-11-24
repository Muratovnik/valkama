/**
 * The Analytics bar's discs and the failure's retry ring on phones of 320 to 430px, in Russian and
 * in English, for a past period and a live one, at rest and after a refresh that failed (DESIGN.md,
 * the Analytics bar).
 *
 * A disc is drawn at its size, 8px by 8px, wherever it stands: a live period's beside the age, and
 * a failure's beside its words however many lines they take. Beside the words wrapped onto two
 * lines the failure's disc was squeezed to an oval 4.4 to 7.7px wide.
 *
 * The retry's focus ring stands clear of the disc before it, by a pixel at least, and inside the
 * row it shares with the refresh: drawn round it, it touched the disc at every width, and round
 * the words on two lines it stood 1.6px past that row.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { failRefresh, frames, open, serveFailing } from './analyticsBarFailure.ts'
import { record } from './analyticsPage.ts'
import { test } from './test.ts'

const WIDTHS = [320, 340, 360, 370, 380, 384, 390, 399, 400, 410, 430] as const

/** A disc's side, `--space-2`, as the bar draws it (DESIGN.md). */
const DISC = 8

/** A past period and a live one, with how many discs the bar draws at rest: a live period's. */
const PERIODS = {
  week: { state: {}, live: 0 },
  today: { state: { period: 'today' }, live: 1 },
} as const

const RETRY = { ru: /Повторить/u, en: /Retry/u } as const

test.use({ locale: 'ru-RU', launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

type Box = {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

/**
 * The live period's disc and the failure's, the row the refresh stands in, and the focused
 * element's focus ring: its box grown by the outline's width and offset, which an offset below
 * zero draws inside it, and whether the keyboard's ring is drawn.
 */
const marks = (page: Page) =>
  page.evaluate(() => {
    const box = (element: Element | null | undefined): Box | null => {
      if (!element) return null
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
      return { left, top, right, bottom, width, height }
    }
    const focused = document.activeElement
    let ring: Box | null = null
    let drawn = false
    if (focused instanceof HTMLElement) {
      const style = getComputedStyle(focused)
      drawn = focused.matches(':focus-visible') && style.outlineStyle !== 'none'
      const out = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
      const own = focused.getBoundingClientRect()
      ring = {
        left: own.left - out,
        top: own.top - out,
        right: own.right + out,
        bottom: own.bottom + out,
        width: own.width + 2 * out,
        height: own.height + 2 * out,
      }
    }
    return {
      live: box(document.querySelector('.analytics-bar-fresh-mark')),
      failure: box(document.querySelector('.refresh-failed-mark')),
      row: box(document.querySelector('.analytics-refresh')),
      ring,
      drawn,
    }
  })

type Marks = Awaited<ReturnType<typeof marks>>

function expectDisc(name: string, disc: Box | null) {
  expect.soft(disc?.width, `${name}: the disc's width`).toBeCloseTo(DISC, 1)
  expect.soft(disc?.height, `${name}: the disc's height`).toBeCloseTo(DISC, 1)
}

for (const locale of ['ru', 'en'] as const)
  for (const [period, { state, live }] of Object.entries(PERIODS))
    test(`the failure's disc and its retry's ring keep their room, ${period} in ${locale}`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      const fail = await serveFailing(page, WIDTHS[0])
      await open(page, state)
      const failure = page.locator('.refresh-failed')
      const retry = failure.getByRole('button', { name: RETRY[locale] })
      const seen: Record<string, { failed: Marks; rest: Marks }> = {}
      for (const width of WIDTHS) {
        fail(false)
        await page.setViewportSize({ width, height: 900 })
        await frames(page)
        const rest = await marks(page)
        const atRest = [rest.live].filter((disc) => disc !== null)
        expect.soft(atRest, `${width}px at rest: the live period's discs`).toHaveLength(live)
        for (const disc of atRest) expectDisc(`${width}px at rest, live`, disc)
        fail(true)
        await failRefresh(page)
        // The keyboard's way onto the retry, so its ring is the one a key draws.
        await retry.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(retry).toBeFocused()
        await frames(page)
        const failed = await marks(page)
        seen[width] = { rest, failed }
        const name = `${width}px failed`
        expectDisc(name, failed.failure)
        expect.soft(failed.drawn, `${name}: the retry's ring drawn`).toBe(true)
        const ring = failed.ring ?? { left: Number.NaN, top: Number.NaN, bottom: Number.NaN }
        const disc = failed.failure ?? { right: Number.NaN }
        const row = failed.row ?? { top: Number.NaN, bottom: Number.NaN }
        expect
          .soft(ring.left - disc.right, `${name}: the air between the disc and the ring`)
          .toBeGreaterThanOrEqual(1)
        expect.soft(ring.top, `${name}: the ring above the row`).toBeGreaterThanOrEqual(row.top)
        expect.soft(ring.bottom, `${name}: the ring under the row`).toBeLessThanOrEqual(row.bottom)
        // Answered, the retry takes the failure away.
        fail(false)
        await retry.click()
        await expect(failure).toBeHidden()
        await page.mouse.move(1, 899)
      }
      await record(info, `bar failure marks ${locale} ${period}`, seen)
    })
