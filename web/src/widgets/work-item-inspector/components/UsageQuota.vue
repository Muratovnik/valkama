<script setup lang="ts">
/**
 * What the item's work took of each account's weekly quota, the latest week first: one line per
 * account and week, its organization and account by the start of their ids, whole in the hint,
 * the day the week resets and the item's percent of that week, marked «≈». The percent is the
 * item's share of the cost of the account's work that week times how much of the week is spent,
 * and its hint says both. Lines of different accounts and weeks are never added up, so there is
 * no total. A week with no percent says why in place of one: no reading of the week says how
 * much of it is spent, or the account's work that week had no cost.
 *
 * Under the lines, the assumption the figure rests on and that it leans high, and how much of the
 * item's cost is on no account that can be shown, when any is. Each line carries `data-week`:
 * the seat and the day its week ends.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { agentIdStart } from '@/widgets/work-item-inspector/utils/agentFacts.ts'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

type Quota = ItemUsage['quota']
type Week = Quota['weeks'][number]

const props = defineProps<{ quota: Quota }>()
const { locale, t } = useI18n()

const percentOf = (value: number) =>
  new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(value)

/** The day a week resets, in the reader's calendar. */
const dayOf = (moment: string) =>
  new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }).format(new Date(moment))

/** The account by the starts of its organization and its id, as the card names an agent. */
const accountOf = (week: Week) =>
  [week.account.organization, week.account.account_uuid]
    .filter((part) => part !== null)
    .map((part) => agentIdStart(part))
    .join(' · ')

function figureOf(week: Week): { hint: string; text: string } {
  if (week.percent === null || week.share === null || week.week_used_percent === null)
    return {
      text: '—',
      hint: t(week.share === null ? 'workItem.usage.quotaNoCost' : 'workItem.usage.quotaNoReading'),
    }
  return {
    text: t('workItem.usage.quotaPercent', { percent: percentOf(week.percent / 100) }),
    hint: t('workItem.usage.quotaShare', {
      share: percentOf(week.share),
      used: percentOf(week.week_used_percent / 100),
    }),
  }
}

const weeks = computed(() =>
  props.quota.weeks.map((week) => ({
    key: `${week.seat}:${week.week_ends_at}`,
    account: accountOf(week),
    seat: week.seat,
    ends: t('workItem.usage.quotaWeek', { date: dayOf(week.week_ends_at) }),
    ...figureOf(week),
  })),
)

const unknown = computed(() => {
  const share = props.quota.unknown_share
  return share ? t('workItem.usage.quotaUnknown', { share: percentOf(share) }) : ''
})
</script>

<template>
  <div
    v-if="weeks.length || unknown"
    class="usage-quota"
  >
    <span class="usage-quota-caption">{{ t('workItem.usage.quota') }}</span>
    <ul
      v-if="weeks.length"
      class="usage-quota-weeks"
      :aria-label="t('workItem.usage.quota')"
    >
      <li
        v-for="week in weeks"
        :key="week.key"
        class="usage-quota-week"
        :data-week="week.key"
      >
        <span
          v-tooltip.detail="week.seat"
          class="usage-quota-account"
          >{{ week.account }}</span
        >
        <span class="usage-quota-ends">{{ week.ends }}</span>
        <span
          v-tooltip.detail="week.hint"
          class="usage-quota-figure"
          data-part="percent"
          :aria-description="week.hint"
          >{{ week.text }}</span
        >
      </li>
    </ul>
    <p class="usage-quota-note">{{ t('workItem.usage.quotaNote') }}</p>
    <p
      v-if="unknown"
      class="usage-quota-note"
      data-part="unknown"
    >
      {{ unknown }}
    </p>
  </div>
</template>

<style scoped>
.usage-quota {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.usage-quota-caption {
  color: var(--color-text-muted);
  font: var(--font-group-heading);
}

/* An account, its week and its percent on a line that wraps between them, never inside one. */
.usage-quota-weeks {
  display: grid;
  gap: var(--space-half);
  padding: 0;
  margin: 0;
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
  list-style: none;
}

.usage-quota-week {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-3);
  color: var(--color-text-muted);
}

.usage-quota-account,
.usage-quota-ends,
.usage-quota-figure {
  white-space: nowrap;
}

.usage-quota-figure {
  color: var(--color-text);
  font-weight: 500;
}

.usage-quota-note {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}
</style>
