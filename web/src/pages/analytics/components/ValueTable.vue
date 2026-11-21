<script setup lang="ts">
/**
 * Every value of a section in the side panel over the Analytics page (`DetailPanel`), opened by the
 * line under its ranked list that counts them, «All 30»: the section's own table (`SpendingTable`)
 * with its sort, its download and, while the section is split, its pairs (`useCrossRead`), under a
 * field that finds a value by its name. A row's name pressed opens that value's panel in place of
 * the table, as a new place in the history, so Back returns to the table (`inspect`). The panel
 * leaves the names a narrow column, so a name of free text takes two lines (`twoLineNames`).
 *
 * While the page reads its answer anew, of this section or another, the table waits for it rather
 * than showing rows of another dimension under this one's name. A read again of the pairs that
 * fails keeps them and says «Could not refresh · Retry» beside the field, in room the field's row
 * keeps for it while the section is split (`RefreshFailed`, `held`), as a value's panel says its
 * own beside its actions: said only in the page's bar, the words stood under this panel, unseen. What a reader of the panel selects
 * it by: the content is `data-detail="all"`.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RefreshFailed from '@/pages/analytics/components/RefreshFailed.vue'
import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import { useCrossRead } from '@/pages/analytics/composables/useCrossRead.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import { pageDimensionOf } from '@/shared/api/analyticsApi.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  /** The second dimension the section is split by, as the address holds it; null for none. */
  across: UsageDimension | null
  /** The section's dimension, whose every value the table lists. */
  by: UsageDimension
  /** The filters the page's answer was read with. */
  filters: UsageFilters
  measure: Measure
  /** Why the last press here did not open what it asked for, in words; empty otherwise. */
  notice: string
  /** The page's answer, by the section's dimension once it stands; null while there is none. */
  page: Usage | null
}>()
/** The panel closed; a value pressed to open its panel in place of the table; its name. */
const emit = defineEmits<{
  close: []
  inspect: [value: string | null, label: string]
  named: [title: string]
}>()

const { t } = useI18n()
const words = useSpendingWords()

const title = computed(() =>
  t('analytics.detail.all.title', { dimension: words.dimension(props.by) }),
)
watch(title, (named) => emit('named', named), { immediate: true })
/** The page's answer, while it is the section's: another dimension's has no rows of this one. */
const usage = computed(() =>
  props.page && pageDimensionOf(props.page) === props.by ? props.page : null,
)
const across = computed(() => (props.across && props.across !== props.by ? props.across : null))
/** The read by both dimensions while the section is split, asked once its answer stands. */
const cross = useCrossRead({
  usage: () => usage.value,
  across: () => across.value,
  filters: () => props.filters,
})
const find = ref('')
/** Whether the section is split, so pairs stand whose read again can fail. */
const split = computed(() => cross.state.value.status !== 'off')
</script>

<template>
  <DrawerFrame
    :title="title"
    :close-label="t('analytics.detail.close')"
    @close="emit('close')"
  >
    <template #facts>
      <div class="value-table-facts">
        <VTextInput
          v-model="find"
          class="value-table-find"
          size="compact"
          autocomplete="off"
          :label="t('analytics.detail.all.find')"
          :placeholder="t('analytics.detail.all.find')"
          hide-label
        />
        <RefreshFailed
          v-if="split"
          :failed="cross.failedAgain.value"
          held
          @retry="cross.retry"
        />
      </div>
    </template>
    <div
      class="value-table"
      data-detail="all"
    >
      <SpendingTable
        v-if="usage"
        :across="across"
        :by="by"
        :cross="cross.state.value"
        :filters="filters"
        :find="find"
        :measure="measure"
        :notice="notice"
        :usage="usage"
        two-line-names
        @inspect="(value, label) => emit('inspect', value, label)"
        @reread="cross.retry"
      />
      <p
        v-else
        class="value-table-wait"
      >
        {{ t('platform.states.loading') }}
      </p>
    </div>
  </DrawerFrame>
</template>

<style scoped>
/* The table's held heading row and total stand on the panel's ground, not the page's. */
.value-table {
  --color-chart-table-ground: var(--color-surface);

  min-width: 0;
}

/* The field, and beside it the room of a failed read again of the pairs while it fits the line;
   on a phone that room takes the line under the field. */
.value-table-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
}

.value-table-find {
  flex: 1 1 12rem;
  max-inline-size: 24rem;
}

.value-table-wait {
  min-block-size: 1lh;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
