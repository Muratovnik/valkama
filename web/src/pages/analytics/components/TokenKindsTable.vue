<script setup lang="ts">
/**
 * The period's tokens by kind as a table: each kind the tokens figure counts, largest first,
 * beside its tokens in the period it is compared with and how it moved; then the row of their sum,
 * which is the «Tokens» figure of the summary; then the kinds that figure leaves out, as notes in
 * the quiet ink. An answer whose period before was not read has no column for it. Narrowed to
 * accounts, a kind moves by the page's one rule beside what the read left out on no account
 * (`lineChangeOf`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import { useKindWords } from '@/pages/analytics/composables/useKindWords.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { KindLine } from '@/pages/analytics/utils/tokenKinds.ts'
import { lineChangeOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

import ChartTable from '@/shared/ui/ChartTable.vue'

const props = defineProps<{
  /** The period the figures are compared with; null when it was not read. */
  compared: { from: string; to: string } | null
  lines: readonly KindLine[]
  /** The sum of the counted kinds, as the panel writes it. */
  total: string
}>()

const { t } = useI18n()
const words = useSpendingWords()
const kindWords = useKindWords()

const title = computed(() => t('analytics.kinds.table'))

/** So many tokens as a line the page's change rule reads. */
const spent = (tokens: number | null): Spent => ({
  seconds: 0,
  tokens,
  cost: null,
  unpriced: 0,
})

const beforeHead = computed(() =>
  props.compared
    ? t('analytics.panel.table.heads.before', {
        period: words.period(props.compared.from, props.compared.to),
      })
    : '',
)

const rows = computed(() =>
  props.lines.map((line) => {
    const before = line.before ?? null
    const now = spent(line.count)
    return {
      key: line.kind,
      counted: line.counted,
      name: kindWords.name(line),
      count: kindWords.count(line.count),
      before: kindWords.count(before),
      change: words.lineChange(
        'tokens',
        lineChangeOf(
          'tokens',
          now,
          spent(before),
          line.unplaced === undefined ? undefined : spent(line.unplaced),
        ),
        now,
        spent(before),
      ),
    }
  }),
)
const counted = computed(() => rows.value.filter((row) => row.counted))
const apart = computed(() => rows.value.filter((row) => !row.counted))
</script>

<template>
  <PanelLevel
    class="kinds-table"
    level="block"
    :title="title"
  >
    <ChartTable
      :label="title"
      :empty="!lines.length"
      :words="{ empty: t('analytics.bars.empty') }"
    >
      <thead>
        <tr>
          <th
            scope="col"
            class="chart-cell chart-heading"
          >
            {{ t('analytics.kinds.kind') }}
          </th>
          <th
            scope="col"
            class="chart-cell chart-heading"
            data-numeric="true"
          >
            {{ t('analytics.panel.table.heads.tokens') }}
          </th>
          <template v-if="compared">
            <th
              scope="col"
              class="chart-cell chart-heading"
              data-numeric="true"
            >
              {{ beforeHead }}
            </th>
            <th
              scope="col"
              class="chart-cell chart-heading"
              data-numeric="true"
            >
              {{ t('analytics.table.change') }}
            </th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in counted"
          :key="row.key"
          :data-kind="row.key"
        >
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ row.name }}
          </th>
          <td
            class="chart-cell"
            data-numeric="true"
          >
            {{ row.count }}
          </td>
          <template v-if="compared">
            <td
              class="chart-cell"
              data-numeric="true"
            >
              {{ row.before }}
            </td>
            <td
              class="chart-cell"
              data-numeric="true"
            >
              {{ row.change }}
            </td>
          </template>
        </tr>
        <tr class="kinds-table-total">
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ t('analytics.panel.table.total') }}
          </th>
          <td
            class="chart-cell"
            data-numeric="true"
          >
            {{ total }}
          </td>
          <td
            v-if="compared"
            class="chart-cell"
            colspan="2"
          />
        </tr>
        <tr
          v-for="row in apart"
          :key="row.key"
          class="chart-rest"
          :data-kind="row.key"
        >
          <th
            scope="row"
            class="chart-cell chart-name"
          >
            {{ row.name }}
          </th>
          <td
            class="chart-cell"
            data-numeric="true"
          >
            {{ row.count }}
          </td>
          <template v-if="compared">
            <td
              class="chart-cell"
              data-numeric="true"
            >
              {{ row.before }}
            </td>
            <td
              class="chart-cell"
              data-numeric="true"
            >
              {{ row.change }}
            </td>
          </template>
        </tr>
      </tbody>
    </ChartTable>
  </PanelLevel>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
/* The sum the counted kinds add up to, in the full ink and the heavier weight, and set apart by
   air from the kinds the sum leaves out under it. */
.kinds-table-total > * {
  padding-block-end: var(--space-4);
  color: var(--color-text);
  font-weight: 600;
}
</style>
