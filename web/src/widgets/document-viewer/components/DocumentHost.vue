<script setup lang="ts">
/**
 * What the viewer stands in: a drawer over what it was opened from, or, on a document's
 * own page, nothing of its own, since the window is the host and its tab takes the title.
 */
import { useI18n } from 'vue-i18n'

import { useTitle } from '@vueuse/core'

import {
  DOCUMENT_PANE_DEFAULT_WIDTH,
  DOCUMENT_PANE_STORAGE_KEY,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
} from '@/shared/lib/shellLayout.ts'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'

const props = defineProps<{ label: string; open: boolean; title: string; page?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
if (props.page) useTitle(() => props.title)
</script>

<template>
  <slot v-if="page" />
  <ResizableInspector
    v-else
    layer="command"
    surface-class="document-drawer"
    :open="open"
    :label="label"
    :resize-label="t('documentLinks.viewer.resize')"
    :storage-key="DOCUMENT_PANE_STORAGE_KEY"
    :default-width="DOCUMENT_PANE_DEFAULT_WIDTH"
    :min-width="DRAWER_MIN_WIDTH"
    :max-width="DRAWER_MAX_WIDTH"
    @close="emit('close')"
  >
    <slot />
  </ResizableInspector>
</template>
