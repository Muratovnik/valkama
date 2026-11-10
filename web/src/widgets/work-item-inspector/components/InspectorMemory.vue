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
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  memorySourceGap,
  useMemorySource,
} from '@/widgets/work-item-inspector/utils/memorySource.ts'

import { searchMemory } from '@/shared/api/memoryApi.ts'
import type { MemoryResult } from '@/shared/api/memoryApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import { actorName } from '@/shared/lib/actor.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import ScreenLink from '@/shared/ui/ScreenLink.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VDisclosure from '@/shared/ui/VDisclosure.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
  /** Absent in a global scope, where no project answers for this item. */
  projectId: string
  writable: boolean
}>()

const emit = defineEmits<{ attach: [value: { label: string; value: string }] }>()

const { t, d } = useI18n()

const query = ref('')
const busy = ref(false)
const failure = ref('')
const results = ref<readonly MemoryResult[]>([])
const provider = ref('')
const source = ref('')
const capabilities = ref<readonly string[]>([])
const health = ref('')
const reason = ref<{ code: string; message: string } | null>(null)
const searched = ref(false)
const {
  failed: sourceFailed,
  load: loadSource,
  loading: sourceLoading,
  located,
} = useMemorySource(() => props.projectId)
/**
 * Why search cannot answer for this project, in one line, or nothing when it can. The last
 * search knows best; before one, the project's listing does. A project the listing does not
 * name is one Valkama has not registered.
 */
const sourceGap = computed(() => {
  if (sourceLoading.value || !props.projectId) return ''
  if (searched.value)
    return health.value === 'ready' ? '' : memorySourceGap(t, reason.value?.code, reason.value)
  if (sourceFailed.value) return ''
  if (!located.value) return memorySourceGap(t, 'project_unregistered', null)
  return located.value.health === 'ready'
    ? ''
    : memorySourceGap(t, located.value.reason?.code, located.value.reason)
})
/** Diagnostics checks every project's knowledge folder and says how to repair it. */
const diagnostics = computed(() =>
  serializePlatformRoute({
    module_id: 'settings',
    scope: { kind: 'project', project_ref: { project_id: props.projectId } },
    state: { section: 'diagnostics' },
  }),
)
/** The folder a search reads, once it is known. */
const sourceRoot = computed(() => (searched.value && source.value) || located.value?.root || '')

watch(
  () => props.projectId,
  () => {
    searched.value = false
    results.value = []
    provider.value = ''
    source.value = ''
    failure.value = ''
  },
)

/** What is already attached, which is the record rather than the search. */
const attached = computed(() => props.item.refs.filter((entry) => entry.kind === 'memory'))

const searchable = computed(() => Boolean(props.projectId) && query.value.trim().length > 0)

/** What the field says: the folder it searches, once that is known. */
const searchHint = computed(() =>
  sourceRoot.value ? t('memory.searchIn', { root: sourceRoot.value }) : t('memory.searchHint'),
)
const searchHintId = useId()

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
    reason.value = answer.reason
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
    <DataEmptyState
      v-else
      :title="t('memory.none')"
      inline
    />

    <DataEmptyState
      v-if="writable && !projectId"
      :title="t('memory.noProject')"
      inline
    />
    <template v-else-if="writable">
      <DataEmptyState
        v-if="sourceFailed && !searched"
        class="memory-source"
        :title="t('memory.sourceFailed')"
        inline
      >
        <template #action>
          <VButton
            size="inline"
            variant="ghost"
            @click="loadSource()"
            >{{ t('memory.sourceRetry') }}</VButton
          >
        </template>
      </DataEmptyState>
      <DataEmptyState
        v-else-if="sourceGap"
        class="memory-source"
        :title="sourceGap"
        inline
      >
        <template #action>
          <ScreenLink :href="diagnostics">{{ t('memory.openDiagnostics') }}</ScreenLink>
        </template>
      </DataEmptyState>
      <form
        class="memory-form"
        @submit.prevent="search"
      >
        <VTextInput
          v-model="query"
          :label="t('memory.search')"
          :describedby="searchHintId"
          :maxlength="120"
          :disabled="busy"
        />
        <VButton
          type="submit"
          :disabled="!searchable || busy"
        >
          {{ t('memory.searchAction') }}
        </VButton>
        <small
          :id="searchHintId"
          class="memory-hint"
          >{{ searchHint }}</small
        >
      </form>

      <p
        v-if="failure"
        class="memory-error"
        role="alert"
      >
        {{ failure }}
      </p>

      <VDisclosure
        v-if="searched && !failure"
        class="quiet"
      >
        <template #summary>{{ t('memory.technicalDetails') }}</template>
        <p>{{ t('memory.provider', { provider, capabilities: capabilityList }) }}</p>
      </VDisclosure>
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
      <DataEmptyState
        v-else-if="searched && !failure && health === 'ready'"
        :title="t('memory.noResults')"
        inline
      />
    </template>
  </section>
</template>

<style scoped>
.memory {
  display: grid;
  gap: var(--space-heading-content);
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

/* The button lines up with the field's control. Inside the field the hint came
   after the control, so the button stood level with the hint, under what it acts on. */
.memory-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-label-value) var(--space-2);
  align-items: end;
  margin-top: var(--space-heading-content);
}

.memory-hint {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
