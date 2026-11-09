<script setup lang="ts">
/**
 * The way through «Needs my answer», in the dialog's head: «Question N of M», where M counts
 * the blocks of questions still waiting and N is the one being read, and a step to the one
 * before and after. It took the place of a rail of short bars at the dialog's start edge, one
 * per question shown, which needed decoding and counted answered questions too, so it had more
 * bars than the list said were waiting.
 *
 * A block being read is the last waiting one whose head has reached the top of the list, where
 * the browser brings it too, its scroll margin under the top, and at the end of the list the last
 * of all, since the last blocks never reach the top. Above the first, it is the first: N is never
 * a block the reader has not come to, and the step down from there is to the second. One a step
 * brought up stays the one being read until the reader scrolls, so a block near the end keeps
 * its number after the step.
 *
 * A step brings the block's head up to the top of the list, where it sticks, and leaves focus
 * on the step, so that pressing it again goes on. The arrows do the same from any control of
 * the group, and Home and End go to the first and the last. The count itself goes to where the
 * block being read is answered: its first field takes focus, as an in-page link's target does.
 * The count keeps the room of its widest number, so the steps beside it never move.
 */
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The panel that scrolls the list. */
  scroller: HTMLElement | null
}>()
const { t } = useI18n()

/** What a block's top may lie past the line it is brought to and still have reached it. */
const REACHED = 1
/** The list stops at 100 requests, so the count's room is for three digits. */
const WIDEST = 888
/** Where a block is answered, before the comment's press that ends a question's label. */
const ANSWER = 'input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled])'
const CONTROL = 'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]'

const blocks = shallowRef<HTMLElement[]>([])
/** The waiting block being read. */
const at = ref(0)
/** The block a step brought up, until the reader scrolls. */
let pinned: HTMLElement | null = null
/** A step's own scroll is under way, which is not the reader scrolling. */
let settling = false

const place = computed(() => t('requests.hub.place', { n: at.value + 1, m: blocks.value.length }))
const widest = computed(() => t('requests.hub.place', { n: WIDEST, m: WIDEST }))

function read() {
  const found = props.scroller?.querySelectorAll<HTMLElement>('[data-request-waiting]') ?? []
  return [...found].filter((block) => block.getClientRects().length > 0)
}

function track() {
  const scroller = props.scroller
  const all = blocks.value
  if (!scroller || !all.length) {
    at.value = 0
    return
  }
  const held = pinned ? all.indexOf(pinned) : -1
  if (held >= 0) {
    at.value = held
    return
  }
  pinned = null
  const scrolls = scroller.scrollHeight > scroller.clientHeight
  if (scrolls && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
    at.value = all.length - 1
    return
  }
  const top = scroller.getBoundingClientRect().top + REACHED
  const reached = all.filter(
    (block) =>
      block.getBoundingClientRect().top <=
      top + (Number.parseFloat(getComputedStyle(block).scrollMarginTop) || 0),
  )
  at.value = Math.max(reached.length - 1, 0)
}

function collect() {
  const next = read()
  const now = blocks.value
  if (next.length !== now.length || next.some((block, index) => block !== now[index]))
    blocks.value = next
  track()
}

let frame = 0
let collecting = false
function schedule(all: boolean) {
  collecting ||= all
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const whole = collecting
    collecting = false
    if (whole) collect()
    else track()
  })
}

watch(
  () => props.scroller,
  () => schedule(true),
  { immediate: true },
)
useMutationObserver(
  () => props.scroller,
  () => schedule(true),
  { attributeFilter: ['data-request-waiting', 'hidden'], childList: true, subtree: true },
)
useResizeObserver(
  () => props.scroller,
  () => schedule(true),
)
useEventListener(
  () => props.scroller,
  'scroll',
  () => {
    if (!settling) pinned = null
    schedule(false)
  },
  { passive: true },
)
useEventListener(
  () => props.scroller,
  'scrollend',
  () => {
    settling = false
    schedule(false)
  },
  { passive: true },
)

/** Brings this waiting block's head up to the top of the list. */
function bring(index: number, behavior?: ScrollBehavior) {
  const scroller = props.scroller
  const block = blocks.value[index]
  if (!scroller || !block) return null
  pinned = block
  at.value = index
  const top =
    scroller.scrollTop + block.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  const goal = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight))
  // No scroll to make, no end of one to wait for.
  settling = Math.abs(goal - scroller.scrollTop) >= 1
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollTo({ top: goal, behavior: behavior ?? (still ? 'auto' : 'smooth') })
  return block
}

const step = (by: number) => bring(Math.min(Math.max(at.value + by, 0), blocks.value.length - 1))

/** The count goes to where the block being read is answered. */
function answer() {
  const block = bring(at.value, 'auto')
  if (!block) return
  moveFocus(
    block.querySelector<HTMLElement>(ANSWER) ?? block.querySelector<HTMLElement>(CONTROL) ?? block,
    { preventScroll: true },
  )
}

function walk(event: KeyboardEvent) {
  const last = blocks.value.length - 1
  const go = {
    ArrowDown: () => step(1),
    ArrowUp: () => step(-1),
    End: () => bring(last),
    Home: () => bring(0),
  }[event.key]
  if (!go || event.altKey || event.ctrlKey || event.metaKey) return
  event.preventDefault()
  go()
}
</script>

<template>
  <div
    v-if="blocks.length"
    class="request-navigator"
    role="group"
    :aria-label="t('requests.hub.nav')"
  >
    <VButton
      v-tooltip="t('requests.hub.toAnswer')"
      class="request-navigator-place"
      variant="text"
      reach
      @click="answer"
      @keydown="walk"
    >
      <span class="request-navigator-count">
        <span
          class="request-navigator-widest"
          aria-hidden="true"
          >{{ widest }}</span
        >
        <span class="request-navigator-now">{{ place }}</span>
      </span>
    </VButton>
    <VButton
      v-tooltip="t('requests.hub.previous')"
      variant="ghost"
      :aria-label="t('requests.hub.previous')"
      icon
      @click="step(-1)"
      @keydown="walk"
    >
      <VIcon name="arrow-up" />
    </VButton>
    <VButton
      v-tooltip="t('requests.hub.next')"
      variant="ghost"
      :aria-label="t('requests.hub.next')"
      icon
      @click="step(1)"
      @keydown="walk"
    >
      <VIcon name="arrow-down" />
    </VButton>
  </div>
</template>

<style scoped>
/* The head's own group of icons, closer to each other than to the title (`OverlayHeader`). */
.request-navigator {
  display: flex;
  gap: var(--space-1);
  align-items: center;
}

/* Its words and the room of its widest number in one cell, the words at the steps' side: a
   number gaining a digit grows the words toward the title and moves nothing else. */
.request-navigator-count {
  display: inline-grid;
  justify-items: end;
  font-variant-numeric: tabular-nums;
}

.request-navigator-widest,
.request-navigator-now {
  grid-area: 1 / 1;
}

.request-navigator-widest {
  visibility: hidden;
}
</style>
