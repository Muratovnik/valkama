<script setup lang="ts">
/**
 * The two queues no view shows by itself, as toggles beside the filter field:
 * «Можно брать» and «Назначено», the second with its own count. A preset is
 * only a list of tokens, so a pressed one is the same filter a chip or the
 * menu would have made.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  presetActive,
  togglePreset,
  WORK_FILTER_PRESETS,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterPreset } from '@/entities/work-item/utils/workFilter.ts'

import CountBadge from '@/shared/ui/CountBadge.vue'
import ToggleChip from '@/shared/ui/ToggleChip.vue'

const props = defineProps<{
  /** Open items somebody holds: the «Назначено» preset's count. */
  held: number
}>()

const filter = defineModel<WorkFilter>('filter', { required: true })

const { t } = useI18n()

const presets = computed(() =>
  WORK_FILTER_PRESETS.map((preset) => ({
    preset,
    label: t(preset.label),
    pressed: presetActive(filter.value, preset),
    count: preset.id === 'held' ? props.held : null,
  })),
)

function press(preset: WorkFilterPreset) {
  filter.value = togglePreset(filter.value, preset)
}
</script>

<template>
  <div
    class="filter-presets"
    role="group"
    :aria-label="t('workItem.filter.presets')"
  >
    <ToggleChip
      v-for="entry in presets"
      :key="entry.preset.id"
      class="filter-preset"
      :pressed="entry.pressed"
      @toggle="press(entry.preset)"
    >
      {{ entry.label }}
      <CountBadge
        v-if="entry.count !== null"
        placement="inline"
        :limit="99999"
        :value="entry.count"
      />
    </ToggleChip>
  </div>
</template>

<style scoped>
.filter-presets {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
}

/* Where the row cannot hold them, the menu offers them at its top and the
   field shows a pressed one as a chip (WorkFilterChips, the same width). */
@container workspace (width < 1000px) {
  .filter-presets {
    display: none;
  }
}
</style>
