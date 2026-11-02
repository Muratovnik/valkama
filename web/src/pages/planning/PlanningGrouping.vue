<script setup lang="ts">
/**
 * How the board is grouped, as the pressed control its neighbours in the bar are.
 *
 * It says its word where the row has room and is its glyph where it has not, never
 * both; the name stays its accessible name and its hover text either way. On a
 * phone it shares the counts' line, says its word there, and gives the word up to
 * the reset while a filter is on, so the work does not move as a filter turns on.
 */
import { useI18n } from 'vue-i18n'

import ToggleChip from '@/shared/ui/ToggleChip.vue'
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
    class="grouping"
    :class="{ filtered }"
    :aria-label="t('workItem.lanes.groupingLabel')"
    :title="t('workItem.lanes.groupingLabel')"
    :pressed="pressed"
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

@container workspace (width < 1000px) {
  .grouping-glyph {
    display: block;
  }

  .grouping-word {
    display: none;
  }
}

/* A phone: the second line has the room again, until a filter's reset needs it. */
@container workspace (width <= 556px) {
  .grouping-glyph {
    display: none;

    .grouping.filtered & {
      display: block;
    }
  }

  .grouping-word {
    display: inline;

    .grouping.filtered & {
      display: none;
    }
  }
}
</style>
