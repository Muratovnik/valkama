<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import HistoryFilterBar from '@/widgets/work-item-inspector/components/HistoryFilterBar.vue'
import { eventWords } from '@/widgets/work-item-inspector/utils/eventWords.ts'
import {
  groupHistory,
  matchesRecorded,
} from '@/widgets/work-item-inspector/utils/historyRecords.ts'
import { buildActivity } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'
import type { ActivityEntry } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  item: WorkItem
}>()

const { t, te, locale } = useI18n()
const query = ref('')
const selected = ref<Record<string, string>>({ category: '', author: '' })
function reset() {
  query.value = ''
  selected.value = { category: '', author: '' }
}
watch(() => props.item.work_item_id, reset)

const entries = computed(() => buildActivity(props.item))
const emptyTitle = computed(() =>
  t(entries.value.length ? 'history.noMatches' : 'workItem.noActivity'),
)
const choices = computed(() => [
  {
    id: 'category',
    label: t('history.category'),
    options: [
      { value: '', label: t('history.all') },
      { value: 'event', label: t('history.events') },
      { value: 'ref', label: t('history.evidence') },
    ],
  },
  {
    id: 'author',
    label: t('history.actor'),
    options: [
      { value: '', label: t('history.allActors') },
      ...[...new Set(entries.value.map((entry) => entry.author).filter(Boolean))].map((value) => ({
        value,
        label: value,
      })),
    ],
  },
])
function title(entry: ActivityEntry) {
  return te(entry.titleKey)
    ? t(entry.titleKey)
    : t('history.unknownEvent', { action: entry.action ?? entry.kind })
}
/** The row's second line in words; the recorded line stays in the entry for the search. */
function detail(entry: ActivityEntry) {
  return entry.kind === 'event' ? eventWords(entry, props.item.comments, t) : entry.detail
}
const groups = computed(() => {
  const { category, author } = selected.value
  return groupHistory(
    entries.value.filter(
      (entry) =>
        (!category || entry.kind === category) &&
        (!author || entry.author === author) &&
        matchesRecorded([entry, title(entry), detail(entry)], query.value),
    ),
    (entry) => entry.at,
  )
})
function groupLabel(date: Date | null) {
  return date
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(date)
    : t('history.unknownDate')
}
/** The group heading already says which day, so a row says only when in it. */
function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }).format(date)
}
/** The reference value, unless the label already says it. */
function referenceValue(entry: ActivityEntry) {
  const value = entry.reference?.value ?? ''
  return value && value !== entry.detail ? value : ''
}
</script>

<template>
  <div class="activity">
    <div class="activity-filters">
      <p class="activity-scope">{{ t('history.scope') }}</p>
      <HistoryFilterBar
        v-model:query="query"
        v-model:selected="selected"
        :search-label="t('history.search')"
        :choices="choices"
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
        <!-- What happened, then what it was about, then who: the recorded
             substance is the row's second line, where it used to hide inside a
             "Recorded details" disclosure on every single row. -->
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
          <RichText
            v-if="detail(entry)"
            class="entry-detail"
            :source="detail(entry)"
          />
          <p
            v-if="referenceValue(entry)"
            class="entry-reference"
          >
            <RichText
              :source="referenceValue(entry)"
              inline
            />
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

.activity-filters {
  display: grid;
  gap: var(--space-3);
}

.activity-scope {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.history-group {
  display: grid;
  gap: var(--space-heading-content);
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
  gap: var(--space-1);
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
  font: var(--font-note);
  overflow-wrap: anywhere;
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
