<script setup lang="ts">
/**
 * The decisions of the page's view as one table that fills the section (`SectionTable`): when,
 * the participation point, the card, the session that decided and what it decided, newest first.
 * Its frame holds the rest of the window under the bar and scrolls inside itself, so a long
 * period of a thousand decisions is read in the table while the bar stays above it. Each
 * column's heading sorts by it: the moment newest first, words A to Z first.
 *
 * Over the table a line counts the decisions of the view, and while further pages are still being
 * read it says how many of how many are in (`reading`); where the view holds more than the page
 * reads, it says the newest are shown (`MOST`).
 *
 * A row's card is a link to the card, which a plain press opens over the page on its System
 * events, where the event the decision was recorded by stands marked (`InspectorActivity`); a
 * press with a modifier or the middle button is the browser's, as for any link. Each row carries
 * its event's id (`data-event`), the hook a reader of the page selects a row by.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { MOST } from '@/pages/decisions/composables/useDecisionsRead.ts'

import SectionTable from '@/widgets/section-table/components/SectionTable.vue'
import { useColumnSort } from '@/widgets/section-table/composables/useColumnSort.ts'

import type { Decision } from '@/shared/api/decisionsApi.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { opensInPlace } from '@/shared/lib/linkPress.ts'
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { useComposedText } from '@/shared/lib/useComposedText.ts'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'

const props = defineProps<{
  items: readonly Decision[]
  /** More pages are still being read. */
  reading: boolean
  /** How many decisions the view holds in all. */
  total: number
}>()

const { locale, t } = useI18n()
const resolve = useReferenceLinks()
/** What was decided in the reader's language, from the key it was composed of. */
const composed = useComposedText()

const COLUMNS = ['at', 'point', 'item', 'session', 'what'] as const
type Column = (typeof COLUMNS)[number]
const HEADINGS: Record<Column, string> = {
  at: 'decisions.table.when',
  point: 'decisions.table.point',
  item: 'decisions.table.item',
  session: 'decisions.table.session',
  what: 'decisions.table.what',
}

const pointWords = (decision: Decision) => t(`decisionPoints.${decision.point}`)
const when = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)

const { sortBy, lines, marks } = useColumnSort({
  columns: () => COLUMNS.map((key) => ({ key, ascendingFirst: key !== 'at' })),
  first: () => 'at',
  lines: () => props.items,
  locale: () => locale.value,
  value: (decision, column) => {
    if (column === 'at') return Date.parse(decision.at)
    if (column === 'point') return pointWords(decision)
    if (column === 'item') return decision.item.reference
    if (column === 'session') return holderName(decision.session)
    return composed.what(decision)
  },
})

const columns = computed(() => COLUMNS.map((key) => ({ key, text: t(HEADINGS[key]) })))
const sortWords = (column: string) => t('decisions.table.sortBy', { column })
const emptyWords = computed(() => ({ empty: t('decisions.empty') }))
const holds = computed(() => [props.items])

/** Each row as it is drawn: the moment, the point, the card's link, the session. */
const rows = computed(() =>
  lines.value.map((decision) => ({
    decision,
    at: when.value.format(new Date(decision.at)),
    point: pointWords(decision),
    session: holderName(decision.session),
    what: composed.what(decision),
    link: resolve({ kind: 'work-item', value: decision.item.reference }),
    name: t('decisions.table.open', { reference: decision.item.reference }),
  })),
)

/** The count over the table, and how far the read is while pages are still on their way. */
const counts = computed(() => {
  const shown = props.items.length
  if (props.reading) return t('decisions.table.reading', { count: shown, total: props.total })
  const count = t('decisions.table.count', { count: props.total }, props.total)
  return props.total > shown
    ? `${count} · ${t('decisions.table.most', { count: Math.min(shown, MOST), total: props.total })}`
    : count
})

/** A plain press opens the card over the page; any other is the browser's. */
function follow(row: (typeof rows.value)[number], event: MouseEvent) {
  const link = row.link
  if (!link) return
  if (opensInPlace(event)) {
    event.preventDefault()
    link.open()
  }
}
</script>

<template>
  <SectionTable
    class="decisions-table"
    :columns="columns"
    :empty="!items.length"
    :empty-words="emptyWords"
    :holds="holds"
    :label="t('decisions.table.label')"
    :marks="marks"
    :sort-words="sortWords"
    @sort="sortBy"
  >
    <template #head>
      <p
        class="decisions-table-count"
        role="status"
      >
        {{ counts }}
      </p>
    </template>
    <template #rows>
      <tr
        v-for="row in rows"
        :key="row.decision.event_id"
        class="row-state"
        :data-event="row.decision.event_id"
      >
        <td class="chart-cell chart-name decisions-at">
          <time :datetime="row.decision.at">{{ row.at }}</time>
        </td>
        <td class="chart-cell">{{ row.point }}</td>
        <th
          scope="row"
          class="chart-cell decisions-item"
        >
          <a
            v-if="row.link?.href"
            class="chart-press"
            :href="row.link.href"
            :aria-label="row.name"
            @click="(event) => follow(row, event)"
            >{{ row.decision.item.reference }}</a
          >
          <template v-else>{{ row.decision.item.reference }}</template>
          <span
            v-slash-breaks="row.decision.item.title"
            class="chart-detail"
          />
        </th>
        <td class="chart-cell decisions-session">{{ row.session }}</td>
        <td class="chart-cell decisions-what">{{ row.what }}</td>
      </tr>
    </template>
  </SectionTable>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>

<style scoped>
/* The count over the frame, and the frame in the rest of the table's height, which the page's
   layout gives it: the frame is held by that, not by a guess at what stands over it in the
   window, which a bar of two rows on a phone made too small. */
.decisions-table {
  --size-section-table-over: 0rem;

  grid-template-rows: auto minmax(0, 1fr);
}

.decisions-table-count {
  min-block-size: 1lh;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The moment and the session keep to one line; the card's title and what was decided wrap. */
.decisions-at,
.decisions-session {
  white-space: nowrap;
}

.decisions-item {
  min-inline-size: 12rem;
  color: var(--color-text);
  font: inherit;
  text-align: start;
}

.decisions-what {
  min-inline-size: 16rem;
  color: var(--color-text);
  overflow-wrap: anywhere;
}
</style>
