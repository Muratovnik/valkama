<script setup lang="ts">
/**
 * What the read of the questions did not cover, a quiet line each under the list's status: that a
 * source was not read, that the list changed while it was read, and each space whose questions
 * could not be read, with the reason the finder names it by.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InputRequestList } from '@/shared/api/inputRequestModel.ts'
import { skippedSourceReason } from '@/shared/api/planningTarget.ts'
import { spaceName, useSpaceNames } from '@/shared/lib/spaceNames.ts'

const props = defineProps<{ partial: boolean; result: InputRequestList | null }>()
const { t } = useI18n()
const spaces = useSpaceNames()
/** The sources not read, each with the reason the finder names it by. */
const skipped = computed(() =>
  (props.result?.coverage ?? [])
    .filter((source) => source.status === 'unavailable')
    .map((source) => {
      const reason = skippedSourceReason(source.reason)
      return {
        key: JSON.stringify(source.space_ref),
        text: t('requests.sourceUnavailable', {
          space: spaceName(spaces.value, source.space_ref),
          reason: t(
            reason === 'requests_unavailable' ? 'requests.unreadable' : `finder.reasons.${reason}`,
          ),
        }),
      }
    }),
)
</script>

<template>
  <p
    v-if="partial"
    class="request-note"
    role="status"
  >
    {{ t('requests.partial') }}
  </p>
  <p
    v-if="result?.has_more"
    class="request-note"
    role="status"
  >
    {{ t('requests.truncated') }}
  </p>
  <p
    v-for="source in skipped"
    :key="source.key"
    class="request-note"
  >
    {{ source.text }}
  </p>
</template>

<style scoped>
.request-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}
</style>
