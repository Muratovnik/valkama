<script setup lang="ts">
import { computed, useId } from 'vue'

import { ListboxContent, ListboxFilter, ListboxItem, ListboxRoot } from 'reka-ui'

const props = defineProps<{
  items: readonly { detail: string; key: string; title: string }[]
  label: string
  loading: boolean
  placeholder: string
  query: string
  resultsLabel: string
}>()
const emit = defineEmits<{ 'select': [key: string]; 'update:query': [value: string] }>()
const resultsId = useId()
const busyMark = computed(() => props.loading || undefined)
</script>

<template>
  <ListboxRoot
    class="command-list"
    :highlight-on-hover="true"
  >
    <ListboxFilter
      class="command-input"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="true"
      autocomplete="off"
      :model-value="query"
      :aria-label="label"
      :placeholder="placeholder"
      :aria-controls="resultsId"
      :auto-focus="true"
      :maxlength="200"
      @update:model-value="emit('update:query', $event)"
    />
    <slot name="feedback" />
    <ListboxContent
      :id="resultsId"
      class="command-results"
      :aria-label="resultsLabel"
      :aria-busy="busyMark"
    >
      <ListboxItem
        v-for="item in items"
        :key="item.key"
        class="command-result"
        :value="item.key"
        @select.prevent="emit('select', item.key)"
      >
        <span class="command-title">{{ item.title }}</span>
        <span class="command-detail">{{ item.detail }}</span>
      </ListboxItem>
    </ListboxContent>
  </ListboxRoot>
</template>

<style scoped>
.command-list {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.command-input {
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  font-size: var(--font-size-interface);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.command-results {
  display: grid;
  gap: var(--space-1);
  max-height: min(50dvh, 480px);
  overflow-y: auto;
}

.command-result {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  border-radius: var(--radius-control);
  cursor: pointer;

  &[data-highlighted] {
    background: var(--color-surface-hover);
    outline: 1px solid var(--color-focus-ring);
    outline-offset: -1px;
  }
}

.command-title {
  font-size: var(--font-size-interface);
  overflow-wrap: anywhere;
}

.command-detail {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
  overflow-wrap: anywhere;
}
</style>
