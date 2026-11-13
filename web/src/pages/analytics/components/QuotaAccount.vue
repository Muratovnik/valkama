<script setup lang="ts">
/**
 * One account of the quota panel: its name — the owner's, or else the start of its id, the whole
 * id in its hint — its plan, and each window of the section on show (`QuotaWindow`), the week
 * before each model's week. As a table its windows are one table of their figures, each window's
 * facts and readings after it.
 *
 * An account nobody's source read says so and shows no window, and one with no window of the
 * section says that instead, so no source, a window never read and a fresh 0 % never read alike.
 * A seat known only for its week says so. A window of money past a limit has no share: it is a
 * line of its state, its age and its source, and never a figure beside a share.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import QuotaWindow from '@/pages/analytics/components/QuotaWindow.vue'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { sectionWindows, spendWindows, windowKey } from '@/pages/analytics/utils/quotaFigures.ts'

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
  /** The answer's own moment, whose day a time is said on without its date. */
  today: string
}>()

const { t } = useI18n()
const words = useQuotaWords()

const name = computed(() => words.accountName(props.account))
const detail = computed(() => words.accountDetail(props.account))
const windows = computed(() => sectionWindows(props.account, props.section))
const others = computed(() =>
  spendWindows(props.account).map((window) => ({
    key: windowKey(window),
    text: words.other(window, props.now),
  })),
)

const rows = computed<WindowRow[]>(() =>
  windows.value.map((window) => ({
    key: windowKey(window),
    label: words.windowName(window),
    valueText: words.share(window.latest.used_percent),
    evenText: window.even_percent === null ? '—' : words.share(window.even_percent),
    noteText: words.state(window),
  })),
)
const tableWords = computed<WindowWords>(() => ({
  name: t('analytics.quota.table.name'),
  value: t('analytics.quota.table.value'),
  even: t('analytics.quota.table.even'),
  note: t('analytics.quota.table.note'),
  empty: t('analytics.quota.table.empty'),
}))
</script>

<template>
  <li
    class="quota-account"
    :data-account="name"
  >
    <header class="quota-account-head">
      <h3 class="quota-account-name">
        <span v-tooltip.detail="{ text: detail, words: name }">{{ name }}</span>
      </h3>
      <p
        v-if="account.plan || account.seat"
        class="quota-account-facts"
      >
        <span v-if="account.plan">{{
          t('analytics.quota.panel.plan', { plan: account.plan })
        }}</span>
        <span v-if="account.seat">{{ t('analytics.quota.panel.provisional') }}</span>
      </p>
    </header>
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
        {{ other.text }}
      </li>
    </ul>
  </li>
</template>

<style scoped>
.quota-account {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  min-width: 0;
}

.quota-account-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: baseline;
  min-width: 0;
}

.quota-account-name {
  min-width: 0;
  margin: 0;
  font: var(--font-section-title);
  overflow-wrap: anywhere;
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
