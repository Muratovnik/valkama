<script setup lang="ts">
/**
 * The done work estimates are judged by: how many done tasks of the scope there are, and the
 * table of them by project and kind, and under each the same of those carrying one label, with
 * how many tasks a row holds and the median of their agent time and of their tokens processed
 * anew. A row of several projects or of none names the space it stands in. Until the scope has
 * as many done tasks as an estimate needs (`min_basis`), the line over the table says so.
 *
 * Each row carries `data-level`, `project_kind` or `project_kind_label`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVolumesWords } from '@/pages/volumes/composables/useVolumesWords.ts'

import type { Volumes } from '@/shared/api/volumesReadApi.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'

const props = defineProps<{ estimates: Volumes['estimates'] }>()

const { t } = useI18n()
const words = useVolumesWords()

const basis = computed(() => {
  const { basis: count, min_basis: least } = props.estimates
  const line = t('volumes.estimates.basis', { count }, count)
  return count < least ? `${line} ${t('volumes.estimates.few', { least }, least)}` : line
})

const rows = computed(() =>
  props.estimates.rows.map((row, at) => ({
    key: `${at}`,
    level: row.level,
    group: [
      words.projectName(row.project, row.space?.key ?? null),
      t(`workItem.kind.${row.kind}`),
      row.label ?? '',
    ]
      .filter(Boolean)
      .join(' · '),
    tasks: row.tasks,
    time: words.span(row.agent_seconds.median),
    tokens: words.compact(row.tokens_anew.median),
  })),
)
const emptyWords = computed(() => ({ empty: t('volumes.estimates.empty') }))
</script>

<template>
  <section
    class="volumes-estimates"
    :aria-label="t('volumes.estimates.label')"
  >
    <h2 class="volumes-heading">
      {{ t('volumes.estimates.label') }}
      <span class="volumes-heading-count">{{ basis }}</span>
    </h2>
    <ChartTable
      :empty="!rows.length"
      :label="t('volumes.estimates.label')"
      :words="emptyWords"
    >
      <thead>
        <tr>
          <th
            scope="col"
            class="chart-cell chart-heading"
          >
            {{ t('volumes.estimates.group') }}
          </th>
          <th
            scope="col"
            class="chart-cell chart-heading"
            data-numeric="true"
          >
            {{ t('volumes.estimates.tasks') }}
          </th>
          <th
            scope="col"
            class="chart-cell chart-heading"
            data-numeric="true"
          >
            {{ t('volumes.estimates.time') }}
          </th>
          <th
            scope="col"
            class="chart-cell chart-heading"
            data-numeric="true"
          >
            {{ t('volumes.estimates.tokens') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.key"
          :data-level="row.level"
        >
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ row.group }}
          </th>
          <td
            class="chart-cell volumes-figure"
            data-numeric="true"
          >
            {{ row.tasks }}
          </td>
          <td
            class="chart-cell volumes-figure"
            data-numeric="true"
          >
            {{ row.time }}
          </td>
          <td
            class="chart-cell volumes-figure"
            data-numeric="true"
          >
            {{ row.tokens }}
          </td>
        </tr>
      </tbody>
    </ChartTable>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/pages/volumes/components/volumesSection.css"></style>

<style scoped>
.volumes-estimates {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
}

/* A label's row stands under its project and kind, indented one step. */
[data-level='project_kind_label'] > .chart-name {
  padding-inline-start: var(--space-5);
  color: var(--color-text-muted);
}
</style>
