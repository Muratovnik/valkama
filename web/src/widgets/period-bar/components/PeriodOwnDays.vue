<script setup lang="ts">
/**
 * The ends of the reader's own period, beside the periods in a period bar (`PeriodBar`): its first
 * and last day as two fields, or, for a span between two moments the host names (`spanName`), that
 * name in their place, «13 нояб., 10:00–13:00». No field edits a span: a preset chosen in the bar
 * leaves it. The name is one line no taller than the periods, so the bar keeps its height with it,
 * and whole until the bar's line has given up all else (`cut`); then it is cut at its end, and its
 * hint says it whole. The fields' names and the words of a reversed period are the host's.
 */
import { computed } from 'vue'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** Whether the bar's line has given up all else and a span's name gives up its width. */
  cut: boolean
  /** The first day, `2030-03-04`, or the first moment of a span. */
  from: string
  /** The name of a span between two moments; null for a span of days. */
  spanName: string | null
  /** The last day; the last moment of a span. */
  to: string
  /** The day the read was asked on, the last a field can name. */
  today: string
  /** The fields' names, and what a last day before the first says. */
  words: { from: string; reversed: string; to: string }
}>()
/** A day of the period set anew. */
const emit = defineEmits<{ days: [next: { from: string } | { to: string }] }>()

const rangeError = computed(() =>
  props.from && props.to && props.to < props.from ? props.words.reversed : '',
)
</script>

<template>
  <p
    v-if="spanName"
    v-tooltip.clipped="spanName"
    class="period-bar-span one-line"
    :class="{ 'period-bar-span-cut': cut }"
  >
    {{ spanName }}
  </p>
  <div
    v-else
    class="period-bar-days"
  >
    <VTextInput
      class="period-bar-day"
      type="date"
      size="compact"
      :label="words.from"
      :model-value="from"
      :max="today"
      hide-label
      @update:model-value="(value) => emit('days', { from: String(value) })"
    />
    <span
      class="period-bar-days-dash"
      aria-hidden="true"
      >–</span
    >
    <VTextInput
      class="period-bar-day"
      type="date"
      size="compact"
      :label="words.to"
      :model-value="to"
      :max="today"
      :error="rangeError"
      hide-label
      @update:model-value="(value) => emit('days', { to: String(value) })"
    />
  </div>
</template>

<style scoped>
.period-bar-days {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

/* As wide as a date of the widest figures needs beside the calendar's button, «28.08.2026», and
   no wider: a bar's line has no room to spare beside a span of days, and a day is never cut. */
.period-bar-day {
  inline-size: 8.25rem;
}

.period-bar-days-dash {
  color: var(--color-text-muted);
}

/* A bar narrower than the two days, their dash and the room between, 18rem, as a phone of 360px
   makes Analytics' (264px): each field gives up the air inside its edge and the room beside it
   narrows, so the date keeps the room it had and the days stay one row. At 8.25rem each they
   needed 288px of 264 and stood under each other. */
@container (width < 18rem) {
  .period-bar-days {
    gap: var(--space-1);
  }

  .period-bar-day {
    --space-text-input-inline: var(--space-2);

    inline-size: calc(8.25rem - 2 * (var(--space-3) - var(--space-2)));
  }
}

/* The span's name stands where the days would, in the periods' own words. */
.period-bar-span {
  flex: none;
  margin: 0;
  color: var(--color-text);
  font: var(--font-control);
  font-variant-numeric: tabular-nums;
}

/* Cut, the name takes up the line's whole shortfall: the read again beside it may shrink too, but
   by its weight against this one's, a thousandth, it keeps its own width to the pixel. */
.period-bar-span-cut {
  flex: 0 1000 auto;
}
</style>
