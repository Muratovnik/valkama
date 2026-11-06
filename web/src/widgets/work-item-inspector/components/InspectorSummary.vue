<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorReport from '@/widgets/work-item-inspector/components/InspectorReport.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import RichText from '@/shared/ui/RichText.vue'
import VButton from '@/shared/ui/VButton.vue'
import VDisclosure from '@/shared/ui/VDisclosure.vue'

const props = defineProps<{ item: WorkItem }>()
const { t } = useI18n()
/** Open, the report stands in full and its preview gives way to it. */
const opened = ref(false)

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
    <VDisclosure
      v-model:open="opened"
      class="outcome-details"
      heading="h3"
    >
      <template #summary>{{ t('workItem.outcome') }}</template>
      <div class="outcome-body">
        <InspectorReport :report="item.summary" />
      </div>
    </VDisclosure>
    <div
      v-show="!opened"
      class="outcome-preview"
    >
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

/* The section's name is the toggle, in the type a panel's heading is set in. */
.outcome-details {
  --font-disclosure: var(--font-panel-title);
  --space-disclosure-gap: var(--space-heading-content);
}

.outcome-preview {
  display: grid;
  gap: var(--space-label-value);
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
