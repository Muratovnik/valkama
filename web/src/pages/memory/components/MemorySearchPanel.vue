<script setup lang="ts">
/**
 * Searching one project's knowledge, and saying which folder answered.
 *
 * The half of the page that needs a provider. What comes back is a pointer, a
 * label and the line that matched — never the document. A product that keeps a
 * second copy of somebody's knowledge holds a stale one, and the moment the two
 * disagree the copy is the one nobody distrusts (§16.6).
 *
 * The capabilities the provider declares are shown rather than assumed, and no
 * button appears for one it does not name. A Markdown folder can be searched
 * and read and cannot be written; a view that rendered a save button anyway
 * would be pretending it was a different kind of source.
 */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { searchMemory } from '@/shared/api/memoryApi.ts'
import type { MemorySearch } from '@/shared/api/memoryApi.ts'
import { uiReady } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  cancelResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{ projectId: string; query: string }>()

const emit = defineEmits<{ state: [state: Record<string, string>] }>()

const { t, te } = useI18n()

const draft = ref(props.query)
const resource = ref(createResource<Observed<MemorySearch>>()) as Ref<
  ResourceState<Observed<MemorySearch>>
>
const intentKey = computed(() => searchKey(props.projectId, props.query))
const state = computed(() =>
  resourceUiState(resource.value, {
    failureReason: memoryFailureReason,
  }),
)
const answer = computed(() => {
  const observed = resource.value.key === intentKey.value ? resource.value.data : null
  return observed?.state.status === 'ready' ? observed.state.payload : null
})
const hasQuery = computed(() => Boolean(props.query.trim()))
const busy = computed(() => resource.value.pendingKey === intentKey.value)
const retryable = computed(() => resource.value.failure?.retryable ?? false)
const results = computed(() => answer.value?.results ?? [])
const provider = computed(() => answer.value?.provider_id ?? '')
const root = computed(() => answer.value?.root ?? '')
const capabilities = computed(() => answer.value?.capabilities ?? [])
const health = computed(() => answer.value?.health ?? '')
const reason = computed(() => {
  const code = answer.value?.reason?.code
  if (!code) return ''
  const key = `memoryPage.providers.reason.${code}`
  return te(key) ? t(key) : t('memory.unavailable')
})
const truncated = computed(() => answer.value?.truncated ?? false)

/** Nothing to search for, or a search already running. */
const blocked = computed(() => busy.value || draft.value.trim().length === 0)

/** What this provider declares it can do, as one readable line. */
const capabilityList = computed(() => capabilities.value.join(' · '))

/** Typed transport failures become catalog copy; provider text never crosses this boundary. */
function memoryFailureReason(failure: TypedFailure): string {
  const message = failureMessage(failure)
  return message.key === 'platform.failures.unknown'
    ? t('memoryPage.search.failed')
    : t(message.key, message.params ?? {})
}

/**
 * Which request is current.
 *
 * A slow search that returns after a newer one would otherwise replace the
 * newer results with older ones, and the field would read as if it had ignored
 * what was typed last.
 */
function searchKey(projectId: string, query: string): string {
  return JSON.stringify([projectId, query.trim()])
}

async function load(projectId: string, query: string) {
  const text = query.trim()
  if (!text) {
    resource.value = cancelResource(resource.value)
    return
  }
  const key = searchKey(projectId, text)
  resource.value = beginResource(resource.value, key)
  const generation = resource.value.generation
  try {
    const next = await searchMemory(projectId, text)
    resource.value = resolveResource(resource.value, generation, key, {
      at: new Date().toISOString(),
      state: uiReady(next),
    })
  } catch (error) {
    resource.value = rejectResource(
      resource.value,
      generation,
      key,
      typedFailure(error, 'memory_search_failed'),
    )
  }
}

function retry() {
  void load(props.projectId, props.query)
}

function run() {
  const query = draft.value.trim()
  if (!query || busy.value) return
  if (query === props.query.trim()) void load(props.projectId, query)
  else emit('state', { query })
}

watch(
  [() => props.projectId, () => props.query],
  ([projectId, query]) => {
    draft.value = query
    void load(projectId, query)
  },
  { immediate: true },
)
</script>

<template>
  <section class="memory-search">
    <header>
      <SectionHeading as="h3">{{ t('memoryPage.search.heading') }}</SectionHeading>
      <p class="memory-quiet">{{ t('memoryPage.search.intro') }}</p>
    </header>

    <form
      class="search-row"
      @submit.prevent="run"
    >
      <VTextInput
        v-model="draft"
        :label="t('memoryPage.search.label')"
        :placeholder="t('memoryPage.search.placeholder')"
      />
      <VButton
        type="submit"
        :disabled="blocked"
      >
        {{ t('memoryPage.search.action') }}
      </VButton>
    </form>

    <PlatformStatePanel
      v-if="hasQuery"
      :state="state"
      :retryable="retryable"
      compact
      @retry="retry"
    >
      <template #default>
        <div
          v-if="state.status === 'degraded' && state.reason && retryable"
          class="search-recovery"
        >
          <VButton
            variant="ghost"
            @click="retry"
          >
            {{ t('platform.actions.retry') }}
          </VButton>
        </div>
        <div class="search-provider">
          <SemanticState
            dimension="integration-health"
            :state="health"
            :label="provider"
            compact
          />
          <span
            v-if="root"
            class="memory-quiet"
            >{{ root }}</span
          >
          <span
            v-else-if="reason"
            class="memory-quiet"
            >{{ reason }}</span
          >
        </div>
        <p class="memory-quiet">{{ capabilityList }}</p>

        <DataEmptyState
          v-if="results.length === 0"
          :title="t('memoryPage.search.noResults')"
          :description="t('memoryPage.search.noResultsDetail')"
          compact
        />
        <ul
          v-else
          class="result-list"
        >
          <li
            v-for="result in results"
            :key="`${result.connection_id}:${result.external_id}`"
            class="result-row"
          >
            <span class="result-label">{{ result.label }}</span>
            <span class="memory-quiet">{{ result.external_id }}</span>
            <p
              v-if="result.snippet"
              class="result-snippet"
            >
              {{ result.snippet }}
            </p>
          </li>
        </ul>
        <p
          v-if="truncated"
          class="memory-quiet"
        >
          {{ t('memoryPage.search.truncated') }}
        </p>
      </template>
    </PlatformStatePanel>
  </section>
</template>

<style scoped>
.memory-search {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.memory-quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: end;
}

.search-recovery {
  display: flex;
  justify-content: flex-end;
}

.search-provider {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: baseline;
  min-width: 0;
}

.result-list {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

.result-row {
  display: grid;
  gap: var(--space-hair);
  min-width: 0;
}

.result-label {
  color: var(--color-text);
  font: var(--font-row-title);
  overflow-wrap: anywhere;
}

.result-snippet {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
