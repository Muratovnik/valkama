import type { Ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { revealFrame } from '@/shared/lib/revealFrame.ts'

/**
 * Where focus goes within one question, whose card is `card`.
 *
 * The app takes focus to the question as a whole, and never to one of its lines of words: a
 * ring drawn round one line stood as a thin capsule pressed against the words. The line that
 * says why focus came (how the question ended, its deadline, its title in the list) names or
 * describes the question instead, and is what is brought into view.
 */
export function useRequestFocus(card: Ref<HTMLElement | null>) {
  /** Moves focus to the question and brings `line` into view, or the question where it has none. */
  function focusOn(line: HTMLElement | null | undefined) {
    moveFocus(card.value, { preventScroll: true })
    ;(line ?? card.value)?.scrollIntoView({ block: 'nearest' })
  }
  /** Moves focus to this question, with its title in view where it has one. */
  function focus() {
    focusOn(card.value?.querySelector<HTMLElement>('.request-title'))
  }
  /** Moves focus to the question, with how it ended in view; as `focus` while it still waits. */
  function focusOutcome() {
    const line = card.value?.querySelector<HTMLElement>('.request-state')
    if (line) focusOn(line)
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
  return { focus, focusOn, focusOutcome, holdsFocus, reveal }
}
