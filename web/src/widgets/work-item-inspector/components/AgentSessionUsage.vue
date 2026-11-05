<script setup lang="ts">
/**
 * What the session at the head of a group took: all of it, on this item and elsewhere, and of
 * that what bound to no item at all, which has no card to be read on and stands only here.
 *
 * Its two rows hold their room while the read runs, so that the agents under them do not move
 * when it answers. A session with no read has no rows, and no zeros.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UsageFacts from '@/widgets/work-item-inspector/components/UsageFacts.vue'
import {
  isEstimated,
  saysAnything,
  useUsageWords,
} from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { SessionUsage, UsageLine } from '@/shared/api/planningUsageApi.ts'

const props = defineProps<{
  session: SessionUsage | null
  /** Its read has not answered yet. */
  waiting: boolean
}>()

const { t } = useI18n()
const { figures } = useUsageWords()

const figuresOf = (line: UsageLine, estimated: boolean) =>
  figures({ ...line, seconds: line.elapsed_seconds }, estimated)

const rows = computed(() => {
  const session = props.session
  if (!session) return []
  const estimated = isEstimated(session)
  const total = { ...session, seconds: session.elapsed_seconds }
  const loose = session.by_item.find((line) => line.work_item_id === null)
  return [
    ...(saysAnything(total)
      ? [
          {
            key: 'session',
            label: t('workItem.usage.wholeSession'),
            facts: figures(total, estimated),
          },
        ]
      : []),
    ...(loose && saysAnything({ ...loose, seconds: loose.elapsed_seconds })
      ? [{ key: 'loose', label: t('workItem.usage.noItem'), facts: figuresOf(loose, estimated) }]
      : []),
  ]
})
</script>

<template>
  <div
    v-if="waiting || rows.length"
    class="session-usage"
    :class="{ 'is-waiting': waiting && !rows.length }"
  >
    <p
      v-for="row in rows"
      :key="row.key"
      class="session-usage-row"
    >
      <span class="session-usage-label">{{ row.label }}</span>
      <UsageFacts
        class="session-usage-facts"
        :facts="row.facts"
        columns
      />
    </p>
  </div>
</template>

<style scoped>
/* The columns are the group's, so its figures stand over its agents' figures. */
.session-usage {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  row-gap: var(--space-half);
  color: var(--color-text-muted);
  font: var(--font-detail);

  &.is-waiting {
    min-height: calc(2lh + var(--space-half));
  }
}

.session-usage-row {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: baseline;
  min-width: 0;
  margin: 0;
}

.session-usage-label {
  color: var(--color-text-tertiary);
}

@container drawer (width < 560px) {
  .session-usage-label,
  .session-usage-facts {
    grid-column: 1 / -1;
  }
}
</style>
