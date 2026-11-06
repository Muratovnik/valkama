/**
 * Where a lane heading's actions stand. At the end of the heading's last line
 * when that line has room for them. Where it has not: beside the title when the
 * title stays whole there, and otherwise still at the end, taking the last part
 * of the line down with them onto a line of their own — so they cost the heading
 * a line rather than the title its words, and never stand on a line alone.
 *
 * Which line has room is a fact of the drawn lines, so it is read from them, in
 * terms that do not change with where the actions stand: beside the title, an
 * empty place of their width stands where they would end the last line; taken
 * down, the line the last part left still says how far it reaches. Whether the
 * title stays whole beside them is its words' full width against the first line.
 * So the answer cannot flip back and forth.
 *
 * Only where nothing can come down with them — the last part already starts its
 * line, or would leave the state alone on the line above — do they stand alone at
 * the end, rather than cut the title.
 */
import { onMounted, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useResizeObserver } from '@vueuse/core'

type Place = 'beside' | 'end' | 'tied'

/** The heading's parts the place is read from. */
export interface LaneHeadParts {
  actions: Ref<HTMLElement | null>
  /** The empty place of the actions' width that ends the lines while they stand beside the title. */
  room: Ref<HTMLElement | null>
  tail: Ref<HTMLElement | null>
  toggle: Ref<HTMLElement | null>
}

/** Two parts stand on one line when their vertical middles meet, whatever their heights. */
function sameLine(one: Element, two: Element): boolean {
  const middle = (element: Element) => {
    const box = element.getBoundingClientRect()
    return (box.top + box.bottom) / 2
  }
  return Math.abs(middle(one) - middle(two)) <= 1
}

const width = (element: Element) => element.getBoundingClientRect().width

/** The title stays whole beside the actions: its words' full width fits the first line less
 *  the toggle's insets, a gap and the actions. */
function wholeBeside(toggle: Element, actions: Element): boolean {
  const words = toggle.querySelector('.lane-words')
  const title = toggle.querySelector('.lane-title')
  const head = toggle.parentElement
  if (!words || !title || !head) return true
  const full = width(words) + title.scrollWidth - title.clientWidth
  const gap = Number.parseFloat(getComputedStyle(words).columnGap)
  return full <= width(head) - (width(toggle) - width(words)) - gap - width(actions) + 0.5
}

/** The tail's parts in the lines, the actions, their place and the break left out. */
function textParts(tail: Element): Element[] {
  return [...tail.children].filter(
    (part) =>
      !part.matches('.lane-actions, .lane-room, .lane-break') &&
      getComputedStyle(part).position !== 'absolute',
  )
}

export function useLaneActionsPlace(parts: LaneHeadParts, content: WatchSource) {
  const { actions, room, tail, toggle } = parts
  const place = ref<Place>('end')

  /** Whether the last part and the actions end the line the last part stands on, or left. */
  function fits(tailBox: Element, actionsBox: Element, placeBox: Element, text: Element[]) {
    const [before, last] = [text.at(-2), text.at(-1)]
    if (!last) return true
    if (place.value !== 'tied' || !before) return sameLine(placeBox, last)
    // Untied, the last part would end the line above if it fits there, and start a line
    // otherwise; the actions end the line it stands on if they fit after it.
    const gap = Number.parseFloat(getComputedStyle(tailBox).columnGap)
    const end = tailBox.getBoundingClientRect().right + 0.5
    const after = before.getBoundingClientRect().right + gap + width(last)
    if (after > end) return width(last) + gap + width(actionsBox) <= width(tailBox) + 0.5
    return after + gap + width(actionsBox) <= end
  }

  /** The last part can come down with them: it does not start its line, the line above keeps
   *  more than the state, and the two fit a line. */
  function tieable(tailBox: Element, actionsBox: Element, toggleBox: Element, text: Element[]) {
    const [above, before, last] = [text.at(-3), text.at(-2), text.at(-1)]
    if (!before || !last) return false
    if (place.value !== 'tied' && !sameLine(before, last)) return false
    const alone =
      before.classList.contains('lane-state') &&
      !sameLine(before, toggleBox) &&
      !(above && sameLine(above, before))
    const gap = Number.parseFloat(getComputedStyle(tailBox).columnGap)
    return !alone && width(last) + gap + width(actionsBox) <= width(tailBox) + 0.5
  }

  function read() {
    if (!toggle.value || !tail.value || !actions.value || !room.value) return
    const text = textParts(tail.value)
    const placeBox = place.value === 'beside' ? room.value : actions.value
    if (fits(tail.value, actions.value, placeBox, text)) place.value = 'end'
    else if (wholeBeside(toggle.value, actions.value)) place.value = 'beside'
    else if (tieable(tail.value, actions.value, toggle.value, text)) place.value = 'tied'
    else place.value = 'end'
  }

  useResizeObserver([tail, toggle], read)
  watch(content, read, { flush: 'post' })
  onMounted(read)

  return { place }
}
