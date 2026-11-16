/**
 * What the hint-manager specs note of the window's hover surfaces, a hint's and a reference's
 * card's: every frame, every change of the count of hints, every arrival of the pointer and key,
 * all on the page's own clock, and the points and boxes they aim the pointer at.
 */
import type { Locator, Page } from '@playwright/test'

export interface Frame {
  at: number
  count: number
  /** Every hover surface the frame shows on the window, a hint's or a card's, in page order. */
  surfaces: ('card' | 'hint')[]
  text: string
}

export interface Arrival {
  at: number
  on: string
}

export interface Watched {
  arrivals: Arrival[]
  changes: Frame[]
  hintLog: Frame[]
}

/**
 * Teaches the page to note, all on one clock: every frame from now on, how many hints it shows,
 * the words of the first and which hover surfaces stand on the window; every change of that
 * count, even one undone before the next frame; and when the pointer arrived on an element or a
 * key went down. A surface the library has not placed yet stands off the window, and shows nothing.
 */
export const watchHints = (page: Page) =>
  page.evaluate(() => {
    const host = window as unknown as Watched
    host.arrivals = []
    host.changes = []
    host.hintLog = []
    const note = (on: string) => host.arrivals.push({ at: performance.now(), on })
    document.addEventListener(
      'pointerover',
      (event) => note(event.target instanceof Element ? event.target.className : ''),
      true,
    )
    document.addEventListener('keydown', (event) => note(`key ${event.key}`), true)
    const now = (at: number): Frame => {
      const hints = [...document.querySelectorAll('.tooltip-hint')]
      const shown = hints[0]?.cloneNode(true) as Element | undefined
      for (const copy of shown?.querySelectorAll('[role="tooltip"]') ?? []) copy.remove()
      const surfaces = [...document.querySelectorAll('.tooltip-hint, .reference-preview')]
        .filter((surface) => {
          const { left, top, right, bottom } = surface.getBoundingClientRect()
          return right > left && bottom > top && bottom > 0 && top < innerHeight && right > 0
        })
        .map((surface): 'card' | 'hint' => (surface.matches('.tooltip-hint') ? 'hint' : 'card'))
      return { at, count: hints.length, surfaces, text: shown?.textContent ?? '' }
    }
    let last = now(performance.now()).count
    new MutationObserver(() => {
      const change = now(performance.now())
      if (change.count !== last) host.changes.push(change)
      last = change.count
    }).observe(document.body, { childList: true, subtree: true })
    const frame = (at: number) => {
      host.hintLog.push(now(at))
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

/** What the page noted since the last call (`watchHints`). */
export const watched = (page: Page) =>
  page.evaluate(() => {
    const host = window as unknown as Watched
    return {
      arrivals: host.arrivals.splice(0),
      changes: host.changes.splice(0),
      frames: host.hintLog.splice(0),
    }
  })

/** A point inside `within` where the pointer is on nothing that shows a hint or acts. */
export const quietPoint = (within: Locator) =>
  within.evaluate((box) => {
    const { left, top, right, bottom } = box.getBoundingClientRect()
    for (let y = top + 24; y < bottom - 24; y += 12)
      for (let x = left + 24; x < right - 24; x += 12) {
        const under = document.elementFromPoint(x, y)
        const busy = under?.closest('[data-tooltip], [data-reference-preview], button, a, input')
        if (under && box.contains(under) && !busy) return { x, y }
      }
    throw new Error('no quiet point')
  })

export const boxOf = (locator: Locator) =>
  locator.evaluate((node) => {
    const { left, top, right, bottom } = node.getBoundingClientRect()
    return { left, top, right, bottom }
  })

export const hint = (page: Page) => page.locator('.tooltip-hint')

/** Real time passing in the page, `ms` long, while its frames are noted. */
export const pass = (page: Page, ms: number) =>
  page.evaluate((wait) => new Promise((done) => setTimeout(done, wait)), ms)
