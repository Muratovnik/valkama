/**
 * The rows the side panel shows: the live-work frame as it arrived, and the rows a
 * newer frame no longer has, kept where they stood while they fade.
 *
 * The frame is in order and the client does not sort it. A row that left keeps its
 * place by the rows that stood before it when it left: it goes back after the nearest
 * of them still shown, so it neither jumps to an edge nor pushes the list about while
 * it fades. A space that left with its last row comes back at its key, as the frame
 * orders spaces.
 */
import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'

type LiveSpace = LiveFrame['spaces'][number]
type LiveRow = LiveSpace['rows'][number]

/** A row as shown; `fading` when the frame no longer has it and it is let go after a while. */
export type ShownRow = LiveRow & { fading: boolean }

export interface ShownSpace extends Omit<LiveSpace, 'rows'> {
  rows: ShownRow[]
}

/** A row the frame dropped, with what it needs to stand where it stood. */
export interface DepartedRow {
  /** The rows that stood before it in its space, nearest first. */
  before: readonly string[]
  row: LiveRow
  space: Pick<LiveSpace, 'key' | 'name' | 'project_id'>
}

/** Every row shown in `spaces`, in order, with its space, as a departure would record it. */
export function departures(
  shown: readonly ShownSpace[],
  next: LiveFrame,
): { departed: DepartedRow; reference: string }[] {
  const kept = new Set(next.spaces.flatMap((space) => space.rows.map((row) => row.reference)))
  const left: { departed: DepartedRow; reference: string }[] = []
  for (const space of shown) {
    const order = space.rows.map((row) => row.reference)
    for (const [index, { fading, ...row }] of space.rows.entries()) {
      if (kept.has(row.reference) || fading) continue
      left.push({
        reference: row.reference,
        departed: {
          space: { key: space.key, name: space.name, project_id: space.project_id },
          row,
          before: order.slice(0, index).reverse(),
        },
      })
    }
  }
  return left
}

function spaceAt(spaces: ShownSpace[], departed: DepartedRow): ShownSpace {
  const found = spaces.find((space) => space.key === departed.space.key)
  if (found) return found
  const space: ShownSpace = { ...departed.space, sessions: [], rows: [] }
  const after = spaces.findIndex((other) => other.key > space.key)
  spaces.splice(after === -1 ? spaces.length : after, 0, space)
  return space
}

/** The frame with the rows that left put back where they stood, muted. */
export function shownSpaces(
  frame: LiveFrame | null,
  departed: readonly DepartedRow[],
): ShownSpace[] {
  const spaces: ShownSpace[] = (frame?.spaces ?? []).map((space) => ({
    ...space,
    rows: space.rows.map((row) => ({ ...row, fading: false })),
  }))
  for (const entry of departed) {
    const space = spaceAt(spaces, entry)
    if (space.rows.some((row) => row.reference === entry.row.reference)) continue
    const anchor = entry.before
      .map((reference) => space.rows.findIndex((row) => row.reference === reference))
      .find((index) => index !== -1)
    space.rows.splice(anchor === undefined ? 0 : anchor + 1, 0, { ...entry.row, fading: true })
  }
  return spaces
}

/** How many items an agent's session is on now: what the rail's count says. */
export function liveCount(frame: LiveFrame | null): number {
  return (frame?.spaces ?? []).reduce(
    (count, space) =>
      count + space.rows.filter((row) => row.state !== null && row.state !== 'quiet').length,
    0,
  )
}
