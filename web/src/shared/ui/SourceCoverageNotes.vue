<script setup lang="ts">
/**
 * What a read across spaces did not cover, a quiet line each: that the result is incomplete,
 * and each space it could not read, with the reason the finder names it by. Nothing while every
 * source was read (`coverageIncomplete`). The questions window and the top of Volumes say it so,
 * from the `coverage` their reads answer with. The default slot stands under the first line, for
 * what else a host says of its result.
 *
 * Each line is a `p` with `data-coverage-note`, `incomplete` on the first and `source` on each
 * space's, which a check selects them by.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { coverageIncomplete, skippedSourceReason } from '@/shared/api/planningTarget.ts'
import type { PlanningCoverage } from '@/shared/api/planningTarget.ts'
import { spaceName, useSpaceNames } from '@/shared/lib/spaceNames.ts'

const props = defineProps<{ coverage: readonly PlanningCoverage[] }>()
const { t } = useI18n()
const spaces = useSpaceNames()
const incomplete = computed(() => coverageIncomplete(props.coverage))
/** The sources not read, each with the reason the finder names it by. */
const skipped = computed(() =>
  props.coverage
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
    v-if="incomplete"
    class="coverage-note"
    data-coverage-note="incomplete"
    role="status"
  >
    {{ t('requests.partial') }}
  </p>
  <slot />
  <p
    v-for="source in skipped"
    :key="source.key"
    class="coverage-note"
    data-coverage-note="source"
  >
    {{ source.text }}
  </p>
</template>

<style scoped>
.coverage-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
  overflow-wrap: anywhere;
}
</style>
