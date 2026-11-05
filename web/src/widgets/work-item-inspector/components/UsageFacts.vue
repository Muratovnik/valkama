<script setup lang="ts">
/**
 * A few figures of work in one line, a dot between them. A wrapped line starts without a dot:
 * the dot stands in the room each fact's margin takes from the line, which the line clips.
 *
 * With `columns`, and where the drawer has room, the figures stand in the columns of the grid
 * around them instead, so that a list of them can be compared down the page.
 */
withDefaults(
  defineProps<{
    /** `label` stands with its figure, in the quieter ink, and wraps with it as one. */
    facts: readonly { key: string; text: string; label?: string; title?: string }[]
    columns?: boolean
  }>(),
  { columns: false },
)
</script>

<template>
  <span
    class="usage-facts"
    :class="{ 'in-columns': columns }"
  >
    <span
      v-for="fact in facts"
      :key="fact.key"
      class="usage-fact"
      :title="fact.title"
      ><span
        v-if="fact.label"
        class="usage-fact-label"
        >{{ fact.label }}</span
      >{{ fact.text }}</span
    >
  </span>
</template>

<style scoped>
.usage-facts {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  overflow: clip;
}

.usage-fact {
  position: relative;
  padding-inline-start: var(--space-4);
  margin-inline: calc(-1 * var(--space-4)) var(--space-4);
  white-space: nowrap;

  &::before {
    content: '·' / '';
    position: absolute;
    inset-inline-start: 0;
    width: var(--space-4);
    text-align: center;
  }
}

.usage-fact-label {
  margin-inline-end: var(--space-2);
  color: var(--color-text-tertiary);
}

@container drawer (width >= 560px) {
  .usage-facts.in-columns {
    display: contents;

    .usage-fact {
      padding: 0;
      margin: 0;
      text-align: end;

      &::before {
        content: none;
      }
    }
  }
}
</style>
