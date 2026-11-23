<script setup lang="ts">
/**
 * Where one window of one account went, in the side panel over the Analytics page (`DetailPanel`),
 * opened from the window's block in the quota's section: the window's spend whole, with every
 * breakdown and drawing it offers (`QuotaWindowSpend`), under the window's and the account's names.
 * That it is an estimate at API prices without the work in claude.ai and the desktop app, which the
 * section's «ⓘ» says under the panel, is said by the panel's own «ⓘ» under the names, never as a
 * line of it, as the page says each caveat (`PanelLevel`). It is drawn or read as its table, as
 * every chart of the page is, by a switch of its own beside that «ⓘ»: the section's switch stays
 * under the panel. It opens drawn at every width, as every chart of the page does (`ChartSection`),
 * and a person's choice stands while the panel is open.
 *
 * The account and the window are found by the keys the quota's answer gives them (`accountKey`,
 * `windowKey`), in the quota read on show, to whose moment the side panel reads what used the
 * window (`provideWindowSpend`). Until that read lands it waits; a quota that no longer names the
 * window says so, and a quota that could not be read says that. What a reader of the panel selects
 * it by: the content is `data-detail="window"`.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import QuotaWindowSpend from '@/pages/analytics/components/QuotaWindowSpend.vue'
import type { QuotaRead } from '@/pages/analytics/composables/useQuotaRead.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { accountKey, answerMoment, windowKey } from '@/pages/analytics/utils/quotaFigures.ts'

import { isShareWindow } from '@/shared/api/analyticsApi.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import InfoTip from '@/shared/ui/InfoTip.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The account's key among the quota's answer (`accountKey`). */
  account: string
  read: QuotaRead
  /** The window's key among its account's (`windowKey`). */
  window: string
}>()
/** The panel closed; the name it heads the panel by. */
const emit = defineEmits<{ close: []; named: [title: string] }>()

const { t } = useI18n()
const words = useQuotaWords()

const quota = computed(() => (props.read.status === 'ready' ? props.read.quota : null))

/** The account and its window, once the quota names them; null while it does not. */
const found = computed(() => {
  const account = quota.value?.accounts.find((each) => accountKey(each) === props.account)
  const window = account?.windows
    .filter(isShareWindow)
    .find((each) => windowKey(each) === props.window)
  return account && window ? { account, window } : null
})
const title = computed(() =>
  found.value
    ? t('analytics.detail.window.title', {
        window: words.windowName(found.value.window),
        account: words.accountName(found.value.account),
      })
    : t('analytics.detail.window.open'),
)
watch(title, (named) => emit('named', named), { immediate: true })

type Shown = 'chart' | 'table'
const chosen = ref<Shown | null>(null)
const shown = computed<Shown>(() => chosen.value ?? 'chart')
const options = computed(() =>
  (['chart', 'table'] as const).map((value) => ({ value, label: t(`analytics.shown.${value}`) })),
)
function choose(value: Shown) {
  chosen.value = value
}
</script>

<template>
  <DrawerFrame
    :title="title"
    :close-label="t('analytics.detail.close')"
    @close="emit('close')"
  >
    <template #facts>
      <div
        v-if="found"
        class="window-detail-facts"
      >
        <SegmentedControl
          size="compact"
          :model-value="shown"
          :label="t('analytics.shown.label', { chart: title })"
          :options="options"
          @update:model-value="choose"
        />
        <InfoTip :label="t('analytics.detail.about')">
          <p class="window-detail-basis">{{ t('analytics.quota.spent.basis') }}</p>
          <template #trigger="{ toggle, popup }">
            <VButton
              class="window-detail-about"
              variant="ghost"
              size="compact"
              :aria-label="t('analytics.detail.about')"
              :aria-controls="popup.controls"
              :aria-expanded="popup.expanded"
              icon
              @click="toggle"
            >
              <VIcon
                name="info"
                :size="16"
              />
            </VButton>
          </template>
        </InfoTip>
      </div>
    </template>
    <div
      class="window-detail"
      data-detail="window"
    >
      <QuotaWindowSpend
        v-if="found && quota"
        :account="found.account"
        :window="found.window"
        :today="answerMoment(quota)"
        :shown="shown"
      />
      <DataEmptyState
        v-else-if="quota"
        :title="t('analytics.detail.window.missing')"
        inline
      />
      <DataEmptyState
        v-else-if="read.status === 'failed'"
        :title="t('analytics.quota.panel.failed')"
        inline
      />
      <p
        v-else
        class="window-detail-wait"
      >
        {{ t('platform.states.loading') }}
      </p>
    </div>
  </DrawerFrame>
</template>

<style scoped>
.window-detail {
  min-width: 0;
}

.window-detail-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.window-detail-basis {
  margin: 0;
}

.window-detail-wait {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
