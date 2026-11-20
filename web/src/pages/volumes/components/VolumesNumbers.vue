<script setup lang="ts">
/**
 * The numbers on top of the Volumes page: one for each of the eight categories, in the model's
 * order, then «Waiting for me» and «Commits on no card», ten in a row where the page has room for
 * every name and in as many rows as the names need where it has not, as on a phone; they never
 * scroll sideways. A number's figure stands at its top, over its name: the figures of a row stand
 * at one height whatever lines the names take. Under an open category's name stands the age of
 * its oldest card, under «Waiting for me» that of the question asked first; a closed category
 * counts what came to stand there in the period and says so.
 *
 * A category's number counts its tasks, goals and stages, which the board's filter by category
 * shows together; under a filter only tasks match, and the number counts them alone. A number
 * opens the place that shows exactly what it counts (`volumesTargets`): an open category the board
 * with the page's filter, Done and Cancelled the Work list with the page's filter and the
 * condition «Closed in a period» for its period, «Waiting for me» the questions window. A number
 * that opens nothing is a figure whose hint says why: every space has no board.
 * «Commits on no card» counts the commits on no card of the scope's projects and shows or hides
 * their list under the numbers, saying which (`commitsOpen`); where their list cannot be read for
 * the scope, or could not be read when it was opened (`commitsUnread`), its number is «—».
 *
 * Each number carries `data-number`: the category, `waiting` or `commits`; its name, figure and
 * what stands under it carry `data-part`: `label`, `figure` and `under`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVolumesWords } from '@/pages/volumes/composables/useVolumesWords.ts'
import {
  categoryTarget,
  CLOSED,
  COMMITS_TARGET,
  WAITING_TARGET,
} from '@/pages/volumes/utils/volumesTargets.ts'
import type { VolumesTarget } from '@/pages/volumes/utils/volumesTargets.ts'
import type { VolumesView } from '@/pages/volumes/utils/volumesView.ts'

import { UNKNOWN } from '@/entities/work-item/composables/useGoalSpendWords.ts'

import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import type { Volumes } from '@/shared/api/volumesReadApi.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  /** Whether the list of the commits on no card is shown. */
  commitsOpen: boolean
  /** Whether that list could not be read, which its number says as «—». */
  commitsUnread: boolean
  counts: Volumes['counts']
  /** The moment the ages are counted to. */
  now: Date
  scope: OperatingScope
  view: VolumesView
}>()
const emit = defineEmits<{
  /** A number pressed, with the place it opens. */
  open: [target: VolumesTarget]
}>()

const { t } = useI18n()
const words = useVolumesWords()

/** What a number's press does, in words, or why it does nothing. */
function opensWords(target: VolumesTarget): string {
  if (target.kind === 'none') return t(`volumes.numbers.none.${target.reason}`)
  if (target.kind === 'commits')
    return t(props.commitsOpen ? 'volumes.numbers.closeCommits' : 'volumes.numbers.openCommits')
  if (target.kind === 'list') return t('volumes.numbers.openList')
  return t(target.kind === 'board' ? 'volumes.numbers.openBoard' : 'volumes.numbers.openQuestions')
}

/** What stands under a category's number: the period's, or the age of its oldest card. */
function underOf(row: Volumes['counts']['categories'][number]): string {
  if (CLOSED.includes(row.category)) return t('volumes.numbers.inPeriod')
  if (!row.oldest) return ''
  return t('volumes.numbers.oldestCard', { age: words.age(row.oldest.since, props.now) })
}

interface VolumesNumber {
  figure: string
  hint: string
  key: string
  label: string
  /** What its press opens. */
  target: VolumesTarget
  under: string
}

const counted = computed<VolumesNumber[]>(() => {
  const categories = props.counts.categories.map((row) => {
    const target = categoryTarget(props.scope, row.category, props.view)
    const parts =
      row.goals === null || row.stages === null
        ? ''
        : t('volumes.numbers.parts', { tasks: row.tasks, goals: row.goals, stages: row.stages })
    return {
      key: row.category,
      label: t(`workItem.category.${row.category}`),
      figure: String(row.tasks + (row.goals ?? 0) + (row.stages ?? 0)),
      under: underOf(row),
      hint: [parts, opensWords(target)].filter(Boolean).join(' '),
      target,
    }
  })
  const waiting = props.counts.waiting_owner
  const commits = props.commitsUnread ? null : props.counts.unattached_commits
  return [
    ...categories,
    {
      key: 'waiting',
      label: t('volumes.numbers.waiting'),
      figure: String(waiting.count),
      under: waiting.oldest
        ? t('volumes.numbers.oldestQuestion', { age: words.age(waiting.oldest.since, props.now) })
        : '',
      hint: opensWords(WAITING_TARGET),
      target: WAITING_TARGET,
    },
    {
      key: 'commits',
      label: t('volumes.numbers.commits'),
      figure: commits === null ? UNKNOWN : String(commits),
      under: '',
      hint: [
        commits === null ? t('volumes.numbers.commitsUnknown') : '',
        opensWords(COMMITS_TARGET),
      ]
        .filter(Boolean)
        .join(' '),
      target: COMMITS_TARGET,
    },
  ]
})

/**
 * Each number as it is drawn: a button where it opens a place, a figure where it opens nothing,
 * and its hint as its description, absent with none so nothing empty is read out. The commits'
 * button says whether their list is shown.
 */
const numbers = computed(() =>
  counted.value.map((number) => ({
    ...number,
    opens: number.target.kind !== 'none',
    description: number.hint || undefined,
    expanded: number.target.kind === 'commits' ? props.commitsOpen : undefined,
  })),
)

function press(number: VolumesNumber) {
  emit('open', number.target)
}
</script>

<template>
  <ul
    class="volumes-numbers"
    :aria-label="t('volumes.numbers.label')"
  >
    <li
      v-for="number in numbers"
      :key="number.key"
      class="volumes-number-place"
    >
      <button
        v-if="number.opens"
        v-tooltip.detail="number.hint"
        type="button"
        class="volumes-number volumes-number-press"
        :data-number="number.key"
        :aria-description="number.description"
        :aria-expanded="number.expanded"
        @click="press(number)"
      >
        <span
          class="volumes-number-label"
          data-part="label"
          >{{ number.label }}</span
        >
        <span
          class="volumes-number-figure"
          data-part="figure"
          >{{ number.figure }}</span
        >
        <span
          class="volumes-number-under"
          data-part="under"
          >{{ number.under }}</span
        >
      </button>
      <div
        v-else
        v-tooltip.detail="number.hint"
        class="volumes-number"
        :data-number="number.key"
        :aria-description="number.description"
      >
        <span
          class="volumes-number-label"
          data-part="label"
          >{{ number.label }}</span
        >
        <span
          class="volumes-number-figure"
          data-part="figure"
          >{{ number.figure }}</span
        >
        <span
          class="volumes-number-under"
          data-part="under"
          >{{ number.under }}</span
        >
      </div>
    </li>
  </ul>
</template>

<style scoped>
/* The numbers stand in one row while the page has room for every name, and in as many rows as
   the names need where it has not, a row sharing its width among its numbers. A number is never
   narrower than its longest word, which is never broken, and the numbers never scroll sideways:
   in a frame of their own they did on a phone, and opening the commits' list under them scrolled
   the frame to the pressed number, moving every other one. */
.volumes-numbers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.volumes-number-place {
  display: flex;
  flex: 1 1 0;
  min-width: min-content;
}

/* A number: its figure over its name over its age, the figure in the ink of the figures. The
   figure stands first, at the number's top, so every figure of a row stands at one height
   whatever lines the names take; under its name, it stood a line lower under a name of two lines
   than under one, and «Коммиты без карточки», three lines, put it 34px under the row's highest.
   The name still comes first to assistive technology, which reads the elements in their order. */
.volumes-number {
  display: grid;
  flex: 1;
  grid-template-rows: auto auto auto;
  gap: var(--space-half);
  align-content: start;
  min-width: 0;
  padding: var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-detail);
  text-align: start;
  background: var(--color-surface);
  border-radius: var(--radius-control);
}

.volumes-number-press {
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &[aria-expanded='true'] {
    background: var(--color-surface-active);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 1px;
  }
}

.volumes-number-label {
  grid-row: 2;
  overflow-wrap: normal;
}

.volumes-number-figure {
  grid-row: 1;
  color: var(--color-text);
  font: var(--font-section-title);
  font-variant-numeric: tabular-nums;
}

.volumes-number-under {
  grid-row: 3;
  min-block-size: 1lh;
  color: var(--color-text-tertiary);
}
</style>
