<script setup lang="ts">
/**
 * Back, in a card's bar, to the card this one was opened from. The host asks about a draft
 * before it goes; this only says the way is there.
 */
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const emit = defineEmits<{ back: [] }>()
const { t } = useI18n()
</script>

<template>
  <VButton
    class="head-back"
    size="compact"
    variant="ghost"
    :aria-label="t('workItem.back')"
    @click="emit('back')"
  >
    <VIcon
      name="chevron-left"
      :size="16"
    />
    <span class="head-back-word">{{ t('workItem.back') }}</span>
  </VButton>
</template>

<style scoped>
/* Back rides the bar at the height of the action beside it. A phone-wide bar keeps
   its room for the title: the glyph says it, and the button keeps its name. */
@container drawer (width < 520px) {
  .head-back-word {
    display: none;
  }
}
</style>
