<script setup lang="ts">
/**
 * What a reader of a thread should know about it and would not see at once, each said in its
 * own words on one quiet line: how many replies a folded one holds, a reply since it was
 * marked, a new reply, a draft set aside. Nothing when there is nothing to say.
 */
defineProps<{ flags: readonly string[] }>()
</script>

<template>
  <div
    v-if="flags.length"
    class="thread-flags"
  >
    <span
      v-for="flag in flags"
      :key="flag"
      class="thread-flag"
      >{{ flag }}</span
    >
  </div>
</template>

<style scoped>
.thread-flags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: center;
  min-width: 0;
}

.thread-flag {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
