<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ item: WorkItem }>()
const { t } = useI18n()

function viewReport() {
  const report = document.querySelector<HTMLElement>(
    `#work-report-${props.item.summary_comment_id}`,
  )
  report?.scrollIntoView({ block: 'start' })
  moveFocus(report, { preventScroll: true })
}
</script>

<template>
  <section
    v-if="item.summary"
    class="outcome"
  >
    <details class="outcome-details">
      <summary class="outcome-toggle">
        <SectionHeading
          as="h3"
          level="panel"
          class="outcome-heading"
          >{{ t('workItem.outcome') }}</SectionHeading
        >
      </summary>
      <div class="outcome-body">
        <InspectorReport :report="item.summary" />
      </div>
    </details>
    <div class="outcome-preview">
      <span class="outcome-preview-label">{{ t('workItem.outcomePreview') }}</span>
      <p class="outcome-preview-text">
        <RichText
          :source="item.summary.done"
          inline
        />
      </p>
    </div>
    <VButton
      v-if="item.summary_comment_id !== null"
      class="outcome-link"
      variant="ghost"
      @click="viewReport"
      >{{ t('workItem.viewReport') }}</VButton
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
  justify-self: start;
}

.outcome-toggle {
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.outcome-heading {
  display: inline-flex;
  vertical-align: middle;
}

.outcome-body {
  margin-top: var(--space-heading-content);
}

.outcome-preview {
  display: grid;
  gap: var(--space-label-value);

  .outcome-details[open] ~ & {
    display: none;
  }
}

.outcome-preview-label {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.outcome-preview-text {
  display: -webkit-box;
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
