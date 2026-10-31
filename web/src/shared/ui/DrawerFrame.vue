<script setup lang="ts">
import { nextTick, ref } from 'vue'

import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ closeLabel: string; title: string; subtitle?: string }>()
const emit = defineEmits<{ close: [] }>()
const body = ref<HTMLElement | null>(null)
const head = ref<HTMLElement | null>(null)

/**
 * The head gives its room back to the body once the body is read past it: the
 * title keeps one line and what stands under it steps out, while the actions
 * slot — a refusal, a question — and the tabs stay. Whole, the head of a long
 * title took a quarter of a desktop drawer and more of a phone's, for as long as
 * the drawer was read.
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

defineExpose({ scrollToTop })
</script>

<template>
  <div class="drawer-frame">
    <header
      ref="head"
      class="drawer-frame-head"
      :class="{ condensed }"
    >
      <div class="drawer-frame-title">
        <h2 class="drawer-frame-name">
          <slot name="title">{{ title }}</slot>
        </h2>
        <p
          v-if="subtitle"
          class="drawer-frame-subtitle"
        >
          {{ subtitle }}
        </p>
        <div
          v-if="$slots.meta"
          class="drawer-frame-meta"
        >
          <slot name="meta" />
        </div>
      </div>
      <button
        class="drawer-frame-close"
        type="button"
        :aria-label="closeLabel"
        @click="emit('close')"
      >
        <VIcon name="close" />
      </button>
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
        <slot name="tabs" />
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
.drawer-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 100%;
  background: var(--color-surface);
}

.drawer-frame-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  flex: 0 0 auto;
  grid-template-areas: 'title close' 'actions actions' 'tabs tabs';
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

/* Condensed, the title is one line and the lines under it step out. */
.drawer-frame-head.condensed {
  .drawer-frame-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .drawer-frame-subtitle,
  .drawer-frame-meta {
    display: none;
  }
}

.drawer-frame-subtitle {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.drawer-frame-close {
  display: grid;
  grid-area: close;
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
