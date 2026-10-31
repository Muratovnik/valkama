<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestList from '@/features/input-requests/components/RequestList.vue'
import { useInputRequests } from '@/features/input-requests/composables/useInputRequests.ts'
import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'

import type { InputAnswers } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  count: [value: PendingCount | null]
  select: [target: PlanningTarget]
}>()
const { t } = useI18n()
const { result, loading, failed, partial, entries, count, refresh, changed } = useInputRequests(
  (): undefined => {},
)
const drafts = ref<Record<string, InputAnswers>>({})
watch(count, (value) => emit('count', value), { immediate: true })
watch(
  () => props.open,
  (open) => {
    if (open) void refresh()
  },
)
</script>

<template>
  <DialogFrame
    :open="open"
    :title="t('requests.title')"
    :subtitle="t('requests.scope')"
    :close-label="t('requests.close')"
    @close="emit('close')"
  >
    <RequestList
      :entries="entries"
      :result="result"
      :loading="loading"
      :failed="failed"
      :partial="partial"
      :drafts="drafts"
      @refresh="refresh"
      @updated="changed"
      @draft="(key, value) => (drafts[key] = value)"
      @select="emit('select', $event)"
    />
  </DialogFrame>
</template>
