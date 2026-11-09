/**
 * A space's rows of the frame as the side panel lists them: the work going on now, the
 * quiet work folded under it, and the pinned items apart.
 *
 * The list is there to follow running work at a glance, so only an item a session is
 * working on or waiting at stands in it, freshest first by when the item last changed;
 * a row that changes moves to the top, and two that changed in one second stand by
 * number. An item held by a session at work on others, or silent for over a day, is
 * quiet: it is listed under one folded row, in the same order. A pinned item that is
 * not at work stands in a group of its own, by number, since a person put it there to
 * find it again. An item that is in the frame only as the parent of others is no row
 * of its own: its title is said, muted, before each of its rows, which is where an
 * epic's name helps. A row that left the frame and fades keeps the place its last
 * state gave it.
 */
import type { ShownRow } from '@/shared/lib/liveWorkRows.ts'

/** A row as the list draws it, with the title of the item it belongs to, if any. */
export interface LiveEntry {
  /** The parent's title, said before the row's own; null for a row with no parent. */
  epic: string | null
  row: ShownRow
}

export interface LiveList {
  /** Working or waiting, freshest first. */
  live: LiveEntry[]
  /** Pinned and not at work, by number. */
  pinned: LiveEntry[]
  /** Held or quiet, and not pinned: under the folded row, freshest first. */
  quiet: LiveEntry[]
}

const MOVING = new Set(['working', 'waiting'])
const STILL = new Set(['held', 'quiet'])

/** A row's number as the list prints it under its space's name: the key is already said. */
export function rowNumber(reference: string): string {
  return reference.slice(reference.lastIndexOf('-') + 1)
}

const byNumber = (first: LiveEntry, second: LiveEntry) =>
  Number(rowNumber(first.row.reference)) - Number(rowNumber(second.row.reference))

function byFreshness(first: LiveEntry, second: LiveEntry) {
  if (first.row.updated_at === second.row.updated_at) return byNumber(first, second)
  return first.row.updated_at < second.row.updated_at ? 1 : -1
}

export function liveList(rows: readonly ShownRow[]): LiveList {
  const titles = new Map(rows.map((row) => [row.reference, row.title]))
  const list: LiveList = { live: [], pinned: [], quiet: [] }
  for (const row of rows) {
    const entry = { row, epic: row.parent === null ? null : (titles.get(row.parent) ?? null) }
    if (row.state !== null && MOVING.has(row.state)) list.live.push(entry)
    else if (row.pinned) list.pinned.push(entry)
    else if (row.state !== null && STILL.has(row.state)) list.quiet.push(entry)
  }
  list.live.sort(byFreshness)
  list.quiet.sort(byFreshness)
  list.pinned.sort(byNumber)
  return list
}
