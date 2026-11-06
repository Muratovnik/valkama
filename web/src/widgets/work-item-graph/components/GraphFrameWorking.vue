<script setup lang="ts">
/**
 * The work moving under a frame, in the hue of work under way, after the state on
 * its first line, where folding does not move it: for a folded frame the one sign
 * of it. It says what its number is, «••• 5 работают», at the far end of the line.
 *
 * Zoomed out, where its line leaves the phrase no room, it shortens to the count beside
 * the working dots, «••• 5», the mark a card on the field keeps for the same work, and the
 * header's name and hover text say it whole. It never gives way whole: a band that dropped
 * it told nobody that work was running. Its line says which it is (`short`), measured
 * against the phrase drawn once more where nothing shows it (`wholeWidth`).
 *
 * The number is a word of the phrase, in its size and ink, as «90 open inside» is: a
 * badge's smaller number shrank to a speck beside its word once the line was grown.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

const {
  count,
  overview = false,
  short = false,
} = defineProps<{
  count: number
  overview?: boolean
  /** The count alone beside the dots: the line has no room for the phrase. */
  short?: boolean
  /** The field's motion does not run, so the dots hold still. */
  still?: boolean
}>()
const { t } = useI18n()

const phrase = computed(() => `${count} ${t('graph.frame.working', count)}`)
const shown = computed(() => (short ? String(count) : phrase.value))

const mark = useTemplateRef<HTMLElement>('mark')
const words = useTemplateRef<HTMLElement>('words')
const whole = useTemplateRef<HTMLElement>('whole')

/** How wide the mark stands with its whole phrase, in its line's units, whichever it shows. */
function wholeWidth(): number {
  return mark.value && words.value && whole.value
    ? mark.value.offsetWidth - words.value.offsetWidth + whole.value.offsetWidth
    : 0
}

defineExpose({ wholeWidth })
</script>

<!-- The phrase comes first and the dots after it, laid out from the end, so the dots stand
     before the words. Zoomed out, the whole phrase is drawn once more, unseen, to be measured. -->
<template>
  <span
    ref="mark"
    class="graph-frame-count graph-frame-working"
    :class="{ overview, short }"
    ><span
      ref="words"
      class="working-phrase"
      >{{ shown }}</span
    ><span
      class="work-dots"
      aria-hidden="true"
      :class="{ still }"
      ><i /><i /><i /></span
    ><span
      v-if="overview"
      ref="whole"
      class="working-phrase working-whole"
      aria-hidden="true"
      >{{ phrase }}</span
    ></span
  >
</template>

<style scoped>
.graph-frame-working {
  display: inline-flex;
  flex: 0 0 auto;
  flex-direction: row-reverse;
  gap: var(--space-1);
  justify-content: flex-end;
  align-items: center;
  margin-inline-start: var(--space-1);
  color: var(--color-info);
  white-space: nowrap;

  /* Zoomed out it stands at the far end of the line the header scales, whole or short,
     and the reference beside it gives way before it does. Each part brings its own air. */
  &.overview {
    position: relative;
    gap: 0;
    margin-inline-start: auto;

    & > * {
      margin-inline-start: var(--space-2);
    }
  }
}

.working-phrase {
  font-variant-numeric: tabular-nums;
}

/* Laid out to be measured and never seen. */
.working-whole {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  visibility: hidden;
  pointer-events: none;
}
</style>
