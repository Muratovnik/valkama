<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ImprovementStatusBadge from '@/entities/improvement/components/ImprovementStatusBadge.vue'
import type {
  ImprovementCaseSummary,
  ImprovementState,
} from '@/entities/improvement/utils/improvementDerivations'
import {
  filterCases,
  IMPROVEMENT_STATES,
  sortCases,
} from '@/entities/improvement/utils/improvementDerivations'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SelectionControl from '@/shared/ui/SelectionControl.vue'

const props = withDefaults(
  defineProps<{
    cases: ImprovementCaseSummary[]
    selectedId?: number | null
    state?: ImprovementState | ''
  }>(),
  { state: '' },
)
const emit = defineEmits<{
  select: [item: ImprovementCaseSummary]
  state: [state: ImprovementState | '']
}>()
const { t, te } = useI18n()
const state = ref<ImprovementState | ''>(props.state)
watch(
  () => props.state,
  (value) => (state.value = value),
)
const order = ref<'updated' | 'severity'>('updated')
const filtered = computed(() =>
  sortCases(filterCases(props.cases, state.value || undefined), order.value),
)
/** Whether this row is the case the detail pane beside the list is showing. */
function isSelected(item: ImprovementCaseSummary) {
  return props.selectedId === item.id
}

function selectState(value: string) {
  state.value = value as ImprovementState | ''
  emit('state', state.value)
}
function selectOrder(value: string) {
  order.value = value as 'updated' | 'severity'
}
function stateText(item: ImprovementState): string {
  const key = `improvements.caseState.${item}`
  return te(key) ? t(key) : item
}
const stateOptions = computed<ChoiceOption[]>(() => [
  { value: '', label: t('improvements.allStates') },
  ...IMPROVEMENT_STATES.map((item) => ({ value: item, label: stateText(item) })),
])
const orderOptions = computed<ChoiceOption[]>(() => [
  { value: 'updated', label: t('improvements.recentlyUpdated') },
  { value: 'severity', label: t('improvements.bySeverity') },
])
</script>
<template>
  <section
    class="case-list"
    :aria-label="t('improvements.cases')"
  >
    <header class="list-head">
      <h2>
        {{ t('improvements.cases') }} <span>{{ filtered.length }}</span>
      </h2>
      <div class="filters">
        <SelectionControl
          mode="combobox"
          :model-value="state"
          :options="stateOptions"
          :label="t('improvements.filterState')"
          @update:model-value="selectState"
        /><SelectionControl
          mode="combobox"
          :model-value="order"
          :options="orderOptions"
          :label="t('improvements.sortCases')"
          @update:model-value="selectOrder"
        />
      </div>
    </header>
    <p
      v-if="!filtered.length"
      class="empty"
    >
      {{ t('improvements.noCases') }}
    </p>
    <div
      v-else
      class="case-rows"
    >
      <button
        v-for="item in filtered"
        :key="item.id"
        class="case-row"
        type="button"
        :class="{ selected: isSelected(item) }"
        @click="emit('select', item)"
      >
        <span class="case-copy"
          ><strong>{{ item.title }}</strong
          ><small>{{ item.case_key }} · {{ item.category }}</small
          ><span>{{
            t('improvements.promotion', {
              signals: item.signal_count,
              sessions: item.session_count,
            })
          }}</span></span
        >
        <span class="case-state"
          ><ImprovementStatusBadge
            variant="inline"
            :state="item.state"
            :severity="item.severity"
          /><small>{{ t(`improvements.severity.${item.severity}`) }}</small></span
        >
      </button>
    </div>
  </section>
</template>
<style scoped>
.case-list {
  min-width: 0;
  background: var(--color-surface);
  overflow: visible;
  border-radius: var(--radius-card);
}

.list-head {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-rule);

  h2 {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin: 0;
    font-size: var(--font-size-section);

    & span {
      color: var(--color-text-muted);
      font-size: var(--font-size-dense);
    }
  }
}

.filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-2);
}

.case-rows {
  display: grid;
}

.case-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-4);
  border: 0;
  border-bottom: 1px solid var(--color-rule);
  color: var(--color-text);
  text-align: left;
  background: transparent;
  cursor: pointer;

  &:hover {
    background: var(--color-surface-muted);
  }

  &.selected {
    background: var(--color-surface-active);
    box-shadow: inset 3px 0 var(--color-action-primary);
  }
}

.case-copy {
  display: grid;
  gap: var(--space-1);
  min-width: 0;

  strong {
    font-size: var(--font-size-interface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.case-copy small,
.case-copy span,
.case-state small,
.empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.case-state {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
}

.empty {
  padding: var(--space-6) var(--space-4);
  margin: 0;
  text-align: center;
}
</style>
