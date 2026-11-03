<script setup lang="ts">
/**
 * The panel a card stands in, with a document opened from the card standing beside it when
 * the window has room for both and the board. The card's own width is the panel's business;
 * the document's is its own.
 */
import { useI18n } from 'vue-i18n'

import DocumentViewer from '@/widgets/document-viewer/components/DocumentViewer.vue'
import { useDocumentPane } from '@/widgets/document-viewer/composables/useDocumentPanes.ts'

import {
  BOARD_ROOM_BESIDE_DOCUMENT,
  INSPECTOR_DRAWER_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'

const props = defineProps<{ contentKey: string; label: string; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const documentBeside = useDocumentPane('card', () => props.label)
</script>

<template>
  <ResizableInspector
    surface-class="drawer"
    :content-key="contentKey"
    :open="open"
    :label="label"
    :resize-label="t('workItem.resize')"
    :storage-key="INSPECTOR_DRAWER_STORAGE_KEY"
    :pane="documentBeside.pane"
    :pane-room="BOARD_ROOM_BESIDE_DOCUMENT"
    @close="emit('close')"
    @pane-close="documentBeside.close"
    @pane-fit="documentBeside.stand"
  >
    <slot />
    <template #pane>
      <DocumentViewer
        v-if="documentBeside.view"
        :view="documentBeside.view"
        beside
      />
    </template>
  </ResizableInspector>
</template>
