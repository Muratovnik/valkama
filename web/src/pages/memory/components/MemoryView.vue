<script setup lang="ts">
/**
 * The Memory module's screen: knowledge Valkama points at and does not own.
 *
 * Two scopes answering two different questions. Globally there is no single
 * knowledge root, so the page shows the mapping — which provider answers for
 * which project and which of them cannot be asked — and picking one is what
 * moves the scope. Inside a project there is a root, so the page searches it
 * and lists what the project's work already points at.
 *
 * The linked half loads either way and the search half does not, which is the
 * asymmetry worth keeping visible: an attached pointer is Valkama's own record
 * and still reads when every provider on the machine is unreachable.
 */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'

import MemoryLinks from '@/pages/memory/components/MemoryLinks.vue'
import MemoryProviders from '@/pages/memory/components/MemoryProviders.vue'
import MemorySearchPanel from '@/pages/memory/components/MemorySearchPanel.vue'

import { fetchMemoryLinks, fetchMemoryProviders } from '@/shared/api/memoryApi.ts'
import type { MemoryLink, MemoryProvider } from '@/shared/api/memoryApi.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import {
  MAX_UI_STATE_REASON_LENGTH,
  uiDegraded,
  uiError,
  uiLoading,
  uiReady,
} from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import type { WorkItemNavigationTarget } from '@/shared/types/reference.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{ query: string; scope: OperatingScope }>()

const emit = defineEmits<{
  'open-project': [projectId: string]
  'open-work-item': [target: WorkItemNavigationTarget]
  'state': [state: Record<string, string>]
}>()

interface Observed<T> {
  at: string
  value: T
}

const providersResource = ref(createResource<Observed<readonly MemoryProvider[]>>()) as Ref<
  ResourceState<Observed<readonly MemoryProvider[]>>
>
const linksResource = ref(
  createResource<Observed<{ links: readonly MemoryLink[]; truncated: boolean }>>(),
) as Ref<ResourceState<Observed<{ links: readonly MemoryLink[]; truncated: boolean }>>>

/** Empty in a global scope, where no single project answers. */
const projectId = computed(() =>
  props.scope.kind === 'project' ? props.scope.project_ref.project_id : '',
)

/**
 * One state for the whole screen.
 *
 * Both reads happen together and neither is optional, so a partial screen would
 * be a screen that looks complete while half of it is missing.
 */
const activeKey = computed(() =>
  projectId.value ? JSON.stringify(['links', projectId.value]) : 'providers',
)

function failureText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_UI_STATE_REASON_LENGTH,
  )
}

function viewState<T>(resource: ResourceState<Observed<T>>, key: string): PlatformUiState<true> {
  const current = resource.key === key ? resource.data : null
  if (current === null)
    return resource.status === 'error' ? uiError(resource.error ?? '') : uiLoading()
  if (resource.status === 'ready') return uiReady(true)
  return uiDegraded(true, current.at, resource.error ?? undefined)
}

const state = computed(() =>
  projectId.value
    ? viewState(linksResource.value, activeKey.value)
    : viewState(providersResource.value, activeKey.value),
)
const providers = computed(() =>
  providersResource.value.key === 'providers' ? (providersResource.value.data?.value ?? []) : [],
)
const currentLinks = computed(() =>
  linksResource.value.key === activeKey.value ? linksResource.value.data?.value : null,
)

async function load() {
  const key = activeKey.value
  if (projectId.value) {
    const requestedProject = projectId.value
    linksResource.value = beginResource(linksResource.value, key)
    const generation = linksResource.value.generation
    try {
      const answer = await fetchMemoryLinks(requestedProject)
      linksResource.value = resolveResource(linksResource.value, generation, key, {
        value: { links: answer.links, truncated: answer.truncated },
        at: new Date().toISOString(),
      })
    } catch (error) {
      linksResource.value = rejectResource(linksResource.value, generation, key, failureText(error))
    }
    return
  }
  providersResource.value = beginResource(providersResource.value, key)
  const generation = providersResource.value.generation
  try {
    const answer = await fetchMemoryProviders()
    providersResource.value = resolveResource(providersResource.value, generation, key, {
      value: answer.providers,
      at: new Date().toISOString(),
    })
  } catch (error) {
    providersResource.value = rejectResource(
      providersResource.value,
      generation,
      key,
      failureText(error),
    )
  }
}

watch(projectId, load, { immediate: true })
</script>

<template>
  <div class="memory-page">
    <PlatformStatePanel
      :state="state"
      @retry="load"
    >
      <template v-if="projectId">
        <MemorySearchPanel
          :project-id="projectId"
          :query="query"
          @state="(next) => emit('state', next)"
        />
        <MemoryLinks
          :links="currentLinks?.links ?? []"
          :truncated="currentLinks?.truncated ?? false"
          @open-work-item="(target) => emit('open-work-item', target)"
        />
      </template>
      <MemoryProviders
        v-else
        :providers="providers"
        @open="(id) => emit('open-project', id)"
      />
    </PlatformStatePanel>
  </div>
</template>

<style scoped>
.memory-page {
  display: grid;
  gap: var(--space-8);
  min-width: 0;
  padding-block-end: var(--space-8);
}
</style>
