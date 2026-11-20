<script setup lang="ts">
/**
 * What the read of the questions did not cover, a quiet line each under the list's status: that a
 * source was not read, that the list changed while it was read, and each space whose questions
 * could not be read, with the reason the finder names it by (`SourceCoverageNotes`, which the top
 * of Volumes says its own coverage with).
 */
import { useI18n } from 'vue-i18n'

import type { InputRequestList } from '@/shared/api/inputRequestModel.ts'
import SourceCoverageNotes from '@/shared/ui/SourceCoverageNotes.vue'

defineProps<{ result: InputRequestList | null }>()
const { t } = useI18n()
</script>

<template>
  <SourceCoverageNotes :coverage="result?.coverage ?? []">
    <p
      v-if="result?.has_more"
      class="request-note"
      role="status"
    >
      {{ t('requests.truncated') }}
    </p>
  </SourceCoverageNotes>
</template>

<style scoped>
.request-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}
</style>
