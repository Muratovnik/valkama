/**
 * The one message the shell shows at the window's corner, and what can be done
 * about it.
 *
 * It was a bare string that nothing ever cleared: «Data refreshed» from the
 * morning stayed there all day, and a notice that needed an answer had no way
 * to offer one. A notice now carries an optional action and is dismissed — by
 * the operator, by taking its action, or by the next notice, which replaces it.
 *
 * `message` keeps the old shape for the many writers that only have words: a
 * string written there is a notice without an action, and an empty one clears it.
 */

import { computed, shallowRef } from 'vue'

export interface ShellNoticeAction {
  label: string
  run: () => void
}

export interface ShellNotice {
  message: string
  action?: ShellNoticeAction
}

export function useShellNotice() {
  const current = shallowRef<ShellNotice | null>(null)

  function say(message: string, action?: ShellNoticeAction) {
    current.value = message ? { message, ...(action ? { action } : {}) } : null
  }

  function dismiss() {
    current.value = null
  }

  /** Take the notice's action; the notice has been answered, so it goes. */
  function act() {
    const action = current.value?.action
    dismiss()
    action?.run()
  }

  const message = computed({
    get: () => current.value?.message ?? '',
    set: (value: string) => say(value),
  })

  return { act, current, dismiss, message, say }
}
