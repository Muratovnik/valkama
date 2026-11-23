<script setup lang="ts">
/**
 * How work flowed in the period: how many tasks came in and came to a close, the owner's
 * decisions made in the interface and the commits of a known repository, for the whole period
 * and day by day, oldest first, the days adding up to the period's figures. Over them the pace of
 * the scope's tasks in a chain's words (`useChainForecast`): what the last days added and closed,
 * and what closing them all asks a day. The pace's days are the reader's, as the read counts them.
 *
 * The days' table scrolls in its own frame where a long period has more days than its room. Each
 * day's row carries `data-day`; each figure `data-measure`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useChainForecast } from '@/widgets/work-item-inspector/utils/useChainForecast.ts'

import type { Volumes } from '@/shared/api/volumesReadApi.ts'
import { localDay } from '@/shared/lib/periodDays.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'

const props = defineProps<{
  flow: Volumes['flow']
  /** The moment the page was read at, whose day the pace counts to. */
  now: Date
}>()

const { locale, t } = useI18n()

const forecast = useChainForecast(
  () => props.flow.pace,
  () => localDay(props.now),
)

/** What the last days did, and what closing the rest asks a day. */
const paceLine = computed(() =>
  [forecast.pace.value, forecast.verdict.value].filter(Boolean).join(' '),
)

const MEASURES = ['created', 'closed', 'decisions', 'commits'] as const

const totals = computed(() =>
  MEASURES.map((measure) => ({
    measure,
    label: t(`volumes.flow.${measure}`),
    count: props.flow.totals[measure],
  })),
)

const dayWords = computed(
  () => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', weekday: 'short' }),
)
/** The days newest first, as a reader looks back from today. */
const days = computed(() =>
  [...props.flow.days].reverse().map((day) => {
    const [year, month, date] = day.day.split('-').map(Number)
    return { ...day, label: dayWords.value.format(new Date(year, month - 1, date)) }
  }),
)
const emptyWords = computed(() => ({ empty: t('volumes.flow.empty') }))
</script>

<template>
  <section
    class="volumes-flow"
    :aria-label="t('volumes.flow.label')"
  >
    <h2 class="volumes-heading">{{ t('volumes.flow.label') }}</h2>
    <dl class="volumes-flow-totals">
      <div
        v-for="total in totals"
        :key="total.measure"
        class="volumes-flow-total"
        :data-measure="total.measure"
      >
        <dt class="volumes-flow-total-name">{{ total.label }}</dt>
        <dd class="volumes-figure volumes-flow-total-figure">{{ total.count }}</dd>
      </div>
    </dl>
    <p
      v-if="paceLine"
      class="volumes-flow-pace"
      data-region="pace"
    >
      {{ paceLine }}
    </p>
    <ChartTable
      class="volumes-flow-days"
      :empty="!days.length"
      :label="t('volumes.flow.byDay')"
      :words="emptyWords"
    >
      <thead>
        <tr>
          <th
            scope="col"
            class="chart-cell chart-heading"
          >
            {{ t('volumes.flow.day') }}
          </th>
          <th
            v-for="total in totals"
            :key="total.measure"
            scope="col"
            class="chart-cell chart-heading"
            data-numeric="true"
          >
            {{ total.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="day in days"
          :key="day.day"
          :data-day="day.day"
        >
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ day.label }}
          </th>
          <td
            v-for="measure in MEASURES"
            :key="measure"
            class="chart-cell volumes-figure"
            data-numeric="true"
            :data-measure="measure"
          >
            {{ day[measure] }}
          </td>
        </tr>
      </tbody>
    </ChartTable>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/pages/volumes/components/volumesSection.css"></style>

<style scoped>
.volumes-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
}

/* The period's four figures in a row, each its name over its figure, wrapping on a phone. */
.volumes-flow-totals {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-6);
  margin: 0;
}

.volumes-flow-total {
  display: grid;
  gap: var(--space-half);
}

.volumes-flow-total-name {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.volumes-flow-total-figure {
  margin: 0;
  font: var(--font-section-title);
}

.volumes-flow-pace {
  margin: 0;
  color: var(--color-text-muted);
}

/* A long period's days scroll in the table's own frame rather than lengthening the page. */
.volumes-flow-days {
  max-block-size: 24rem;
  overflow: auto;
}
</style>
