/**
 * A space's rows and sessions of the frame as the side panel lists them: the work to follow
 * now, three folds of the rest, and the pinned items apart.
 *
 * The list is there to follow running work at a glance, so only what a session is working on,
 * or waits at for less than four hours, stands in it (`onView`): items and the sessions that
 * are on no item, in one run. A row that asks a person comes first, since it is the wait a
 * person can end now; then the freshest first, an item by when it last changed and a session
 * by when it began what it does now. Two of one second stand items first, by number, and
 * sessions as the frame sent them.
 *
 * The rest folds under three rows, each named by what it holds and in the same order: the
 * items held by a session at work on others, what has waited for over four hours, items and
 * sessions, and the items silent for over a day, each freshest first; among the long waits,
 * as in the work on view, a row that asks a person stands first. A pinned item that is not
 * on view stands with the pinned, by number, since a person put it there to find it again.
 * An item that is in the frame only as the parent of others is no row of its own: its title
 * is said with its rows, which is where an epic's name helps. A row that left the frame and
 * fades keeps the place its last state gave it.
 */
import type { LiveSession } from '@/shared/api/liveFrameModel.ts'
import { onView } from '@/shared/lib/liveWorkRows.ts'
import type { ShownRow } from '@/shared/lib/liveWorkRows.ts'

/** An item as the list draws it, with the title of the item it belongs to, if any. */
export interface ItemEntry {
  /** The parent's title, said with the row's own; null for a row with no parent. */
  epic: string | null
  kind: 'item'
  row: ShownRow
}

/** A session on no item, as the list draws it. */
export interface SessionEntry {
  kind: 'session'
  session: LiveSession
}

export type LiveEntry = ItemEntry | SessionEntry

export interface LiveList {
  /** Held by a session at work on others, and not pinned. */
  held: ItemEntry[]
  /** Working, or waiting for less than four hours: items and sessions, asking first. */
  live: LiveEntry[]
  /** Waiting for over four hours, items not pinned and sessions, asking first. */
  long: LiveEntry[]
  /** Pinned and not on view, by number. */
  pinned: ItemEntry[]
  /** Silent for over a day, and not pinned. */
  quiet: ItemEntry[]
}

/** A row's number as the list prints it under its space's name: the key is already said. */
export function rowNumber(reference: string): string {
  return reference.slice(reference.lastIndexOf('-') + 1)
}

const numberOf = (entry: ItemEntry) => Number(rowNumber(entry.row.reference))

const byNumber = (first: ItemEntry, second: ItemEntry) => numberOf(first) - numberOf(second)

const freshness = (entry: LiveEntry) =>
  entry.kind === 'item' ? entry.row.updated_at : entry.session.since

const asks = (entry: LiveEntry) => (entry.kind === 'item' ? entry.row.asks : entry.session.asks)

/** Freshest first; two of one second items first by number, sessions as they came. */
function byFreshness(first: LiveEntry, second: LiveEntry) {
  const [one, other] = [freshness(first), freshness(second)]
  if (one !== other) return one < other ? 1 : -1
  if (first.kind === 'item' && second.kind === 'item') return byNumber(first, second)
  if (first.kind === second.kind) return 0
  return first.kind === 'item' ? -1 : 1
}

const asking = (first: LiveEntry, second: LiveEntry) =>
  Number(asks(second)) - Number(asks(first)) || byFreshness(first, second)

/** Where an item stands: on view, with the pinned, or in the fold its state names. */
function placeOf(list: LiveList, row: ShownRow): ItemEntry[] | LiveEntry[] | undefined {
  if (onView(row)) return list.live
  if (row.pinned) return list.pinned
  switch (row.state) {
    case 'held': {
      return list.held
    }
    case 'waiting': {
      return list.long
    }
    case 'quiet': {
      return list.quiet
    }
    default: {
      return undefined
    }
  }
}

export function liveList(
  rows: readonly ShownRow[],
  sessions: readonly LiveSession[] = [],
): LiveList {
  const titles = new Map(rows.map((row) => [row.reference, row.title]))
  const list: LiveList = { live: [], held: [], long: [], quiet: [], pinned: [] }
  for (const row of rows) {
    const entry: ItemEntry = {
      kind: 'item',
      row,
      epic: row.parent === null ? null : (titles.get(row.parent) ?? null),
    }
    placeOf(list, row)?.push(entry)
  }
  for (const session of sessions) {
    const entry: SessionEntry = { kind: 'session', session }
    if (onView(session)) list.live.push(entry)
    else list.long.push(entry)
  }
  list.live.sort(asking)
  list.held.sort(byFreshness)
  list.long.sort(asking)
  list.quiet.sort(byFreshness)
  list.pinned.sort(byNumber)
  return list
}
