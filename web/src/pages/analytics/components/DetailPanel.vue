<script setup lang="ts">
/**
 * The side panel over the Analytics page: the product's drawer at the window's right edge, resized
 * by its left one and the whole window wide on a phone (`ResizableInspector`), modal over the page
 * on the drawer layer. The overlay host owns its focus, Escape, the page's lock and the focus given
 * back on its close; the page owns what it shows, the view's `detail` (`useDetail`):
 *
 * - one value pressed anywhere on the page (`ValueDetail`);
 * - every value of the section on show, its whole table (`ValueTable`);
 * - where one window of one account's quota went (`WindowDetail`).
 *
 * What it shows next replaces what it showed, and the focus moves into it as on an opening
 * (`contentKey`); while it closes, it keeps what it showed until it has gone. Its parts' headings
 * stand under the name its drawer gives each (`provideHeadingOver`), its reads' waits are said in a
 * status region of its own (`WaitStatus`), since the page under a modal panel is out of reach of a
 * screen reader, and it holds the reads of what used the windows it opens for as long as the page
 * stands (`provideWindowSpend`).
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ValueDetail from '@/pages/analytics/components/ValueDetail.vue'
import ValueTable from '@/pages/analytics/components/ValueTable.vue'
import WindowDetail from '@/pages/analytics/components/WindowDetail.vue'
import { provideHeadingOver } from '@/pages/analytics/composables/usePanelOutline.ts'
import type { QuotaRead } from '@/pages/analytics/composables/useQuotaRead.ts'
import { provideReadWaits } from '@/pages/analytics/composables/useReadWaits.ts'
import { provideWindowSpend } from '@/pages/analytics/composables/useWindowSpend.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'

import type { AnalyticsDetail, Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import {
  ANALYTICS_DETAIL_STORAGE_KEY,
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
} from '@/shared/lib/shellLayout.ts'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'
import WaitStatus from '@/shared/ui/WaitStatus.vue'

const props = defineProps<{
  /** The second dimension the section on show is split by; null for none. */
  across: UsageDimension | null
  /** The period the page's answer is compared with; null when it was not read. */
  compared: PeriodBounds | null
  /** What the panel shows; null while it is closed. */
  detail: AnalyticsDetail | null
  /** The filters the page's answer was read with. */
  filters: UsageFilters
  measure: Measure
  /** Why the last change asked in the panel was not made, in words; empty otherwise. */
  notice: string
  /** Whether it stands open: it has something to show and nothing stands over it. */
  open: boolean
  /** The page's read, whose answer a value and a table are read for. */
  page: PlatformUiState<Usage>
  /** The quota read on show, which a window is found in. */
  quota: QuotaRead
  /** When the page's answer was asked for. */
  readAt: Date
  /** Whether the period is live, «Now» or «Today». */
  live?: boolean
}>()
/** Closed; a value pressed in it; the page narrowed to the value on show. */
const emit = defineEmits<{
  close: []
  inspect: [by: UsageDimension, value: string | null, label: string]
  narrow: [by: UsageDimension, value: string | null, label: string]
}>()

const { t } = useI18n()

provideHeadingOver(2)
const { shown: waitShown } = provideReadWaits()
provideWindowSpend(() => (props.quota.status === 'ready' ? props.quota.quota : null))

/** What it shows, kept while it closes so it leaves whole. */
const shown = ref<AnalyticsDetail | null>(props.detail)
watch(
  () => props.detail,
  (next) => {
    if (next) shown.value = next
  },
)
const contentKey = computed(() => JSON.stringify(shown.value))

/** The page's answer, once there is one; whether its period spent nothing. */
const pageUsage = computed(() =>
  props.page.status === 'ready' || props.page.status === 'degraded' ? props.page.payload : null,
)
const pageEmpty = computed(() => props.page.status === 'empty')

/** The name of what it shows, as its drawer heads it: the panel's name too. */
const title = ref('')
const label = computed(() => t('analytics.detail.label', { title: title.value }))
</script>

<template>
  <ResizableInspector
    surface-class="analytics-detail"
    :open="open"
    :label="label"
    :resize-label="t('analytics.detail.resize')"
    :content-key="contentKey"
    :storage-key="ANALYTICS_DETAIL_STORAGE_KEY"
    :default-width="DRAWER_DEFAULT_WIDTH"
    :min-width="DRAWER_MIN_WIDTH"
    :max-width="DRAWER_MAX_WIDTH"
    @close="emit('close')"
  >
    <WaitStatus :shown="waitShown" />
    <ValueDetail
      v-if="shown?.kind === 'value'"
      :key="contentKey"
      :by="shown.by"
      :value="shown.value"
      :compared="compared"
      :filters="filters"
      :measure="measure"
      :notice="notice"
      :page="pageUsage"
      :page-empty="pageEmpty"
      :read-at="readAt"
      :live="live"
      @named="(name) => (title = name)"
      @close="emit('close')"
      @narrow="(name) => shown?.kind === 'value' && emit('narrow', shown.by, shown.value, name)"
    />
    <ValueTable
      v-else-if="shown?.kind === 'all'"
      :across="across"
      :by="shown.by"
      :filters="filters"
      :measure="measure"
      :notice="notice"
      :page="pageUsage"
      @named="(name) => (title = name)"
      @close="emit('close')"
      @inspect="(value, name) => shown?.kind === 'all' && emit('inspect', shown.by, value, name)"
    />
    <WindowDetail
      v-else-if="shown?.kind === 'window'"
      :account="shown.account"
      :window="shown.window"
      :read="quota"
      @named="(name) => (title = name)"
      @close="emit('close')"
    />
  </ResizableInspector>
</template>
