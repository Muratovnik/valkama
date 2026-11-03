<script setup lang="ts">
/** The questions waiting for an answer, with a document opened from one standing beside them. */
import { useI18n } from 'vue-i18n'

import DocumentViewer from '@/widgets/document-viewer/components/DocumentViewer.vue'
import { useDocumentPane } from '@/widgets/document-viewer/composables/useDocumentPanes.ts'

import InputRequestsHub from '@/features/input-requests/components/InputRequestsHub.vue'
import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'

import type { PlanningTarget } from '@/shared/api/planningTarget.ts'

defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  count: [value: PendingCount | null]
  select: [target: PlanningTarget]
}>()

const { t } = useI18n()
const documentBeside = useDocumentPane('hub', () => t('requests.title'))
</script>

<template>
  <InputRequestsHub
    :open="open"
    :pane="documentBeside.pane"
    @close="emit('close')"
    @select="(target) => emit('select', target)"
    @count="(count) => emit('count', count)"
    @pane-close="documentBeside.close"
    @pane-fit="documentBeside.stand"
  >
    <template #pane>
      <DocumentViewer
        v-if="documentBeside.view"
        :view="documentBeside.view"
        beside
      />
    </template>
  </InputRequestsHub>
</template>
