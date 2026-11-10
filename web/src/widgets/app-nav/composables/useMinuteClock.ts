import { onScopeDispose, readonly, ref } from 'vue'
import type { Ref } from 'vue'

/** How often the list's times move on. */
export const MINUTE_MS = 60_000

const now = ref(Date.now())
let readers = 0
let timer: ReturnType<typeof setInterval> | undefined

/**
 * The time the side panel's rows count how long from: one clock for every row of every list
 * on the page, which moves once a minute while any row reads it and stops with the last. A
 * row only says how long in whole minutes or hours, so a tick changes words and nothing else:
 * the list is ordered by the frame's times, never by this one.
 */
export function useMinuteClock(): Readonly<Ref<number>> {
  if (readers === 0) {
    now.value = Date.now()
    timer = setInterval(() => (now.value = Date.now()), MINUTE_MS)
  }
  readers += 1
  onScopeDispose(() => {
    readers -= 1
    if (readers > 0) return
    clearInterval(timer)
    timer = undefined
  })
  return readonly(now)
}
