/**
 * A finger's tap on the ground of a far-out frame opens its epic, as a mouse's press there does.
 *
 * The browser moves a tap to the control it judges the finger meant, and far out a frame's
 * cards stand a few pixels apart, so a finger on the ground nearly always covers one: a tap
 * on the ground opened a card beside it, or the header's button, and the ground was hardly
 * ever what took it. The press keeps where the finger's centre was, so when that is the ground
 * of a frame that opens its epic there, the click the browser moved elsewhere is given back to
 * that ground, and the frame says what a press there means (`GraphFrame`). A tap centred on a
 * card or a header is the browser's to place, as before.
 */
import type { MaybeRefOrGetter } from 'vue'

import { useEventListener } from '@vueuse/core'

/** The ground that opens its epic: the frame's own box, written by `GraphFrame`. */
const GROUND = '.graph-frame.ground-opens'

export function useGraphGroundTap(field: MaybeRefOrGetter<HTMLElement | null>) {
  /** The ground under the centre of the finger that pressed last, if it was ground. */
  let ground: HTMLElement | null = null

  useEventListener(
    field,
    'pointerdown',
    (event: PointerEvent) => {
      const under =
        event.pointerType === 'touch'
          ? document.elementFromPoint(event.clientX, event.clientY)
          : null
      ground = under instanceof HTMLElement && under.matches(GROUND) ? under : null
    },
    { capture: true },
  )

  useEventListener(
    field,
    'click',
    (event: MouseEvent) => {
      const pressed = ground
      ground = null
      // A click the keyboard or the frame itself sent carries no press of a finger.
      if (!pressed || event.detail === 0 || event.target === pressed) return
      event.preventDefault()
      event.stopPropagation()
      pressed.click()
    },
    { capture: true },
  )
}
