<script setup lang="ts">
/**
 * The panel of a section of the subscription quota, its five hours or its week: each account the
 * quota read knows, in the answer's order, with every window of the section (`QuotaAccount`).
 *
 * It reads the quota (`useQuotaRead`), not the page's usage: the filters do not apply to it, and the
 * period reaches only each window's step line, which draws every window of the period up to the
 * current one; all the lines of the section share one time scale (`sectionLength`), each as long
 * as the longest and ending at its own reset, so the two windows of a pair stand moment for moment. The «ⓘ» of its heading says that once, with what «Breakdown» is and
 * leaves out (`useSectionCaveats`); no line of the panel says either again. Its windows are drawn
 * or read as their tables, as every chart of the page is (`ChartSection`). No figure here is added to another: each is one
 * account's share of one window, and no money stands beside one.
 *
 * Its first wait, a first read that failed and an answer with no account stand in the product's
 * shared state panel. While it is read again the answer on show stays; a read again that failed
 * keeps it as it stood, and the bar says the read failed, as it does for every read of the page
 * (`useQuota`): a line here moved the heading and every account under it.
 *
 * Where the account in use reports no five-hour window, the five hours' section says so first, by
 * the account's name, over the accounts (`withoutFiveHours`), as its tile does: their windows have
 * reset, which alone read as a failure of the read; its line is `data-note="no-five-hours"`.
 *
 * What used each window opens from the window's block in the side panel over the page
 * (`WindowDetail`), which reads it to the answer's moment.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import QuotaAccount from '@/pages/analytics/components/QuotaAccount.vue'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import type { QuotaRead } from '@/pages/analytics/composables/useQuotaRead.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { useSectionCaveats } from '@/pages/analytics/composables/useSectionCaveats.ts'
import { accountKey, answerMoment, withoutFiveHours } from '@/pages/analytics/utils/quotaFigures.ts'
import { sectionLength } from '@/pages/analytics/utils/quotaLine.ts'

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
/** Read the quota again: asked, or after an account's name was saved, which its answer says. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const words = useQuotaWords()

const state = computed<PlatformUiState<Quota>>(() => {
  const { read } = props
  if (read.status === 'loading') return uiLoading()
  if (read.status === 'failed') return uiError('analytics.quota.panel.failed')
  const { quota } = read
  if (!quota.accounts.length) return uiEmpty('analytics.quota.panel.none')
  return read.refreshing ? uiDegraded(quota, quota.now) : uiReady(quota)
})

const title = computed(() => words.sectionName(props.section))
/** That the account in use reports no five-hour window, in the five hours' section; none else. */
const noFiveHours = computed(() => {
  const { read, section, now } = props
  if (read.status !== 'ready' || section !== 'quota_five_hour') return ''
  const current = withoutFiveHours(read.quota, now)
  return current
    ? t('analytics.quota.panel.noFiveHours', { account: words.accountName(current) })
    : ''
})
/** What does not reach the quota and what used each window, which the heading's «ⓘ» says. */
const caveats = useSectionCaveats()
const about = computed(() => caveats.quota())

/** The one time scale of the section's lines: how long each runs over, in ms. */
const scale = computed(() => {
  const { read, section } = props
  return read.status === 'ready'
    ? sectionLength(read.quota.accounts, section, answerMoment(read.quota))
    : null
})

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
          :about="about"
          :narrow="narrow"
          :list-label="t('analytics.quota.panel.heading')"
        >
          <template #chart>
            <p
              v-if="noFiveHours"
              class="quota-panel-note"
              data-note="no-five-hours"
            >
              {{ noFiveHours }}
            </p>
            <QuotaAccount
              v-for="account in payload.accounts"
              :key="accountKey(account)"
              shown="chart"
              :account="account"
              :section="section"
              :today="answerMoment(payload)"
              :now="now"
              :fresh-for="payload.fresh_for_seconds"
              :scale="scale"
              @renamed="emit('retry')"
            />
          </template>
          <template #table>
            <p
              v-if="noFiveHours"
              class="quota-panel-note"
              data-note="no-five-hours"
            >
              {{ noFiveHours }}
            </p>
            <QuotaAccount
              v-for="account in payload.accounts"
              :key="accountKey(account)"
              shown="table"
              :account="account"
              :section="section"
              :today="answerMoment(payload)"
              :now="now"
              :fresh-for="payload.fresh_for_seconds"
              :scale="scale"
              @renamed="emit('retry')"
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

/* What the section says before its accounts, in the text's ink: why no five hours stand. */
.quota-panel-note {
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
}
</style>
