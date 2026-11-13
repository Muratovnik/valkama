<script setup lang="ts">
/**
 * A chart of the page under its title, drawn or as its table: the same numbers either way. A
 * narrow page starts on the table, which a phone reads where a plot of columns does not; a
 * person's own choice stands until the page is left. Why a press in it did nothing stands under
 * its title, said to a screen reader as it comes (`notice`).
 *
 * It is a block of the panel, a chart under its heading, unless it says it is a whole section, as
 * the quota's is (`PanelLevel`), whose caveats its heading's «ⓘ» says (`about`).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'

import FieldError from '@/shared/ui/FieldError.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

type Shown = 'chart' | 'table'

const props = withDefaults(
  defineProps<{
    /** Whether the page is too narrow to read a chart, which makes the table the first view. */
    narrow: boolean
    title: string
    /** The caveats of the whole section, said in the «ⓘ» of its heading. */
    about?: readonly string[]
    level?: 'section' | 'block'
    /** A list's name, when what the chart holds is a list: the quota's accounts. */
    listLabel?: string
    /** Why the last press in the chart did nothing, in words; empty otherwise. */
    notice?: string
  }>(),
  { notice: '', level: 'block', listLabel: undefined, about: () => [] },
)
defineSlots<{ chart: () => unknown; table: () => unknown }>()

const { t } = useI18n()

const chosen = ref<Shown | null>(null)
const shown = computed<Shown>(() => chosen.value ?? (props.narrow ? 'table' : 'chart'))
const options = computed(() =>
  (['chart', 'table'] as const).map((value) => ({ value, label: t(`analytics.shown.${value}`) })),
)
function choose(value: Shown) {
  chosen.value = value
}
/** A list of groups is a list. */
const bodyAs = computed(() => (props.listLabel ? 'ul' : 'div'))
const switchLabel = computed(() => t('analytics.shown.label', { chart: props.title }))
</script>

<template>
  <PanelLevel
    class="chart-section"
    :level="level"
    :data-shown="shown"
    :title="title"
    :about="about"
    :body-as="bodyAs"
    :body-label="listLabel"
  >
    <template #actions="{ size }">
      <SegmentedControl
        :model-value="shown"
        :size="size"
        :label="switchLabel"
        :options="options"
        @update:model-value="choose"
      />
    </template>
    <FieldError
      v-if="notice"
      role="alert"
    >
      {{ notice }}
    </FieldError>
    <slot
      v-if="shown === 'chart'"
      name="chart"
    />
    <slot
      v-else
      name="table"
    />
  </PanelLevel>
</template>
