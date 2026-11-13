<script setup lang="ts">
/**
 * The card's frame before there is a card to draw it: the bar with its close, and no
 * head, as the card stands while its record is read. What waits for the card's code
 * stands in it, so that wait and the card's own stand in one column and the dots do
 * not move when the card takes over. It is drawn with what the card is given and takes
 * only the reference; the rest is the card's.
 */
import { useI18n } from 'vue-i18n'

import DrawerFrame from '@/shared/ui/DrawerFrame.vue'

defineProps<{ reference: string }>()
const emit = defineEmits<{ close: [] }>()
defineOptions({ inheritAttrs: false })
const { t } = useI18n()
</script>

<template>
  <DrawerFrame
    :title="reference"
    :close-label="t('drawer.close')"
    headless
    @close="emit('close')"
  >
    <slot />
  </DrawerFrame>
</template>
