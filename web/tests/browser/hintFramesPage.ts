/**
 * What the hint-manager specs note of the window's hover surfaces, a hint's and a reference's
 * card's, a cut text's whole words laid over it counting as a hint: every frame, every change of the count of hints, every arrival of the pointer and key,
 * all on the page's own clock, and the points and boxes they aim the pointer at.
 */
import type { Locator, Page } from '@playwright/test'

import { resumeClock, standClock, stands } from './pageClock.ts'

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
      const hints = [...document.querySelectorAll('.tooltip-hint, .whole-text')]
      const shown = hints[0]?.cloneNode(true) as Element | undefined
      // A hint drawn as a grid keeps a copy of its text for a screen reader; it shows the rest.
      for (const copy of shown?.querySelectorAll('[role="tooltip"]') ?? []) copy.remove()
      const surfaces = [
        ...document.querySelectorAll('.tooltip-hint, .whole-text, .reference-preview'),
      ]
        .filter((surface) => {
          const { left, top, right, bottom } = surface.getBoundingClientRect()
          return right > left && bottom > top && bottom > 0 && top < innerHeight && right > 0
        })
        .map((surface): 'card' | 'hint' =>
          surface.matches('.reference-preview') ? 'card' : 'hint',
        )
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

/**
 * What the page noted since the last call (`watchHints`), up to the next frame. A wait on the
 * document, such as a hint's count, ends as soon as the hint is added or removed, before the frame
 * that draws it; the next frame's own note comes first, as it asked for that frame before this did.
 */
export const watched = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(done))
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

/** The hint up, in either of its surfaces: a box of words, or a cut text's words laid whole. */
export const hint = (page: Page) => page.locator('.tooltip-hint, .whole-text')

/** A cut text's whole words, laid over it (`WholeText`). */
export const wholeText = (page: Page) => page.locator('.whole-text')

/**
 * Whether the whole text laid over a cut one is what the window shows at the start of its first
 * line, over every menu or sheet the cut text stands in. It lets the pointer through, so no hit
 * test finds it: for this one reading it is made a target, and is let through again at once.
 */
export const wholeTextOnTop = (page: Page) =>
  wholeText(page).evaluate((whole: HTMLElement) => {
    const { left, top } = whole.getBoundingClientRect()
    const through = whole.style.pointerEvents
    whole.style.pointerEvents = 'auto'
    const seen = document.elementFromPoint(left + 4, top + 4)
    whole.style.pointerEvents = through
    return seen !== null && whole.contains(seen)
  })

/**
 * Once every hint up has faded in: a hint shown after the pointer's rest fades in on the page's
 * own timeline, which a test's clock does not run, and its ink read before then is paler.
 */
export const hintsFadedIn = (page: Page) =>
  page.evaluate(async () => {
    const hints = [...document.querySelectorAll('.tooltip-hint, .whole-text')]
    await Promise.all(hints.flatMap((hint) => hint.getAnimations().map((one) => one.finished)))
  })

/**
 * The page's time passing, `ms` long, while its frames are noted: run by the test on a clock that
 * stands (`standClock`), and real time otherwise.
 */
export const pass = (page: Page, ms: number) =>
  stands(page)
    ? page.clock.runFor(ms)
    : page.evaluate((wait) => new Promise((done) => setTimeout(done, wait)), ms)

/**
 * How far the page's clock runs between two moves of a stroke (`stroke`): a frame, as a pointer
 * reports a hand's moves. A stroke's pace is the test's, never the machine's, and well inside the
 * 120 ms the hint manager waits on a pointer that stopped (`GRACE_MS` in `hintManager.ts`): a hint
 * stays that long after the pointer leaves its anchor, and on the way to a hint what the pointer
 * crosses takes over once it stands still on it that long.
 */
const MOVE_MS = 16

interface Point {
  x: number
  y: number
}

/** A point the pointer goes to, and in how many steps it gets there. */
export type Leg = Point & { steps: number }

/** A move of the pointer, as the page heard it. */
export interface Move {
  /** When the page heard it, on its own clock, before any handler of the page's own did. */
  at: number
  /** The words of every hint the next frame showed. */
  hints: string[]
  /**
   * What it was on: the element with a hint or the surface at the stroke's start (`from`) or at
   * its end (`to`), another hover surface (`surface`), another element with a hint by its class,
   * or nothing (`''`).
   */
  on: string
  /** How many cut texts the next frame laid whole. */
  wholes: number
  x: number
  y: number
}

/**
 * Teaches the page to note every move of the pointer from now on, in place of what it noted before
 * (`moved`): the pointer is to go from `from` to `to`, and each move says which of them, or what
 * else, it was on. It is heard before the page's own handlers, at the time they hear it.
 */
const watchMoves = (page: Page, from: Point, to: Point) =>
  page.evaluate(
    ({ start, end }) => {
      const host = window as unknown as { moves: Move[]; movesHeard?: AbortController }
      host.movesHeard?.abort()
      const heard = new AbortController()
      host.movesHeard = heard
      host.moves = []
      const surfaces = '[data-hint-surface]'
      const holder = (element: Element | null) =>
        element?.closest(surfaces) ??
        element?.closest('[data-tooltip], [data-reference-preview]') ??
        null
      const holderAt = ({ x, y }: Point) => holder(document.elementFromPoint(x, y))
      const [first, last] = [holderAt(start), holderAt(end)]
      const named = (element: Element | null) => {
        if (element === null) return ''
        if (element === first) return 'from'
        if (element === last) return 'to'
        return element.matches(surfaces) ? 'surface' : (element.getAttribute('class') ?? '')
      }
      addEventListener(
        'pointermove',
        (event) => {
          const target = event.target instanceof Element ? event.target : null
          const move: Move = {
            at: performance.now(),
            hints: [],
            on: named(holder(target)),
            wholes: 0,
            x: event.clientX,
            y: event.clientY,
          }
          host.moves.push(move)
          requestAnimationFrame(() => {
            move.hints = [...document.querySelectorAll('.tooltip-hint')].map(
              (hint) => hint.textContent ?? '',
            )
            move.wholes = document.querySelectorAll('.whole-text').length
          })
        },
        { capture: true, signal: heard.signal },
      )
    },
    { start: from, end: to },
  )

/** The moves the page noted since `watchMoves`; the frame after the last one has come. */
const moved = (page: Page) =>
  page.evaluate(() => (window as unknown as { moves: Move[] }).moves.splice(0))

/**
 * Moves the pointer from `from`, where it stands, along `legs`, each in its own steps, the last
 * ending where the stroke goes: the moves the page heard.
 *
 * The page's clock stands for the stroke and runs `MOVE_MS` after each move, so the pointer moves
 * at that pace by the page's clock, which a busy machine cannot slow down. A clock the test has
 * not stopped (`standClock`) is stopped for the stroke and goes on with the wall after it.
 */
export async function stroke(page: Page, from: Point, legs: readonly Leg[]) {
  const to = legs.at(-1) ?? from
  const own = !stands(page)
  if (own) await standClock(page)
  await watchMoves(page, from, to)
  let at = from
  for (const leg of legs) {
    for (let step = 1; step <= leg.steps; step += 1) {
      const part = step / leg.steps
      await page.mouse.move(at.x + (leg.x - at.x) * part, at.y + (leg.y - at.y) * part)
      await page.clock.runFor(MOVE_MS)
    }
    at = leg
  }
  const moves = await moved(page)
  if (own) await resumeClock(page)
  return moves
}

/**
 * How long the pointer was between the two elements, in ms: from its first move off `from`'s to
 * its first move onto `to`'s, the grace the first one's surface runs in.
 */
export function crossing(moves: readonly Move[]) {
  const left = moves.findIndex((move) => move.on !== 'from')
  const off = moves[left]
  const on = moves.find((move, at) => at >= left && move.on === 'to')
  if (!off || !on) {
    const way = moves.map((move) => move.on || '-').join(' → ')
    throw new Error(`the pointer went ${way}, not from one element to the other`)
  }
  return on.at - off.at
}
