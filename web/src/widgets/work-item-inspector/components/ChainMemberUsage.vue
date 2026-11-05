<script setup lang="ts">
/**
 * One member's share of an epic's work, on its row of the epic's chain: the time on the clock
 * and the estimated cost, as the epic's own line says them. The share comes from the epic's own
 * usage read, which lists every item under it, so a row costs no read of its own; a member that
 * read does not list, or one nobody worked on, says nothing.
 */
import { computed } from 'vue'

import UsageFacts from '@/widgets/work-item-inspector/components/UsageFacts.vue'
import { injectInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import { isEstimated, useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

const props = defineProps<{ member: string }>()

const read = injectInspectorUsage()?.read
const { cost, time } = useUsageWords()

const facts = computed(() => {
  const usage = read?.usage.value
  if (!usage || usage.scope === 'item') return []
  const line = usage.by_item.find((entry) => entry.work_item_id === props.member)
  if (!line) return []
  return [
    { key: 'time', text: time(line.elapsed_seconds, isEstimated(usage)) },
    { key: 'cost', text: cost(line.estimated_api_cost_usd) },
  ].filter((fact) => fact.text)
})
</script>

<template>
  <UsageFacts
    v-if="facts.length"
    :facts="facts"
  />
</template>
