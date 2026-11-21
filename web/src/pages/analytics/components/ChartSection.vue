<script setup lang="ts">
/**
 * A chart of the page under its title, drawn or as its table: the same numbers either way. A
 * chart of one whole split into parts named by identifiers is drawn two ways, as a ring or as
 * ranked bars (`views`, `splitView.ts`), and opens on the first it offers; any other chart has
 * one drawing. It opens on that drawing at every width, a phone's as a desktop's: each drawing
 * reads in the narrowest panel, the ranked bars giving a name its own line over its bar, the days
 * scrolling sideways inside their frame, and the table is a press away. Once a narrow page opened
 * every chart as its table, though none needed it. A person's own choice stands until the page is
 * left, and where the chart stops offering
 * the drawing chosen, as a split section does the ring, it opens on its first again. Why a press
 * in it did nothing stands under its title, said to a screen reader as it comes (`notice`).
 *
 * It is a block of the panel, a chart under its heading, unless it says it is a whole section, as
 * the quota's is (`PanelLevel`), whose caveats its heading's «ⓘ» says (`about`). A title that
 * names the page's measure keeps the room of its title under every measure (`titles`), so
 * choosing one moves nothing beside or under it.
 *
 * The section says which of its views is shown (`data-shown`: `chart`, a split's drawing or
 * `table`), for a reader of the page to find the sections and the view each stands in.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import type { SplitView } from '@/pages/analytics/utils/splitView.ts'

import FieldError from '@/shared/ui/FieldError.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

/** A drawing of the chart: the one drawing of most, or a split's ring or bars. */
type Drawn = 'chart' | SplitView
type Shown = Drawn | 'table'

const props = withDefaults(
  defineProps<{
    title: string
    /** The caveats of the whole section, said in the «ⓘ» of its heading. */
    about?: readonly string[]
    level?: 'section' | 'block'
    /** A list's name, when what the chart holds is a list: the quota's accounts. */
    listLabel?: string
    /** Why the last press in the chart did nothing, in words; empty otherwise. */
    notice?: string
    /** Every title it takes in turn, as under each of the page's measures, whose room it keeps. */
    titles?: readonly string[]
    /** The drawings it offers before its table, in the switch's order. */
    views?: readonly Drawn[]
  }>(),
  {
    notice: '',
    level: 'block',
    listLabel: undefined,
    about: () => [],
    titles: () => [],
    views: () => ['chart'],
  },
)
defineSlots<{ chart: (props: { view: Drawn }) => unknown; table: () => unknown }>()

const { t } = useI18n()

const offered = computed<Shown[]>(() => [...props.views, 'table'])
const opening = computed<Drawn>(() => props.views[0] ?? 'chart')
const chosen = ref<Shown | null>(null)
const shown = computed<Shown>(() => {
  return chosen.value && offered.value.includes(chosen.value) ? chosen.value : opening.value;
})
const options = computed(() =>
  offered.value.map((value) => ({ value, label: t(`analytics.shown.${value}`) })),
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
    :titles="titles"
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
      v-if="shown !== 'table'"
      name="chart"
      :view="shown"
    />
    <slot
      v-else
      name="table"
    />
  </PanelLevel>
</template>
