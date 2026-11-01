<script setup lang="ts">
import { nextTick, ref } from 'vue'

import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  closeLabel: string
  title: string
  /** The facts ask something and take a row of their own, condensed or not. */
  factsRow?: boolean
  subtitle?: string
}>()
const emit = defineEmits<{ close: [] }>()
const body = ref<HTMLElement | null>(null)
const head = ref<HTMLElement | null>(null)

/**
 * The head reads top down as what the record is, then what holds for it: the
 * identity line over the title, the facts under it, then whatever the head asks
 * or reports, then the tabs. All of it stands outside the body's scroll.
 *
 * The head gives its room back to the body once the body is read past it: the
 * title keeps one line and the identity line and subtitle step out, while the
 * controls — Back and Close — the actions slot, a refusal or a question, and
 * the tabs stay. The facts slot moves up beside the title and is told it is
 * condensed, so it keeps only what has to stay in reach — the card's one
 * action — and lets the rest scroll away with the body; the tabs slot is told
 * too, so it can keep to one row. Whole, the head of a long title took a
 * quarter of a desktop drawer and more of a phone's; keeping the facts line,
 * a full-width action and two rows of tabs, it still pinned a third of a phone.
 *
 * It condenses only past its own height and comes back only at the very top,
 * and the body is scrolled back by exactly the height the head gave up, so the
 * text under the reader's eye does not move and a scroll near either threshold
 * cannot flip it back and forth.
 */
const condensed = ref(false)
/** How far past the head's own height the body is read before the head condenses. */
const CONDENSE_AFTER = 24

async function follow() {
  const scroller = body.value
  const whole = head.value
  if (!scroller || !whole) return
  if (condensed.value) {
    if (scroller.scrollTop <= 0) condensed.value = false
    return
  }
  const before = whole.offsetHeight
  if (scroller.scrollTop <= before + CONDENSE_AFTER) return
  condensed.value = true
  await nextTick()
  scroller.scrollTop -= before - whole.offsetHeight
}

/**
 * Back to the top of the body, for a host that swaps what the body shows. One
 * scroll position shared by every tab opened the next tab wherever the last one
 * had been read to — the Relations heading above the fold, the newest event
 * below it.
 */
function scrollToTop() {
  body.value?.scrollTo({ top: 0 })
}

/** Where the body is read to, for a host that will bring the reader back to it. */
interface DrawerPosition {
  condensed: boolean
  top: number
}

function position(): DrawerPosition {
  return { condensed: condensed.value, top: body.value?.scrollTop ?? 0 }
}

/**
 * Back to a position read earlier, head and all. The head is condensed first,
 * so the scroll that follows does not condense it again and subtract the
 * height it gave up from a position that was taken with it already given up.
 */
async function restore(at: DrawerPosition) {
  condensed.value = at.condensed
  await nextTick()
  if (body.value) body.value.scrollTop = at.top
}

defineExpose({ position, restore, scrollToTop })
</script>

<template>
  <div class="drawer-frame">
    <header
      ref="head"
      class="drawer-frame-head"
      :class="{ condensed, 'facts-row': factsRow }"
    >
      <!-- The controls come first in the document and stand at the row's end:
           opening the drawer puts focus on Back or Close, as it did when the
           head started with the title, and not on the first fact over it. -->
      <div class="drawer-frame-controls">
        <slot name="controls" />
        <button
          class="drawer-frame-close"
          type="button"
          :aria-label="closeLabel"
          @click="emit('close')"
        >
          <VIcon name="close" />
        </button>
      </div>
      <div class="drawer-frame-title">
        <div
          v-if="$slots.identity"
          class="drawer-frame-identity"
        >
          <slot name="identity" />
        </div>
        <h2 class="drawer-frame-name">
          <slot name="title">{{ title }}</slot>
        </h2>
        <p
          v-if="subtitle"
          class="drawer-frame-subtitle"
        >
          {{ subtitle }}
        </p>
      </div>
      <div
        v-if="$slots.facts"
        class="drawer-frame-facts"
      >
        <slot
          name="facts"
          :condensed="condensed"
        />
      </div>
      <div
        v-if="$slots.actions"
        class="drawer-frame-actions"
      >
        <slot name="actions" />
      </div>
      <div
        v-if="$slots.tabs"
        class="drawer-frame-tabs"
      >
        <slot
          name="tabs"
          :condensed="condensed"
        />
      </div>
    </header>
    <div
      ref="body"
      class="drawer-frame-body"
      @scroll.passive="follow"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* The drawer is resizable and its width is the workspace's, not the
   viewport's, so what it holds lays itself out against the drawer. */
.drawer-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 100%;
  background: var(--color-surface);
  container: drawer / inline-size;
}

.drawer-frame-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  flex: 0 0 auto;
  grid-template-areas: 'title close' 'facts facts' 'actions actions' 'tabs tabs';
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-6) var(--space-6) 0;
  border-bottom: 1px solid var(--color-rule);
  background: var(--color-surface);
}

.drawer-frame-title {
  grid-area: title;
  min-width: 0;
}

.drawer-frame-name {
  margin: 0;
  font: var(--font-drawer-title);
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

/* Condensed, the title is one line and the lines under it step out; what is
   left of the facts stands at the end of the title's row, before the controls. */
.drawer-frame-head.condensed {
  grid-template-areas: 'title facts close' 'actions actions actions' 'tabs tabs tabs';
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;

  .drawer-frame-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .drawer-frame-subtitle,
  .drawer-frame-identity {
    display: none;
  }
}

/* The identity line is a line of small facts over the title, so it sits
   closer to the title than the title does to anything else. */
.drawer-frame-identity {
  margin-bottom: var(--space-1);
}

.drawer-frame-facts {
  grid-area: facts;
  min-width: 0;
}

.drawer-frame-subtitle {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

/* The controls stay in the head's top row, beside the title, whether the head is
   whole or condensed; their own top edge is the row's, as the close button's was. */
.drawer-frame-controls {
  display: flex;
  grid-area: close;
  gap: var(--space-2);
  align-items: flex-start;
}

.drawer-frame-close {
  display: grid;
  place-items: center;
  width: var(--size-control-target);
  height: var(--size-control-target);
  padding: 0;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    border-color: var(--color-rule);
  }
}

.drawer-frame-actions {
  display: flex;
  flex-wrap: wrap;
  grid-area: actions;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
}

.drawer-frame-tabs {
  grid-area: tabs;
  min-width: 0;
}

/* A question the facts ask is read in full: condensed, the head gives it the
   row under the title, as the whole head does. */
.drawer-frame-head.condensed.facts-row {
  grid-template-areas: 'title close' 'facts facts' 'actions actions' 'tabs tabs';
  grid-template-columns: minmax(0, 1fr) auto;
}

/* A phone-wide drawer has no title row to spare: Back and Close already share
   it, so the action ends the tabs' row instead, centred on the tabs above the
   strip's own foot, and the title keeps the width that says which item this is. */
@container drawer (width < 520px) {
  .drawer-frame-head.condensed:not(.facts-row) {
    grid-template-areas: 'title close' 'actions actions' 'tabs facts';
    grid-template-columns: minmax(0, 1fr) auto;

    .drawer-frame-facts {
      padding-bottom: var(--space-3);
    }
  }
}

/* The scrollbar is paid for out of the end inset, so the body's content ends
   where the head's does. Drawn inside a full inset it pushed every row 10px
   short of the close button above it, and the column read as shifted.

   The body is the containing block of what is positioned inside it. Without
   that, a visually hidden label far down a long section was placed against the
   drawer instead, stretched the drawer's own scroll area to twice its height,
   and the first `scrollIntoView` scrolled the drawer and left a blank band
   under the body. */
.drawer-frame-body {
  position: relative;
  min-height: 0;
  padding: var(--space-6);
  padding-inline-end: calc(var(--space-6) - var(--size-scrollbar));
  overflow-y: auto;
  scrollbar-gutter: stable;
}
</style>
