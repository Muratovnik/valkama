/**
 * What the Analytics sweep runs inside the page to read sideways overflow, forbidden text and
 * what a reader may press, installed beside `sweepInPage.ts`'s helpers and bound by the same
 * rule: each function reaches the others only through `window.sweepHelpers`.
 */
import type { Point, ScrollMaker } from './sweepRules.ts'

/** A box of the page or the panel that holds more than it shows sideways. */
export interface Overflowing {
  clientWidth: number
  /** Out-of-flow descendants that reach past its content box, which no frame between clips. */
  escapees: { owner: string; path: string; reach: number }[]
  escapes: boolean
  inflow: number
  /** Whether the box, or out-of-flow content that widens it, stands in the scope read. */
  inScope: boolean
  maker: ScrollMaker
  owner: string
  page: boolean
  path: string
  scrolls: boolean
  scrollWidth: number
}

/** One place a forbidden text stands, visible. */
export interface Occurrence {
  owner: string
  path: string
  said: string
  text: string
}

/** Text with every run of space, of any width, read as one space. */
function spaced(value: string): string {
  return value.replaceAll(/\s+/gu, ' ')
}

/** Whether an element is out of the flow of its parent. */
function outOfFlow(element: Element): boolean {
  return /absolute|fixed/u.test(getComputedStyle(element).position)
}

/** How far the in-flow content of `node` reaches past `start`: down to a nested frame, which holds its own. */
function inflowOf(node: Element, start: number): number {
  const help = window.sweepHelpers
  let reach = 0
  for (const child of node.children) {
    if (help.outOfFlow(child)) continue
    const of = child.getBoundingClientRect()
    const clipped = getComputedStyle(child).overflowX !== 'visible'
    // A leaf's text may run past its box.
    const leaf = child.children.length || clipped ? 0 : of.left + child.scrollWidth - start
    if (of.width || of.height) reach = Math.max(reach, of.right - start, leaf)
    if (!clipped) reach = Math.max(reach, help.inflowOf(child, start))
  }
  return reach
}

/**
 * Out-of-flow descendants of `scroller` reaching past `end`: those no frame clips on the way,
 * where a frame clips one only if it is its containing block or holds that block.
 */
function escapeesOf(scroller: Element, end: number): Element[] {
  const help = window.sweepHelpers
  return [...scroller.querySelectorAll<HTMLElement>('*')].filter((loose) => {
    if (!help.outOfFlow(loose)) return false
    const of = loose.getBoundingClientRect()
    if (of.right <= end + 1 || (!of.width && !of.height)) return false
    const block = loose.offsetParent
    for (let at = loose.parentElement; at && at !== scroller; at = at.parentElement) {
      if (
        getComputedStyle(at).overflowX !== 'visible' &&
        block &&
        (at === block || at.contains(block))
      )
        return false
    }
    return true
  })
}

/** Whether boxes stand in one row, left to right on one line. */
function inRow(boxes: readonly DOMRect[]): boolean {
  return (
    boxes.length >= 3 &&
    boxes.every(
      (one, index) =>
        index === 0 ||
        (Math.abs(one.top - boxes[0].top) <= 2 && one.left >= boxes[index - 1].right - 1),
    )
  )
}

/** What makes the content reach `right`: a table, a row of like items, or something else. */
function makerOf(scroller: Element, right: number): ScrollMaker {
  const help = window.sweepHelpers
  let node: Element = scroller
  for (let depth = 0; depth < 12; depth += 1) {
    if (node instanceof HTMLTableElement) {
      const cells = [...(node.rows[0]?.cells ?? [])].map(
        (cell) => cell.getBoundingClientRect().width,
      )
      return { kind: 'table', unit: Math.min(...cells.filter((width) => width > 1)) }
    }
    const children = [...node.children].filter(
      (child) => !help.outOfFlow(child) && child.getBoundingClientRect().width > 0,
    )
    const boxes = children.map((child) => child.getBoundingClientRect())
    if (help.inRow(boxes)) return { kind: 'row', unit: Math.min(...boxes.map((one) => one.width)) }
    const reaching = children.filter((child) => child.getBoundingClientRect().right >= right - 1)
    if (reaching.length !== 1) break
    node = reaching[0]
  }
  return { kind: 'other', unit: 0 }
}

/** A box that scrolls sideways and is wider inside than out, as it measures; null for any other. */
function overflowOf(scroller: Element, scope: string | null): Overflowing | null {
  const help = window.sweepHelpers
  if (scroller.scrollWidth - scroller.clientWidth <= 1 || scroller.clientWidth <= 1) return null
  const page = scroller === document.documentElement
  const scrolls = page || /auto|scroll/u.test(getComputedStyle(scroller).overflowX)
  // A box that does not scroll sideways cuts what it holds: a designed ellipsis, not a scroll.
  if (!scrolls || (!page && !help.shown(scroller))) return null
  const rect = scroller.getBoundingClientRect()
  const start = page ? -scrollX : rect.left + scroller.clientLeft - scroller.scrollLeft
  const end = page ? innerWidth : rect.left + scroller.clientLeft + scroller.clientWidth
  const inflow = help.inflowOf(scroller, start)
  const loose = help.escapeesOf(scroller, end)
  return {
    page,
    scrolls,
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    inflow,
    escapes: loose.length > 0,
    escapees: loose.slice(0, 12).map((one) => ({
      path: help.path(one),
      owner: help.owner(one),
      reach: Math.round(one.getBoundingClientRect().right - start),
    })),
    inScope: !scope || Boolean(scroller.closest(scope)) || loose.some((one) => one.closest(scope)),
    maker: help.makerOf(scroller, start + inflow),
    path: help.path(scroller),
    owner: help.owner(scroller),
  }
}

/** Every box of the page and the panel, and the document, that scrolls sideways and is wider inside than out. */
function readOverflow(scope: string | null): Overflowing[] {
  const boxes = [
    document.documentElement,
    ...document.querySelectorAll('.analytics-page *, .analytics-detail *'),
  ]
  return boxes
    .map((one) => window.sweepHelpers.overflowOf(one, scope))
    .filter((one) => one !== null)
}

/** Every visible text node of `scope` (the page and its panel where null) that holds one of `texts`. */
function readForbidden(texts: readonly string[], scope: string | null): Occurrence[] {
  const help = window.sweepHelpers
  const spaced = help.spaced
  const found: Occurrence[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const said = spaced(node.textContent ?? '')
    const parent = node.parentElement
    if (!parent?.closest(scope ?? window.sweepData.whole) || !help.shown(parent)) continue
    for (const text of texts.filter((one) => said.includes(spaced(one))))
      found.push({
        text,
        said: said.trim().slice(0, 120),
        path: help.path(parent),
        owner: help.owner(parent),
      })
  }
  return found
}

/**
 * What a reader may press in the panel's charts to open a value, in reading order, each marked
 * `data-sweep-press`: the hinted marks of a chart that are controls first, then the other buttons,
 * never a switch's option or a menu. Answers their paths.
 */
function markPressables(): string[] {
  const help = window.sweepHelpers
  const pressable = ':is(button, [role="button"]):not([aria-haspopup]):not([role="radio"])'
  const all = [...document.querySelectorAll<HTMLElement>(`.analytics-panel ${pressable}`)].filter(
    (one) => help.shown(one) && !one.closest('[role="radiogroup"], [role="menu"]'),
  )
  const marks = all.filter(
    (one) => one.closest('[data-shown]') && one.matches('[data-tooltip], :has([data-tooltip])'),
  )
  const ordered = [...marks, ...all.filter((one) => !marks.includes(one))].slice(0, 12)
  return ordered.map((one, index) => {
    one.dataset.sweepPress = String(index)
    return help.path(one)
  })
}

/** Brings the pressable `index` into view and answers a point where the pointer reaches it. */
function pressPoint(index: number): Point | null {
  const one = document.querySelector(`[data-sweep-press="${index}"]`)
  if (!one) return null
  one.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  const of = one.getBoundingClientRect()
  // A ring's sector has the ring's hole at its box's centre: try across the box.
  const steps = [0.5, 0.25, 0.75, 0.1, 0.9]
  for (const across of steps)
    for (const down of steps) {
      const at = { x: of.left + of.width * across, y: of.top + of.height * down }
      const hit = document.elementFromPoint(at.x, at.y)
      if (hit && one.contains(hit)) return at
    }
  return null
}

/** The helpers of this module, by name, as `window.sweepHelpers` holds them. */
export const layoutHelpers = {
  escapeesOf,
  inflowOf,
  inRow,
  makerOf,
  markPressables,
  outOfFlow,
  overflowOf,
  pressPoint,
  readForbidden,
  readOverflow,
  spaced,
}
