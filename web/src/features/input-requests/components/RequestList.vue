<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'

import type {
  InputAnswers,
  InputRequestEntry,
  InputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  drafts: Record<string, InputAnswers>
  entries: InputRequestEntry[]
  failed: boolean
  loading: boolean
  partial: boolean
  result: InputRequestList | null
  item?: boolean
}>()
const emit = defineEmits<{
  draft: [key: string, value: InputAnswers]
  refresh: []
  select: [target: PlanningTarget]
  updated: [entry: InputRequestEntry]
}>()
const { t } = useI18n()
const busyMark = computed(() => props.loading || undefined)
const emptyLabel = computed(() => {
  if (props.partial) return t('requests.partialEmpty')
  return t(props.item ? 'requests.itemEmpty' : 'requests.empty')
})
const sources = computed(() =>
  props.result?.coverage.map((source) => ({
    ...source,
    key: JSON.stringify([source.project_id, source.space_ref]),
  })),
)
function draftFor(entry: InputRequestEntry) {
  return props.drafts[requestIdentity(entry)] ?? {}
}
</script>

<template>
  <div
    class="request-list"
    :aria-busy="busyMark"
  >
    <div class="request-toolbar">
      <VButton
        :disabled="loading"
        @click="emit('refresh')"
        >{{ t('requests.refresh') }}</VButton
      >
    </div>
    <p
      v-if="loading"
      role="status"
    >
      {{ t('requests.loading') }}
    </p>
    <p
      v-if="failed"
      role="alert"
    >
      {{ t('requests.error') }}
    </p>
    <p
      v-if="partial"
      role="status"
    >
      {{ t('requests.partial') }}
    </p>
    <p
      v-if="result?.has_more"
      role="status"
    >
      {{ t('requests.truncated') }}
    </p>
    <template
      v-for="source in sources"
      :key="source.key"
    >
      <p
        v-if="source.status === 'unavailable'"
        class="request-source"
      >
        {{
          t('requests.sourceUnavailable', {
            project: source.project_id,
            space: source.space_ref.space_key,
          })
        }}
      </p>
    </template>
    <p
      v-if="result && !loading && !failed && !entries.length"
      role="status"
    >
      {{ emptyLabel }}
    </p>
    <RequestCard
      v-for="entry in entries"
      :key="requestIdentity(entry)"
      :entry="entry"
      :draft="draftFor(entry)"
      :show-task-link="!item"
      @update:draft="emit('draft', requestIdentity(entry), $event)"
      @updated="emit('updated', $event)"
      @select="emit('select', $event)"
    />
  </div>
</template>

<style scoped>
.request-list {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.request-source {
  margin: 0;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}

.request-toolbar {
  display: flex;
  justify-content: flex-end;
}
</style>
