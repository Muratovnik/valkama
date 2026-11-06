/**
 * Focus a script places after a press of the pointer is not ringed unless it asks to be.
 *
 * The browser rings a scripted `focus()` from the last focus it made itself: a key's rings,
 * a pointer's does not. A press that never focuses on its own leaves that verdict where it
 * was, so a script's focus took whatever came before it, and here that was a ring on the
 * page's first press and after an earlier scripted focus. Reka's choice lists press that way:
 * the trigger prevents the press's own focus, then the list focuses an option under the
 * pointer and the choice hands focus back to the trigger, each by script, and each stood
 * ringed after a click.
 * Nothing in the library takes a ring's say, so the say is given where every such focus
 * passes: a `focus()` naming no `focusVisible` after a press, and before the next key,
 * names it false. After a key nothing changes.
 *
 * This is the one record of the last input, and `moveFocus` reads it too: a press of a mouse,
 * pen or finger (`pointerdown`, whatever its `pointerType`) or a key other than a bare modifier.
 * A pointer moving over the page is neither, so a write that ends after a round trip still
 * answers the input that started it.
 */
let lastInput: 'key' | 'pointer' | null = null

/** Whether a press of the pointer, and not a key, was the last input. */
export const pressedLast = (): boolean => lastInput === 'pointer'

/** A key held for a press or another key is not a use of the keyboard on its own. */
const MODIFIERS = new Set(['Alt', 'AltGraph', 'CapsLock', 'Control', 'Meta', 'Shift'])

let installed = false

export function quietFocusAfterPress(): void {
  if (installed) return
  installed = true
  document.addEventListener('pointerdown', () => (lastInput = 'pointer'), { capture: true })
  document.addEventListener(
    'keydown',
    (event) => {
      if (!MODIFIERS.has(event.key)) lastInput = 'key'
    },
    { capture: true },
  )
  for (const prototype of [HTMLElement.prototype, SVGElement.prototype]) {
    const focus = Object.getOwnPropertyDescriptor(prototype, 'focus')?.value as unknown
    if (typeof focus !== 'function') continue
    prototype.focus = function (this: HTMLOrSVGElement, options?: FocusOptions) {
      const quiet = pressedLast() && options?.focusVisible === undefined
      Reflect.apply(focus, this, [quiet ? { ...options, focusVisible: false } : options])
    }
  }
}
