<script setup lang="ts">
/**
 * A report or the closing summary: what was done, why when it says, and what comes next.
 *
 * Its friction, what hindered the work itself, stands last and quieter than the result, and
 * not at all where there was none: `none` is what an agent writes for nothing to report.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{
  report: { done: string; next: string; friction?: string; why?: string }
}>()
const { t } = useI18n()
const friction = computed(() => {
  const text = props.report.friction?.trim() ?? ''
  return text.toLowerCase() === 'none' ? '' : text
})
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
    <div
      v-if="friction"
      class="report-field"
    >
      <dt class="report-term">{{ t('workItem.summaryFriction') }}</dt>
      <dd class="report-value report-friction"><RichText :source="friction" /></dd>
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

/* What hindered the work reads after the result, not as part of it. */
.report-friction {
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
