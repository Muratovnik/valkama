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
 * The head gives its room back to the body as soon as the body moves: the
 * title keeps one line and the identity line and subtitle step out, while the
 * controls — Back and Close — the actions slot, a refusal or a question, and
 * the tabs stay. The facts slot moves up beside the title and is told it is
 * condensed, so it keeps only what has to stay in reach — the card's one
 * action — and lets the rest scroll away with the body; the tabs slot is told
 * too, so it can keep to one row. Whole, the head of a long title took a
 * quarter of a desktop drawer and more of a phone's; keeping the facts line,
 * a full-width action and two rows of tabs, it still pinned a third of a phone.
 *
 * It is whole exactly at the top of the body and condensed at every position
 * below it, so a read-down reader has the compact head from the first step, and
 * a card too short to scroll a head's height condenses as well. The only
 * boundary is the top, which is why nothing flips at it: the head condenses on
 * any scroll past 0 and is whole again only at 0.
 *
 * Condensing gives the head's room to the body, and the text takes it by a glide
 * rather than a jump: the text is drawn where it was, then moves up into place
 * on the surface motion duration, and reduced motion makes the move at once. The
 * reader keeps the place they read to, so the text moves by the distance scrolled
 * and the room the head gave up. Condensed, the text is at least a window tall,
 * so a reader who has condensed the head can still
 * scroll, and a short card cannot be clamped back to the top.
 */
const condensed = ref(false)
const content = ref<HTMLElement | null>(null)

async function follow() {
  const scroller = body.value
  if (!scroller || !head.value) return
  if (condensed.value) {
    if (scroller.scrollTop <= 0) await setCondensed(false)
    return
  }
  if (scroller.scrollTop > 0) await setCondensed(true)
}

/**
 * The glide's length and easing are the surface motion tokens; a reader who asked
 * for less motion gets none, which is the move at once.
 */
function glideOf(node: HTMLElement) {
  const styles = getComputedStyle(node)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return {
    duration: reduced ? 0 : Number.parseFloat(styles.getPropertyValue('--duration-surface')) * 1000,
    easing: styles.getPropertyValue('--ease-out').trim(),
  }
}

/**
 * Condenses or restores the head, and glides the text from where it was to where
 * the new layout puts it: the text is drawn at its old place and animated to the
 * new one, so the room the head gave back is taken by motion rather than a jump.
 */
async function setCondensed(next: boolean) {
  const text = content.value
  const before = text?.getBoundingClientRect().top ?? 0
  condensed.value = next
  await nextTick()
  if (!text) return
  const offset = before - text.getBoundingClientRect().top
  const glide = glideOf(text)
  if (offset === 0 || glide.duration === 0) return
  text.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], {
    duration: glide.duration,
    easing: glide.easing,
  })
}

/**
 * A focus move inside the body places its control by the text's settled place.
 * A glide in flight is a transform, and a scroll into view measures the transform,
 * so the control would be brought in at the place the text was passing and sit
 * out of view once the glide ends. The glide ends at once instead.
 */
function settleGlide() {
  for (const animation of content.value?.getAnimations() ?? []) animation.finish()
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
 * Back to a position read earlier, head and all. The head is set first and the
 * position after it, so the position is taken in the geometry it was read in. A
 * restored position is placed at once, without the glide: the text was already
 * where the reader left it.
 */
async function restore(at: DrawerPosition) {
  const scroller = body.value
  if (!scroller) return
  condensed.value = at.condensed && at.top > 0
  await nextTick()
  scroller.scrollTop = at.top
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
      @focusin="settleGlide"
    >
      <div
        ref="content"
        class="drawer-frame-content"
        :class="{ condensed }"
      >
        <slot />
      </div>
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

/* Condensed, the text is at least the body's own height plus a pixel, so the scroll
   range never falls to zero and a short card keeps its one-row head. The percentage
   resolves against the body's content box, so the range the guard adds is 1px and
   the reader is never scrolled into blank below a short text. A long text is its
   own length. */
.drawer-frame-content.condensed {
  min-height: calc(100% + 1px);
}
</style>
