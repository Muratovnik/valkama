<script setup lang="ts">
/**
 * The name that heads a row of a dimension's table, on one line: cut with an ellipsis where the
 * column is narrower than it, and said whole in its hint while it is cut. A value the page names
 * by the start of its id, an account, has the whole id after its name on the same line.
 *
 * It acts as its value does in the bars (`useLineActions`): a link to a task, or a control that
 * narrows the view to the value, sent out as `narrow`. Either is named by the value, since it
 * heads its row's cells; what pressing it does is its description.
 */
import { computed } from 'vue'

import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import type { TableLine } from '@/pages/analytics/composables/useTableModel.ts'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
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
const narrowDescription = computed(() =>
  actions.narrowName(props.by, props.line.value, props.line.name),
)
/** The name and what it leaves out, as the hint says them while the line is cut. */
const whole = computed(() =>
  props.line.detail ? `${props.line.name} ${props.line.detail}` : props.line.name,
)

function follow(event: MouseEvent) {
  if (link.value) actions.follow(link.value, event)
}

/** A middle press on a link opens it elsewhere, and is a press on it all the same. */
function followAside(event: MouseEvent) {
  if (event.button === 1) follow(event)
}

function narrowTo() {
  const value = narrowsTo.value
  if (value !== undefined) emit('narrow', value, props.line.name)
}
</script>

<template>
  <th
    scope="row"
    class="chart-cell chart-name"
  >
    <span
      v-tooltip.clipped="whole"
      class="table-name one-line"
    >
      <a
        v-if="link"
        class="chart-press"
        :href="link.href"
        @click="follow"
        @auxclick="followAside"
      >
        {{ line.name }}
      </a>
      <button
        v-else-if="narrows"
        type="button"
        class="chart-press"
        :aria-description="narrowDescription"
        @click="narrowTo"
      >
        {{ line.name }}
      </button>
      <template v-else>{{ line.name }}</template>
      <span
        v-if="line.detail"
        class="chart-detail"
        >{{ line.detail }}</span
      >
    </span>
  </th>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
/* One line however long the name: the cut is the ellipsis, and the hint says it whole. A press
   inside it keeps the line's box, and what it leaves out follows it in the quiet ink. */
.table-name {
  display: block;

  & .chart-press {
    display: inline;
  }

  & .chart-detail {
    display: inline;
    margin-inline-start: var(--space-2);
  }
}
</style>
