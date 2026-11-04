<script setup lang="ts">
/**
 * Who wrote an entry and when: the name at the start, the time at the end, on one line.
 *
 * A name runs as long as an agent's, and the line used to wrap the whole time under it, where
 * it stood at the start, while on the entry beside it the time stood at the end. Now the time
 * keeps the end of the first line whatever the name, and the name wraps in the room left to
 * it, read whole rather than cut. Three lines had written this each for itself — a thread's
 * root, a reply, and an answer a change replaced — and all three wrapped the time away.
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
  gap: var(--space-2);
  align-items: baseline;
  min-width: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.meta-who {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.meta-when {
  flex: none;
  white-space: nowrap;
}
</style>
