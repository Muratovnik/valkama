<script setup lang="ts">
/**
 * What changed from the period before, a card in the overview's row of cards: the tasks whose
 * figure in the page's measure rose most and fell most (`mostMoved`), the `SHOWN` that moved by
 * the most of either way, each its name on a line of its own and under it an arrow, the amount in
 * the measure's own units, «+6 h 11 min», and words where a side had nothing at all. Two lines an
 * entry and four entries stand as high as a card's five rows, so the row stays one height and the
 * name has the card's whole width. Work on no task is among them, by its name, as it is a large
 * part of what a period spends. The arrow says the way; the headings of the ways are for a
 * screen reader.
 *
 * A task is a link to its card, as a bar of the breakdown by task is; the rest are lines. With no
 * period before read, the block says so with the page's own way to read it again, and with
 * nothing moved, that nothing did.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useOverviewWords } from '@/pages/analytics/composables/useOverviewWords.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { mostMoved } from '@/pages/analytics/utils/overviewFigures.ts'
import type { MovedLine } from '@/pages/analytics/utils/overviewFigures.ts'
import { comparedLines, figureOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  measure: Measure
  /** An answer by task, beside the period before. */
  usage: Usage
}>()
/** Read the answer again, for a period before that could not be read. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const words = useSpendingWords()
const overviewWords = useOverviewWords()
const actions = useLineActions()

const comparison = computed(() => props.usage.comparison)
const period = computed(() =>
  comparison.value ? words.period(comparison.value.period.from, comparison.value.period.to) : '',
)
const label = computed(() =>
  period.value ? t('analytics.overview.changes.label', { period: period.value }) : undefined,
)

/** How many lines the card names: as many as stand as high as a card's rows. */
const SHOWN = 4

const most = computed(() =>
  mostMoved(
    comparedLines({
      before: comparison.value?.rows ?? null,
      dimension: 'work_item',
      measure: props.measure,
      rows: props.usage.rows,
      name: (value) => words.valueLabel('work_item', value),
    }),
    props.measure,
  ),
)
/** The lines that moved by the most of either way, each way still largest first. */
const moved = computed(() => {
  const shown = new Set(
    [...most.value.up, ...most.value.down]
      .toSorted((left, right) => Math.abs(right.by) - Math.abs(left.by))
      .slice(0, SHOWN),
  )
  return {
    up: most.value.up.filter((one) => shown.has(one)),
    down: most.value.down.filter((one) => shown.has(one)),
  }
})

/** A line as the block says it: its name, the amount, and words for a side that had nothing. */
function said(one: MovedLine) {
  const name = words.valueLabel('work_item', one.line.value)
  const amount = overviewWords.movedBy(props.measure, one.by)
  const now = figureOf(props.measure, one.line.now)
  const before = one.line.before ? figureOf(props.measure, one.line.before) : null
  let note = ''
  if (before === 0) note = t('analytics.overview.changes.newly')
  else if (now === 0) note = t('analytics.overview.changes.gone')
  const href = actions.taskLink('work_item', one.line.value)?.href
  return {
    key: one.line.key,
    name,
    amount,
    note,
    icon: one.by > 0 ? 'arrow-up' : 'arrow-down',
    href,
    tag: href ? 'a' : 'div',
  }
}

const groups = computed(() =>
  (['up', 'down'] as const)
    .map((way) => ({
      way,
      heading: t(`analytics.overview.changes.${way}`),
      lines: moved.value[way].map((one) => said(one)),
    }))
    .filter((group) => group.lines.length),
)

function follow(key: string, event: MouseEvent) {
  const line = [...moved.value.up, ...moved.value.down].find((one) => one.line.key === key)
  const link = actions.taskLink('work_item', line?.line.value ?? null)
  if (link) actions.follow(link, event)
}
</script>

<template>
  <section
    class="overview-changes"
    :aria-label="label"
  >
    <h3 class="overview-changes-head">
      {{ t('analytics.overview.changes.title') }}
    </h3>
    <div
      v-if="!comparison"
      class="overview-changes-unread"
    >
      <DataEmptyState
        :title="t('analytics.overview.changes.unread')"
        inline
      />
      <VButton
        size="compact"
        @click="emit('retry')"
      >
        {{ t('platform.actions.retry') }}
      </VButton>
    </div>
    <DataEmptyState
      v-else-if="!groups.length"
      :title="t('analytics.overview.changes.still', { period })"
      inline
    />
    <div
      v-else
      class="overview-changes-ways"
    >
      <div
        v-for="group in groups"
        :key="group.way"
      >
        <h4 class="visually-hidden">
          {{ group.heading }}
        </h4>
        <ul class="overview-changes-list">
          <li
            v-for="line in group.lines"
            :key="line.key"
          >
            <component
              :is="line.tag"
              class="overview-changes-line"
              :href="line.href"
              :data-way="group.way"
              @click="(event: MouseEvent) => line.href && follow(line.key, event)"
            >
              <span class="overview-changes-name one-line">{{ line.name }}</span>
              <span class="overview-changes-by">
                <VIcon
                  class="overview-changes-arrow"
                  :name="line.icon"
                  :size="14"
                />
                <span class="overview-changes-amount">{{ line.amount }}</span>
                <span
                  v-if="line.note"
                  class="overview-changes-note one-line"
                  >{{ line.note }}</span
                >
              </span>
            </component>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* A card of the row: its heading stands as a card's does, and its entries under it. */
.overview-changes {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  min-width: 0;
}

.overview-changes-head {
  display: flex;
  align-items: center;
  min-block-size: var(--size-control-inline);
  margin: 0;
  font: var(--font-field-label);
}

.overview-changes-unread {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
}

.overview-changes-ways {
  min-width: 0;
}

.overview-changes-list {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* An entry: the name on its line, cut to it, and under it the arrow, the amount in tabular
   figures and the words for a side with nothing, which give way before the amount does. */
.overview-changes-line {
  display: grid;
  padding: 0 var(--space-2);
  color: var(--color-text);
  font: var(--font-detail);
  text-decoration: none;
  border-radius: var(--radius-control);

  &[href] {
    cursor: pointer;

    & .overview-changes-name {
      text-decoration: underline;
      text-decoration-color: var(--color-rule-strong);
      text-underline-offset: var(--space-half);
    }

    &:hover {
      background: var(--color-surface-hover);

      & .overview-changes-name {
        text-decoration-color: currentcolor;
      }
    }
  }
}

.overview-changes-by {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  white-space: nowrap;
}

.overview-changes-arrow {
  flex: none;
  color: var(--color-text-muted);
}

.overview-changes-amount {
  flex: none;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.overview-changes-note {
  min-width: 0;
  color: var(--color-text-tertiary);
}
</style>
