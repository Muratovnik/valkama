<script setup lang="ts">
/**
 * How the chain has moved, one action away: the pace of its last days and the
 * chart of its whole history.
 *
 * The card's first screen answers how much there is and whether it closes; this
 * answers why anyone should believe that, which is a second question. With no
 * history to chart there is nothing to fold, and the pace stands as its one line.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import ChainScopeChart from '@/widgets/work-item-inspector/components/ChainScopeChart.vue'

import type { ChainDay } from '@/shared/api/planningChainApi.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The chain's last days in one line. */
  pace: string
  series: readonly ChainDay[]
}>()

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const bodyId = useId()

/** One day is no history: nothing to draw, and so nothing to fold. */
const charted = computed(() => props.series.length > 1)
const chevron = computed(() => (open.value ? 'chevron-down' : 'chevron-right'))
/** Absent while the body is not drawn, since it would name nothing. */
const controls = computed(() => (open.value ? bodyId : undefined))
</script>

<template>
  <div class="chain-details">
    <VButton
      v-if="charted"
      class="chain-details-toggle"
      variant="text"
      size="inline"
      :aria-expanded="open"
      :aria-controls="controls"
      @click="open = !open"
    >
      <VIcon
        :name="chevron"
        :size="16"
      />
      {{ t('workItem.chain.details') }}
    </VButton>
    <div
      v-if="open || !charted"
      :id="bodyId"
      class="chain-details-body"
    >
      <p class="chain-pace">{{ pace }}</p>
      <ChainScopeChart
        v-if="charted"
        :series="series"
      />
    </div>
  </div>
</template>

<style scoped>
.chain-details {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* Its chevron stands on the section's edge, as a heading's first letter does. */
.chain-details-toggle {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-fill-inset));
}

.chain-details-body {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.chain-pace {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}
</style>
