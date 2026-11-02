<script setup lang="ts">
/**
 * What is chosen, in full, under the options and above Send: an agent can put a
 * condition in the part of a description a row folds away, and only what stood whole may
 * be sent as the person's answer.
 *
 * It stands here rather than opening in the row, so that choosing moves no row. A row
 * opening and closing above the next press moved that row from under the pointer, and
 * near the top of a card there is no scroll left to take that back. Nothing reads this
 * out on an arrow press: the radio names it with `aria-details`, and it is in the order
 * of the text for whoever goes on to read it.
 */
import RichText from '@/shared/ui/RichText.vue'

defineProps<{
  entries: readonly { description: string; id: string; label: string }[]
}>()
</script>

<template>
  <div
    v-for="entry in entries"
    :id="entry.id"
    :key="entry.id"
    class="request-chosen"
  >
    <span class="request-chosen-label">{{ entry.label }}</span>
    <RichText
      class="request-chosen-text"
      :source="entry.description"
    />
  </div>
</template>

<style scoped>
/* The chosen row's own ground, which is what ties the two together across the rows
   between them. */
.request-chosen {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  margin-block-start: var(--space-1);
  background: var(--color-surface-active);
  border-radius: var(--radius-control);
}

.request-chosen-label {
  font: var(--font-strong);
  overflow-wrap: anywhere;
}

.request-chosen-text {
  font: var(--font-detail);
}
</style>
