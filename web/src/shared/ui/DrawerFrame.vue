<script setup lang="ts">
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ closeLabel: string; title: string; subtitle?: string }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="drawer-frame">
    <header class="drawer-frame-head">
      <div class="drawer-frame-title">
        <h2 class="drawer-frame-name">{{ title }}</h2>
        <p
          v-if="subtitle"
          class="drawer-frame-subtitle"
        >
          {{ subtitle }}
        </p>
        <slot name="meta" />
      </div>
      <button
        class="drawer-frame-close"
        type="button"
        :aria-label="closeLabel"
        @click="emit('close')"
      >
        <VIcon name="close" />
      </button>
      <div
        v-if="$slots.actions"
        class="drawer-frame-actions"
      >
        <slot name="actions" />
      </div>
      <div
        v-if="$slots.tabs"
        class="drawer-frame-tabs"
      >
        <slot name="tabs" />
      </div>
    </header>
    <div class="drawer-frame-body"><slot /></div>
  </div>
</template>

<style scoped>
.drawer-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 100%;
  background: var(--color-surface);
}

.drawer-frame-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  flex: 0 0 auto;
  grid-template-areas: 'title close' 'actions actions' 'tabs tabs';
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3) var(--space-4);
  padding: var(--space-6) var(--space-6) 0;
  border-bottom: 1px solid var(--color-rule);
  background: var(--color-surface);
}

.drawer-frame-title {
  grid-area: title;
  min-width: 0;
}

.drawer-frame-name {
  margin: 0;
  font: var(--font-drawer-title);
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.drawer-frame-subtitle {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.drawer-frame-close {
  display: grid;
  grid-area: close;
  place-items: center;
  width: var(--size-control-target);
  height: var(--size-control-target);
  padding: 0;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    border-color: var(--color-rule);
  }
}

.drawer-frame-actions {
  display: flex;
  flex-wrap: wrap;
  grid-area: actions;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
}

.drawer-frame-tabs {
  grid-area: tabs;
}

.drawer-frame-body {
  min-height: 0;
  padding: var(--space-6);
  overflow-y: auto;
}
</style>
