<script setup lang="ts">
/**
 * How the board is grouped, as the pressed control its neighbours in the bar are.
 *
 * It says its word, on the bar's row where a usable field still fits beside it and
 * on the counts' line where one does not. Only on a phone, and only while a filter
 * is on, does it give the word up to the reset for its glyph, so the work does not
 * move as a filter turns on; the name stays its accessible name and its hover text
 * either way. A glyph alone has no words to widen it, so then it reaches as an icon
 * button does (`reach`).
 */
import { useI18n } from 'vue-i18n'

import ToggleChip from '@/shared/ui/ToggleChip.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  /** A filter is on, whose reset needs the room on a phone's line. */
  filtered: boolean
  pressed: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

const { t } = useI18n()
</script>

<template>
  <ToggleChip
    v-tooltip.detail="t('workItem.lanes.groupingLabel')"
    class="grouping"
    :class="{ filtered }"
    :aria-label="t('workItem.lanes.groupingLabel')"
    :pressed="pressed"
    :reach="filtered"
    @toggle="emit('toggle')"
  >
    <VIcon
      class="grouping-glyph"
      name="kind-epic"
      :size="16"
    />
    <span class="grouping-word">{{ t('workItem.lanes.grouping.epic') }}</span>
  </ToggleChip>
</template>

<style scoped>
.grouping-glyph {
  display: none;
}

/* A phone: the line it shares with the counts has the room, until a filter's reset
   needs it. */
@container workspace (width <= 624px) {
  .grouping.filtered {
    .grouping-glyph {
      display: block;
    }

    .grouping-word {
      display: none;
    }
  }
}
</style>
