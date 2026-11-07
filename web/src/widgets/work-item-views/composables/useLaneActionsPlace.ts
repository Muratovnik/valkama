/**
 * Where a lane heading's actions stand and whether its state stands on the
 * title's line (`laneActionsPlace.ts`), read from the heading as it is laid out.
 * Every width it is given is one that does not change with either: the parts
 * after the title, the room of a line, the gap, the actions themselves, and the
 * room the first line has after the whole title. The lines drawn are not read,
 * since they do; so the place follows from the width the heading has, whichever
 * place it held before.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

/** Where a finger presses, the actions stand a reach apart, wider than under a pointer. */
const coarse = typeof matchMedia === 'undefined' ? undefined : matchMedia('(pointer: coarse)')

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

/**
 * `board` is the width the board shows, which the heading is drawn across; `content` is the rest
 * a width read here follows from besides the font: the words the heading says.
 */
export function useLaneActionsPlace(
  parts: LaneHeadParts,
  board: WatchSource,
  content: WatchSource,
) {
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

  // A new place makes the lane a line taller or shorter, and the browser observes every lane's
  // size itself, for the size it keeps for a lane out of sight (`content-visibility`,
  // `contain-intrinsic-size` in `WorkItemLanes`). Read in the turn of an observer of a box inside
  // the lane, the place changed the lane's size where the browser could no longer tell itself of
  // it in that frame, and it reported a ResizeObserver loop at every width where a place changed.
  // So the board's width is read where the board's own observer has it (`useColumnFit`), outside
  // the lanes; a heading its lane leaves unlaid out is not read there, which would lay the lane
  // out, but once it is laid out again, off `.lane-measure`, a line of no height across it that
  // nothing the place lays out resizes. That line lies deeper than the lane, so its observer runs
  // after the browser's own has taken the lane's size: read in its turn, a new place still changed
  // the lane too late to be told, so it is read in the next frame. The lane is laid out again some
  // way before it comes into sight, so the frame it keeps its old place is not seen unless it is
  // brought straight into view from far off. The words are watched below and the font listened for.
  watch(
    board,
    () => {
      if (head.value?.checkVisibility?.({ contentVisibilityAuto: true }) !== false) read()
    },
    { flush: 'post' },
  )
  const measure = computed(() => head.value?.querySelector<HTMLElement>(':scope > .lane-measure'))
  let pending = 0
  useResizeObserver(measure, () => {
    cancelAnimationFrame(pending)
    pending = requestAnimationFrame(read)
  })
  onBeforeUnmount(() => cancelAnimationFrame(pending))
  // A font that comes in after the heading was read changes every width read without always
  // resizing the boxes watched: a heading read in the fallback kept a place the font undid.
  useEventListener(
    typeof document !== 'undefined' && 'fonts' in document ? document.fonts : undefined,
    'loadingdone',
    read,
  )
  useEventListener(coarse, 'change', read)
  watch(content, read, { flush: 'post' })
  onMounted(read)

  return { layout }
}
