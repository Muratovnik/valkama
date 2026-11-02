import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { planningRefusal } from '@/shared/api/planningApi.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'

export function useInspectorMutation(identity: () => string, changed: () => void) {
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
  async function submit(operation: () => Promise<unknown>, accepted: () => void = () => {}) {
    if (pending.value) return
    const target = generation
    pending.value = true
    errorKey.value = ''
    errorReason.value = ''
    try {
      await operation()
      if (target !== generation) return
      accepted()
      changed()
    } catch (error) {
      if (target !== generation) return
      const failure = typedFailure(error, 'mutation_failed')
      const refusal = planningRefusal(error)
      const conflict = failure.status === 409 && refusal?.code !== 'workflow_guard'
      errorKey.value = conflict ? 'workItem.editConflict' : 'workItem.editFailed'
      errorReason.value =
        refusal && !conflict && refusal.code !== 'unavailable' ? refusal.message : ''
    } finally {
      pending.value = false
    }
  }
  return { pending, error, submit }
}
