import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { planningRefusal } from '@/shared/api/planningApi.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'

/**
 * A write of a card's section, and why the last one did not go through.
 *
 * `pending` holds from the press until the card has been read again after a write that went
 * through, as the card's own writes hold (`useInspectorWrites`): until then the card still
 * shows what the write changed as it was — a thread still marked, a report not yet the
 * outcome — and a control enabled over it would send the same write a second time.
 */
export function useInspectorMutation(identity: () => string, reread: () => Promise<unknown>) {
  const { t } = useI18n()
  const pending = ref(false)
  const errorKey = ref('')
  /**
   * The server's own reason when it refused the write for something other than
   * a newer revision — a length limit, a closed item — which the generic "could
   * not be saved" sentence used to stand in for.
   */
  const errorReason = ref('')
  /** Why the last write did not go through, as one sentence; empty when it did. */
  const error = computed(() =>
    errorKey.value ? [t(errorKey.value), errorReason.value].filter(Boolean).join(' ') : '',
  )
  let generation = 0
  watch(
    identity,
    () => {
      generation += 1
      errorKey.value = ''
      errorReason.value = ''
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(() => {
    generation += 1
  })
  /**
   * Answers once the wait has ended, whether the write went through: what it disabled can take
   * focus again from then on.
   */
  async function submit(
    operation: () => Promise<unknown>,
    accepted: () => void = () => {},
  ): Promise<boolean> {
    if (pending.value) return false
    const target = generation
    pending.value = true
    errorKey.value = ''
    errorReason.value = ''
    try {
      await operation()
      if (target !== generation) return false
      accepted()
      await reread()
      return true
    } catch (error) {
      if (target !== generation) return false
      const failure = typedFailure(error, 'mutation_failed')
      const refusal = planningRefusal(error)
      const conflict = failure.status === 409 && refusal?.code !== 'workflow_guard'
      errorKey.value = conflict ? 'workItem.editConflict' : 'workItem.editFailed'
      errorReason.value =
        refusal && !conflict && refusal.code !== 'unavailable' ? refusal.message : ''
      return false
    } finally {
      pending.value = false
    }
  }
  return { pending, error, submit }
}
