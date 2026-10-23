<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'

defineProps<{ item: WorkItem }>()
const { t } = useI18n()
</script>

<template>
  <section
    v-if="item.summary"
    class="outcome"
  >
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('workItem.outcome') }}</SectionHeading
    >
    <InspectorReport :report="item.summary" />
    <a
      v-if="item.summary_comment_id !== null"
      class="outcome-link"
      :href="`#work-report-${item.summary_comment_id}`"
      >{{ t('workItem.viewReport') }}</a
    >
  </section>
</template>

<style scoped>
.outcome {
  display: grid;
  gap: var(--space-heading-content);
  padding: var(--space-3);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-card);
}

.outcome-link {
  color: var(--color-action-primary);
  font: var(--font-detail);
}
</style>
