<script setup lang="ts">
/**
 * The name that heads a row of a dimension's table, on one line: cut with an ellipsis where the
 * column is narrower than it, a pair's in its first value (`PairName`), and said whole in its
 * hint while it is cut, under the pointer and the keyboard's focus: a name that is a press holds
 * the hint itself, since the focus lands on the press. A value the page names by the start of its
 * id, an account, has the whole id after its name on the same line, and the line holds the hint,
 * which that id may be cut from while the press is not.
 *
 * It acts as its value does in the bars (`useLineActions`): a link to a task, or a control that
 * narrows the view to the value, sent out as `narrow`. Either is named by the value, since it
 * heads its row's cells; what pressing it does is its description.
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
}>()
/** The value pressed to narrow the view to it: its filter value, and its name. */
const emit = defineEmits<{ narrow: [value: string | null, label: string] }>()

const actions = useLineActions()

const link = computed(() => actions.taskLink(props.by, props.line.value))
const narrowsTo = computed(() => actions.narrowsTo(props.by, props.line.value))
const narrows = computed(() => !link.value && narrowsTo.value !== undefined)
/** A pair acts as its first value does, and its action says that value alone. */
const narrowDescription = computed(() =>
  actions.narrowName(props.by, props.line.value, props.line.valueName),
)
/** The name and what it leaves out, as the hint says them while the line is cut. */
const whole = computed(() =>
  props.line.detail ? `${props.line.name} ${props.line.detail}` : props.line.name,
)
/** The hint is the press's where the press is all the line holds, and the line's otherwise. */
const pressHints = computed(() => (Boolean(link.value) || narrows.value) && !props.line.detail)
const lineHint = computed(() => (pressHints.value ? '' : whole.value))
const pressHint = computed(() => (pressHints.value ? whole.value : ''))

function follow(event: MouseEvent) {
  if (link.value) actions.follow(link.value, event)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function followAside(event: MouseEvent) {
  if (event.button === 1) follow(event)
}

function narrowTo() {
  const value = narrowsTo.value
  if (value !== undefined) emit('narrow', value, props.line.valueName)
}
</script>

<template>
  <th
    scope="row"
    class="chart-cell chart-name"
  >
    <span
      v-tooltip.clipped="lineHint"
      class="table-name one-line"
    >
      <!-- The link's words are the name `PairName` writes as text, which the rule cannot see. -->
      <!-- eslint-disable-next-line vuejs-accessibility/anchor-has-content -->
      <a
        v-if="link"
        v-tooltip.clipped="pressHint"
        class="chart-press"
        :href="link.href"
        @click="follow"
        @auxclick="followAside"
      >
        <span class="press-words one-line"
          ><PairName
            :name="line.name"
            :end="line.nameEnd"
        /></span>
      </a>
      <button
        v-else-if="narrows"
        v-tooltip.clipped="pressHint"
        type="button"
        class="chart-press"
        :aria-description="narrowDescription"
        @click="narrowTo"
      >
        <span class="press-words one-line"
          ><PairName
            :name="line.name"
            :end="line.nameEnd"
        /></span>
      </button>
      <PairName
        v-else
        :name="line.name"
        :end="line.nameEnd"
      />
      <span
        v-if="line.detail"
        class="chart-detail"
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
     heading row and the total its table keeps at the panel's edges (`--stuck-head`,
     `--stuck-foot`, declared by `SpendingTable`). */
  & .chart-press {
    display: inline-block;
    vertical-align: top;
    max-inline-size: 100%;
    scroll-margin-block: var(--stuck-head, 0) var(--stuck-foot, 0);
  }

  & .press-words {
    display: block;
  }

  & .chart-detail {
    display: inline;
    margin-inline-start: var(--space-2);
  }
}
</style>
