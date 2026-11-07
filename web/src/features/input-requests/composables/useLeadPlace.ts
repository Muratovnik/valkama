/**
 * Whether the comment's press leads the place before a question's two answers on its line
 * (`leadPlace.ts`), read from the row as it is laid out. Every width read is one the answer does
 * not change: the row's, the press's, the controls' and the room the asking keeps, which is
 * `--request-room` in rems. Nothing drawn is read, since that follows from the answer.
 */
import { onMounted, onUpdated, ref } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import { pressLeads } from '@/features/input-requests/utils/leadPlace.ts'

/** A length in the 64ths of a pixel layout works in. */
const units = (pixels: number) => Math.round(pixels * 64)

const width = (element: Element) => units(element.getBoundingClientRect().width)

const gapOf = (element: Element) => units(Number.parseFloat(getComputedStyle(element).columnGap))

function roomOf(root: HTMLElement, lead: Element): number {
  if (!lead.classList.contains('is-room')) return 0
  const rems = Number.parseFloat(getComputedStyle(root).getPropertyValue('--request-room'))
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return units(rems * rem)
}

export function useLeadPlace(root: Ref<HTMLElement | null>) {
  const leads = ref(false)

  function read() {
    const row = root.value
    const lead = row?.querySelector(':scope > .request-lead')
    const controls = lead?.querySelector('.request-lead-controls')
    // Not laid out, as under `v-show`: nothing to read, and the place it had stays.
    if (!row || !lead || !controls || row.getClientRects().length === 0) {
      if (row && !lead) leads.value = false
      return
    }
    const first = row.firstElementChild
    leads.value = pressLeads({
      controlGap: gapOf(controls),
      controls: [...controls.children].map((control) => width(control)),
      gap: gapOf(row),
      line: width(row),
      press: first && first !== lead ? width(first) : 0,
      room: roomOf(row, lead),
    })
  }

  // Read in the next frame: the answer changes the row's height, and changed in the observer's
  // own turn it would be observed again in the same frame, which is reported as a loop.
  useResizeObserver(root, () => requestAnimationFrame(read))
  // A face that comes in changes the widths without always resizing the row.
  useEventListener(
    typeof document !== 'undefined' && 'fonts' in document ? document.fonts : undefined,
    'loadingdone',
    read,
  )
  // What is offered changes the controls, which resize nothing observed where the row keeps its
  // height; reading again after the answer changed it finds the same answer.
  onUpdated(read)
  onMounted(read)

  return { leads }
}
