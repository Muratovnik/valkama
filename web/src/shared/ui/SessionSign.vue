<script setup lang="ts">
/**
 * What a session is doing, as one sign wherever it is drawn: one ring of one size and one
 * stroke, its inside saying the state (`liveSign`). At work it turns, in the accent; asking a
 * person in the middle of a turn it is a question in the warning tone, which `uiSystem.ts`
 * gives it as every meaning colour is given; waiting with its turn over it is a check in the
 * text's colour; at work on other items it is paused, muted; silent for over a day it is
 * dashed, fainter still. Each sign is its own shape, so the colour is never all that says it.
 *
 * It says nothing to assistive technology: its host says the state in words. It turns only
 * while the reader allows motion and its host lets it (`still`: the graph's paused field, a
 * key's sample), and a forced palette draws it in its host's ink.
 */
import { computed } from 'vue'

import type { LiveSign } from '@/shared/lib/liveSign.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import { iconGlyph } from '@/shared/ui/iconGlyph.ts'

const props = withDefaults(
  defineProps<{
    sign: LiveSign
    /** The glyph's box, as `VIcon` takes it. */
    size?: number
    /** The working sign holds still: its host's motion is stopped. */
    still?: boolean
  }>(),
  { size: 14, still: false },
)

const glyph = computed(() =>
  iconGlyph(`session-${props.sign}`, { size: props.size, strokeWidth: 2 }),
)
</script>

<template>
  <component
    :is="glyph"
    class="session-sign"
    aria-hidden="true"
    :class="[`session-sign-${sign}`, { still }]"
    :data-tone="statePresentation('session-sign', sign).tone"
  />
</template>

<style scoped>
/* The sign is the size it is drawn at, wherever it stands, as a `VIcon` is. */
.session-sign {
  flex: none;
  max-inline-size: none;
}

.session-sign-working {
  color: var(--color-accent);
  animation: session-sign-turn 1.4s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  &.still {
    animation: none;
  }
}

.session-sign[data-tone='warning'] {
  color: var(--color-warning);
}

.session-sign-waiting {
  color: var(--color-text);
}

.session-sign-held {
  color: var(--color-text-muted);
}

.session-sign-quiet {
  color: var(--color-text-tertiary);
}

/* A forced palette draws every sign in its host's ink: the palette's text where the palette
   rules, and the host's own pair where the host left it, as an open row of the rail does. The
   shapes still tell the signs apart. */
@media (forced-colors: active) {
  .session-sign,
  .session-sign[data-tone] {
    color: inherit;
  }
}

@keyframes session-sign-turn {
  to {
    transform: rotate(360deg);
  }
}
</style>
