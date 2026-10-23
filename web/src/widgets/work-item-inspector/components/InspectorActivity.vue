<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { buildActivity } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

const props = defineProps<{
  item: WorkItem
}>()

const { t, d } = useI18n()

const entries = computed(() => buildActivity(props.item))
function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <div class="activity">
    <ol
      v-if="entries.length"
      class="feed"
    >
      <li
        v-for="entry in entries"
        :key="entry.key"
        class="entry"
        :data-kind="entry.kind"
      >
        <div class="entry-line">
          <span class="entry-title">{{ t(entry.titleKey) }}</span>
          <span class="entry-at">{{ when(entry.at) }}</span>
        </div>
        <p
          v-if="entry.detail"
          class="entry-detail"
        >
          {{ entry.detail }}
        </p>
        <p
          v-if="entry.reference"
          class="entry-reference"
        >
          {{ entry.reference.value }}
        </p>
        <p
          v-if="entry.author"
          class="entry-author"
        >
          {{ actorName(entry.author) }}
          <span
            v-if="actorSession(entry.author)"
            class="entry-session"
            >{{ actorSession(entry.author) }}</span
          >
        </p>
      </li>
    </ol>
    <DataEmptyState
      v-else
      :title="t('workItem.noActivity')"
      compact
    />
  </div>
</template>

<style scoped>
.activity {
  display: grid;
  gap: var(--space-section);
}

.feed {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

.entry {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.entry-line {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: baseline;
}

.entry-title {
  color: var(--color-text);
  font: var(--font-strong);
}

.entry-at {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.entry-detail {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-line);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.entry-reference {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.entry-author {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.entry-session {
  font-variant-numeric: tabular-nums;
}
</style>
