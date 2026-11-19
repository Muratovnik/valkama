<script setup lang="ts">
/**
 * The record behind a memory id written in a card's text.
 *
 * Valkama holds one record of it: the ref on this card, with who attached it, when and under
 * what label. A memory id is a pointer into AgentMemory, which this process cannot read, so
 * the dialog says so rather than pretending to have looked. A commit opens its own dialog
 * (`InspectorCommitPeek`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{ record: WorkItem['refs'][number] }>()
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()

const attached = computed(() => {
  const date = new Date(props.record.at)
  return t('workItem.refAttached', {
    author: actorName(props.record.author),
    at: Number.isNaN(date.valueOf()) ? props.record.at : d(date, 'activity'),
  })
})
</script>

<template>
  <DialogFrame
    :open="true"
    :title="t(`reference.${record.kind}`)"
    :context="record.value"
    :close-label="t('drawer.close')"
    @close="emit('close')"
  >
    <div class="peek">
      <RichText
        v-if="record.label && record.label !== record.value"
        class="peek-label"
        :source="record.label"
        inline
      />
      <p class="peek-meta">{{ attached }}</p>
      <p class="peek-meta">{{ t('textLinks.memoryPointer') }}</p>
    </div>
  </DialogFrame>
</template>

<style scoped>
.peek {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.peek-label {
  font: var(--font-editor);
}

.peek-meta {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
