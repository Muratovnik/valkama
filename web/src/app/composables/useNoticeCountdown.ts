/**
 * How long what was done stays at the window's corner, as Radix and Reka UI Toast keep it:
 * five seconds of a person being able to see it. The time stands while the pointer or the
 * focus is on the notice, and while the window is not in focus, which matters from before
 * the notice appears: opening a session hands the focus to the editor, and these seconds
 * start when the person comes back. What remains carries on rather than starting over; the
 * next notice does start over.
 *
 * Reka UI's own Toast is not used for this much: it brings its own region and viewport, and
 * the shell's status region is the one thing that has to stay as it is.
 */
import { computed, onScopeDispose, ref, watch } from 'vue'

import { useWindowFocus } from '@vueuse/core'

import type { ShellNotice } from '@/app/composables/useShellNotice.ts'

const SHOWN_FOR_MS = 5000

export function useNoticeCountdown(notice: () => ShellNotice | null, expire: () => void) {
  const windowFocused = useWindowFocus()
  const hovered = ref(false)
  const focused = ref(false)
  const held = computed(() => !windowFocused.value || hovered.value || focused.value)

  /** Of the notice shown, or null when nothing shown goes by itself. */
  let remaining: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let startedAt = 0

  function stop() {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    remaining = Math.max(0, (remaining ?? 0) - (Date.now() - startedAt))
  }

  function start() {
    if (remaining === null || timer !== undefined || held.value) return
    startedAt = Date.now()
    timer = setTimeout(() => {
      timer = undefined
      remaining = null
      expire()
    }, remaining)
  }

  watch(
    notice,
    (shown) => {
      stop()
      if (!shown) {
        // The box that held the pointer or the focus has gone, and says no more of either.
        hovered.value = false
        focused.value = false
      }
      remaining = shown?.kind === 'done' && !shown.action ? SHOWN_FOR_MS : null
      start()
    },
    { immediate: true },
  )
  watch(held, (nowHeld) => {
    if (nowHeld) stop()
    else start()
  })
  onScopeDispose(stop)

  return { focused, hovered }
}
