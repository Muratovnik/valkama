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
 * A name cut at the card's edge is whole in the line's hint, under the pointer and in the keyboard's
 * focus, and a name the card holds whole has none.
 *
 * An entry acts as a bar of the breakdown by task does (`useLineActions`): pressed, it opens the
 * value's side panel, sent out as `inspect` — a task's is a link to its card as well, which a
 * press with a modifier or the middle button opens elsewhere, and work with no task a control —
 * and work nobody can place is a line. With no period before read, the block says so with the page's own way to read it again, and with
 * nothing moved, that nothing did.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useOverviewWords } from '@/pages/analytics/composables/useOverviewWords.ts'
import { useHeadingUnder } from '@/pages/analytics/composables/usePanelOutline.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { mostMoved } from '@/pages/analytics/utils/overviewFigures.ts'
import type { MovedLine } from '@/pages/analytics/utils/overviewFigures.ts'
import { comparedLines, figureOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  measure: Measure
  /** An answer by task, beside the period before. */
  usage: Usage
}>()
/** Read the answer again, for a period before that could not be read; a value pressed. */
const emit = defineEmits<{ inspect: [value: string | null, label: string]; retry: [] }>()

const { t } = useI18n()
const words = useSpendingWords()
const overviewWords = useOverviewWords()
const actions = useLineActions()
/** The card's heading one under the level it stands in, and each way of change one under that. */
const headingAs = useHeadingUnder()
const wayAs = useHeadingUnder(2)

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
      .sort((left, right) => Math.abs(right.by) - Math.abs(left.by))
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
  const inspects = actions.inspectsTo('work_item', one.line.value) !== undefined
  return {
    key: one.line.key,
    name,
    amount,
    note,
    icon: one.by > 0 ? 'arrow-up' : 'arrow-down',
    href,
    tag: tagOf(href, inspects),
    type: href || !inspects ? undefined : 'button',
    action: inspects ? actions.inspectName(name) : undefined,
  }
}

/** A task with a card is its link, a value with a panel its button, and unknown work neither. */
function tagOf(href: string | undefined, inspects: boolean) {
  if (href) return 'a'
  return inspects ? 'button' : 'div'
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

const lineOf = (key: string) =>
  [...moved.value.up, ...moved.value.down].find((one) => one.line.key === key)?.line ?? null

/** An entry pressed to open its value's side panel. */
function inspect(key: string) {
  const line = lineOf(key)
  const value = actions.inspectsTo('work_item', line?.value ?? null)
  if (line?.value && value !== undefined)
    emit('inspect', value, words.valueLabel('work_item', line.value))
}

/** An entry pressed: a task's link opens its panel, or its card elsewhere (`follow`). */
function press(key: string, event: MouseEvent) {
  const link = actions.taskLink('work_item', lineOf(key)?.value ?? null)
  if (link) actions.follow(link, event, () => inspect(key))
  else inspect(key)
}

/** A middle press on a task's link opens its card elsewhere, and is a press on it all the same. */
function pressAside(key: string, event: MouseEvent) {
  const link = actions.taskLink('work_item', lineOf(key)?.value ?? null)
  if (link && event.button === 1) actions.follow(link, event, () => inspect(key))
}
</script>

<template>
  <section
    class="overview-changes"
    :aria-label="label"
  >
    <component
      :is="headingAs"
      class="overview-changes-head"
    >
      {{ t('analytics.overview.changes.title') }}
    </component>
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
        <component
          :is="wayAs"
          class="visually-hidden"
        >
          {{ group.heading }}
        </component>
        <ul class="overview-changes-list">
          <li
            v-for="line in group.lines"
            :key="line.key"
          >
            <component
              :is="line.tag"
              v-tooltip.clipped="line.name"
              class="overview-changes-line"
              :href="line.href"
              :type="line.type"
              :aria-description="line.action"
              :data-way="group.way"
              @click="(event: MouseEvent) => line.action && press(line.key, event)"
              @auxclick="(event: MouseEvent) => pressAside(line.key, event)"
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
   figures and the words for a side with nothing, which give way before the amount does. A control
   is the line it stands for, across the card's width. */
.overview-changes-line {
  display: grid;
  inline-size: 100%;
  padding: 0 var(--space-2);
  border: 0;
  color: var(--color-text);
  font: var(--font-detail);
  text-align: start;
  text-decoration: none;
  background: none;
  border-radius: var(--radius-control);

  &:is([href], [type='button']) {
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
