/**
 * A press that was meant for something else.
 *
 * Something new can rise under a pointer that stands still: a question folds and the next
 * one comes up, a scrim appears over the tile just pressed. The next press goes to whatever
 * stands there now, although it was aimed at what stood there before. Time cannot tell the
 * two apart, nor can the browser's click count: a slow server lets the newcomer arrive a
 * second later, and that press counts as a first one.
 *
 * The pointer can tell, because a person going for something new moves to it. So a press at
 * the point of the one before, with no move between, on anything but what that one landed
 * on, is stray, and it stays so until the pointer moves or the wheel turns. A stray press
 * does not count as landing: a third one must not get through where the second was stopped,
 * or pressing on while a write hangs would end a question nobody has seen.
 *
 * The whole page is watched, since the press before may have landed anywhere. It is only
 * told apart here: each place where such a press would do harm stops it itself.
 */

/** A hand on a mouse shakes by this much without meaning to go anywhere. */
const SAME_POINT_PX = 3
const CONTROL = 'a, button, input, label, select, summary, textarea'

interface Press {
  landed: Element | null
  x: number
  y: number
}

/** The press the pointer has not moved away from. */
let standing: Press | null = null
/** What the press under way is, for the events it is made of. */
let stray = false

const movedFrom = (press: Press, event: PointerEvent) =>
  Math.hypot(event.clientX - press.x, event.clientY - press.y) > SAME_POINT_PX

function landedOn(target: EventTarget | null) {
  return target instanceof Element ? (target.closest(CONTROL) ?? target) : null
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      // Nothing moves between two touches of a finger, so the points are compared as well.
      if (standing && movedFrom(standing, event)) standing = null
      const landed = landedOn(event.target)
      stray = standing !== null && standing.landed !== landed
      if (!stray) standing = { landed, x: event.clientX, y: event.clientY }
    },
    { capture: true },
  )
  document.addEventListener(
    'pointermove',
    (event) => {
      if (standing && movedFrom(standing, event)) standing = null
    },
    { capture: true, passive: true },
  )
  document.addEventListener(
    'wheel',
    () => {
      standing = null
    },
    { capture: true, passive: true },
  )
}

/** Whether this event belongs to a stray press. A key's click (`detail` 0) never does. */
export function isStrayPress(event: MouseEvent) {
  return stray && event.detail > 0
}

function stop(event: MouseEvent) {
  if (!isStrayPress(event)) return
  event.preventDefault()
  event.stopPropagation()
}

/**
 * A stray press reaches nothing inside this element: neither the control under it, nor
 * focus, nor what a label would have ticked. Stopped on its way in, for every control the
 * element holds and any it comes to hold.
 */
export function stopStrayPresses(region: HTMLElement | null) {
  region?.addEventListener('mousedown', stop, { capture: true })
  region?.addEventListener('click', stop, { capture: true })
}
