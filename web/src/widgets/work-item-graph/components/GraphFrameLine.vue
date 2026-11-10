<script setup lang="ts">
/**
 * A frame header's first line, as a card's is: what it is and its reference, its
 * state once it has moved, and at the far end the work moving under it. The state
 * gives way first when the line is full, then the reference; the header's button
 * keeps both whole in its name. Over the work under no epic the line is its name.
 * Zoomed out it is the reference and the work moving, the whole line grown with the
 * field by the `--grow` the header sets, and far out the reference gives way to what
 * a fold hides (`named`). There the work moving shortens to its count beside the dots
 * when the line holds no more beside the reference, or, where the band gives the line a
 * second row (`wraps`), when that row cannot hold it either; and the reference is cut
 * before the mark is. The header's name and hover text keep both whole.
 */
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import GraphFrameWorking from '@/widgets/work-item-graph/components/GraphFrameWorking.vue'

import { printsFacet } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const {
  epic,
  named = true,
  overview = false,
  working,
  wraps = false,
} = defineProps<{
  /** The epic the header opens; the work under no epic has none. */
  epic: WorkItemBrief | null
  /** What the work under no epic is called. */
  title: string
  /** How many items under the frame an agent is working on now. */
  working: number
  /** Whether the reference or the name is drawn. */
  named?: boolean
  overview?: boolean
  /** The field's motion does not run, so the working dots hold still. */
  still?: boolean
  /** Zoomed out, the band gives the line a second row for what the first cannot hold. */
  wraps?: boolean
}>()

/** An epic says it is one; an item that grew children says it is an item. */
const kindGlyph = computed(() => (epic?.kind === 'epic' ? 'kind-epic' : 'parent'))
const kindInk = computed(() => (epic?.kind === 'epic' ? 'epic' : undefined))
/** The epic's state, said once it has moved, as a board's lane says it. */
const stateShown = computed(() => (epic ? printsFacet('state', 'lane', epic) : false))
const stateName = useStateName()
const epicState = computed(() => (epic ? stateName(epic.state) : ''))

const line = useTemplateRef<HTMLElement>('line')
const name = useTemplateRef<HTMLElement>('name')
const mark = useTemplateRef<InstanceType<typeof GraphFrameWorking>>('mark')
/** Zoomed out, the work moving says its count alone: the line has no room for its phrase. */
const short = ref(false)

/** Read in the line's own units, which its growth leaves as they are. */
function fit() {
  const whole = mark.value?.wholeWidth() ?? 0
  if (!overview || !line.value || whole === 0) {
    short.value = false
    return
  }
  // The name at its whole width, however much of it is drawn now.
  const beside = wraps ? 0 : (name.value?.scrollWidth ?? 0)
  short.value = beside + whole > line.value.clientWidth + 0.5
}

onMounted(fit)
watch([() => overview, () => wraps, () => working, () => named, () => epic?.reference], fit, {
  flush: 'post',
})
// The line's width follows the growth, and the name's the font it waited for.
useResizeObserver(
  computed(() => [line.value, name.value]),
  fit,
)
</script>

<template>
  <span
    ref="line"
    class="graph-frame-line"
    :class="{ overview, wraps: overview && wraps }"
  >
    <VIcon
      v-if="epic && !overview"
      class="graph-frame-kind"
      :data-kind="kindInk"
      :name="kindGlyph"
      :size="14"
    />
    <template v-if="named">
      <span
        v-if="epic"
        ref="name"
        v-tooltip.clipped="epic.reference"
        class="graph-frame-reference one-line"
        >{{ epic.reference }}</span
      >
      <span
        v-else
        ref="name"
        v-slash-breaks="title"
        v-tooltip.clipped="title"
        class="graph-frame-title"
        :class="{ 'one-line': overview }"
      />
    </template>
    <SemanticState
      v-if="epic && stateShown && !overview"
      class="graph-frame-state"
      dimension="work-item-state"
      :class="{ closed: epic.state.is_terminal }"
      :state="epic.state.category"
      :label="epicState"
    />
    <GraphFrameWorking
      v-if="working"
      ref="mark"
      :count="working"
      :overview="overview"
      :short="short"
      :still="still"
    />
  </span>
</template>

<style scoped>
.graph-frame-line {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  font: var(--font-detail);

  /* Grown as one line, so that what stands on it is measured at the size it is drawn: a
     word grown on its own took its room unscaled and could stand over the reference. Its
     height is the one the growth draws, which the header keeps for it. */
  &.overview {
    gap: 0;
    align-items: flex-start;
    width: calc(100% / var(--grow));
    height: calc(1lh * var(--grow));
    font: var(--font-drawer-title);
    font-weight: 700;
    transform: scale(var(--grow));
    transform-origin: left top;

    /* What the first row cannot hold takes the second, which the band has room for. */
    &.wraps {
      flex-wrap: wrap;
    }
  }
}

.graph-frame-kind {
  flex: 0 0 auto;
  color: var(--color-kind-ink, currentcolor);
}

.graph-frame-reference {
  flex: 0 1 auto;
  font-variant-numeric: tabular-nums;
}

.graph-frame-title {
  min-width: 0;
  color: var(--color-text);
  font: var(--font-row-title);
}

/* A closed epic still holding open work says so, quietly. */
.graph-frame-state {
  flex: 0 1000 auto;
  min-width: 0;
  min-height: 0;
  margin-inline-start: var(--space-1);

  &.closed {
    opacity: 0.7;
  }
}

/* The work moving shortens first, and the reference is cut only where that is not room
   enough: the mark that work is running never gives way. Both are one line there
   (`.one-line`). */
.overview :is(.graph-frame-reference, .graph-frame-title) {
  display: block;
  flex: 0 1 auto;
  max-width: 100%;
  color: var(--color-text);
  font: inherit;
}
</style>
