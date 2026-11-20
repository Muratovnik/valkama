<script setup lang="ts">
/**
 * What the top of the Volumes page did not count, over its numbers: that the result is
 * incomplete and each space it could not read, as the questions window says it of its own read
 * (`SourceCoverageNotes`), from the read's `coverage`. Nothing while every source was read.
 */
import { coverageIncomplete } from '@/shared/api/planningTarget.ts'
import type { PlanningCoverage } from '@/shared/api/planningTarget.ts'
import SourceCoverageNotes from '@/shared/ui/SourceCoverageNotes.vue'

defineProps<{ coverage: readonly PlanningCoverage[] }>()
</script>

<template>
  <div
    v-if="coverageIncomplete(coverage)"
    class="volumes-coverage"
  >
    <SourceCoverageNotes :coverage="coverage" />
  </div>
</template>

<style scoped>
/* The lines one under another, at the questions window's step. */
.volumes-coverage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
}
</style>
