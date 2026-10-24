<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestList from '@/features/input-requests/components/RequestList.vue'
import { useInputRequests } from '@/features/input-requests/composables/useInputRequests.ts'

import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'

const props = defineProps<{ target: PlanningTarget }>()
const emit = defineEmits<{ changed: [entry: InputRequestEntry] }>()
const { t } = useI18n()
const { result, loading, failed, partial, entries, refresh, changed } = useInputRequests(
  () => props.target,
)
const drafts = ref<Record<string, InputAnswers>>({})
function updated(entry: InputRequestEntry) {
  changed(entry)
  emit('changed', entry)
}
</script>

<template>
  <section
    class="item-input-requests"
    :aria-label="t('requests.itemTitle')"
  >
    <SectionHeading
      as="h3"
      level="panel"
      >{{ t('requests.itemTitle') }}</SectionHeading
    >
    <RequestList
      :entries="entries"
      :result="result"
      :loading="loading"
      :failed="failed"
      :partial="partial"
      :drafts="drafts"
      item
      @refresh="refresh"
      @updated="updated"
      @draft="(key, value) => (drafts[key] = value)"
    />
  </section>
</template>

<style scoped>
.item-input-requests {
  display: grid;
  gap: var(--space-heading-content);
  min-width: 0;
}
</style>
