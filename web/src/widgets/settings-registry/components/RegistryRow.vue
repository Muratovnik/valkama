<script setup lang="ts">
/**
 * One row of a registry section: what the thing is, what it is called underneath,
 * and the facts about it.
 *
 * Availability, configuration ownership, observed health, and enablement answer
 * different operator questions. Named lanes keep those answers aligned without
 * turning them into one ambiguous status sentence; technical facts stay behind
 * the row's disclosure.
 *
 * Every element is styled by a class rather than by its tag, which is what let
 * this widget come off the `selector-max-type` exception list.
 */
import { useI18n } from 'vue-i18n'

import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  icon: string
  title: string
  /** The owner is operational context, not a health or lifecycle state. */
  configurationOwner?: string
  /** Label/value pairs shown under the identity; empty means no list at all. */
  details?: { label: string; value: string }[]
  subtitle?: string
}>()
const { t } = useI18n()
</script>

<template>
  <li class="registry-row">
    <VIcon
      class="registry-icon"
      :name="props.icon"
    />
    <span class="registry-identity"
      ><strong class="registry-name">{{ props.title }}</strong
      ><small
        v-if="props.subtitle"
        class="registry-sub"
        >{{ props.subtitle }}</small
      ></span
    >
    <span
      v-if="
        props.configurationOwner ||
        $slots.availability ||
        $slots.health ||
        $slots.enablement ||
        $slots.configuration ||
        $slots.condition
      "
      class="registry-control-lane"
    >
      <span
        v-if="$slots.availability"
        class="registry-state-lane registry-availability"
      >
        <small class="registry-lane-label">{{ t('settings.stateLanes.availability') }}</small>
        <slot name="availability" />
      </span>
      <span
        v-if="props.configurationOwner"
        class="registry-state-lane registry-owner"
      >
        <small class="registry-lane-label">{{ t('settings.stateLanes.configurationOwner') }}</small>
        <span class="registry-owner-value">{{ props.configurationOwner }}</span>
      </span>
      <span
        v-if="$slots.health"
        class="registry-state-lane registry-health"
      >
        <small class="registry-lane-label">{{ t('settings.stateLanes.observedHealth') }}</small>
        <slot name="health" />
      </span>
      <span
        v-if="$slots.enablement"
        class="registry-state-lane registry-enablement"
      >
        <small class="registry-lane-label">{{ t('settings.stateLanes.enablement') }}</small>
        <slot name="enablement" />
      </span>
      <span
        v-if="$slots.configuration || $slots.condition"
        class="registry-state-lane registry-configuration"
      >
        <small class="registry-lane-label">{{ t('settings.stateLanes.configuration') }}</small>
        <span class="registry-condition">
          <slot
            v-if="$slots.configuration"
            name="configuration"
          />
          <slot
            v-else
            name="condition"
          />
        </span>
      </span>
    </span>
    <details
      v-if="props.details?.length"
      class="registry-details"
    >
      <summary class="registry-details-summary">{{ t('platform.registry.details') }}</summary>
      <dl class="registry-facts">
        <div
          v-for="detail in props.details"
          :key="detail.label"
          class="registry-fact"
        >
          <dt class="registry-fact-label">{{ detail.label }}</dt>
          <dd class="registry-fact-value">{{ detail.value }}</dd>
        </div>
      </dl>
    </details>
  </li>
</template>

<style scoped>
.registry-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  column-gap: var(--space-3);
  align-items: center;
  padding-block: var(--space-3);
  border-bottom: 1px solid var(--color-rule);

  &:last-child {
    border-bottom: 0;
  }
}

.registry-icon {
  margin-inline-start: var(--space-4);
}

.registry-identity {
  display: grid;
  grid-column: 2;
  gap: var(--space-1);
  min-width: 0;
}

/* The list owns the tracks and every row joins that subgrid. Status copy and
   its control are one decision, so they share one compact lane instead of
   becoming two unrelated right-aligned columns. */
.registry-control-lane {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 3 / -1;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  padding-inline-end: var(--space-4);
}

.registry-state-lane {
  display: grid;
  gap: var(--space-half);
  align-content: center;
  min-width: 0;
}

.registry-lane-label {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.registry-owner-value {
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: break-word;
}

.registry-condition {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

/* break-word, not anywhere: `anywhere` also shrinks the intrinsic minimum of
   the column, so a grid track collapsed to one character and hyphenated
   "agentmemo-ry" mid-word in a name that would otherwise have fit. */
.registry-name,
.registry-sub {
  overflow-wrap: break-word;
}

.registry-name {
  font-size: var(--font-size-interface);
}

.registry-sub {
  color: var(--color-text-muted);
  font: var(--font-note);
}

.registry-details {
  grid-column: 2 / -1;
  min-width: 0;
  padding-inline-end: var(--space-4);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.registry-details-summary {
  width: fit-content;
  cursor: pointer;
}

.registry-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-1) var(--space-3);
  padding: var(--space-3);
  margin: var(--space-2) 0 0;
  background: var(--color-surface-recess);
  border-radius: var(--radius-control);
}

.registry-fact {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
  font-size: var(--font-size-dense);
}

.registry-fact-label {
  color: var(--color-text-muted);
}

.registry-fact-value {
  min-width: 0;
  margin: 0;
  overflow-wrap: break-word;
}

@container workspace (width <= 556px) {
  .registry-control-lane {
    grid-template-columns: 1fr;
    grid-column: 2;
    gap: var(--space-3);
  }

  .registry-facts {
    grid-template-columns: 1fr;
  }

  .registry-details {
    grid-column: 2;
  }
}
</style>
