<script setup lang="ts">
/** A setting as the screen reads it: what it is on the left, its control on the right. */
defineProps<{
  label: string
  /** Why the last change to this row did not hold; it stands under the control. */
  failure?: string
  hint?: string
  /** For a control that takes its name from this row's label. */
  labelId?: string
}>()
</script>

<template>
  <div class="settings-row">
    <span class="settings-row-identity">
      <strong
        :id="labelId"
        class="settings-row-label"
        >{{ label }}</strong
      >
      <small
        v-if="hint"
        class="settings-row-hint"
        >{{ hint }}</small
      >
    </span>
    <div class="settings-row-control">
      <slot />
      <p
        v-if="failure"
        class="settings-row-failure"
        role="alert"
      >
        {{ failure }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.settings-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--size-column-gutter);
  align-items: center;
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-rule);
}

.settings-row-identity {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;

  .settings-row-label {
    font: var(--font-label);
  }

  .settings-row-hint {
    color: var(--color-text-muted);
    font: var(--font-detail);
  }
}

.settings-row-control {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.settings-row-failure {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

@container workspace (width <= 696px) {
  .settings-row {
    grid-template-columns: 1fr;
    gap: var(--space-3);
    align-items: start;
  }
}
</style>
