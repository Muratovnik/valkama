<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  groupHistory,
  matchesRecorded,
} from '@/widgets/work-item-inspector/utils/historyRecords.ts'
import { buildActivity } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'
import type { ActivityEntry } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
}>()

const { t, te, d, locale } = useI18n()
const query = ref('')
const category = ref('')
const author = ref('')
function reset() {
  query.value = ''
  category.value = ''
  author.value = ''
}
watch(() => props.item.work_item_id, reset)

const entries = computed(() => buildActivity(props.item))
const emptyTitle = computed(() =>
  t(entries.value.length ? 'history.noMatches' : 'workItem.noActivity'),
)
const categories = computed(() => [
  { value: '', label: t('history.all') },
  { value: 'event', label: t('history.events') },
  { value: 'ref', label: t('history.evidence') },
])
const authors = computed(() => [
  { value: '', label: t('history.allActors') },
  ...[...new Set(entries.value.map((entry) => entry.author).filter(Boolean))].map((value) => ({
    value,
    label: value,
  })),
])
function title(entry: ActivityEntry) {
  return te(entry.titleKey)
    ? t(entry.titleKey)
    : t('history.unknownEvent', { action: entry.action ?? entry.kind })
}
const groups = computed(() =>
  groupHistory(
    entries.value.filter(
      (entry) =>
        (!category.value || entry.kind === category.value) &&
        (!author.value || entry.author === author.value) &&
        matchesRecorded([entry, title(entry)], query.value),
    ),
    (entry) => entry.at,
  ),
)
function groupLabel(date: Date | null) {
  return date
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(date)
    : t('history.unknownDate')
}
function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <div class="activity">
    <p class="entry-detail">{{ t('history.scope') }}</p>
    <div class="history-filters">
      <VTextInput
        v-model="query"
        :label="t('history.search')"
      />
      <ChoiceSelect
        v-model="category"
        :label="t('history.category')"
        :options="categories"
      />
      <ChoiceSelect
        v-model="author"
        :label="t('history.actor')"
        :options="authors"
      />
    </div>
    <section
      v-for="group in groups"
      :key="group.key"
      class="history-group"
    >
      <SectionHeading
        as="h3"
        level="panel"
        >{{ groupLabel(group.date) }}</SectionHeading
      >
      <ol class="feed">
        <li
          v-for="entry in group.records"
          :key="entry.key"
          class="entry"
          :data-kind="entry.kind"
        >
          <div class="entry-line">
            <span class="entry-title">{{ title(entry) }}</span>
            <span class="entry-at">{{ when(entry.at) }}</span>
          </div>
          <details
            v-if="entry.detail || entry.reference"
            class="entry-context"
          >
            <summary>{{ t('history.detail') }}</summary>
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
          </details>
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
    </section>
    <DataEmptyState
      v-if="!groups.length"
      :title="emptyTitle"
      compact
    >
      <template
        v-if="entries.length"
        #action
      >
        <VButton @click="reset">{{ t('history.reset') }}</VButton>
      </template>
    </DataEmptyState>
  </div>
</template>

<style scoped>
.activity {
  display: grid;
  gap: var(--space-section);
}

.history-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  gap: var(--space-3);
}

.history-group {
  display: grid;
  gap: var(--space-heading-content);
}

.entry-context {
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
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
