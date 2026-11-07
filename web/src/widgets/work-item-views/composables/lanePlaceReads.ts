/**
 * Lane headings whose place is still to be read. A heading laid out again is read a frame after
 * its observer saw it (`useLaneActionsPlace`), and a new place changes its lane's height and so
 * moves everything under it. What must stand somewhere once the board's content is still — a tile
 * cleared of its heading (`useLaneClearance`) — waits for those reads rather than for a count of
 * frames.
 */
import { nextTick } from 'vue'

let due = 0
let waiting: (() => void)[] = []

/** A heading's read is due: whatever waits for the places waits for it too. */
export function placeDue() {
  due += 1
}

/**
 * A due read has been made, or will not be. Once none is due and the board holds what they
 * changed, before it is drawn, what waited runs.
 */
export function placeRead() {
  due -= 1
  if (due > 0) return
  void nextTick(() => {
    if (due > 0) return
    const run = waiting
    waiting = []
    for (const then of run) then()
  })
}

/** Whether a heading's read is still due. */
export const placesDue = () => due > 0

/** Runs `then` once no heading's read is due: at once if none is. */
export function afterPlaces(then: () => void) {
  if (due === 0) then()
  else waiting.push(then)
}
