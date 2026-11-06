/**
 * Whether the interface may still move focus where an action of the person's lands.
 *
 * An action that waits on the server ends after a round trip, and by then the person may have
 * gone on: into a field to type, to another control. The landing would take them out of it.
 * So the right to move focus is given as the action begins (`grantFocus`) and is gone once the
 * person moves focus themselves: focus comes to an element after a press or a key that came
 * after the right was given. A key or a press that moves nothing leaves it standing, and so
 * does focus falling to the page because what held it went or was disabled: with focus on
 * nothing, a landing takes it from nobody, so it needs no right.
 *
 * The interface's own moves are not the person's. Those that go through `take` are known as
 * such; any other that follows no input since the right was given is told apart by that, a
 * form closing or a drawer opening on its own included. The record of input is `pressFocus`'s.
 */
import { inputCount, recordInput } from '@/shared/lib/pressFocus.ts'

/** The page itself has focus: what held it went, or nothing has taken it yet. */
export function focusOnNothing(): boolean {
  const active = document.activeElement
  return active === null || active === document.body
}

/** The count of input when focus last came to an element by the person's hand, so far as told. */
let movedAt = 0
/** A move of the interface's own is under way. */
let moving = false
let listening = false

function listen() {
  if (listening) return
  listening = true
  recordInput()
  document.addEventListener(
    'focusin',
    () => {
      if (!moving) movedAt = inputCount()
    },
    { capture: true },
  )
}

export interface FocusRight {
  /** What follows answers no input that came before now: the right counts from here. */
  forgetInput(): void
  /** The action has landed, or has nothing left to land on. */
  spend(): void
  /** Moves focus if the right still stands or nothing holds focus; the right outlasts it. */
  take(move: () => void): void
}

function right(held: boolean): FocusRight {
  let since = inputCount()
  const stands = () => {
    if (held && movedAt > since) held = false
    return held
  }
  return {
    take(move) {
      if (!stands() && !focusOnNothing()) return
      moving = true
      try {
        move()
      } finally {
        moving = false
      }
    },
    spend() {
      held = false
    },
    forgetInput() {
      stands()
      since = inputCount()
    },
  }
}

/** The right of an action that begins now, in answer to the person. */
export function grantFocus(): FocusRight {
  listen()
  return right(true)
}

/** No right at all: a move under it only fills a focus nothing holds. */
export const NO_FOCUS_RIGHT: FocusRight = right(false)

/**
 * The right of one owner's latest action: a new action replaces the right of the one before,
 * which has nothing left to land on once the person has asked for something else.
 */
export function latestFocusRight() {
  let current = NO_FOCUS_RIGHT
  return {
    give() {
      current = grantFocus()
    },
    forgetInput: () => current.forgetInput(),
    spend: () => current.spend(),
    take: (move: () => void) => current.take(move),
  }
}
