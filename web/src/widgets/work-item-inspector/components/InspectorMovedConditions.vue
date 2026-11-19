<script setup lang="ts">
/**
 * Where conditions that left the item went, in Relations: each part split off it and each task a
 * conversion left its work in, by reference and with how many conditions it took then, as its
 * history recorded it (`conditions_changed.moved`). A row opens that card; each carries
 * `data-moved` with its reference. Nothing stands here for an item none left.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import SectionHeader from '@/shared/ui/SectionHeader.vue'

const props = defineProps<{ item: WorkItem }>()
const emit = defineEmits<{ open: [reference: string] }>()
const { t } = useI18n()

const moved = computed(() =>
  (props.item.conditions_changed?.moved ?? []).map((entry, index) => ({
    key: `${entry.to}:${index}`,
    reference: entry.to,
    count: t('workItem.dividing.moved.count', { n: entry.count }, entry.count),
  })),
)
</script>

<template>
  <section
    v-if="moved.length"
    class="moved-section"
  >
    <SectionHeader
      :title="t('workItem.dividing.moved.title')"
      :count="moved.length"
    />
    <ul class="moved-list">
      <li
        v-for="entry in moved"
        :key="entry.key"
        :data-moved="entry.reference"
      >
        <button
          class="moved-open"
          type="button"
          @click="emit('open', entry.reference)"
        >
          <span class="moved-reference">{{ entry.reference }}</span>
          <span class="moved-count">{{ entry.count }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.moved-section {
  display: grid;
  gap: var(--space-heading-content);
}

.moved-list {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}

.moved-open {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  min-width: 0;
  padding: var(--space-1) 0;
  border: 0;
  color: inherit;
  text-align: start;
  background: none;
  cursor: pointer;

  &:is(:hover, :focus-visible) .moved-reference {
    text-decoration: underline;
  }
}

.moved-reference {
  color: var(--color-text);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.moved-count {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
