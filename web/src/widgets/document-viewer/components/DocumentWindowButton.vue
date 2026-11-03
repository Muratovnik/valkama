<script setup lang="ts">
/**
 * Moves a document to a window of its own. It then closes here, so that focus goes back
 * to the link that opened it and whatever else was in hand is where it was left. The new
 * window has no way back to this one: it opens with `noopener`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { documentPageHref } from '@/shared/api/documentPage.ts'
import type { DocumentPageAddress } from '@/shared/api/documentPage.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ place: DocumentPageAddress }>()
const emit = defineEmits<{ opened: [] }>()

const { t } = useI18n()
const label = computed(() => t('documentLinks.viewer.newWindow'))

function open() {
  window.open(documentPageHref(props.place), '_blank', 'noopener')
  emit('opened')
}
</script>

<template>
  <VButton
    variant="ghost"
    :aria-label="label"
    :title="label"
    icon
    @click="open"
  >
    <VIcon name="external-link" />
  </VButton>
</template>
