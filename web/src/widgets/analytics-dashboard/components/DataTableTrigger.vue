<script setup lang="ts">
/**
 * The way from a chart to the numbers behind it.
 *
 * Every chart card offers it, and the same nine lines of markup were written
 * five times — once per card — with the copy already varying in whether it was
 * conditional. A chart that quietly loses its way to the table is a chart the
 * operator cannot check.
 */
import { useI18n } from 'vue-i18n'

import VIcon from '@/shared/ui/VIcon.vue'

const emit = defineEmits<{ open: [] }>()
const { t } = useI18n()
</script>

<template>
  <button
    class="data-inspector-trigger"
    type="button"
    aria-haspopup="dialog"
    @click="emit('open')"
  >
    <VIcon
      name="table"
      :size="18"
    /><span
      ><strong>{{ t('dashboard.openDataTable') }}</strong
      ><small>{{ t('dashboard.opensInDrawer') }}</small></span
    >
  </button>
</template>

<style scoped>
.data-inspector-trigger {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
  width: 100%;
  min-height: 52px;
  padding: var(--space-2) 0;
  margin-top: var(--space-2);
  border: 0;
  border-top: 1px solid var(--color-rule);
  color: var(--color-text);
  font-size: var(--font-size-dense);
  text-align: left;
  background: transparent;
  cursor: pointer;

  span {
    display: grid;
    gap: var(--space-hair);
  }

  strong {
    font-weight: 700;
  }

  small {
    color: var(--color-text-muted);
    font: var(--font-chrome);
  }

  &:hover {
    color: var(--color-info);
  }
}
</style>
