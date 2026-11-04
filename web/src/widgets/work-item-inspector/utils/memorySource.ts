import { inject, provide, ref, watch } from 'vue'
import type { InjectionKey } from 'vue'

import { fetchMemoryProviders } from '@/shared/api/memoryApi.ts'
import type { MemoryProvider } from '@/shared/api/memoryApi.ts'

type MemorySource = ReturnType<typeof readMemorySource>

const MEMORY_SOURCE: InjectionKey<MemorySource> = Symbol('memory-source')

/**
 * Which knowledge source answers for a project, read for as long as its holder lives.
 *
 * Memory read it when it was shown, so it was shown without its source and then filled the
 * source in: one line saying it was being checked, then the provider and its path in its
 * place, and the card's sections, sticking above it, moved for a frame and moved back. A
 * card reads it as it opens instead, as it reads its attempts, so the section stands whole
 * on the frame it is chosen; a Memory with no card around it reads it for itself.
 */
function readMemorySource(projectId: () => string) {
  const located = ref<MemoryProvider>()
  const loading = ref(false)
  const failed = ref(false)
  let request = 0

  async function load(project = projectId()) {
    const asked = ++request
    failed.value = false
    loading.value = Boolean(project)
    if (!project) return
    try {
      const answer = await fetchMemoryProviders()
      if (asked === request)
        located.value = answer.providers.find((entry) => entry.project_id === project)
    } catch {
      if (asked === request) failed.value = true
    } finally {
      if (asked === request) loading.value = false
    }
  }

  watch(
    projectId,
    (project, _previous, onCleanup) => {
      onCleanup(() => {
        request += 1
      })
      located.value = undefined
      void load(project)
    },
    { immediate: true },
  )
  return { failed, load, loading, located }
}

/** The card's own read, for its Memory section whenever that is shown. */
export function provideMemorySource(projectId: () => string) {
  provide(MEMORY_SOURCE, readMemorySource(projectId))
}

/** The read of the card around this section, or one of its own where there is no card. */
export function useMemorySource(projectId: () => string) {
  return inject(MEMORY_SOURCE, null) ?? readMemorySource(projectId)
}
