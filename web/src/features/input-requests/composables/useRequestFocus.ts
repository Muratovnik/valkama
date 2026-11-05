import type { Ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { revealFrame } from '@/shared/lib/revealFrame.ts'

/** Where focus goes within one question, whose card is `card`. */
export function useRequestFocus(card: Ref<HTMLElement | null>) {
  /** Moves focus to this question's heading, or to the question where it has none. */
  function focus() {
    moveFocus(card.value?.querySelector<HTMLElement>('.request-title') ?? card.value)
  }
  /** Moves focus to how this question ended, or to the question while it still waits. */
  function focusOutcome() {
    const line = card.value?.querySelector<HTMLElement>('.request-state')
    if (line) moveFocus(line)
    else focus()
  }
  /**
   * Brings the question into view, at its first line under what the scroller keeps over
   * its top, with the keyboard at its first control. Focus alone would scroll the control
   * to the far edge and leave the prompt out of sight.
   */
  function reveal() {
    const root = card.value
    const control =
      root?.querySelector<HTMLElement>('input:checked:not(:disabled)') ??
      root?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)')
    ;(control ?? root)?.focus({ preventScroll: true })
    revealFrame(root)
  }
  const holdsFocus = () => card.value?.contains(document.activeElement) ?? false
  return { focus, focusOutcome, holdsFocus, reveal }
}
