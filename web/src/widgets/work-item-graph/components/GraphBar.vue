<script setup lang="ts">
/**
 * What the field is showing, and how much of it.
 *
 * The two filter buttons carry their own counts, so the choice states its
 * consequence rather than making the operator switch to find out. The frontier
 * count on the right is the one number worth the accent: it is the work that could
 * start now.
 *
 * Scoped to a chain, the filter gives way to a chip naming the chain — the way
 * back to the whole space. The chip counts the whole chain; the field draws its
 * open part, and a switch beside the chip says how many closed members that
 * leaves out and draws them. The key to the markers lies on the field itself
 * (`GraphLegend`), so this bar stays one row and never changes height with it.
 *
 * A branch of the chain the card chose has a chip of its own beside the chain's,
 * and letting it go gives the field back the whole chain.
 *
 * In a phone-wide workspace the filter and a switch do not share one row, and
 * three stacked rows left the field half the screen. There the bar keeps only
 * the filter or the chip; the switch and the key (the `legend` slot) open under
 * a «Graph options» button, and the host draws the frontier count on the field
 * where the key was. A branch chip takes a second row there: it is a choice the
 * operator made and wants named, not chrome. The narrow layout is the
 * container's, so nothing here measures the window.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import ScopeChip from '@/shared/ui/ScopeChip.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The branch of the chain the field is framed on: an epic's reference, `''` for none. */
  branch: string | null
  chain: { reference: string; total: number } | null
  hiddenDone: number
  /** The field draws a key, so the narrow bar has one to offer. */
  keyed: boolean
  openTotal: number
  readyCount: number
  showDone: boolean
}>()

const emit = defineEmits<{
  'exit-branch': []
  'exit-chain': []
  'update:showDone': [value: boolean]
}>()
const { t } = useI18n()
const filter = computed(() => (props.showDone ? 'all' : 'open'))
const branchName = computed(() =>
  props.branch === '' ? t('workItem.chain.noEpic') : (props.branch ?? ''),
)
const options = computed(() => [
  { value: 'open' as const, label: t('graph.openOnly', { count: props.openTotal }) },
  {
    value: 'all' as const,
    label: t('graph.all', { count: props.openTotal + props.hiddenDone }),
  },
])

function updateFilter(value: 'all' | 'open') {
  emit('update:showDone', value === 'all')
}

/** Only a narrow bar shows the button; a wide one lays the options out in its row. */
const optionsOpen = ref(false)
const optionsId = useId()
/** The one switch is a chain's, for its closed members; the whole space has none. */
const switchShown = computed(() => props.chain !== null && props.hiddenDone > 0)
const hasOptions = computed(() => switchShown.value || props.keyed)
</script>

<template>
  <div class="graph-bar">
    <ScopeChip
      v-if="chain"
      class="graph-chip"
      :label="t('graph.chainChip', { reference: chain.reference, count: chain.total })"
      :exit-label="t('graph.chainExit', { reference: chain.reference })"
      @exit="emit('exit-chain')"
    />
    <SegmentedControl
      v-else
      class="graph-filter"
      size="compact"
      :label="t('graph.title')"
      :model-value="filter"
      :options="options"
      @update:model-value="updateFilter"
    />
    <ScopeChip
      v-if="chain && branch !== null"
      class="graph-branch-chip"
      :label="t('graph.branchChip', { name: branchName })"
      :exit-label="t('graph.branchExit', { name: branchName })"
      @exit="emit('exit-branch')"
    />
    <VButton
      v-if="hasOptions"
      class="graph-options-toggle"
      variant="ghost"
      :aria-label="t('graph.options')"
      :aria-expanded="optionsOpen"
      :aria-controls="optionsId"
      icon
      @click="optionsOpen = !optionsOpen"
    >
      <VIcon name="filters" />
    </VButton>
    <div
      :id="optionsId"
      class="graph-options"
      :class="{ open: optionsOpen }"
    >
      <ToggleSwitch
        v-if="switchShown"
        class="graph-closed"
        :label="t('graph.closedToggle')"
        :model-value="showDone"
        :on-label="t('graph.closed', { count: hiddenDone })"
        :off-label="t('graph.closed', { count: hiddenDone })"
        @update:model-value="(value) => emit('update:showDone', value)"
      />
      <div class="graph-options-legend">
        <slot name="legend" />
      </div>
    </div>
    <span class="graph-frontier-count">{{ t('graph.frontier', { count: readyCount }) }}</span>
  </div>
</template>

<style scoped>
.graph-bar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  align-items: center;
  padding: var(--space-1) 0 var(--space-3);
}

.graph-frontier-count {
  margin-left: auto;
  color: var(--color-action-primary);
  font: var(--font-line);
}

/* Wide, the options are the row's own: the button is not needed and the key
   lies on the field. */
.graph-options {
  display: contents;
}

.graph-options-toggle,
.graph-options-legend {
  display: none;
}

@container workspace (width <= 586px) {
  .graph-bar {
    flex-wrap: nowrap;
    gap: var(--space-2);
  }

  .graph-options-toggle {
    display: inline-flex;
    margin-left: auto;
  }

  .graph-options {
    display: none;
  }

  /* Open, the options take the room under the row; the field gives it back when
     they close. A chosen branch takes the row under the chain's chip, the
     options button staying beside the chain's. */
  .graph-bar:has(:is(.graph-options.open, .graph-branch-chip)) {
    flex-wrap: wrap;
  }

  .graph-branch-chip {
    order: 1;
  }

  .graph-options.open {
    display: flex;
    flex-basis: 100%;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
    order: 2;
  }

  .graph-options-legend {
    display: block;
  }

  .graph-frontier-count {
    display: none;
  }
}
</style>
