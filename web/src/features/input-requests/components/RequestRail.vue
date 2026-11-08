<script setup lang="ts">
/**
 * A way through the list of everything waiting: a short bar at the dialog's start edge for each
 * question, the bars of one block of questions together and the blocks apart. The bar of the
 * question being read is longer and in full ink; a bar answers its press by bringing its question
 * to the top of the panel, under the head of its block that sticks there, and names its question
 * to the pointer resting on it and to a reader.
 *
 * A question is what a block marks as one (`data-rail-question`): each field of a block answered
 * field by field, each titled group of a review. A block that marks none, folded once answered or
 * a review with no groups, has one bar of its own (`data-rail-block`), named by its title. The
 * bars are read off the list as it stands, so a block that folds, opens or leaves takes its bars
 * with it; nothing here keeps a second copy of what a block shows.
 *
 * The question being read is the last whose top has passed the upper third of the panel, and at
 * the end of the list the last of all, since the last questions never reach that line. One that
 * a press brought up stays the one being read while it is in sight, so a question near the end
 * keeps its bar after the press.
 *
 * The rail is one stop on Tab, the bar of the question being read; the arrows walk the bars and
 * Home and End reach the ends, and Enter or Space goes. Gone to from the keyboard, focus goes
 * with the question, to where it is answered, or to a review group's heading or a block that
 * has no questions shown, as an in-page link's target takes it; a press of the pointer leaves
 * focus where it was. A wheel turned over the rail scrolls the list, as it did
 * over the inset the rail stands in.
 */
import { computed, nextTick, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  /** The panel that scrolls the list. */
  scroller: HTMLElement | null
}>()
const { t } = useI18n()

interface Mark {
  label: string
  target: HTMLElement
}
interface Block {
  label: string
  marks: Mark[]
}

/** The air left between a question brought up and what sticks over it. */
const CLEARANCE = 8
/** A line of the wheel, where the wheel counts in lines. */
const WHEEL_LINE = 16
/** Where an answer is given, before the comment's press that ends the question's label. */
const ANSWER = 'input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled])'
const CONTROL = 'button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]'

const blocks = shallowRef<Block[]>([])
const marks = computed(() => blocks.value.flatMap((block) => block.marks))
const current = shallowRef<HTMLElement | null>(null)
/** The bar the keyboard stands on while it is in the rail. */
const walking = shallowRef<HTMLElement | null>(null)
const stop = computed(() => walking.value ?? current.value ?? marks.value[0]?.target ?? null)
/** The question a press brought up, until it is out of sight after its scroll has ended. */
let pinned: HTMLElement | null = null
let settling = false
const bars: HTMLButtonElement[] = []

const shown = (element: HTMLElement) => element.getClientRects().length > 0

function read(): Block[] {
  const scroller = props.scroller
  if (!scroller) return []
  return [...scroller.querySelectorAll<HTMLElement>('[data-rail-block]')]
    .filter((block) => shown(block))
    .map((block) => {
      const label = block.dataset.railLabel ?? ''
      const marked = [...block.querySelectorAll<HTMLElement>('[data-rail-question]')]
        .filter((target) => shown(target))
        .map((target) => ({ label: target.dataset.railQuestion ?? '', target }))
      return { label, marks: marked.length ? marked : [{ label, target: block }] }
    })
}

/** The same bars as before, so a change elsewhere in the list draws nothing again. */
function same(next: Block[]) {
  const now = blocks.value
  return (
    next.length === now.length &&
    next.every((block, b) => {
      const was = now[b]
      return (
        was?.label === block.label &&
        was.marks.length === block.marks.length &&
        block.marks.every(
          (mark, m) => was.marks[m]?.target === mark.target && was.marks[m]?.label === mark.label,
        )
      )
    })
  )
}

function inSight(element: HTMLElement, scroller: HTMLElement) {
  const box = element.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  return box.bottom > view.top && box.top < view.bottom
}

function track() {
  const scroller = props.scroller
  const all = marks.value
  if (!scroller || !all.length) {
    current.value = null
    return
  }
  const held = pinned && all.some((mark) => mark.target === pinned) ? pinned : null
  if (held && (settling || inSight(held, scroller))) {
    current.value = held
    return
  }
  pinned = null
  const scrolls = scroller.scrollHeight > scroller.clientHeight
  if (scrolls && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
    current.value = all.at(-1)?.target ?? null
    return
  }
  const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3
  let reading = all[0]?.target ?? null
  for (const mark of all) {
    if (mark.target.getBoundingClientRect().top > line) break
    reading = mark.target
  }
  current.value = reading
}

function collect() {
  const next = read()
  if (!same(next)) blocks.value = next
  if (walking.value && !next.some((block) => block.marks.some((m) => m.target === walking.value)))
    walking.value = null
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
  {
    attributeFilter: ['data-rail-block', 'data-rail-label', 'data-rail-question'],
    childList: true,
    subtree: true,
  },
)
useResizeObserver(
  () => props.scroller,
  () => schedule(true),
)
useEventListener(
  () => props.scroller,
  'scroll',
  () => schedule(false),
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

/** What sticks over the top of the panel above this question, inside its block. */
function coverAbove(target: HTMLElement) {
  const block = target.closest<HTMLElement>('[data-rail-block]')
  const edges = block ? [...block.querySelectorAll<HTMLElement>('[data-stuck-edge="start"]')] : []
  return edges
    .filter((edge) => !edge.contains(target) && !target.contains(edge))
    .filter((edge) => edge.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
    .reduce((sum, edge) => sum + edge.getBoundingClientRect().height, 0)
}

function go(mark: Mark, event: MouseEvent) {
  const scroller = props.scroller
  if (!scroller) return
  pinned = mark.target
  current.value = mark.target
  const top =
    scroller.scrollTop +
    mark.target.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top -
    coverAbove(mark.target) -
    CLEARANCE
  const goal = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight))
  // No scroll to make, no end of one to wait for.
  settling = Math.abs(goal - scroller.scrollTop) >= 1
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollTo({ top: goal, behavior: still ? 'auto' : 'smooth' })
  // A key's press has no pointer to say where it went: focus goes with the question.
  if (event.detail === 0) {
    const control = mark.target.matches('[data-rail-block]')
      ? mark.target
      : (mark.target.querySelector<HTMLElement>(ANSWER) ??
        mark.target.querySelector<HTMLElement>(CONTROL))
    moveFocus(control, { preventScroll: true })
  }
}

function walk(event: KeyboardEvent) {
  const all = marks.value
  const at = all.findIndex((mark) => mark.target === stop.value)
  const to = {
    ArrowDown: Math.min(at + 1, all.length - 1),
    ArrowUp: Math.max(at - 1, 0),
    End: all.length - 1,
    Home: 0,
  }[event.key]
  if (to === undefined || to < 0) return
  event.preventDefault()
  walking.value = all[to]?.target ?? null
  void nextTick(() => bars[to]?.focus())
}

const rail = shallowRef<HTMLElement | null>(null)
/** Leaving the rail puts its stop back on the question being read. */
function leave(event: FocusEvent) {
  const into = event.relatedTarget
  if (!(into instanceof Node) || !rail.value?.contains(into)) walking.value = null
}

function wheel(event: WheelEvent) {
  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE : 1
  props.scroller?.scrollBy({ top: event.deltaY * scale, left: 0 })
}

/** The order of a bar among all of them, for the arrows. */
function order(block: number, mark: number) {
  return blocks.value.slice(0, block).reduce((sum, each) => sum + each.marks.length, 0) + mark
}
const isCurrent = (mark: Mark) => mark.target === current.value
/** `location` on the question being read, and absent elsewhere rather than a claim of false. */
const currentMark = (mark: Mark) => (isCurrent(mark) ? 'location' : undefined)
/** The rail's one Tab stop. */
const stopOf = (mark: Mark) => (mark.target === stop.value ? 0 : -1)
function keep(bar: unknown, block: number, mark: number) {
  bars[order(block, mark)] = bar as HTMLButtonElement
}
</script>

<template>
  <nav
    v-if="marks.length"
    ref="rail"
    class="request-rail"
    :aria-label="t('requests.rail')"
    @wheel.passive="wheel"
  >
    <div
      v-for="(block, b) in blocks"
      :key="b"
      class="request-rail-block"
      role="group"
      :aria-label="block.label"
    >
      <button
        v-for="(mark, m) in block.marks"
        :key="m"
        :ref="(bar) => keep(bar, b, m)"
        v-tooltip="mark.label"
        type="button"
        class="request-rail-bar"
        :class="{ 'is-current': isCurrent(mark) }"
        :aria-label="mark.label"
        :aria-current="currentMark(mark)"
        :tabindex="stopOf(mark)"
        @focus="walking = mark.target"
        @focusout="leave"
        @keydown="walk"
        @click="go(mark, $event)"
      />
    </div>
  </nav>
</template>

<style scoped>
/* As tall as its bars, or as the panel where they are more than it holds: then each bar gives up
   height alike, down to a line it can still be told from, and past that the rail scrolls. The
   blocks stand a bar's pitch apart, which a gap of half that did not show beside 24px bars. */
.request-rail {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: var(--space-6);
  min-height: 0;
  padding-block: var(--space-2);
  overflow-y: auto;
  scrollbar-width: none;
}

.request-rail-block {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* The whole width of the inset and 24px of height answer a press (WCAG 2.5.8) while there is
   room; what is drawn is the short line. */
.request-rail-bar {
  position: relative;
  flex: 0 1 var(--space-6);
  min-height: var(--space-2);
  padding: 0;
  border: 0;
  color: var(--color-text-tertiary);
  background: none;
  cursor: pointer;

  &::before {
    content: '';
    position: absolute;
    inset-block-start: calc(50% - 1px);
    inset-inline-start: var(--space-1);
    inline-size: var(--space-2);
    block-size: 2px;
    background: currentcolor;
    border-radius: 999px;
    transition: inline-size var(--duration-quick) var(--ease-out);
  }

  &:hover,
  &:focus-visible {
    color: var(--color-text-muted);

    &::before {
      inline-size: var(--space-3);
    }
  }

  &:focus-visible {
    outline-offset: -2px;
  }

  /* Longer as well as brighter, so a forced palette and a reader of shapes see it too. */
  &.is-current {
    color: var(--color-text);

    &::before {
      inline-size: var(--space-4);
    }
  }

  @media (forced-colors: active) {
    &::before {
      background: CanvasText;
    }

    &.is-current::before {
      background: Highlight;
    }
  }
}
</style>
