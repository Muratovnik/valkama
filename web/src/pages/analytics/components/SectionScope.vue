<script setup lang="ts">
/**
 * Which projects a section's figures are of, beside its heading in the quiet ink: «project
 * Billing» on a page scoped to one, «space Platform» on one scoped to a space whole, «all
 * projects» on the global page (`useScopeWords`). It stands on the heading's line, after its «ⓘ»,
 * in the room the heading and the row's controls leave it, whatever the name: a long one wraps
 * there and is cut at the end of its second line (`.two-lines`), its whole words in a hint while
 * they are cut, so the section's choice and what the section holds stand where a short name leaves
 * them; two lines of its quiet type are no taller than a control of the row. Laid out at its whole
 * width, an 85-character space name took the pauses' choice to a line of its own at 1440px, 40px
 * down, and at 1024px the words and then the choice to lines of their own, the tables 61px down.
 * Only where the heading's line leaves less than the words' least room, on a phone, do they take a
 * line of their own. The bar has no room for them; a project's week beside the global one, with
 * the project named only in the context bar, read as two answers for one week.
 */
import { useScopeWords } from '@/pages/analytics/composables/useScopeWords.ts'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const words = useScopeWords()
</script>

<template>
  <span
    v-if="words"
    v-tooltip.clipped="words.short"
    class="section-scope two-lines"
    data-part="scope"
    >{{ words.short }}</span
  >
</template>

<style scoped>
/* The words take the room the row's other parts leave on its line, never their own width, so no
   name moves those parts; with less than 10rem of it they take a line of their own. The row's
   controls grow too, to take a line of their own whole on a phone (`PanelLevel`), and beside the
   words they shared the room equally: at 1440px the words stood 261px wide instead of 522 and a
   name of 50 characters wrapped. Grown a million times faster, the words take all of it there,
   and what the controls get is less than a layout unit. */
.section-scope {
  flex: 1000000 1 0;
  min-width: min(100%, 10rem);
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
