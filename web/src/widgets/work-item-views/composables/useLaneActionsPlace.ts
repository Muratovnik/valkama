/**
 * Where a lane heading's actions stand and whether its state stands on the
 * title's line (`laneActionsPlace.ts`), read from the heading as it is laid out.
 * Every width it is given is one that does not change with either: the parts
 * after the title, the room of a line, the gap, the actions themselves, and the
 * room the first line has after the whole title. The lines drawn are not read,
 * since they do; so the place follows from the width the heading has, whichever
 * place it held before.
 */
import { onMounted, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import { layoutOf } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'
import type { LaneLayout } from '@/widgets/work-item-views/utils/laneActionsPlace.ts'

/** The heading's parts the place is read from. */
export interface LaneHeadParts {
  actions: Ref<HTMLElement | null>
  head: Ref<HTMLElement | null>
  tail: Ref<HTMLElement | null>
  toggle: Ref<HTMLElement | null>
}

/** A length in the 64ths of a pixel layout works in. */
const units = (pixels: number) => Math.round(pixels * 64)

const width = (element: Element) => units(element.getBoundingClientRect().width)

const style = (element: Element) => getComputedStyle(element)

/** The room the first line has after the whole title: the heading less the toggle drawn with
 *  its title whole. The title's own width is its text's, however much of it its box shows. */
function firstRoom(head: Element, toggle: Element): number {
  const words = toggle.querySelector('.lane-words')
  const title = toggle.querySelector('.lane-title')
  if (!words || !title) return 0
  const reference = toggle.querySelector('.lane-reference')
  const text = document.createRange()
  text.selectNodeContents(title)
  const gap = units(Number.parseFloat(style(words).columnGap))
  const full = (reference ? width(reference) + gap : 0) + units(text.getBoundingClientRect().width)
  return width(head) - (width(toggle) - width(words)) - full
}

/** The parts after the title, wherever the state stands: the actions, their place, the break
 *  and what only a screen reader reads left out. */
function textParts(head: Element, tail: Element): Element[] {
  const state = head.querySelector(':scope > .lane-state')
  return [...(state ? [state] : []), ...tail.children].filter(
    (part) =>
      !part.matches('.lane-actions, .lane-room, .lane-break') &&
      style(part).position !== 'absolute',
  )
}

export function useLaneActionsPlace(parts: LaneHeadParts, content: WatchSource) {
  const { actions, head, tail, toggle } = parts
  const layout = ref<LaneLayout>({ place: 'end', raised: false })

  function read() {
    if (!head.value || !toggle.value || !tail.value || !actions.value) return
    const text = textParts(head.value, tail.value)
    const words = toggle.value.querySelector('.lane-words')
    const gap = units(Number.parseFloat(style(tail.value).columnGap))
    layout.value = layoutOf({
      actions: width(actions.value),
      first: firstRoom(head.value, toggle.value),
      gap,
      line: width(head.value) - units(Number.parseFloat(style(head.value).paddingInlineStart)),
      parts: text.map((part) => width(part)),
      state: text.findIndex((part) => part.classList.contains('lane-state')),
      titleGap: words ? units(Number.parseFloat(style(words).columnGap)) : gap,
      wraps: style(head.value).flexWrap !== 'nowrap',
    })
  }

  useResizeObserver([head, tail, toggle], read)
  // A font that comes in after the heading was read changes every width read without always
  // resizing the boxes watched: a heading read in the fallback kept a place the font undid.
  useEventListener(
    typeof document !== 'undefined' && 'fonts' in document ? document.fonts : undefined,
    'loadingdone',
    read,
  )
  watch(content, read, { flush: 'post' })
  onMounted(read)

  return { layout }
}
