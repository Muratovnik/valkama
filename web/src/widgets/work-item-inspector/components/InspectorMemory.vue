<script setup lang="ts">
/**
 * The knowledge this item points at, and a way to point it at more.
 *
 * Two halves that answer to different owners. The attached pointers are
 * Valkama's own record — a ref on the work item — and survive a provider being
 * down, which is why the label is kept beside the id. The search half belongs
 * to whichever provider answers for this project, and the buttons it offers are
 * exactly the capabilities that provider declared: a Markdown folder can be
 * searched and read and cannot be written, and a view that rendered a save
 * button anyway would be pretending it was a different kind of source.
 *
 * Nothing here copies content. A snippet is what matched, not the record: a
 * product that keeps a second copy of somebody's knowledge holds a stale one,
 * and the moment the two disagree the copy is the one nobody distrusts.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchMemoryProviders, searchMemory } from '@/shared/api/memoryApi.ts'
import type { MemoryResult } from '@/shared/api/memoryApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import type { PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { actorName } from '@/shared/lib/actor.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
  /** Absent in a global scope, where no project answers for this item. */
  projectId: string
  writable: boolean
  registry?: PlatformRegistryReady | null
}>()

const emit = defineEmits<{ attach: [value: { label: string; value: string }] }>()

const { t, d, te } = useI18n()

const query = ref('')
const busy = ref(false)
const failure = ref('')
const results = ref<readonly MemoryResult[]>([])
const provider = ref('')
const source = ref('')
const capabilities = ref<readonly string[]>([])
const health = ref('')
const reason = ref('')
const searched = ref(false)
const sourceLoading = ref(false)
const sourceFailed = ref(false)
const located = ref<Awaited<ReturnType<typeof fetchMemoryProviders>>['providers'][number]>()
const reference = computed(() =>
  props.registry?.capabilities.find((entry) => entry.capability.capability_id === 'memory.open'),
)
const referenceName = computed(() => {
  const identity = reference.value?.assignment?.connection_ids[0]
  const connection = props.registry?.connections.find((entry) => {
    const ref = entry.connection_ref
    return (
      `${ref.service_ref.owner_id}:${ref.service_ref.service_id}:${ref.adapter_lineage_id}:${ref.connection_id}` ===
      identity
    )
  })
  if (!connection) return t('memory.noProvider')
  if (
    connection.service.owner_id === 'agentmemory' &&
    connection.service.service_id === 'local-reference-service'
  )
    return 'AgentMemory'
  return te(connection.name) ? t(connection.name) : connection.service.service_id
})
const workspaceSettings = computed(() =>
  serializePlatformRoute({
    module_id: 'settings',
    scope: props.projectId
      ? { kind: 'project', project_ref: { project_id: props.projectId } }
      : { kind: 'global' },
    state: { section: 'workspace' },
  }),
)
const activeProvider = computed(() => provider.value || located.value?.provider_id || '')
const providerName = computed(() =>
  activeProvider.value === 'markdown-knowledge'
    ? t('memory.markdownProvider')
    : activeProvider.value,
)
const sourceUnavailable = computed(
  () => (searched.value ? health.value : located.value?.health) === 'unavailable',
)

let sourceRequest = 0

async function loadSource(projectId = props.projectId) {
  const request = ++sourceRequest
  sourceFailed.value = false
  sourceLoading.value = Boolean(projectId)
  if (!projectId) return
  try {
    const answer = await fetchMemoryProviders()
    if (request === sourceRequest)
      located.value = answer.providers.find((entry) => entry.project_id === projectId)
  } catch {
    if (request === sourceRequest) sourceFailed.value = true
  } finally {
    if (request === sourceRequest) sourceLoading.value = false
  }
}

watch(
  () => props.projectId,
  (projectId, _previous, onCleanup) => {
    onCleanup(() => {
      sourceRequest += 1
    })
    located.value = undefined
    searched.value = false
    results.value = []
    provider.value = ''
    source.value = ''
    failure.value = ''
    void loadSource(projectId)
  },
  { immediate: true },
)

/** What is already attached, which is the record rather than the search. */
const attached = computed(() => props.item.refs.filter((entry) => entry.kind === 'memory'))

const searchable = computed(() => Boolean(props.projectId) && query.value.trim().length > 0)

/** What the field says: where it searches, or why it cannot. */
const searchHint = computed(() =>
  props.projectId ? t('memory.searchHint') : t('memory.noProject'),
)

/** The provider's own capability list, as one readable line. */
const capabilityList = computed(() => capabilities.value.join(', '))

/** Only what the provider said it can do; nothing is offered on assumption. */
const canOpen = computed(() => capabilities.value.includes('memory.open'))

async function search() {
  if (!searchable.value || busy.value) return
  busy.value = true
  const searchedProject = props.projectId
  failure.value = ''
  try {
    const answer = await searchMemory(searchedProject, query.value.trim())
    if (props.projectId !== searchedProject) return
    results.value = answer.results
    provider.value = answer.provider_id
    source.value = answer.root
    capabilities.value = answer.capabilities
    health.value = answer.health
    reason.value = answer.reason?.message ?? ''
    searched.value = true
  } catch (error) {
    if (props.projectId !== searchedProject) return
    results.value = []
    failure.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <section class="memory">
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('memory.heading') }}</SectionHeading
    >
    <p class="quiet">{{ t('memory.intro') }}</p>

    <div
      v-if="projectId"
      class="memory-source"
    >
      <strong class="memory-label">{{ t('memory.searchProvider') }}</strong>
      <p class="quiet">{{ t('memory.documentSource', { project: projectId }) }}</p>
      <p
        v-if="providerName"
        class="quiet"
      >
        {{ providerName }}
      </p>
      <p
        v-if="located?.root"
        class="memory-id"
      >
        {{ located.root }}
      </p>
      <p
        v-if="sourceLoading"
        class="quiet"
      >
        {{ t('memory.sourcePending') }}
      </p>
      <p
        v-else-if="sourceFailed"
        class="memory-error"
      >
        {{ t('memory.sourceFailed') }}
      </p>
      <p
        v-else-if="sourceUnavailable"
        class="memory-error"
      >
        {{ reason || located?.reason?.message || t('memory.unavailable') }}
      </p>
      <VButton
        v-if="sourceFailed"
        @click="loadSource()"
        >{{ t('memory.sourceRetry') }}</VButton
      >
      <p class="quiet">{{ t('memory.sourceSetup') }}</p>
      <template v-if="registry">
        <strong class="memory-label">{{ t('memory.referenceProvider') }}</strong>
        <p class="quiet">
          {{
            t('memory.referenceSelection', {
              provider: referenceName,
              source: t(`memory.referenceScope.${reference?.source ?? 'unavailable'}`),
            })
          }}
        </p>
        <p
          v-if="reference?.state !== 'ready'"
          class="quiet"
        >
          {{ t('memory.referenceUnavailable') }}
        </p>
      </template>
      <a
        class="memory-settings-link"
        :href="workspaceSettings"
        >{{ t('memory.workspaceSettings') }}</a
      >
    </div>

    <ul
      v-if="attached.length"
      class="memory-list"
    >
      <li
        v-for="entry in attached"
        :key="`${entry.value}-${entry.at}`"
        class="memory-row"
      >
        <span class="memory-label">{{ entry.label || entry.value }}</span>
        <span class="memory-id">{{ entry.value }}</span>
        <span class="memory-meta">{{
          t('workItem.refAttached', { author: actorName(entry.author), at: when(entry.at) })
        }}</span>
      </li>
    </ul>
    <p
      v-else
      class="quiet"
    >
      {{ t('memory.none') }}
    </p>

    <template v-if="writable">
      <form
        class="memory-form"
        @submit.prevent="search"
      >
        <VTextInput
          v-model="query"
          :label="t('memory.search')"
          :hint="searchHint"
          :maxlength="120"
          :disabled="!projectId || busy"
        />
        <VButton
          type="submit"
          :disabled="!searchable || busy"
        >
          {{ t('memory.searchAction') }}
        </VButton>
      </form>

      <p
        v-if="failure"
        class="memory-error"
        role="alert"
      >
        {{ failure }}
      </p>
      <p
        v-else-if="searched"
        class="quiet"
      >
        {{ t('memory.source', { source: source || providerName }) }}
        <span v-if="health !== 'ready'"> · {{ reason || t('memory.unavailable') }}</span>
      </p>

      <details
        v-if="searched && !failure"
        class="quiet"
      >
        <summary>{{ t('memory.technicalDetails') }}</summary>
        <p>{{ t('memory.provider', { provider, capabilities: capabilityList }) }}</p>
        <p>{{ source }}</p>
      </details>
      <ul
        v-if="results.length"
        class="memory-results"
      >
        <li
          v-for="entry in results"
          :key="entry.external_id"
          class="memory-result"
        >
          <span class="memory-label">{{ entry.label }}</span>
          <span class="memory-id">{{ entry.external_id }}</span>
          <span
            v-if="entry.snippet"
            class="memory-snippet"
            >{{ entry.snippet }}</span
          >
          <VButton
            :disabled="!canOpen"
            @click="emit('attach', { value: entry.external_id, label: entry.label })"
          >
            {{ t('memory.attach') }}
          </VButton>
        </li>
      </ul>
      <p
        v-else-if="searched && !failure && health === 'ready'"
        class="quiet"
      >
        {{ t('memory.noResults') }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.memory {
  display: grid;
  gap: var(--space-heading-content);
}

.memory-source {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);
}

.memory-settings-link {
  width: fit-content;
  color: var(--color-accent);
  font: var(--font-note);
}

.quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.memory-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-note);
}

.memory-list,
.memory-results {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.memory-row,
.memory-result {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.memory-label {
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
}

.memory-id {
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.memory-snippet {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.memory-meta {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.memory-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: end;
  margin-top: var(--space-heading-content);
}
</style>
