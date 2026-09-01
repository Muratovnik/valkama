<script setup lang="ts">
/**
 * The relations a card holds, each with the actions its adapter offers.
 *
 * An action is disabled when the registry has no input descriptor for it in either
 * operation, which means the adapter announced something this build cannot invoke.
 * Showing it greyed says the relation has an action the platform does not know yet;
 * hiding it would say the relation has none.
 */
import { useI18n } from 'vue-i18n'

import type { ActionRef } from '@/shared/api/platformActionRef.ts'
import type { ActionInputDescriptor, PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { PlatformRelation } from '@/shared/api/platformRelations.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  busy: boolean
  registry: PlatformRegistryReady | null
  relations: readonly PlatformRelation[]
}>()

const emit = defineEmits<{ invoke: [relation: PlatformRelation, action: ActionRef] }>()
const { t, te, d } = useI18n()

/** An ISO timestamp in the activity format. */
function observedAt(iso: string): string {
  return d(new Date(iso), 'activity')
}

function descriptorFor(
  action: ActionRef,
  operation: ActionInputDescriptor['operation'],
): ActionInputDescriptor | undefined {
  return props.registry?.action_inputs.find(
    (item) => item.action_id === action.action_id && item.operation === operation,
  )
}

function actionLabel(action: ActionRef): string {
  const descriptor = props.registry?.action_inputs.find(
    (item) => item.action_id === action.action_id,
  )
  return descriptor && te(descriptor.title_key)
    ? t(descriptor.title_key)
    : t('platform.relations.action')
}

function stateLabel(state: PlatformRelation['state']): string {
  return t(`platform.relations.states.${state}`)
}
</script>

<template>
  <p
    v-if="!relations.length"
    class="relation-empty"
  >
    {{ t('platform.relations.empty') }}
  </p>
  <ul
    v-else
    class="relation-rows"
  >
    <li
      v-for="relation in relations"
      :key="relation.relation_id"
      class="relation-row"
    >
      <VIcon
        :name="relation.presentation.icon_key || 'external-link'"
        :size="19"
      />
      <div class="relation-copy">
        <strong class="relation-label">{{ relation.presentation.label }}</strong>
        <span
          v-if="relation.presentation.secondary_text"
          class="relation-secondary"
          >{{ relation.presentation.secondary_text }}</span
        >
        <small class="relation-provenance"
          >{{ relation.kind }} · {{ observedAt(relation.provenance.observed_at) }}</small
        >
      </div>
      <SemanticState
        class="relation-state"
        dimension="relation-state"
        variant="badge"
        :label="stateLabel(relation.state)"
        :state="relation.state"
      />
      <div
        v-if="relation.actions.length"
        class="relation-actions"
      >
        <button
          v-for="action in relation.actions"
          :key="action.action_id"
          class="relation-action"
          type="button"
          :disabled="busy || (!descriptorFor(action, 'open') && !descriptorFor(action, 'remove'))"
          @click="emit('invoke', relation, action)"
        >
          {{ actionLabel(action) }}
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.relation-rows {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}

.relation-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-rule);

  &:last-child {
    border-bottom: 0;
  }
}

.relation-copy {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
}

.relation-label {
  font-size: var(--font-size-interface);
}

:is(.relation-label, .relation-secondary, .relation-provenance) {
  overflow-wrap: anywhere;
}

:is(.relation-secondary, .relation-provenance, .relation-empty) {
  color: var(--color-text-muted);
  font: var(--font-note);
}

.relation-empty {
  margin: 0;
}

.relation-actions {
  display: flex;
  flex-wrap: wrap;
  grid-column: 2/-1;
  gap: var(--space-2);

  .relation-action {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--size-control-height-compact);
    padding: 0 var(--space-3);
    color: var(--color-text);
    font-size: var(--font-size-dense);
    background: var(--color-control-surface);
    border-radius: var(--radius-control);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--color-surface-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

/* The inspector is narrower than the window by whatever the operator has dragged,
   so the row asks the overlay and not the viewport. */
@container overlay (width <= 600px) {
  .relation-row {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .relation-state {
    grid-column: 2;
    justify-self: start;
  }

  .relation-actions {
    grid-column: 1/-1;

    .relation-action {
      flex: 1 1 140px;
    }
  }
}
</style>
