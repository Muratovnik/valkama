<script setup lang="ts">
/**
 * A list of a value's figures in its side panel, a name and its figure to a line, the figures in
 * one column of tabular numbers: the period's, and a task's of all time. Each figure is marked by
 * its key (`data-figure`), which is what a reader of it selects it by.
 */
defineProps<{
  figures: readonly { key: string; name: string; text: string }[]
}>()
</script>

<template>
  <dl class="value-figures">
    <div
      v-for="figure in figures"
      :key="figure.key"
      class="value-figure"
      :data-figure="figure.key"
    >
      <dt class="value-figure-name">{{ figure.name }}</dt>
      <dd class="value-figure-text">{{ figure.text }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.value-figures {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-1) var(--space-4);
  margin: 0;
  font: var(--font-detail);
}

.value-figure {
  display: contents;

  & .value-figure-name {
    color: var(--color-text-muted);
  }

  & .value-figure-text {
    margin: 0;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }
}
</style>
