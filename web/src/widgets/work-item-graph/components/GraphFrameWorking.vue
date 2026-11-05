<script setup lang="ts">
/**
 * The work moving under a frame, in the hue of work under way, after the state on
 * its first line, where folding does not move it: for a folded frame the one sign
 * of it. It says what its number is at every zoom, «••• 5 работают», at the far end
 * of the line.
 *
 * Short of room it gives way whole, never as a number or dots with no word: the dots
 * first, then the number with its word, and the header's name and hover text still say
 * it. Three dots and a five over a narrow frame read as nothing at all.
 *
 * The number is a word of the phrase, in its size and ink, as «90 open inside» is: a
 * badge's smaller number shrank to a speck beside its word once the line was grown.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { count, overview = false } = defineProps<{
  count: number
  overview?: boolean
  /** The field's motion does not run, so the dots hold still. */
  still?: boolean
}>()
const { t } = useI18n()

const phrase = computed(() => `${count} ${t('graph.frame.working', count)}`)
</script>

<!-- The phrase comes first and the dots after it, laid out from the end: what wraps out
     of the line's sight is what comes last, so the dots go before the words. -->
<template>
  <span
    class="graph-frame-count graph-frame-working"
    :class="{ overview }"
    ><span class="working-phrase">{{ phrase }}</span
    ><span
      class="work-dots"
      aria-hidden="true"
      :class="{ still }"
      ><i /><i /><i /></span
  ></span>
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

  /* Zoomed out it stands at the far end of the line the header scales, and what does
     not fit beside the reference wraps onto a line nobody sees. The empty first item
     keeps the phrase from being the first on the line, which would show it cut. Each
     part brings its own air, so a mark that gave way whole takes none from the reference. */
  &.overview {
    flex: 0 1 auto;
    flex-wrap: wrap;
    gap: 0;
    justify-content: flex-start;
    min-width: 0;
    max-block-size: 1lh;
    margin-inline-start: auto;
    overflow: hidden;

    /* A line tall, or the phrase that wrapped would rise to the top in its place. */
    &::before {
      content: '';
      block-size: 1lh;
    }

    & > * {
      margin-inline-start: var(--space-2);
    }
  }
}

.working-phrase {
  font-variant-numeric: tabular-nums;
}
</style>
