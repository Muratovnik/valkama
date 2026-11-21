<script setup lang="ts">
/**
 * The ends of the reader's own period, beside the periods in the Analytics bar: its first and last
 * day as two fields, or, for a span between two moments, its name in their place, «13 нояб.,
 * 10:00–13:00», in the page's language. No field edits a span: a preset chosen in the bar leaves
 * it. The name is one line no taller than the periods, so the bar keeps its height with it, and
 * whole until the bar's line has given up all else (`cut`); then it is cut at its end, and its
 * hint says it whole.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'

import { isMomentSpan } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** Whether the bar's line has given up all else and a span's name gives up its width. */
  cut: boolean
  /** The day the read was asked on, the last a custom period can name. */
  today: string
  view: AnalyticsView
}>()
/** A day of the period set anew. */
const emit = defineEmits<{ amend: [next: Partial<AnalyticsView>] }>()

const { t } = useI18n()
const words = useSpendingWords()

/** The name of a span between two moments; null for a span of days. */
const spanName = computed(() =>
  isMomentSpan(props.view) ? words.span(props.view.from, props.view.to) : null,
)

const rangeError = computed(() =>
  props.view.from && props.view.to && props.view.to < props.view.from
    ? t('analytics.period.reversed')
    : '',
)
</script>

<template>
  <p
    v-if="spanName"
    v-tooltip.clipped="spanName"
    class="analytics-bar-span one-line"
    :class="{ 'analytics-bar-span-cut': cut }"
  >
    {{ spanName }}
  </p>
  <div
    v-else
    class="analytics-bar-days"
  >
    <VTextInput
      class="analytics-day"
      type="date"
      size="compact"
      :label="t('analytics.period.from')"
      :model-value="view.from"
      :max="today"
      hide-label
      @update:model-value="(from) => emit('amend', { from: String(from) })"
    />
    <span
      class="analytics-bar-days-dash"
      aria-hidden="true"
      >–</span
    >
    <VTextInput
      class="analytics-day"
      type="date"
      size="compact"
      :label="t('analytics.period.to')"
      :model-value="view.to"
      :max="today"
      :error="rangeError"
      hide-label
      @update:model-value="(to) => emit('amend', { to: String(to) })"
    />
  </div>
</template>

<style scoped>
.analytics-bar-days {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

/* As wide as a date of the widest figures needs beside the calendar's button, «28.08.2026», and
   no wider: the bar's line has no room to spare beside a span of days, and a day is never cut. */
.analytics-day {
  inline-size: 8.25rem;
}

.analytics-bar-days-dash {
  color: var(--color-text-muted);
}

/* A bar narrower than the two days, their dash and the room between, 18rem, as a phone of 360px
   makes it (264px): each field gives up the air inside its edge and the room beside it narrows, so
   the date keeps the room it had and the days stay one row. At 8.25rem each they needed 288px of
   264 and stood under each other. */
@container (width < 18rem) {
  .analytics-bar-days {
    gap: var(--space-1);
  }

  .analytics-day {
    --space-text-input-inline: var(--space-2);

    inline-size: calc(8.25rem - 2 * (var(--space-3) - var(--space-2)));
  }
}

/* The span's name stands where the days would, in the periods' own words. */
.analytics-bar-span {
  flex: none;
  margin: 0;
  color: var(--color-text);
  font: var(--font-control);
  font-variant-numeric: tabular-nums;
}

/* Cut, the name takes up the line's whole shortfall: the read again beside it may shrink too, but
   by its weight against this one's, a thousandth, it keeps its own width to the pixel. */
.analytics-bar-span-cut {
  flex: 0 1000 auto;
}
</style>
