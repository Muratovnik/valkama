<script setup lang="ts">
/**
 * The goals of the scope as a tree in the section table (`SectionTable`): each goal, its stages
 * under it to any depth, on the tree's rows (`useGoalTree`, `TreeRowLead`, `useListKeys`). One
 * Tab stop, ↑ ↓ through the rows, → opens a folded row, ← folds an open one or goes to its parent,
 * and Enter or a press anywhere on a row opens its card.
 *
 * A row says where the goal stands, «closed N of M», how many tasks stood under it at acceptance
 * (K, or «—» with why the read gives none), what it spent without the cancelled and with them,
 * and the estimate of what is left with the done tasks it is judged by. Every figure is the read's
 * own: a goal's spending is its own work, its stages' rows and its tasks', added up by the server.
 * Each heading sorts the rows that share a parent by its column; the read's order stands first.
 * A row's name is its reference over its title, and under the title what the row says of itself:
 * the goal over a row past the fifth indent, another space, a part. Each carries `data-part`:
 * `reference`, `title` and `detail`.
 *
 * A space with no goal says so in the table's place, the work outside goals being counted below.
 * Each row carries `data-id` and `data-reference`, and each figure `data-figure`: `closed`,
 * `baseline`, `spent`, `spent-all` or `remaining`.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { goalLines, useGoalTree } from '@/pages/volumes/composables/useGoalTree.ts'
import type { GoalLine } from '@/pages/volumes/composables/useGoalTree.ts'
import { useVolumesWords } from '@/pages/volumes/composables/useVolumesWords.ts'

import SectionTable from '@/widgets/section-table/components/SectionTable.vue'
import { useColumnSort } from '@/widgets/section-table/composables/useColumnSort.ts'

import { PARTS } from '@/entities/work-item/composables/useGoalSpendWords.ts'
import type { Figure } from '@/entities/work-item/composables/useGoalSpendWords.ts'

import type { Volumes, VolumesGoal } from '@/shared/api/volumesReadApi.ts'
import { useReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import { standingOf } from '@/shared/lib/standing.ts'
import { treeRowAttrs } from '@/shared/lib/treeRows.ts'
import { useStandingName } from '@/shared/lib/useStateName.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import TreeRowLead from '@/shared/ui/TreeRowLead.vue'
import { useListKeys } from '@/shared/ui/useListKeys.ts'

const props = defineProps<{
  goals: Volumes['goals']
  measuredFrom: string | null
  /** The space the reader's folds are kept by; every space has a key of its own. */
  space: string
}>()

const { locale, t } = useI18n()
const words = useVolumesWords()
const standingName = useStandingName()
const resolve = useReferenceLinks()

/** The deepest level the indent reaches; a row deeper names the row over it. */
const LEVELS = 5

const COLUMNS = ['goal', 'state', 'closed', 'baseline', 'spent', 'spentAll', 'remaining'] as const
type Column = (typeof COLUMNS)[number]
const NUMERIC: ReadonlySet<Column> = new Set([
  'closed',
  'baseline',
  'spent',
  'spentAll',
  'remaining',
])

const lines = computed(() => goalLines(props.goals))
const readOrder = computed(() => new Map(lines.value.map((line, at) => [line, at])))

const {
  sortBy,
  lines: sorted,
  marks,
} = useColumnSort({
  columns: () => COLUMNS.map((key) => ({ key, ascendingFirst: key === 'goal' || key === 'state' })),
  first: () => 'goal',
  lines: () => lines.value,
  locale: () => locale.value,
  value: (line: GoalLine, column) => {
    const { goal } = line
    if (column === 'goal') return readOrder.value.get(line) ?? 0
    if (column === 'state') return standingName(goal)
    if (column === 'closed') return goal.tasks.total ? goal.tasks.closed / goal.tasks.total : 0
    if (column === 'baseline') return goal.baseline?.tasks ?? null
    if (column === 'spent') return goal.spent.agent_seconds
    if (column === 'spentAll') return goal.spent_with_cancelled.agent_seconds
    return goal.remaining?.estimated ? goal.remaining.agent_seconds : null
  },
})

const tree = useGoalTree({ sorted: () => sorted.value, space: () => props.space })
/** A figure's cell: its text, the hint that says why it is «—» or not whole, and its hook. */
interface FigureCell extends Figure {
  /** The estimate's done tasks, under its figure; empty elsewhere. */
  basis: string
  /** The hint as the cell's description; absent with no hint, so nothing empty is read out. */
  description: string | undefined
  key: 'baseline' | 'closed' | 'remaining' | 'spent' | 'spent-all'
  /**
   * Its time and its tokens, which stand on two lines where the table is short of room; a part
   * with no digit, such as «nothing spent», is words, which may break between them.
   */
  parts: { text: string; words: boolean }[]
}

const DIGIT = /\d/u

const cell = (key: FigureCell['key'], figure: Figure, basis = ''): FigureCell => ({
  ...figure,
  key,
  basis,
  description: figure.hint || undefined,
  parts: figure.text.split(PARTS).map((text) => ({ text, words: !DIGIT.test(text) })),
})

/** What the row says under its name: the row over a row past the indent, its space, its part. */
function detailOf(goal: VolumesGoal, depth: number): string {
  const under =
    depth >= LEVELS && goal.parent_reference
      ? t('volumes.goals.under', { reference: goal.parent_reference })
      : ''
  const space = goal.other_space
    ? t('volumes.goals.otherSpace', { space: goal.other_space.key })
    : ''
  return [under, space, goal.partial ? t('volumes.goals.partial') : ''].filter(Boolean).join(' · ')
}

const rows = computed(() =>
  tree.rows.value.map((row) => {
    const { goal } = row.item
    const { basis, ...remaining } = words.remaining(goal)
    return {
      row,
      goal,
      detail: detailOf(goal, row.depth),
      labelledBy: `${nameOf(row.id, 'reference')} ${nameOf(row.id, 'title')}`,
      figures: [
        cell('closed', { text: words.closed(goal), hint: '' }),
        cell('baseline', words.baseline(goal)),
        cell('spent', words.spent(goal.spent, props.measuredFrom)),
        cell('spent-all', words.spent(goal.spent_with_cancelled, props.measuredFrom)),
        cell('remaining', remaining, basis),
      ],
    }
  }),
)

const HEADINGS: Record<Column, string> = {
  goal: 'volumes.goals.goal',
  state: 'volumes.goals.state',
  closed: 'volumes.goals.closed',
  baseline: 'volumes.goals.baseline',
  spent: 'volumes.goals.spent',
  spentAll: 'volumes.goals.spentAll',
  remaining: 'volumes.goals.remaining',
}
const columns = computed(() =>
  COLUMNS.map((key) => ({ key, text: t(HEADINGS[key]), numeric: NUMERIC.has(key) })),
)
const sortWords = (column: string) => t('volumes.goals.sortBy', { column })
const emptyWords = computed(() => ({
  empty: t('volumes.goals.noGoals'),
  emptyDescription: t('volumes.goals.noGoalsDescription'),
}))
const holds = computed(() => [props.goals])

const nameOf = (id: string, part: string) => `goal-${id}-${part}`

const root = ref<HTMLElement | null>(null)
const open = (reference: string) => resolve({ kind: 'work-item', value: reference })?.open()
const keys = useListKeys(
  root,
  () => ({
    count: () => rows.value.length,
    heightAt: (index) =>
      root.value?.querySelector<HTMLElement>(`tbody tr:nth-child(${index + 1})`)?.offsetHeight ?? 0,
    idAt: (index) => rows.value[index]?.row.id,
    placeOf: tree.placeOf,
    reveal: () => false,
  }),
  open,
  { kind: 'row', tree },
)
const { tabStop, toggle } = keys
</script>

<template>
  <div
    ref="root"
    class="volumes-goals"
  >
    <SectionTable
      class="volumes-goals-table"
      :columns="columns"
      :empty="!rows.length"
      :empty-words="emptyWords"
      :holds="holds"
      :label="t('volumes.goals.label')"
      :marks="marks"
      :sort-words="sortWords"
      tree
      @sort="sortBy"
    >
      <template #head>
        <h2 class="volumes-heading">{{ t('volumes.goals.label') }}</h2>
      </template>
      <template #rows>
        <tr
          v-for="line in rows"
          :key="line.row.id"
          class="row-state volumes-goal-row"
          v-bind="treeRowAttrs(line.row)"
          :aria-labelledby="line.labelledBy"
          :data-id="line.row.id"
          :data-reference="line.goal.reference"
          :tabindex="tabStop(line.row.id)"
        >
          <th
            scope="row"
            class="chart-cell chart-name volumes-goal"
            tabindex="-1"
          >
            <span class="volumes-goal-line">
              <TreeRowLead
                :depth="line.row.depth"
                :expanded="line.row.expanded"
                :levels="LEVELS"
                :name="line.goal.reference"
                @toggle="toggle(line.row.id)"
              />
              <span class="volumes-goal-words">
                <span
                  :id="nameOf(line.row.id, 'reference')"
                  class="volumes-goal-reference"
                  data-part="reference"
                  >{{ line.goal.reference }}</span
                >
                <span
                  :id="nameOf(line.row.id, 'title')"
                  v-tooltip.clipped="line.goal.title"
                  v-slash-breaks="line.goal.title"
                  class="volumes-goal-title"
                  data-part="title"
                />
                <span
                  v-if="line.detail"
                  class="chart-detail"
                  data-part="detail"
                  >{{ line.detail }}</span
                >
              </span>
            </span>
          </th>
          <td
            class="chart-cell"
            tabindex="-1"
          >
            <SemanticState
              dimension="work-item-state"
              :state="standingOf(line.goal)"
              :label="standingName(line.goal)"
            />
          </td>
          <td
            v-for="figure in line.figures"
            :key="figure.key"
            v-tooltip.detail="figure.hint"
            class="chart-cell volumes-figure"
            data-numeric="true"
            tabindex="-1"
            :data-figure="figure.key"
            :aria-description="figure.description"
          >
            <span
              v-for="(part, at) in figure.parts"
              :key="at"
              class="volumes-figure-part"
              :class="{ 'volumes-figure-words': part.words }"
              ><span
                v-if="at"
                class="volumes-figure-joint"
                >{{ PARTS }}</span
              >{{ part.text }}</span
            >
            <!-- The space keeps the basis a word of its own in the cell's text. -->
            <span
              v-if="figure.basis"
              class="chart-detail volumes-figure-basis"
              >{{ ` ${figure.basis}` }}</span
            >
          </td>
        </tr>
      </template>
    </SectionTable>
  </div>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>

<style scoped src="@/pages/volumes/components/volumesSection.css"></style>

<style scoped>
.volumes-goals {
  min-width: 0;
}

/* The frame holds the panel's height less the section's heading, which the page's layout gives:
   no guess at what stands over the panel, which a bar of two rows on a phone made wrong. */
.volumes-goals-table {
  --size-section-table-over: calc(100dvh - 100cqb + 3rem);
}

/* A row's cells stand on its middle, and an estimate's basis stands under its figure. */
.volumes-goal-row {
  cursor: pointer;

  & > .chart-cell {
    vertical-align: middle;
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

.volumes-goal {
  color: var(--color-text);
  font: inherit;
  text-align: start;
}

/* The indent and its arrow, then the row's words: its reference over its title, and under the
   title what the row says of itself, such as the goal over a row past the fifth indent, all on
   the title's edge. While the table has room for it, the words keep their own width whatever the
   indent takes, so a deep row's title reads on lines as long as a shallow one's (where it has not,
   they give way, below): beside the reference, in a column held at its
   least, a goal six levels down kept some 54px of 276 for its title, which broke into six lines,
   and its «in MAIN-17» stood at the cell's start, 182px left of the title. The arrow stands on the
   reference's line. */
.volumes-goal-line {
  display: flex;
  align-items: flex-start;
  min-width: 0;
}

.volumes-goal-words {
  display: grid;
  flex: 1;
  min-inline-size: 11rem;
}

.volumes-goal-reference {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

/* Where the table is too narrow for its headings on one line (`SectionTable`), a spend stands on
   two lines, its time over its tokens, and the column of names takes the room that gives: on one
   line the spends took 171px a column and left the names 276. */
.volumes-goals-table:is([data-fit='two'], [data-fit='least']) .volumes-figure-part {
  display: block;
}

.volumes-goals-table:is([data-fit='two'], [data-fit='least']) .volumes-figure-joint {
  display: none;
}

/* Where even two lines leave a column past the frame (`least`), the names give way down to their
   longest word, the indent kept, and a figure said in words — «расхода нет», the done tasks an
   estimate is judged by — breaks between its words; a figure with digits keeps its line. At 1280
   in Russian, a goal six levels deep held the names at 320px and «Осталось ≈» stood 135px past
   the frame. */
.volumes-goals-table[data-fit='least'] {
  & .volumes-goal-words {
    min-inline-size: 0;
  }

  & :is(.volumes-figure-words, .volumes-figure-basis) {
    overflow-wrap: normal;
    white-space: normal;
  }
}
</style>
