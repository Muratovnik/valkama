/**
 * What a lane heading draws, member by member, read from the page: the chevron's path, the
 * reference's and the title's letters, the state's dot and word, the counts, each note of work
 * out of sight line by line, and each action's glyph or word. Boxes are what is drawn, not the
 * boxes that hold it, and they are relative to the heading's own corner. The members are then
 * sorted into the rows they stand on, the two actions as one: the glyphs of a lone pair stand at
 * heights of their own, and would count as rows of their own.
 */
import type { Locator } from '@playwright/test'

import type { Box } from './laneHeadGeometry.ts'

type Member = 'action' | 'chevron' | 'counts' | 'note' | 'reference' | 'state' | 'title'

export interface Part {
  box: Box
  member: Member
}

export interface Reading {
  /** Whether the actions are drawn: they are see-through at rest where a pointer can hover. */
  actionsShown: boolean
  /** Whether the title, whole, and the actions after it would fit the heading's first line. */
  besideWhole: boolean
  height: number
  parts: Part[]
  /** The members of each row, top to bottom. */
  rows: Member[][]
  /** How many characters of the title are drawn whole, before any ellipsis. */
  titleChars: number
  titleLength: number
  width: number
}

/** What the page says of one heading, before it is sorted into rows. */
interface Drawn {
  actionsShown: boolean
  height: number
  /** Where each of the title's letters ends, relative to the heading. */
  letterEnds: number[]
  parts: Part[]
  /** Where the title's letters may end and still be whole: its box less any ellipsis. */
  titleEnd: number
  width: number
}

/** Reads one heading's drawn parts; runs in the page, so it carries everything it uses. */
const drawnHeading = (head: Element): Drawn => {
  const origin = head.getBoundingClientRect()
  const parts: Part[] = []
  /** Adds what is drawn of `rect`, cut to `within` when given. */
  const add = (member: Member, rect: Box, within: Box = rect) => {
    const box = {
      bottom: Math.min(rect.bottom, within.bottom) - origin.top,
      left: Math.max(rect.left, within.left) - origin.left,
      right: Math.min(rect.right, within.right) - origin.left,
      top: Math.max(rect.top, within.top) - origin.top,
    }
    if (box.right - box.left > 0.5 && box.bottom - box.top > 0.5) parts.push({ box, member })
  }
  /** The letters of an element, a rect per line, cut to `within` when given. */
  const letters = (member: Member, element: Element | null, within?: Box) => {
    const walker = document.createTreeWalker(element ?? document.createElement('i'), 4)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest('.visually-hidden') || !node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) add(member, rect, within)
    }
  }
  const glyphs = (member: Member, element: Element | null) => {
    for (const path of element?.querySelectorAll('path, circle, rect, line, polyline') ?? [])
      add(member, path.getBoundingClientRect())
  }

  glyphs('chevron', head.querySelector('.lane-chevron'))
  letters('reference', head.querySelector('.lane-reference'))
  const title = head.querySelector('.lane-title')
  const titleBox = title?.getBoundingClientRect()
  letters('title', title, titleBox)
  const state = head.querySelector('.lane-state:not(.visually-hidden)')
  const dot = state?.querySelector('.state-dot')
  if (dot) add('state', dot.getBoundingClientRect())
  letters('state', state?.querySelector('.state-label') ?? null)
  letters('counts', head.querySelector('.lane-counts'))
  for (const note of head.querySelectorAll('.lane-elsewhere')) letters('note', note)
  const actions = head.querySelector('.lane-actions')
  for (const action of actions?.querySelectorAll('button') ?? [])
    if (action.querySelector('svg')) glyphs('action', action)
    else letters('action', action)

  // The title's letters drawn whole end before its box does, less the ellipsis it draws.
  const text = title?.firstChild
  const letterEnds: number[] = []
  if (text?.nodeType === Node.TEXT_NODE) {
    const range = document.createRange()
    for (let at = 0; at < (text.textContent?.length ?? 0); at += 1) {
      range.setStart(text, at)
      range.setEnd(text, at + 1)
      letterEnds.push(range.getBoundingClientRect().right - origin.left)
    }
  }
  const canvas = document.createElement('canvas').getContext('2d')
  if (canvas && title) canvas.font = getComputedStyle(title).font
  const clipped = Boolean(title && title.scrollWidth > title.clientWidth + 0.5)
  const ellipsis = clipped && canvas ? canvas.measureText('…').width : 0
  return {
    actionsShown: actions !== null && Number(getComputedStyle(actions).opacity) > 0,
    height: origin.height,
    letterEnds,
    parts,
    titleEnd: (titleBox?.right ?? origin.left) - origin.left - ellipsis,
    width: origin.width,
  }
}

/** Whether the title, whole, the gap its words keep and the actions fit the heading's width; runs
 *  in the page. */
const besideWholeIn = (head: Element): boolean => {
  const words = head.querySelector('.lane-words')
  const title = head.querySelector('.lane-title')
  const actions = head.querySelector('.lane-actions')
  if (!words || !title || !actions) return true
  const origin = head.getBoundingClientRect()
  const end =
    words.getBoundingClientRect().right - origin.left + title.scrollWidth - title.clientWidth
  const gap = Number.parseFloat(getComputedStyle(words).columnGap)
  return end + gap + actions.getBoundingClientRect().width <= origin.width + 0.5
}

/** The members of each row: a part whose middle falls inside a row already found stands on it. */
function rowsOf(parts: Part[]): Member[][] {
  const actions = parts.filter(({ member }) => member === 'action').map(({ box }) => box)
  const merged: Part[] = [
    ...parts.filter(({ member }) => member !== 'action'),
    ...(actions.length > 0
      ? [
          {
            member: 'action' as const,
            box: {
              bottom: Math.max(...actions.map(({ bottom }) => bottom)),
              left: Math.min(...actions.map(({ left }) => left)),
              right: Math.max(...actions.map(({ right }) => right)),
              top: Math.min(...actions.map(({ top }) => top)),
            },
          },
        ]
      : []),
  ]
  const rows: { bottom: number; members: Member[]; top: number }[] = []
  for (const { box, member } of merged.toSorted((one, two) => one.box.top - two.box.top)) {
    const middle = (box.top + box.bottom) / 2
    const row = rows.find((one) => middle >= one.top - 0.5 && middle <= one.bottom + 0.5)
    if (!row) {
      rows.push({ bottom: box.bottom, members: [member], top: box.top })
      continue
    }
    row.top = Math.min(row.top, box.top)
    row.bottom = Math.max(row.bottom, box.bottom)
    if (!row.members.includes(member)) row.members.push(member)
  }
  return rows.map(({ members }) => members)
}

/** Reads one heading as it is drawn now. */
export async function readHeading(head: Locator): Promise<Reading> {
  const drawn = await head.evaluate(drawnHeading)
  const whole = drawn.letterEnds.findIndex((end) => end > drawn.titleEnd + 0.5)
  return {
    actionsShown: drawn.actionsShown,
    besideWhole: await head.evaluate(besideWholeIn),
    height: drawn.height,
    parts: drawn.parts,
    rows: rowsOf(drawn.parts),
    titleChars: whole === -1 ? drawn.letterEnds.length : whole,
    titleLength: drawn.letterEnds.length,
    width: drawn.width,
  }
}
