<script setup lang="ts">
import { computed, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import { useScrolledPast } from '@/shared/lib/useScrolledPast.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  closeLabel: string
  title: string
  /** What the `action` slot stands in for: it shows once this has scrolled away. */
  actionAnchor?: HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()

/**
 * Three parts, and only one of them moves. The bar never moves and has one height:
 * who the record is on its left, the controls on its right. Under it stands whatever
 * has to be answered or read wherever the reader is. Everything else is one scroller,
 * natively, 1:1: the title, the facts, the tabs, the content.
 *
 * No layout here depends on where the scroller stands. The tabs stick to its top, and
 * the bar answers the head leaving with two fades and no reflow: the title takes the
 * identity's place once the big title has passed under the bar, and the action fades
 * in beside the controls once its anchor has too. Both have their room from the start,
 * so that nothing around them moves when they arrive. It used to be one head outside
 * the scroller with two layouts flipped at the first scrolled pixel, and each thing
 * that flip took from under a reader — a press, a focus, a position — had its own
 * repair. A tall pinned head ate the drawer, which is what the flip was for; a bar and
 * one row of tabs pin less than it did.
 */
const body = ref<HTMLElement | null>(null)
const name = ref<HTMLElement | null>(null)
const tabs = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)

const titleAway = useScrolledPast(name, body)
const actionAway = useScrolledPast(() => props.actionAnchor, body)

/** Whatever is scrolled into view comes to rest under the tabs, not behind them. */
const tabsHeight = ref(0)
useResizeObserver(tabs, (entries) => {
  tabsHeight.value = entries[0]?.borderBoxSize[0]?.blockSize ?? 0
})
const scrollPadding = computed(() => ({ scrollPaddingBlockStart: `${tabsHeight.value}px` }))

/**
 * To the start of the content, for a host that swaps what it shows. One position shared
 * by every tab opened the next tab wherever the last one had been read to — the
 * Relations heading above the fold, the newest event below it. The tabs hold their
 * place under the pointer that pressed them: a reader above them has nothing to skip.
 */
function scrollToContent() {
  const scroller = body.value
  const start = content.value?.offsetTop
  if (!scroller || start === undefined) return
  scroller.scrollTo({ top: Math.min(scroller.scrollTop, start - tabsHeight.value) })
}

/** Where the scroller is read to, for a host that will bring the reader back to it. */
function position() {
  return body.value?.scrollTop ?? 0
}

function restore(top: number) {
  body.value?.scrollTo({ top })
}

defineExpose({ position, restore, scrollToContent })
</script>

<template>
  <div class="drawer-frame">
    <header
      class="drawer-frame-bar"
      :class="{ 'title-away': titleAway, 'action-away': actionAway }"
    >
      <!-- The controls come first in the document and stand at the row's end:
           opening the drawer puts focus on Back or Close, and not on a fact. -->
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
      <div
        v-if="$slots.identity"
        class="drawer-frame-identity"
      >
        <slot name="identity" />
      </div>
      <!-- The heading is the one in the scroller; this is the same words kept in sight. -->
      <p
        class="drawer-frame-pinned-title"
        aria-hidden="true"
        :title="title"
      >
        {{ title }}
      </p>
      <div
        v-if="$slots.action"
        class="drawer-frame-action"
      >
        <slot name="action" />
      </div>
    </header>
    <div
      v-if="$slots.notices"
      class="drawer-frame-notices"
    >
      <slot name="notices" />
    </div>
    <div
      ref="body"
      class="drawer-frame-body"
      :style="scrollPadding"
    >
      <div class="drawer-frame-lead">
        <h2
          ref="name"
          class="drawer-frame-name"
        >
          <slot name="title">{{ title }}</slot>
        </h2>
        <div
          v-if="$slots.facts"
          class="drawer-frame-facts"
        >
          <slot name="facts" />
        </div>
      </div>
      <div
        v-if="$slots.tabs"
        ref="tabs"
        class="drawer-frame-tabs"
      >
        <slot name="tabs" />
      </div>
      <div
        ref="content"
        class="drawer-frame-content"
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
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 100%;
  background: var(--color-surface);
  container: drawer / inline-size;
}

/* One height whatever it shows. The identity may run under the action's cell, which
   stands empty while the identity is in sight: the title stops short of that cell
   from the start, so the action arrives without cutting a word it had already shown. */
.drawer-frame-bar {
  display: grid;
  grid-template-areas: 'lead action controls';
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--space-2);
  align-items: center;
  height: calc(var(--size-control-target) + 2 * var(--space-1));
  padding-inline: var(--space-6);
}

.drawer-frame-identity {
  grid-row: 1;
  grid-column: lead-start / action-end;
  min-width: 0;
}

.drawer-frame-pinned-title {
  grid-area: lead;
  min-width: 0;
  margin: 0;
  font: var(--font-name);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drawer-frame-action {
  grid-area: action;
}

.drawer-frame-controls {
  display: flex;
  grid-area: controls;
  gap: var(--space-2);
  align-items: center;
}

/* The fades, and the only things the scroller's position decides. What is out of sight
   is out of reach too. A control the keyboard holds stays where it is until the keyboard
   moves on, and what would stand over it waits. */
.drawer-frame-identity,
.drawer-frame-pinned-title,
.drawer-frame-action {
  transition:
    opacity var(--duration-surface) var(--ease-out),
    visibility var(--duration-surface) var(--ease-out);
}

.drawer-frame-pinned-title,
.drawer-frame-action,
.title-away .drawer-frame-identity {
  opacity: 0;
  visibility: hidden;
}

.title-away .drawer-frame-pinned-title,
.action-away .drawer-frame-action,
.drawer-frame-identity:has(:focus-visible),
.drawer-frame-action:has(:focus-visible) {
  opacity: 1;
  visibility: visible;
}

.drawer-frame-bar:has(.drawer-frame-identity :focus-visible) {
  .drawer-frame-pinned-title,
  .drawer-frame-action {
    opacity: 0;
    visibility: hidden;
  }
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

/* A refusal of a write far down has to be seen however far down it was made, and a
   question is asked of the reader wherever they stand, so these stay out of the
   scroller. Their height follows what they say, never where the scroller is. */
.drawer-frame-notices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-6) var(--space-3);
}

/* The scrollbar is paid for out of the end inset, so the scroller's content ends
   where the bar's does. Drawn inside a full inset it pushed every row 10px short
   of the close button above it, and the column read as shifted.

   The scroller is the containing block of what is positioned inside it. Without
   that, a visually hidden label far down a long section was placed against the
   drawer instead, stretched the drawer's own scroll area to twice its height,
   and the first `scrollIntoView` scrolled the drawer and left a blank band
   under the body. */
.drawer-frame-body {
  position: relative;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.drawer-frame-lead,
.drawer-frame-tabs,
.drawer-frame-content {
  padding-inline: var(--space-6) calc(var(--space-6) - var(--size-scrollbar));
}

.drawer-frame-lead {
  display: grid;
  gap: var(--space-3);
  padding-block: var(--space-1) var(--space-4);
}

.drawer-frame-name {
  margin: 0;
  font: var(--font-drawer-title);
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.drawer-frame-facts {
  min-width: 0;
}

/* The content scrolls away behind these and they cover it edge to edge. */
.drawer-frame-tabs {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-block-end: var(--space-3);
  border-bottom: 1px solid var(--color-rule);
  background: var(--color-surface);
}

.drawer-frame-content {
  padding-block: var(--space-6);
}
</style>
