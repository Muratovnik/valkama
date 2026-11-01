<script setup lang="ts">
/**
 * Text that may run long, shown to a few lines until the reader asks for the rest.
 *
 * Agents write descriptions and comments a screen long, and the inspector used
 * to print every one of them in full: one item read as a ribbon nearly ten
 * thousand pixels tall, with the comment field at its far end. The whole text
 * stays in the document, so search and a screen reader still reach it; only
 * its height is held until the toggle is pressed. The toggle appears only when
 * something is actually hidden.
 *
 * What is held is either `text` — markdown, drawn by `RichText`, or the words as
 * written when `format` is `plain` — or whatever the default slot holds, such as
 * a work report's three sections; `resetKey` then says when the content is new
 * and the hold starts again.
 *
 * The height is counted in lines of the host's type, and then ends at the last
 * line it holds whole. Plain text lines up with that count by itself; markdown
 * does not — list gaps, code and a heading's weight shift the lines — and a
 * held list used to end through the middle of a line of text, half of it
 * showing above the toggle.
 *
 * The host sets the type on this component's root, the way it would on the
 * paragraph this replaces.
 */
import { computed, nextTick, onMounted, ref, useSlots, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver } from '@vueuse/core'

import RichText from '@/shared/ui/RichText.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    format?: 'markdown' | 'plain'
    lines?: number
    resetKey?: string | number
    text?: string
  }>(),
  { text: '', format: 'markdown', lines: 8, resetKey: undefined },
)

const { t } = useI18n()
const slots = useSlots()
/** Words kept as written, line breaks and all, rather than read as markdown. */
const plain = computed(() => !slots.default && props.format === 'plain')
const expanded = ref(false)
const overflowing = ref(false)
const body = ref<HTMLElement | null>(null)
/** Where the held text ends, in pixels from its top; null holds by the line count alone. */
const cut = ref<number | null>(null)
/** The line count on the root, where the default cut is worked out from it. */
const linesStyle = computed(() => ({ '--collapsible-lines': props.lines }))
const cutStyle = computed(() =>
  cut.value === null ? {} : { '--collapsible-cut': `${cut.value}px` },
)

/** The bottom of the last line box that ends within `limit`, or null where none can be read. */
function lastWholeLine(element: HTMLElement, limit: number): number | null {
  if (typeof document.createRange !== 'function') return null
  const range = document.createRange()
  range.selectNodeContents(element)
  const top = element.getBoundingClientRect().top
  let bottom = 0
  for (const rect of range.getClientRects()) {
    const end = rect.bottom - top
    if (end <= limit + 0.5 && end > bottom) bottom = end
  }
  return bottom > 0 ? Math.ceil(bottom) : null
}

function measure() {
  const element = body.value
  if (!element || expanded.value) return
  const limit = props.lines * Number.parseFloat(getComputedStyle(element).lineHeight)
  if (!Number.isFinite(limit)) {
    overflowing.value = element.scrollHeight > element.clientHeight + 1
    return
  }
  overflowing.value = element.scrollHeight > limit + 1
  cut.value = overflowing.value ? lastWholeLine(element, limit) : null
}

useResizeObserver(body, measure)
onMounted(measure)
watch(
  () => props.resetKey ?? props.text,
  () => {
    expanded.value = false
    void nextTick(measure)
  },
)
watch(expanded, (open) => {
  if (!open) void nextTick(measure)
})
/**
 * A link inside the held text that takes focus opens the whole text. The text
 * now holds links, and Tab reached the ones below the cut: the browser scrolled
 * the held box to show the focused one, and the box then showed the middle of
 * the text with its top cut away, which nothing on the page could undo. A link
 * the reader can already see leaves the text as it is.
 */
function reveal(event: FocusEvent) {
  const element = body.value
  if (!element || !overflowing.value || expanded.value) return
  if (!(event.target instanceof Element)) return
  // Where the link ends in the text, whatever the box has been scrolled to.
  const end =
    event.target.getBoundingClientRect().bottom -
    element.getBoundingClientRect().top +
    element.scrollTop
  if (end > element.clientHeight + 1) expanded.value = true
  element.scrollTop = 0
}
const toggleLabel = computed(() =>
  t(expanded.value ? 'platform.actions.collapse' : 'platform.actions.expand'),
)
</script>

<template>
  <div
    class="collapsible"
    :style="linesStyle"
  >
    <div
      ref="body"
      class="collapsible-text"
      :class="{ clamped: !expanded, plain }"
      :style="cutStyle"
      @focusin="reveal"
    >
      <slot>
        <template v-if="format === 'plain'">{{ props.text }}</template>
        <RichText
          v-else
          :source="props.text"
        />
      </slot>
    </div>
    <VButton
      v-if="overflowing"
      class="collapsible-toggle"
      size="inline"
      variant="ghost"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
      >{{ toggleLabel }}</VButton
    >
  </div>
</template>

<style scoped>
.collapsible {
  /* The line count arrives inline here and the measured cut on the text; these
     are the fallbacks, the cut being the line count until a line is measured. */
  --collapsible-lines: 8;
  --collapsible-cut: calc(var(--collapsible-lines) * 1lh);

  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.collapsible-text {
  min-width: 0;
  overflow-wrap: anywhere;

  &.plain {
    white-space: pre-wrap;
  }

  &.clamped {
    max-height: var(--collapsible-cut);
    overflow: hidden;
  }
}

/* The toggle starts where the text starts, so it reads as the text's own end
   rather than as an action of the section around it. */
.collapsible-toggle {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-2));
}
</style>
