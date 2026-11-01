<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import RichText from '@/shared/ui/RichText.vue'

defineProps<{ report: { done: string; next: string; why?: string } }>()
const { t } = useI18n()
</script>

<template>
  <dl class="report">
    <div class="report-field">
      <dt class="report-term">{{ t('workItem.summaryDone') }}</dt>
      <dd class="report-value"><RichText :source="report.done" /></dd>
    </div>
    <div
      v-if="report.why"
      class="report-field"
    >
      <dt class="report-term">{{ t('workItem.summaryWhy') }}</dt>
      <dd class="report-value"><RichText :source="report.why" /></dd>
    </div>
    <div class="report-field">
      <dt class="report-term">{{ t('workItem.summaryNext') }}</dt>
      <dd class="report-value"><RichText :source="report.next" /></dd>
    </div>
  </dl>
</template>

<style scoped>
.report {
  display: grid;
  gap: var(--space-3);
  margin: 0;
}

.report-field {
  display: grid;
  gap: var(--space-label-value);
}

.report-term {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.report-value {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
}
</style>
