<script setup lang="ts">
/**
 * The panel of a section of the subscription quota, its five hours or its week: each account the
 * quota read knows, in the answer's order, with every window of the section (`QuotaAccount`).
 *
 * It reads the quota (`useQuotaRead`), not the page's usage: the period and the filters do not
 * apply to it, and its words at its top say so. Its windows are drawn or read as their tables,
 * as every chart of the page is (`ChartSection`). No figure here is added to another: each is one
 * account's share of one window, and no money stands beside one.
 *
 * Its first wait, a first read that failed and an answer with no account stand in the product's
 * shared state panel. While it is read again the answer on show stays; a read again that failed
 * keeps it and says from when its figures are.
 *
 * What used each window is read by the window's own block, to the answer's moment; the panel
 * holds those reads for its chart and its table alike (`provideWindowSpend`).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import QuotaAccount from '@/pages/analytics/components/QuotaAccount.vue'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import type { QuotaRead } from '@/pages/analytics/composables/useQuotaRead.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { provideWindowSpend } from '@/pages/analytics/composables/useWindowSpend.ts'
import { accountKey } from '@/pages/analytics/utils/quotaFigures.ts'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type { Quota } from '@/shared/api/analyticsApi.ts'
import { uiDegraded, uiEmpty, uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  /** The moment the panel stands at, in ms: the ages and the time left are counted to it. */
  now: number
  read: QuotaRead
  section: QuotaSection
}>()
/** Read the quota again. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const words = useQuotaWords()

const state = computed<PlatformUiState<Quota>>(() => {
  const { read } = props
  if (read.status === 'loading') return uiLoading()
  if (read.status === 'failed') return uiError('analytics.quota.panel.failed')
  const { quota } = read
  if (!quota.accounts.length) return uiEmpty('analytics.quota.panel.none')
  if (read.failedAgain)
    return uiDegraded(
      quota,
      quota.now,
      t('analytics.quota.panel.failedAgain', { ago: words.ago(quota.now, props.now) }),
    )
  return read.refreshing ? uiDegraded(quota, quota.now) : uiReady(quota)
})

provideWindowSpend(() => (props.read.status === 'ready' ? props.read.quota : null))

const title = computed(() => words.sectionName(props.section))
/** What the panel shows and how old it is; the period and the filters do not apply to it. */
const intro = computed(() =>
  props.read.status === 'ready'
    ? t('analytics.quota.panel.intro', { ago: words.ago(props.read.quota.now, props.now) })
    : '',
)

const root = ref<HTMLElement | null>(null)
const narrow = useNarrowCharts(root)
</script>

<template>
  <PlatformStatePanel
    :state="state"
    @retry="emit('retry')"
  >
    <template #default="{ payload }">
      <div
        ref="root"
        class="quota-panel"
      >
        <ChartSection
          level="section"
          :title="title"
          :narrow="narrow"
          :list-label="t('analytics.quota.panel.heading')"
        >
          <template #lead>
            <p class="quota-intro">
              {{ intro }}
            </p>
          </template>
          <template #chart>
            <QuotaAccount
              v-for="account in payload.accounts"
              :key="accountKey(account)"
              shown="chart"
              :account="account"
              :section="section"
              :today="payload.now"
              :now="now"
            />
          </template>
          <template #table>
            <QuotaAccount
              v-for="account in payload.accounts"
              :key="accountKey(account)"
              shown="table"
              :account="account"
              :section="section"
              :today="payload.now"
              :now="now"
            />
          </template>
        </ChartSection>
      </div>
    </template>
  </PlatformStatePanel>
</template>

<style scoped>
.quota-panel {
  min-width: 0;
  container-type: inline-size;
}

.quota-intro {
  max-inline-size: 72ch;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
