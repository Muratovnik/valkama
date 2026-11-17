<script setup lang="ts">
/**
 * One account of the quota panel: its name — the owner's, or else the start of its id, the whole
 * id in its hint — its plan, and each window of the section on show (`QuotaWindow`), the week
 * before each model's week. As a table its windows are one table of their figures — the share,
 * the pace, the state with how long a silent one has been silent, and the forecast, or past the
 * reset that it has reset — each window's facts and readings after it.
 *
 * An account nobody's source read says so and shows no window, and one with no window of the
 * section says that instead, so no source, a window never read and a fresh 0 % never read alike.
 * A seat known only for its week says so. A window of money past a limit has no share: it is a
 * line of its name and its state, its age and its source in the line's hint as a window of a
 * share keeps them in its bar's, all of it in words as a table, and never a figure beside a share.
 *
 * It is a group of the panel on a surface of its own, its windows side by side where the width
 * keeps each readable and one under the next where it does not (`PanelLevel`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import QuotaWindow from '@/pages/analytics/components/QuotaWindow.vue'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import {
  sectionWindows,
  spendWindows,
  stands,
  windowKey,
} from '@/pages/analytics/utils/quotaFigures.ts'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type { QuotaAccount } from '@/shared/api/analyticsApi.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import WindowBarTable from '@/shared/ui/WindowBarTable.vue'
import type { WindowRow, WindowWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  account: QuotaAccount
  /** The moment the panel stands at, in ms. */
  now: number
  section: QuotaSection
  shown: 'chart' | 'table'
  /** The answer's moment at its offset: each time is said at it, and undated on its day. */
  today: string
}>()

const { t } = useI18n()
const words = useQuotaWords()

const name = computed(() => words.accountName(props.account))
const detail = computed(() => words.accountDetail(props.account))
const windows = computed(() => sectionWindows(props.account, props.section))
/**
 * The windows of money, as the windows of a share say themselves: its name and state on the line
 * and how old its reading is and who read it in its hint, all of it in words in a table.
 */
const others = computed(() =>
  spendWindows(props.account).map((window) => ({
    key: windowKey(window),
    text: words.other(window, props.now),
    state: words.otherState(window),
    read: words.latest(window, props.now, props.today),
  })),
)

const rows = computed<WindowRow[]>(() =>
  windows.value.map((window) => ({
    key: windowKey(window),
    label: words.windowName(window),
    valueText: words.share(window.latest.used_percent),
    evenText: window.even_percent === null ? '—' : words.share(window.even_percent),
    noteText: words.stateAt(window, props.now),
    forecastText: stands(window, props.now)
      ? words.forecast(window, props.today)
      : words.reset(window, props.now, props.today),
  })),
)
const tableWords = computed<WindowWords>(() => ({
  name: t('analytics.quota.table.name'),
  value: t('analytics.quota.table.value'),
  even: t('analytics.quota.table.even'),
  note: t('analytics.quota.table.note'),
  forecast: t('analytics.quota.table.forecast'),
  empty: t('analytics.quota.table.empty'),
}))
</script>

<template>
  <PanelLevel
    class="quota-account"
    level="group"
    as="li"
    columns="fit"
    column-min="24rem"
    :data-account="name"
    surface
  >
    <template #heading>
      <span class="quota-account-name">
        <span v-tooltip.detail="{ text: detail, words: name }">{{ name }}</span>
      </span>
    </template>
    <template
      v-if="account.plan || account.seat"
      #beside
    >
      <p class="quota-account-facts">
        <span v-if="account.plan">{{
          t('analytics.quota.panel.plan', { plan: account.plan })
        }}</span>
        <span v-if="account.seat">{{ t('analytics.quota.panel.provisional') }}</span>
      </p>
    </template>
    <p
      v-if="account.no_source"
      class="quota-account-none"
      data-state="no-source"
    >
      {{ t('analytics.quota.panel.noSource') }}
    </p>
    <p
      v-else-if="!windows.length"
      class="quota-account-none"
      data-state="no-window"
    >
      {{ t(`analytics.quota.panel.noWindow.${section}`) }}
    </p>
    <template v-else>
      <WindowBarTable
        v-if="shown === 'table'"
        class="quota-account-table"
        :label="t('analytics.quota.table.caption', { account: name })"
        :rows="rows"
        :words="tableWords"
      />
      <QuotaWindow
        v-for="window in windows"
        :key="windowKey(window)"
        :account="account"
        :window="window"
        :today="today"
        :now="now"
        :shown="shown"
      />
    </template>
    <ul
      v-if="others.length"
      class="quota-account-others"
    >
      <li
        v-for="other in others"
        :key="other.key"
      >
        <span
          v-if="shown === 'chart'"
          v-tooltip.detail="other.read"
          >{{ other.state }}</span
        >
        <template v-else>{{ other.text }}</template>
      </li>
    </ul>
  </PanelLevel>
</template>

<style scoped>
/* What is not a window takes the group's whole width, over or under its windows. */
.quota-account-none,
.quota-account-table,
.quota-account-others {
  grid-column: 1 / -1;
}

.quota-account-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.quota-account-none,
.quota-account-others {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.quota-account-others {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  list-style: none;
}
</style>
