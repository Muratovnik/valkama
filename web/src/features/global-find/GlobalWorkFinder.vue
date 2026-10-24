<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { GlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import CommandList from '@/shared/ui/CommandList.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; select: [target: PlanningTarget] }>()
const { t } = useI18n()
const query = ref('')
const retry = ref(0)
const loading = ref(false)
const failed = ref(false)
const result = ref<GlobalPlanningSearch | null>(null)
const unavailable = computed(
  () => result.value?.coverage.filter((entry) => entry.status === 'unavailable') ?? [],
)
const hasQuery = computed(() => Boolean(query.value.trim()))
const emptyMessage = computed(() =>
  t(unavailable.value.length ? 'finder.partialEmpty' : 'finder.empty'),
)
const choices = computed(() =>
  (result.value?.items ?? []).map((entry) => ({
    key: `${entry.target.project_id}:${entry.target.space_ref.data_scope_id}:${entry.item.work_item_id}`,
    title: entry.item.title,
    detail: [
      entry.target.project_id,
      entry.item.reference,
      entry.item.state.name,
      ...(entry.target.writable ? [] : [t('finder.readonly')]),
    ].join(' · '),
  })),
)
function selectKey(key: string) {
  const index = choices.value.findIndex((entry) => entry.key === key)
  const entry = result.value?.items[index]
  if (entry) select(entry.target)
}

watch(
  [query, () => props.open, retry],
  ([text, open], _previous, cleanup) => {
    result.value = null
    failed.value = false
    loading.value = false
    if (!open || !text.trim()) return
    const controller = new AbortController()
    let current = true
    loading.value = true
    const timer = setTimeout(() => {
      void searchGlobalPlanningWorkItems(text.trim(), controller.signal)
        .then((response) => {
          if (current) result.value = response
        })
        .catch(() => {
          if (current) failed.value = true
        })
        .finally(() => {
          if (current) loading.value = false
        })
    }, 250)
    cleanup(() => {
      current = false
      clearTimeout(timer)
      controller.abort()
    })
  },
  { immediate: true, flush: 'sync' },
)

function select(target: PlanningTarget) {
  if (!props.open || loading.value) return
  emit('select', target)
}
</script>

<template>
  <DialogFrame
    :open="open"
    :title="t('finder.title')"
    :subtitle="t('finder.scope')"
    :close-label="t('finder.close')"
    @close="emit('close')"
  >
    <CommandList
      v-if="open"
      v-model:query="query"
      :label="t('finder.searchLabel')"
      :placeholder="t('finder.placeholder')"
      :results-label="t('finder.results')"
      :items="choices"
      :loading="loading"
      @select="selectKey"
    >
      <template #feedback>
        <div
          class="finder-feedback"
          role="status"
          aria-live="polite"
        >
          <p v-if="loading">{{ t('finder.loading') }}</p>
          <p v-else-if="failed">{{ t('finder.error') }}</p>
          <p v-else-if="!hasQuery">{{ t('finder.prompt') }}</p>
          <p v-else-if="result && !result.items.length">
            {{ emptyMessage }}
          </p>
          <p v-if="result?.items.length && unavailable.length">{{ t('finder.partial') }}</p>
          <p v-if="result?.has_more">{{ t('finder.truncated') }}</p>
        </div>
        <VButton
          v-if="failed"
          variant="secondary"
          @click="retry++"
          >{{ t('finder.retry') }}</VButton
        >
      </template>
    </CommandList>
    <ul
      v-if="unavailable.length"
      class="finder-coverage"
    >
      <li
        v-for="entry in unavailable"
        :key="`${entry.project_id}:${entry.space_ref.data_scope_id}:${entry.space_ref.space_key}`"
      >
        {{
          t('finder.unavailable', { project: entry.project_id, space: entry.space_ref.space_key })
        }}
      </li>
    </ul>
    <p class="finder-keyboard">{{ t('finder.keyboard') }}</p>
  </DialogFrame>
</template>

<style scoped>
.finder-feedback {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.finder-coverage {
  padding-inline-start: var(--space-5);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.finder-keyboard {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}
</style>
