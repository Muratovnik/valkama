<script setup lang="ts">
/**
 * Which projects a section's figures are of, beside its heading in the quiet ink: «project
 * Billing» on a page scoped to one, «all projects» on the global page (`useScopeWords`). It stands
 * on the heading's line, after its «ⓘ», and takes a line of its own only where a long name leaves
 * the line no room, never cut. The bar has no room for it; a project's week beside the global one,
 * with the project named only in the context bar, read as two answers for one week.
 */
import { useScopeWords } from '@/pages/analytics/composables/useScopeWords.ts'

const words = useScopeWords()
</script>

<template>
  <span
    v-if="words"
    class="section-scope"
    data-part="scope"
    >{{ words.short }}</span
  >
</template>

<style scoped>
.section-scope {
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
