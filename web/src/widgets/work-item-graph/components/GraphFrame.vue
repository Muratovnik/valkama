<script setup lang="ts">
/**
 * An epic on the graph, as the frame round its work: or folded, its header
 * alone.
 *
 * The frame is ground a step above the field and its cards a step above it, so
 * it is told by tone and draws no line. Its header is one row of two controls,
 * each one button with one action as a card is: the chevron folds or unfolds
 * it, the rest opens the epic's card. The rest names the epic, its state once
 * it has moved, and how its work stands in words, a number beside each word
 * rather than inside it; the 3px edge under the row is the same count drawn.
 * Only the title gives way when the row is short: the counts are never cut, and
 * take the row under the name before they would be.
 *
 * The work under no epic is a frame too, with no epic to open. A frame inside
 * a frame is a well cut into it, a step below. Zoomed out past reading, the
 * header keeps the epic's reference and its edge, grown with the field.
 *
 * Every control carries `data-walk-target`, the id the keyboard's walk knows it
 * by: `frame:<id>:fold` and `frame:<id>`.
 */
import { computed } from 'vue'
import { Translation, useI18n } from 'vue-i18n'

import { Handle, Position } from '@vue-flow/core'

import GraphFrameProgress from '@/widgets/work-item-graph/components/GraphFrameProgress.vue'
import { FRAME_HEADER, NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { printsFacet } from '@/entities/work-item/utils/facets.ts'

import CountBadge from '@/shared/ui/CountBadge.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const {
  frame,
  overview = false,
  still = false,
  tabStop = null,
  working = 0,
} = defineProps<{
  frame: PlacedFrame
  /** The field is zoomed out past reading: the header is the reference and the edge. */
  overview?: boolean
  /** The field's motion does not run, so the working dots hold still. */
  still?: boolean
  /** The walk target that takes Tab, when it is one of this frame's. */
  tabStop?: string | null
  /**
   * How many items under it, nested frames' included, an agent is working on
   * now: for a folded frame the one sign of the work moving inside it.
   */
  working?: number
}>()
const emit = defineEmits<{
  blur: [target: string]
  focus: [target: string]
  open: [reference: string]
  toggle: [id: string]
}>()
const { t } = useI18n()

/** A frame's counts are its epic's whole size, which no badge's «99+» may round off. */
const WHOLE = Number.MAX_SAFE_INTEGER

/** The epic to open; the work under no epic has none. */
const epic = computed(() => (frame.id === NO_EPIC_FRAME ? null : frame.epic))
const foldTarget = computed(() => `frame:${frame.id}:fold`)
const openTarget = computed(() => `frame:${frame.id}`)

/** An epic says it is one; an item that grew children says it is an item. */
const isEpic = computed(() => epic.value?.kind === 'epic')
const named = computed(() =>
  epic.value ? { reference: epic.value.reference, title: epic.value.title } : null,
)

const foldLabel = computed(() => {
  const verb = frame.folded ? 'unfold' : 'fold'
  if (!named.value) return t(`graph.frame.${verb}None`)
  return t(`graph.frame.${verb}${isEpic.value ? 'Epic' : 'Parent'}`, named.value)
})
const chevron = computed(() => (frame.folded ? 'chevron-right' : 'chevron-down'))
const kindGlyph = computed(() => (isEpic.value ? 'kind-epic' : 'parent'))
const title = computed(() => epic.value?.title ?? t('graph.frame.noEpic'))

/** The groups under way or stopped, in the edge's order; a zero is not written. */
const counts = computed(() =>
  (['review', 'active', 'blocked'] as const)
    .filter((group) => frame.progress[group] > 0)
    .map((group) => ({ group, count: frame.progress[group] })),
)

/** What a reader hears for the open target: the same facts the header shows. */
const openLabel = computed(() => {
  const kind = isEpic.value ? 'epic' : 'parent'
  const head = named.value ? t(`graph.frame.${kind}`, named.value) : t('graph.frame.noEpic')
  const done = t('graph.frame.doneOf', { done: frame.progress.done, total: frame.progress.total })
  const groups = counts.value.map(({ group, count }) => {
    const word = t(`graph.frame.${group}`, count)
    return `${count} ${word}`
  })
  const live = working > 0 ? [`${working} ${t('graph.frame.working', working)}`] : []
  return [head, done, ...groups, ...live].join(' · ')
})

/**
 * The open target is a button only where there is an epic to open; over the
 * work under no epic the same row is plain text.
 */
const openTag = computed(() => (epic.value ? 'button' : 'span'))
/** What only the button carries: plain text has no type, name, walk target or stop. */
const asButton = <T,>(value: T): T | undefined => (epic.value ? value : undefined)
const openType = computed(() => asButton('button'))
const openName = computed(() => asButton(openLabel.value))
const openWalk = computed(() => asButton(openTarget.value))
const openTab = computed(() => asButton(tabIndex(openTarget.value)))

/** The epic's state, said once it has moved, as a board's lane says it. */
const stateShown = computed(() => (epic.value ? printsFacet('state', 'lane', epic.value) : false))
const closedEpic = computed(() => epic.value?.state.is_terminal ?? false)

/** A frame inside a frame is a well cut into the one it stands in. */
const nested = computed(() => frame.parentId !== null)
const headStyle = computed(() => (frame.folded ? undefined : { height: `${FRAME_HEADER}px` }))

function tabIndex(target: string): number {
  return tabStop === target ? 0 : -1
}

/**
 * A count's word, after a space: the gap beside the number is drawn, and the
 * space is what copied text and a reader of the plain row get.
 */
function countWord(group: (typeof counts.value)[number]['group'], count: number): string {
  const word = t(`graph.frame.${group}`, count)
  return ` ${word}`
}

const workingWord = computed(() => {
  const word = t('graph.frame.working', working)
  return ` ${word}`
})

function onOpen() {
  if (epic.value) emit('open', epic.value.reference)
}

function onOpenFocus() {
  if (epic.value) emit('focus', openTarget.value)
}

function onOpenBlur() {
  if (epic.value) emit('blur', openTarget.value)
}
</script>

<template>
  <section
    class="graph-frame"
    :class="{ folded: frame.folded, nested, overview }"
    :data-frame="frame.id"
  >
    <Handle
      id="target"
      class="graph-frame-handle"
      type="target"
      :position="Position.Left"
      :connectable="false"
    />
    <Handle
      id="source"
      class="graph-frame-handle"
      type="source"
      :position="Position.Right"
      :connectable="false"
    />
    <header
      class="graph-frame-head nopan"
      :style="headStyle"
    >
      <button
        class="graph-frame-fold"
        type="button"
        :aria-label="foldLabel"
        :aria-expanded="!frame.folded"
        :data-walk-target="foldTarget"
        :tabindex="tabIndex(foldTarget)"
        @click="emit('toggle', frame.id)"
        @focus="emit('focus', foldTarget)"
        @blur="emit('blur', foldTarget)"
      >
        <VIcon
          :name="chevron"
          :size="16"
        />
      </button>
      <component
        :is="openTag"
        class="graph-frame-open"
        :type="openType"
        :aria-label="openName"
        :data-walk-target="openWalk"
        :tabindex="openTab"
        @click="onOpen"
        @focus="onOpenFocus"
        @blur="onOpenBlur"
      >
        <span
          class="graph-frame-name"
          :title="title"
        >
          <VIcon
            v-if="epic"
            class="graph-frame-kind"
            :name="kindGlyph"
            :size="14"
          />
          <span
            v-if="epic"
            class="graph-frame-reference"
            >{{ epic.reference }}</span
          >
          <span class="graph-frame-title">{{ title }}</span>
        </span>
        <SemanticState
          v-if="epic && stateShown && !overview"
          class="graph-frame-state"
          dimension="work-item-state"
          :class="{ closed: closedEpic }"
          :state="epic.state.category"
          :label="epic.state.name"
        />
        <template v-if="!overview">
          <Translation
            class="graph-frame-count"
            keypath="graph.frame.doneOf"
            tag="span"
          >
            <template #done>
              <CountBadge
                placement="inline"
                :limit="WHOLE"
                :value="frame.progress.done"
              />
            </template>
            <template #total>
              <CountBadge
                placement="inline"
                :limit="WHOLE"
                :value="frame.progress.total"
              />
            </template>
          </Translation>
          <span
            v-for="{ group, count } in counts"
            :key="group"
            class="graph-frame-count"
            :data-group="group"
            ><CountBadge
              placement="inline"
              :limit="WHOLE"
              :value="count"
            />{{ countWord(group, count) }}</span
          >
        </template>
        <span
          v-if="working"
          class="graph-frame-count graph-frame-working"
          ><span
            class="work-dots"
            aria-hidden="true"
            :class="{ still }"
            ><i /><i /><i /></span
          ><CountBadge
            placement="inline"
            :limit="WHOLE"
            :value="working"
          /><template v-if="!overview">{{ workingWord }}</template></span
        >
      </component>
      <GraphFrameProgress
        class="graph-frame-progress"
        :progress="frame.progress"
      />
    </header>
  </section>
</template>

<style scoped>
.graph-frame-handle {
  opacity: 0;
  pointer-events: none;
}

/* One step above the field, as the board's lane is; a frame inside a frame is
   a well, one step below the frame it is cut into. The cards stand a step
   above either. The frame itself takes no pointer: the field behind it pans. */
.graph-frame {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: var(--radius-card);

  &.nested {
    background: var(--color-surface-recess);
  }
}

/* The header is the row and the edge under it. Folded, it is the whole frame. */
.graph-frame-head {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0 var(--space-1);
  align-items: center;
  padding: var(--space-1) var(--space-3) var(--space-2) var(--space-1);
  color: var(--color-text-muted);
  font: var(--font-line);
  pointer-events: auto;

  .graph-frame.folded & {
    height: 100%;
  }
}

.graph-frame-fold,
.graph-frame-open {
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border-radius: var(--radius-status);
}

.graph-frame-fold,
.graph-frame-open[data-walk-target] {
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    background: var(--color-surface-hover);
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

.graph-frame-fold {
  display: grid;
  place-items: center;
  align-self: stretch;
  width: 28px;
}

/* The name gives way first, and the counts take the row under it before any
   of them is cut. */
.graph-frame-open {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  align-content: center;
  align-items: center;
  align-self: stretch;
  padding: 0 var(--space-1);
}

.graph-frame-name {
  display: flex;
  flex: 1 1 0;
  gap: var(--space-1);
  align-items: center;
  min-width: 80px;
  color: var(--color-text);
  overflow: hidden;
}

.graph-frame-kind {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.graph-frame-reference {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.graph-frame-title {
  min-width: 0;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* A closed epic still holding open work says so, quietly. */
.graph-frame-state {
  flex: 0 0 auto;

  &.closed {
    opacity: 0.7;
  }
}

.graph-frame-count {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: baseline;
  white-space: nowrap;
}

.graph-frame-progress {
  grid-column: 1 / -1;
}

/* Zoomed out, the header is a band that still reads: the reference grown with
   the field, as a zoomed-out card's is, over a thicker edge. The work under no
   epic has no reference, and keeps its name instead. */
.graph-frame.overview {
  .graph-frame-fold {
    visibility: hidden;
  }

  .graph-frame-kind,
  .graph-frame-reference + .graph-frame-title {
    display: none;
  }

  .graph-frame-reference,
  .graph-frame-title {
    color: var(--color-text);
    font: var(--font-drawer-title);
    font-weight: 700;
    transform: scale(2.2);
    transform-origin: left center;
  }

  .graph-frame-progress {
    height: 12px;
  }

  /* «● 2» at the band's far end, grown as the reference is. */
  .graph-frame-working {
    font: var(--font-drawer-title);
    font-weight: 700;
    transform: scale(2.2);
    transform-origin: right center;
  }
}

/* Folded, the work moving inside is the one sign of it, so it rides the name's
   row, and the counts take the two rows under it. */
.graph-frame.folded {
  .graph-frame-name {
    order: -2;
  }

  .graph-frame-working {
    order: -1;
  }
}

/* The work moving under the frame, in the hue of work under way. */
.graph-frame-working {
  align-items: center;
  color: var(--color-info);
}

/* A forced palette clears the ground, so the frame is outlined instead. */
@media (forced-colors: active) {
  .graph-frame {
    outline: 1px solid CanvasText;
  }
}
</style>
