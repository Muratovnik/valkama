<script setup lang="ts">
/**
 * Who wrote an entry and when: the name at the start, the time at the end.
 *
 * The time keeps the end of the name's first line while the name has at least 14ch beside
 * it, or the whole of its own width when that is less; with less room the time takes a line
 * of its own under the name, still at the end, and the name the whole width. 14ch holds a
 * word of an agent's name such as "retrospective" whole. "changed · {time}" leaves a phone
 * about 10ch, and holding the time on the first line there stood an agent's name one word
 * fragment to a line, eight or ten lines of it; every other line on a phone leaves 17ch or
 * more and does not move.
 *
 * The name's basis is the minimum and its width stops at its own: the line breaks on the
 * basis, so a name shorter than 14ch still shares the line with a time beside it that fits,
 * and the space it does not take goes to the time's auto margin.
 */
defineProps<{ when: string }>()
</script>

<template>
  <div class="meta-line">
    <span class="meta-who"><slot /></span>
    <span class="meta-when">{{ when }}</span>
  </div>
</template>

<style scoped>
.meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  align-items: baseline;
  min-width: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.meta-who {
  flex: 1 1 14ch;
  min-width: 0;
  max-width: max-content;
  overflow-wrap: anywhere;
}

.meta-when {
  flex: none;
  margin-inline-start: auto;
  white-space: nowrap;
}
</style>
