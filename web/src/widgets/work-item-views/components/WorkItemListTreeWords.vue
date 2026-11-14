<script setup lang="ts">
/**
 * What a tree's row says after its title that the tree's shape cannot: how
 * much under a row matched the filter, so a path row's quiet tone is never the
 * only sign of what it is, and the parent of a row deeper than the indent goes.
 */
defineProps<{
  /** «3 match»; empty where nothing is filtered or nothing under the row matched. */
  matching: string
  /** «in MAIN-12»; empty where the indent still shows the parent. */
  parent: string
}>()
</script>

<template>
  <span
    v-if="matching"
    class="list-matching"
    >{{ matching }}</span
  >
  <span
    v-if="parent"
    class="list-parent"
    >{{ parent }}</span
  >
</template>

<style scoped>
/* After the title, on its line. */
.list-matching {
  margin-inline-start: var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-detail);
  white-space: nowrap;
}

/* A line of its own under the title. */
.list-parent {
  display: block;
  padding-top: var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
