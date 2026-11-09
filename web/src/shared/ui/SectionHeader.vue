<script setup lang="ts">
/**
 * A section's title row: the heading, the number it counts, and the actions
 * that act on the whole section.
 *
 * The inspector's sections each built this row by hand and no two agreed: a
 * count pressed against its heading with no space between ("Related work4"), a
 * count at the far edge, an edit action that set the row's height, and a
 * refresh standing on a row of its own above an empty message. The row is one
 * decision, so it has one owner; `SectionHeading` stays the heading element and
 * nothing more.
 *
 * The row also owns how tall its actions stand. The chain's heading held a 36px scope switch
 * beside a 28px «На графе», each sized by the section that placed it; the actions slot hands
 * every action the one size, compact, which is what a control riding a dense header is.
 */
import SectionHeading from '@/shared/ui/SectionHeading.vue'

withDefaults(
  defineProps<{
    title: string
    as?: 'h2' | 'h3' | 'h4'
    /** What the section holds, beside its name: `4`, or `5/7 done`. */
    count?: string | number
    level?: 'page' | 'panel'
  }>(),
  { as: 'h3', count: '', level: 'panel' },
)

/** The size every action of a section's heading takes, from the slot that places it. */
const ACTION_SIZE = 'compact'

defineSlots<{ actions?: (scope: { size: typeof ACTION_SIZE }) => unknown }>()
</script>

<template>
  <div class="section-header">
    <SectionHeading
      class="section-header-title"
      :as="as"
      :level="level"
    >
      <!-- Text and count stay one sentence to a reader ("Related work 4"); the
           row's gap, not that space, is what separates them on screen. -->
      {{ title }}
      <span
        v-if="count !== ''"
        class="section-header-count"
        >{{ count }}</span
      >
    </SectionHeading>
    <div
      v-if="$slots.actions"
      class="section-header-actions"
    >
      <slot
        name="actions"
        :size="ACTION_SIZE"
      />
    </div>
  </div>
</template>

<style scoped>
/* The heading keeps its own height, so a row with an action and one without
   put their content at the same distance below the title. */
.section-header {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.section-header-title {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.section-header-count {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.section-header-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
}
</style>
