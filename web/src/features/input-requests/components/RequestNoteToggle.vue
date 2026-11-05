<script setup lang="ts">
/**
 * The press that opens a comment, a quiet glyph at the end of a line already there: the words
 * of two comments stood as two lines of their own on every question, most of them never used.
 * Its words are for the pointer resting on it and for a reader. A comment written shows it in
 * the glyph's shape and in those words, where colour does not say it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    disabled: boolean
    open: boolean
    /** What the glyph says under a pointer. */
    title: string
    written: boolean
    /** What a reader hears, where the title would not say what the comment is on. */
    name?: string
  }>(),
  { name: undefined },
)
const emit = defineEmits<{ press: [] }>()
const { t } = useI18n()
const said = (words: string) => (props.written ? t('requests.noteWritten', { note: words }) : words)
const shownTitle = computed(() => said(props.title))
const heardName = computed(() => said(props.name ?? props.title))
</script>

<template>
  <VButton
    class="request-note-toggle"
    variant="text"
    size="inline"
    :class="{ 'is-written': written }"
    :disabled="disabled"
    :title="shownTitle"
    :aria-expanded="open"
    :aria-label="heardName"
    icon
    @click="emit('press')"
  >
    <VIcon
      class="request-note-glyph"
      name="message-square"
      :size="16"
    />
  </VButton>
</template>

<style scoped>
.request-note-toggle.is-written {
  color: var(--color-text);

  .request-note-glyph {
    fill: currentcolor;
  }
}

/* The whole target where a finger is what presses it: under a coarse pointer, and in a surface
   as narrow as a phone's. */
@media (pointer: coarse) {
  .request-note-toggle {
    --size-control-inline: var(--size-control-target);
  }
}

@container overlay (width <= 30rem) {
  .request-note-toggle {
    --size-control-inline: var(--size-control-target);
  }
}
</style>
