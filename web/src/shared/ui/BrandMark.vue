<script setup lang="ts">
/**
 * The Valkama mark: one drawing, two tones.
 *
 * The drawing is a spark on a 96-unit square: a long stroke, and an accent of
 * a triangle under its short arm and a four-pointed star. Everything that shows
 * the mark in the application renders this component. The two copies that
 * cannot import a Vue component are the browser tab (`public/favicon.svg`) and
 * the Windows icon (`windows/make_icon.py`), because neither a tab nor an ICO
 * resolves a custom property or a bundler import; `tests/brandMark.test.ts`
 * holds all three to the same geometry.
 *
 * `brand` is two flat colours from `tokens.css`, the stroke and the accent. It
 * belongs where the mark stands alone on someone else's ground: a browser tab,
 * a tray, an installer.
 *
 * `chrome` is the same drawing in one ink, taking its color from the carrier.
 * Inside the shell a second colour would be a chromatic event in a chrome that
 * rations a status down to a single dot.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ size?: number; title?: string; tone?: 'brand' | 'chrome' }>(),
  { size: 26, title: '', tone: 'brand' },
)

const bodyFill = computed(() =>
  props.tone === 'chrome' ? 'currentColor' : 'var(--color-brand-body)',
)
const accentFill = computed(() =>
  props.tone === 'chrome' ? 'currentColor' : 'var(--color-brand-accent)',
)

/**
 * A titled mark is an image with a name; an untitled one is decoration.
 *
 * One decision spelled as one binding, because the two attributes cannot
 * disagree: whichever does not apply has to be absent rather than false, and
 * `role="img"` with no name is a worse promise than no role at all.
 */
const labelling = computed(() => (props.title ? { role: 'img' } : { 'aria-hidden': true }))
</script>

<template>
  <svg
    class="brand-mark-svg"
    viewBox="0 0 96 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    v-bind="labelling"
  >
    <title v-if="title">{{ title }}</title>
    <path
      d="M48 94L59 72L24 2H2L48 94Z"
      :fill="bodyFill"
    />
    <path
      d="M62.91 64.17L73 44H52.83L62.91 64.17ZM75 0L79.65 13.35L90.5 18L79.65 22.65L75 36L70.35 22.65L59.5 18L70.35 13.35L75 0Z"
      :fill="accentFill"
    />
  </svg>
</template>

<style scoped>
.brand-mark-svg {
  display: block;
  flex: 0 0 auto;
}
</style>
