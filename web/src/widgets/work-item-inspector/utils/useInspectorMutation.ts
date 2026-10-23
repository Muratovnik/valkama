import { onBeforeUnmount, ref, watch } from 'vue'

import { typedFailure } from '@/shared/api/typedFailure.ts'

export function useInspectorMutation(identity: () => string, changed: () => void) {
  const pending = ref(false)
  const errorKey = ref('')
  let generation = 0
  watch(
    identity,
    () => {
      generation += 1
      errorKey.value = ''
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
    try {
      await operation()
      if (target !== generation) return
      accepted()
      changed()
    } catch (error) {
      if (target !== generation) return
      const failure = typedFailure(error, 'mutation_failed')
      errorKey.value = failure.status === 409 ? 'workItem.editConflict' : 'workItem.editFailed'
    } finally {
      pending.value = false
    }
  }
  return { pending, errorKey, submit }
}
