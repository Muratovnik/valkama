<script setup lang="ts">
/**
 * The press that opens a comment, a quiet glyph at the end of a line already there: the words
 * of two comments stood as two lines of their own on every question, most of them never used.
 * Its words are for the pointer resting on it and for a reader. A comment written shows it in
 * the glyph's shape and in those words, where colour does not say it.
 *
 * Where a finger presses, which every control asks in one place (`reach.css`), it answers
 * across `--size-control-target`. On the line of a field's label or a review's point it grows
 * its own box to that (`reach-grow`), since rows stand right under it. At the left end of a
 * question's or a list's buttons (`reach`) it keeps its drawn box and reaches past it instead:
 * grown there, centred on the boxes' axis, its ground, its ring and a forced palette's frame
 * stood 3px outside the comment's sheet on a phone. Asked for a coarse pointer alone, the grown
 * box stood 28px on a phone-wide window under a mouse, beside an entry's icons of 44.
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
    /** It reaches past what it draws for a finger, rather than drawing that much. */
    reach?: boolean
  }>(),
  { name: undefined, reach: false },
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
    :class="{ 'is-written': written, reach, 'reach-grow': !reach }"
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

/* The whole target in a sheet as narrow as a phone's, as where a finger presses (`reach-grow`).
   One that reaches keeps its box, and is the box of its reach. */
@container overlay (width <= 30rem) {
  .request-note-toggle:not(.reach) {
    --size-control-inline: var(--size-control-target);
  }
}

.request-note-toggle.reach {
  position: relative;
}
</style>

<style scoped src="@/shared/ui/reach.css"></style>
