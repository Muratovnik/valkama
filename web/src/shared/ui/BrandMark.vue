<script setup lang="ts">
/**
 * The Valkama mark: one drawing, two tones.
 *
 * Everything that shows the mark in the application renders this component —
 * the navigation brand was a letter `V` in a box standing in for it. The two
 * copies that cannot import a Vue component are the browser tab
 * (`public/favicon.svg`) and the Windows icon (`windows/make_icon.py`), because
 * neither a tab nor an ICO resolves a custom property or a bundler import;
 * `tests/brandMark.test.ts` holds all three to the same path data.
 *
 * `brand` is the gradient in the accent family from `tokens.css`, not the teal
 * the drawing arrived in. It belongs where the mark stands alone on someone
 * else's ground: a browser tab, a tray, an installer.
 *
 * `chrome` is the same drawing in one ink, taking its color from the carrier.
 * Inside the shell the gradient was the only one in an interface whose own
 * rules forbid them, and four chromatic events in a chrome that rations a
 * status down to a single dot.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ size?: number; title?: string; tone?: 'brand' | 'chrome' }>(),
  { size: 26, title: '', tone: 'brand' },
)

/** One id per instance would be tidier, but the mark appears once per view and
 *  a stable id keeps the markup readable in the DOM inspector. */
const GRADIENT_ID = 'valkama-mark-gradient'
const SPARK_ID = 'valkama-mark-spark'

/** The mark's own aspect ratio, so a caller sets one number and not two. */
const height = computed(() => Math.round((props.size * 306) / 353))

const strokeFill = computed(() =>
  props.tone === 'chrome' ? 'currentColor' : `url(#${GRADIENT_ID})`,
)
const sparkFill = computed(() => (props.tone === 'chrome' ? 'currentColor' : `url(#${SPARK_ID})`))

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
    viewBox="0 0 353 306"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="height"
    v-bind="labelling"
  >
    <title v-if="title">{{ title }}</title>
    <defs v-if="tone === 'brand'">
      <linearGradient
        :id="GRADIENT_ID"
        x1="4"
        y1="279"
        x2="359"
        y2="19"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="var(--color-brand-gradient-from)" />
        <stop
          offset="0.55"
          stop-color="var(--color-brand-gradient-mid)"
        />
        <stop
          offset="1"
          stop-color="var(--color-brand-gradient-to)"
        />
      </linearGradient>
      <linearGradient
        :id="SPARK_ID"
        x1="324"
        y1="46.5"
        x2="353"
        y2="21.5"
        gradientUnits="userSpaceOnUse"
      >
        <stop stop-color="var(--color-brand-spark-from)" />
        <stop
          offset="1"
          stop-color="var(--color-brand-spark-to)"
        />
      </linearGradient>
    </defs>
    <path
      d="M0 0H88L230 239L190 306L0 0Z"
      :fill="strokeFill"
    />
    <path
      d="M210 175L240 225L339 67L284 67L210 175Z"
      :fill="strokeFill"
    />
    <path
      d="M338.5 21C340 29.5 344 33.5 353 35C344 36.5 340 40.5 338.5 49C337 40.5 333 36.5 324 35C333 33.5 337 29.5 338.5 21Z"
      :fill="sparkFill"
    />
  </svg>
</template>

<style scoped>
.brand-mark-svg {
  display: block;
  flex: 0 0 auto;
}
</style>
