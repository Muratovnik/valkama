<script setup lang="ts">
/**
 * The name that heads a row of a dimension's table, on one line: cut with an ellipsis where the
 * column is narrower than it, a pair's in its first value (`PairName`), and said whole in its
 * hint while it is cut, under the pointer and the keyboard's focus: a name that is a press holds
 * the hint itself, since the focus lands on the press. A value with a detail, a session named by
 * its title, has its client and the start of its id after its name on the same line, and the line
 * holds the hint, which that detail may be cut from while the press is not.
 *
 * On two lines (`lines`), as a narrow table of free text asks, the name breaks between its words
 * and ends in an ellipsis past its second line, so a task's reference and the start of its title
 * stand together; a pair takes a line a part, each cut at its own end (`PairName`'s `stacked`),
 * and a detail a line of its own under the name, since a press is one box the line cannot break.
 *
 * It acts as its value does in the bars (`useLineActions`): a press opens the value's side panel,
 * sent out as `inspect`, and a task's name is a link to its card as well, which a press with a
 * modifier or the middle button opens elsewhere. Either is named by the value, since it heads its
 * row's cells; what pressing it does is its description.
 */
import { computed } from 'vue'

import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import type { TableLine } from '@/pages/analytics/composables/useTableModel.ts'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import PairName from '@/shared/ui/PairName.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  by: UsageDimension
  line: TableLine
  /** The lines the name may take: one, or two for a name of free text in a narrow column. */
  lines?: 1 | 2
}>()
/** The value pressed to open its side panel: its filter value, and its name. */
const emit = defineEmits<{ inspect: [value: string | null, label: string] }>()

const actions = useLineActions()

const link = computed(() => actions.taskLink(props.by, props.line.value))
const inspectsTo = computed(() => actions.inspectsTo(props.by, props.line.value))
const inspects = computed(() => !link.value && inspectsTo.value !== undefined)
/** A pair acts as its first value does, and its action says that value alone. */
const pressDescription = computed(() => actions.inspectName(props.line.valueName))
/** The name and what it leaves out, as the hint says them while the line is cut. */
const whole = computed(() =>
  props.line.detail ? `${props.line.name} ${props.line.detail}` : props.line.name,
)
/** The hint is the press's where the press is all the line holds, and the line's otherwise. */
const pressHints = computed(() => (Boolean(link.value) || inspects.value) && !props.line.detail)
const lineHint = computed(() => (pressHints.value ? '' : whole.value))
const pressHint = computed(() => (pressHints.value ? whole.value : ''))
/** On two lines a name breaks between its words, and a pair stacks its parts instead. */
const wraps = computed(() => props.lines === 2)
const stacked = computed(() => wraps.value && Boolean(props.line.nameEnd))
/** How the name's words keep to their lines: one, cut; two, clamped; stacked, a part a line. */
const wordsRule = computed(() => {
  if (!wraps.value) return 'one-line'
  return stacked.value ? '' : 'two-lines'
})

function follow(event: MouseEvent) {
  if (link.value) actions.follow(link.value, event, inspect)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function followAside(event: MouseEvent) {
  if (event.button === 1) follow(event)
}

function inspect() {
  const value = inspectsTo.value
  if (value !== undefined) emit('inspect', value, props.line.valueName)
}
</script>

<template>
  <th
    scope="row"
    class="chart-cell chart-name"
  >
    <span
      v-tooltip.clipped="lineHint"
      class="table-name"
      :class="{ 'one-line': !wraps, 'table-wraps': wraps }"
    >
      <!-- The link's words are the name `PairName` writes as text, which the rule cannot see. -->
      <!-- eslint-disable-next-line vuejs-accessibility/anchor-has-content -->
      <a
        v-if="link"
        v-tooltip.clipped="pressHint"
        class="chart-press"
        :href="link.href"
        :aria-description="pressDescription"
        @click="follow"
        @auxclick="followAside"
      >
        <span
          class="press-words"
          :class="wordsRule"
          ><PairName
            :name="line.name"
            :end="line.nameEnd"
            :runs="line.nameRuns"
            :stacked="stacked"
        /></span>
      </a>
      <button
        v-else-if="inspects"
        v-tooltip.clipped="pressHint"
        type="button"
        class="chart-press"
        :aria-description="pressDescription"
        @click="inspect"
      >
        <span
          class="press-words"
          :class="wordsRule"
          ><PairName
            :name="line.name"
            :end="line.nameEnd"
            :runs="line.nameRuns"
            :stacked="stacked"
        /></span>
      </button>
      <span
        v-else
        class="plain-words"
        :class="wraps && wordsRule"
        ><PairName
          :name="line.name"
          :end="line.nameEnd"
          :runs="line.nameRuns"
          :stacked="stacked"
      /></span>
      <span
        v-if="line.detail"
        class="chart-detail"
        :class="{ 'one-line': wraps }"
        >{{ line.detail }}</span
      >
    </span>
  </th>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/shared/ui/rowStates.css"></style>

<style scoped>
/* One line however long the name: the cut is the ellipsis, and the hint says it whole. A press
   inside it is a box no wider than the line, so a pair's first value gives way inside the press
   and its second stays in view; what it leaves out follows it in the quiet ink. */
.table-name {
  display: block;

  /* A button is laid out as one box, whatever its display says, so the line's ellipsis does not
     reach the words inside it: a long name in it was cut at the button's edge with none. The
     words keep the line's rule inside the press, and the press keeps its box, its ring and the
     hit area that stands past it, which a cut on the press itself would clip. A link is the same
     box, so the cut is inside the press its hint stands on, which the focus reaches: cut by the
     line around it, a link's name had no hint under the keyboard. A box that cuts has no
     baseline to give the line, so the press stands on the line's top rather than raising the
     line by the depth under its letters. Brought into view by the focus, it stands clear of the
     heading row and the total its table holds at its frame's edges, by the room the frame keeps
     for them (`scroll-padding`, `SpendingTable`). */
  & .chart-press {
    display: inline-block;
    vertical-align: top;
    max-inline-size: 100%;
  }

  /* A block, unless it keeps to two lines (`.two-lines`), whose own box that is. */
  & .press-words:not(.two-lines) {
    display: block;
  }

  /* On the name's line, in the table's line height (`--font-line`): in the detail's own, taller
     one, a session's row stood 1.3px taller than the rows of a name with no detail. */
  & .chart-detail {
    display: inline;
    margin-inline-start: var(--space-2);
    line-height: var(--line-height-tight);
  }
}

/* On two lines the name's words take the press's whole width and break between words, an
   ellipsis ending the second line (`.two-lines`), as a ranked list of free text draws them. Each
   part of a pair and a detail is a line of its own, cut at its end; the line under the pointer
   still says the whole name. The press stands on the line's top, so the row's figures stand on its
   first line. */
.table-wraps {
  & .plain-words:not(.two-lines) {
    display: block;
  }

  & .chart-detail {
    display: block;
    margin-inline-start: 0;
  }
}
</style>
