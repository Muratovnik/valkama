<script setup lang="ts">
/**
 * A document over what it was opened from: a drawer on the command layer, over a card,
 * which stays mounted under it with any draft in it, and over the questions waiting for
 * an answer. Escape closes it alone and gives focus back to the link that opened it, which
 * is the overlay host's to do.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import DocumentViewer from '@/widgets/document-viewer/components/DocumentViewer.vue'
import { useDocumentOver } from '@/widgets/document-viewer/composables/useDocumentPanes.ts'
import type { DocumentView } from '@/widgets/document-viewer/composables/useDocumentView.ts'

import {
  DOCUMENT_PANE_DEFAULT_WIDTH,
  DOCUMENT_PANE_STORAGE_KEY,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
} from '@/shared/lib/shellLayout.ts'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'

const props = defineProps<{ view: DocumentView }>()

const { t } = useI18n()
const over = useDocumentOver(props.view)
const label = computed(() => t('documentLinks.viewer.label', { title: props.view.title.value }))
const resizeLabel = computed(() => t('documentLinks.viewer.resize'))
</script>

<template>
  <ResizableInspector
    layer="command"
    surface-class="document-drawer"
    :open="over"
    :label="label"
    :resize-label="resizeLabel"
    :storage-key="DOCUMENT_PANE_STORAGE_KEY"
    :default-width="DOCUMENT_PANE_DEFAULT_WIDTH"
    :min-width="DRAWER_MIN_WIDTH"
    :max-width="DRAWER_MAX_WIDTH"
    @close="view.close"
  >
    <DocumentViewer :view="view" />
  </ResizableInspector>
</template>
