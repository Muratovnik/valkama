<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestList from '@/features/input-requests/components/RequestList.vue'
import { useInputRequests } from '@/features/input-requests/composables/useInputRequests.ts'
import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { DIALOG_ROOM_BESIDE_DOCUMENT } from '@/shared/lib/shellLayout.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'

const props = defineProps<{ open: boolean; pane?: OverlayPaneNames | null }>()
const emit = defineEmits<{
  'close': []
  'count': [value: PendingCount | null]
  'pane-close': []
  'pane-fit': [fit: PaneFit | null]
  'select': [target: PlanningTarget]
}>()
const { t } = useI18n()
const { result, loading, failed, partial, entries, count, refresh, changed } = useInputRequests(
  () => 'all',
)
const drafts = ref<Record<string, RequestDraft>>({})
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
    :pane="pane"
    :pane-room="DIALOG_ROOM_BESIDE_DOCUMENT"
    @close="emit('close')"
    @pane-close="emit('pane-close')"
    @pane-fit="(fit) => emit('pane-fit', fit)"
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
    <template #pane>
      <slot name="pane" />
    </template>
  </DialogFrame>
</template>
