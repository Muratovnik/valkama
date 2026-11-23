<script setup lang="ts">
/**
 * The days of «Closed in a period» of the reader's own, beside the filter's chips: the period
 * bar's two fields (`PeriodOwnDays`), there while the condition holds days of the reader's own,
 * the first and the last day taken in. A day set anew narrows the work at once; a field emptied
 * keeps the day it had, so the condition never holds half a period, and a last day before the
 * first says so under its field and keeps no card.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PeriodOwnDays from '@/widgets/period-bar/components/PeriodOwnDays.vue'

import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { dayOf, localDay } from '@/shared/lib/periodDays.ts'

const filter = defineModel<WorkFilter>('filter', { required: true })
const { t } = useI18n()

const own = computed(() => (filter.value.closed?.period === 'custom' ? filter.value.closed : null))
/** The last day a field can name: the day the board was opened on. */
const today = localDay(new Date())
const words = computed(() => ({
  from: t('workItem.filter.closedIn.from'),
  reversed: t('workItem.filter.closedIn.reversed'),
  to: t('workItem.filter.closedIn.to'),
}))

function setDay(next: { from: string } | { to: string }) {
  const day = dayOf('from' in next ? next.from : next.to)
  if (own.value && day) filter.value = { ...filter.value, closed: { ...own.value, ...next } }
}
</script>

<template>
  <PeriodOwnDays
    v-if="own"
    :cut="false"
    :from="own.from"
    :span-name="null"
    :to="own.to"
    :today="today"
    :words="words"
    @days="setDay"
  />
</template>
