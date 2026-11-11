<script setup lang="ts">
/**
 * A chart of the page under its title, drawn or as its table: the same numbers either way. A
 * narrow page starts on the table, which a phone reads where a plot of columns does not; a
 * person's own choice stands until the page is left. Why a press in it did nothing stands under
 * its title, said to a screen reader as it comes (`notice`).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FieldError from '@/shared/ui/FieldError.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

type Shown = 'chart' | 'table'

const props = defineProps<{
  /** Whether the page is too narrow to read a chart, which makes the table the first view. */
  narrow: boolean
  title: string
  /** Why the last press in the chart did nothing, in words; empty otherwise. */
  notice?: string
}>()
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
const switchLabel = computed(() => t('analytics.shown.label', { chart: props.title }))
</script>

<template>
  <section
    class="chart-section"
    :data-shown="shown"
  >
    <SectionHeader
      as="h2"
      level="page"
      :title="title"
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
    </SectionHeader>
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
  </section>
</template>

<style scoped>
.chart-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
}
</style>
