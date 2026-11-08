<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { createWorkItem, linkWorkItems } from '@/shared/api/planningApi.ts'
import { LINK_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import type { PlanningSearchResult } from '@/shared/api/planningSearchApi.ts'
import { holderName } from '@/shared/lib/actor.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  initialDirection: WorkItem['links'][number]['direction']
  initialKind: WorkItem['links'][number]['kind']
  item: WorkItem
  open: boolean
  writable: boolean
}>()
const emit = defineEmits<{ changed: []; close: []; open: [reference: string] }>()
const { t } = useI18n()
const kind = ref(props.initialKind)
const direction = ref(props.initialDirection)
const mode = ref('existing')
const query = ref('')
const title = ref('')
const selectedId = ref('')
const results = ref<PlanningSearchResult[]>([])
const searching = ref(false)
const busy = ref(false)
const error = ref('')
const searchError = ref('')
const created = ref<WorkItem | null>(null)
const kindOptions = computed(() =>
  LINK_KINDS.map((value) => ({ value, label: t(`workItem.link.${value}`) })),
)
const directionOptions = computed(() =>
  ['outgoing', 'incoming'].map((value) => ({ value, label: t(`workItem.related.${value}`) })),
)
const modeOptions = computed(() =>
  ['existing', 'new'].map((value) => ({ value, label: t(`workItem.related.${value}`) })),
)
const eligible = computed(() =>
  results.value.filter(
    (candidate) =>
      candidate.work_item_id !== props.item.work_item_id &&
      candidate.planning_space_id === props.item.planning_space_id &&
      !props.item.links.some(
        (link) =>
          link.work_item_id === candidate.work_item_id &&
          link.kind === kind.value &&
          link.direction === direction.value,
      ),
  ),
)
const selected = computed(() =>
  eligible.value.find((candidate) => candidate.work_item_id === selectedId.value),
)
const ready = computed(
  () =>
    props.writable &&
    !busy.value &&
    Boolean(created.value || (mode.value === 'new' ? title.value.trim() : selected.value)),
)
const hasQuery = computed(() => Boolean(query.value.trim()))
const submitLabel = computed(() => {
  if (created.value) return t('workItem.related.retryLink')
  if (mode.value === 'new') return t('workItem.related.createLink')
  return t('workItem.linkAdd')
})
const frozen = computed(() => busy.value || Boolean(created.value) || !props.writable)

watch(
  () => props.open,
  (open) => {
    if (!open || created.value) return
    kind.value = props.initialKind
    direction.value = props.initialDirection
  },
)

watch(
  [query, mode, () => props.open, () => props.item.work_item_id],
  ([text, currentMode, open, identity], previous, cleanup) => {
    searching.value = false
    if (!open) return
    results.value = []
    if (text !== previous[0] || currentMode !== previous[1] || identity !== previous[3]) {
      selectedId.value = ''
    }
    searchError.value = ''
    if (currentMode !== 'existing' || !text.trim()) return
    const controller = new AbortController()
    let current = true
    searching.value = true
    const timer = setTimeout(() => {
      void searchPlanningWorkItems(text.trim(), props.item.planning_space_id, controller.signal)
        .then((items) => {
          if (current) results.value = items
        })
        .catch((error_: unknown) => {
          if (current) searchError.value = error_ instanceof Error ? error_.message : String(error_)
        })
        .finally(() => {
          if (current) searching.value = false
        })
    }, 250)
    cleanup(() => {
      current = false
      clearTimeout(timer)
      controller.abort()
    })
  },
)

async function submit() {
  if (!ready.value) return
  const sourceId = props.item.work_item_id
  const relationKind = kind.value
  const relationDirection = direction.value
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'new' && !created.value) {
      created.value = await createWorkItem({
        space: props.item.planning_space_id,
        title: title.value.trim(),
      })
      emit('changed')
    }
    const otherId = created.value?.work_item_id ?? selected.value?.work_item_id
    if (!otherId || !props.writable) return
    await linkWorkItems({
      id: relationDirection === 'incoming' ? otherId : sourceId,
      other: relationDirection === 'incoming' ? sourceId : otherId,
      kind: relationKind,
    })
    created.value = null
    title.value = ''
    query.value = ''
    selectedId.value = ''
    emit('changed')
    emit('close')
  } catch (error_) {
    error.value = error_ instanceof Error ? error_.message : String(error_)
  } finally {
    busy.value = false
  }
}

function close() {
  if (!busy.value) emit('close')
}
</script>

<template>
  <DialogFrame
    :open="open"
    :title="t('workItem.related.pickerTitle')"
    :context="`${item.reference} · ${item.title}`"
    :close-label="t('drawer.close')"
    :busy="busy"
    :error="error"
    @close="close"
    @submit="submit"
  >
    <div class="relation-options">
      <ChoiceSelect
        v-model="kind"
        :options="kindOptions"
        :label="t('workItem.related.relation')"
        :disabled="frozen"
      />
      <ChoiceSelect
        v-model="direction"
        :options="directionOptions"
        :label="t('workItem.related.direction')"
        :disabled="frozen"
      />
    </div>
    <ChoiceSelect
      v-model="mode"
      :options="modeOptions"
      :label="t('workItem.related.mode')"
      :disabled="frozen"
    />
    <template v-if="created">
      <p
        class="picker-note"
        role="status"
      >
        {{ t('workItem.related.partial', { reference: created.reference }) }}
      </p>
      <VButton @click="emit('open', created.reference)">{{
        t('workItem.related.openCreated', { reference: created.reference })
      }}</VButton>
    </template>
    <VTextInput
      v-else-if="mode === 'new'"
      v-model="title"
      :label="t('workItem.related.title')"
      :maxlength="200"
      :disabled="busy || !writable"
    />
    <template v-else>
      <VTextInput
        v-model="query"
        autocomplete="off"
        :label="t('workItem.related.search')"
        :hint="t('workItem.related.searchHint')"
        :maxlength="200"
        :disabled="busy || !writable"
      />
      <p
        v-if="searching"
        class="picker-note"
        role="status"
      >
        {{ t('workItem.related.searching') }}
      </p>
      <p
        v-else-if="searchError"
        class="picker-error"
        role="alert"
      >
        {{ searchError }}
      </p>
      <DataEmptyState
        v-else-if="hasQuery && !eligible.length"
        :title="t('workItem.related.noResults')"
        inline
      />
      <ul
        v-if="eligible.length"
        class="picker-results"
      >
        <li
          v-for="candidate in eligible"
          :key="candidate.work_item_id"
        >
          <label class="picker-result">
            <input
              v-model="selectedId"
              type="radio"
              name="related-task"
              :value="candidate.work_item_id"
              :disabled="busy || !writable"
            />
            <span class="result-copy">
              <span class="result-title"
                >{{ candidate.reference }} · <span v-slash-breaks="candidate.title"
              /></span>
              <span class="result-meta"
                >{{ candidate.state.name
                }}<template v-if="candidate.claim_ref">
                  · {{ holderName(candidate.claim_ref) }}</template
                ></span
              >
            </span>
          </label>
        </li>
      </ul>
    </template>
    <template #footer>
      <VButton
        :disabled="busy"
        @click="close"
        >{{ t('workItem.cancel') }}</VButton
      >
      <VButton
        type="submit"
        variant="primary"
        :disabled="!ready"
        >{{ submitLabel }}</VButton
      >
    </template>
  </DialogFrame>
</template>

<style scoped>
.relation-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.picker-note,
.picker-error {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.picker-error {
  color: var(--color-danger);
}

.picker-results {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.picker-result {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  min-height: var(--size-control-target);
  cursor: pointer;
}

.result-copy {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.result-title {
  color: var(--color-text);
  font: var(--font-editor);
  overflow-wrap: anywhere;
}

.result-meta {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
