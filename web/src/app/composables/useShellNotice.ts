/**
 * The one message the shell shows at the window's corner, and what can be done
 * about it.
 *
 * It was a bare string that nothing ever cleared: «Data refreshed» from the
 * morning stayed there all day, and a notice that needed an answer had no way
 * to offer one. Each writer now says which kind it has. What was done goes by
 * itself (`useNoticeCountdown`); a refusal and a notice with an action stay until
 * the operator puts them away or takes the action. The next notice replaces either.
 */

import { shallowRef } from 'vue'

import type { NoticeKind } from '@/shared/lib/notice.ts'

export interface ShellNoticeAction {
  label: string
  run: () => void
}

export interface ShellNotice {
  kind: NoticeKind
  message: string
  action?: ShellNoticeAction
}

export function useShellNotice() {
  const current = shallowRef<ShellNotice | null>(null)

  function say(message: string, kind: NoticeKind, action?: ShellNoticeAction) {
    current.value = { kind, message, ...(action ? { action } : {}) }
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

  return { act, current, dismiss, say }
}
