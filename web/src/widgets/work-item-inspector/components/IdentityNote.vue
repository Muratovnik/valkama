<script setup lang="ts">
/**
 * What a press in the card's identity line did: a copy made, a copy refused, an
 * anchor that could not open. One rule for every such note, because the line has
 * one height and on a phone only a few dozen pixels are left for it.
 *
 * A glyph says it at any width — a check for done, a circle with a mark for
 * failed, told apart by shape in the note's own ink — and the words stand beside it only where the line holds them whole.
 * They used to be cut to an ellipsis, which on a phone left «Ссылка скопиров…»:
 * a sentence nobody can finish is no confirmation. Assistive technology hears the
 * whole sentence either way, from a status region that is always there, so that
 * a note arriving in it is announced rather than appearing with its region.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  failed: boolean
  /** The sentence; empty when there is nothing to say. */
  text: string
}>()

const shown = useTemplateRef<HTMLElement>('shown')
const words = useTemplateRef<HTMLElement>('words')
/** The identity line, whose width is the drawer's and never the note's. */
const line = computed(() => shown.value?.parentElement ?? null)
/** Whether the words fit beside the glyph; measured, never assumed. */
const whole = ref(true)
const glyph = computed(() => (props.failed ? 'alert' : 'check'))

async function measure() {
  whole.value = true
  await nextTick()
  const node = words.value
  // Against the box's own fractional width: words given exactly their length are whole.
  if (node) whole.value = node.scrollWidth <= Math.ceil(node.getBoundingClientRect().width)
}

watch(() => props.text, measure, { flush: 'post' })
// The note's own width follows its words, so the line is what is watched: watching the
// note would hide the words, shrink it, show them again and never settle.
useResizeObserver(line, () => void measure())
</script>

<template>
  <span
    v-if="text"
    ref="shown"
    class="identity-note"
    aria-hidden="true"
    :title="text"
  >
    <VIcon
      class="identity-note-glyph"
      :name="glyph"
      :size="14"
    />
    <span
      v-if="whole"
      ref="words"
      class="identity-note-words"
      >{{ text }}</span
    >
  </span>
  <span
    class="visually-hidden"
    role="status"
    >{{ text }}</span
  >
</template>

<style scoped>
/* As long as its words, in the room the facts and controls leave: the date gives way
   first (its own rule says how), and what is still too long loses its words. */
.identity-note {
  display: flex;
  flex: 0 1 auto;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  color: var(--color-text-muted);
}

.identity-note-glyph {
  flex: none;
}

/* No ellipsis: words that do not fit are not shown at all, the glyph says it. */
.identity-note-words {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
}
</style>
