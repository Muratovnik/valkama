/**
 * Where a lane heading's actions stand (`laneActionsPlace.ts`), read from the
 * heading as it is laid out. Every width it is given is one that does not change
 * with where they stand: the parts before them, the room of a line, the gap, the
 * actions themselves, and the title's whole width against the first line. The
 * lines drawn are not read, since they do; so the place follows from the width
 * the heading has, whichever place it held before.
 */
import { onMounted, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import { placeOf } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'
import type { LanePlace } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'

/** The heading's parts the place is read from. */
export interface LaneHeadParts {
  actions: Ref<HTMLElement | null>
  tail: Ref<HTMLElement | null>
  toggle: Ref<HTMLElement | null>
}

/** A length in the 64ths of a pixel layout works in. */
const units = (pixels: number) => Math.round(pixels * 64)

const width = (element: Element) => units(element.getBoundingClientRect().width)

const columnGap = (element: Element) =>
  units(Number.parseFloat(getComputedStyle(element).columnGap))

/** The title stays whole beside the actions: its words' full width fits the first line less the
 *  toggle's insets, a gap and the actions. The title's own width is its text's, however much of
 *  it its box shows. */
function wholeBeside(toggle: Element, actions: Element): boolean {
  const words = toggle.querySelector('.lane-words')
  const title = toggle.querySelector('.lane-title')
  const head = toggle.parentElement
  if (!words || !title || !head) return true
  const reference = toggle.querySelector('.lane-reference')
  const text = document.createRange()
  text.selectNodeContents(title)
  const gap = columnGap(words)
  const full = (reference ? width(reference) + gap : 0) + units(text.getBoundingClientRect().width)
  return full <= width(head) - (width(toggle) - width(words)) - gap - width(actions)
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
  const { actions, tail, toggle } = parts
  const place = ref<LanePlace>('end')

  function read() {
    if (!toggle.value || !tail.value || !actions.value) return
    const text = textParts(tail.value)
    place.value = placeOf({
      actions: width(actions.value),
      gap: columnGap(tail.value),
      line: width(tail.value),
      parts: text.map((part) => width(part)),
      state: text.findIndex((part) => part.classList.contains('lane-state')),
      wholeBeside: wholeBeside(toggle.value, actions.value),
    })
  }

  useResizeObserver([tail, toggle], read)
  watch(content, read, { flush: 'post' })
  onMounted(read)

  return { place }
}
