<script setup lang="ts">
/**
 * What a press in the card's identity line did: a copy made or a copy refused.
 * One rule for every such note, because the line has one height and on a phone
 * only a few dozen pixels are left for it.
 *
 * A glyph says it at any width — a check for done, a circle with a mark for
 * failed, told apart by shape in the note's own ink — and the words stand beside
 * it whenever the line can give them room: the line decides, and lets its date and
 * the item's kind step aside first (`InspectorIdentity`). They used to be cut to
 * an ellipsis, which on a phone left «Ссылка скопиров…»: a sentence nobody can
 * finish is no confirmation. Assistive technology hears the whole sentence either
 * way, from a status region that is always there, so that a note arriving in it
 * is announced rather than appearing with its region.
 */
import { computed } from 'vue'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    failed: boolean
    /** The sentence; empty when there is nothing to say. */
    text: string
    /** Whether the line has room for the words beside the glyph. */
    words?: boolean
  }>(),
  { words: true },
)

const glyph = computed(() => (props.failed ? 'alert' : 'check'))
</script>

<template>
  <span
    v-if="text"
    v-tooltip="text"
    class="identity-note"
    aria-hidden="true"
  >
    <VIcon
      class="identity-note-glyph"
      :name="glyph"
      :size="14"
    />
    <span
      v-if="words"
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
/* As long as its words: the line gives it room by taking things out whole, never by
   cutting into one. */
.identity-note {
  display: flex;
  flex: none;
  gap: var(--space-1);
  align-items: center;
  color: var(--color-text-muted);
}

.identity-note-glyph {
  flex: none;
}
</style>
