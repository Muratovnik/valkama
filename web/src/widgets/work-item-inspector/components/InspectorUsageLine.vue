<script setup lang="ts">
/**
 * How much work the item took, in one quiet line under its facts: the time, the estimated cost
 * and the tokens processed anew. An item with nothing to say has no line and none of its room.
 *
 * The line says the numbers and its tooltip what they are; a press goes to the Agents tab,
 * where the same explanations stand in words a finger can reach as well. The first number is
 * the clock's: what agents spent side by side adds up in that tab and in the tooltip.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UsageFacts from '@/widgets/work-item-inspector/components/UsageFacts.vue'
import { injectInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import { isEstimated, useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'

const emit = defineEmits<{ details: [] }>()

const { t } = useI18n()
const { cost, notes, span, time, tokens } = useUsageWords()
const read = injectInspectorUsage()?.read
const usage = computed(() => read?.usage.value ?? null)

function costWords(usage: ItemUsage): string {
  const { estimated_api_cost_usd: usd, unpriced_models: unpriced } = usage
  if (usd === null) return unpriced.length ? t('workItem.usage.noPrice') : ''
  return cost(usd, unpriced.length > 0)
}

/** The label rides the first figure there is, so what wraps is a figure and not the label. */
const facts = computed(() => {
  const shown = usage.value
  if (!shown) return []
  const label = t(shown.scope === 'item' ? 'workItem.usage.work' : 'workItem.usage.workEpic')
  return [
    { key: 'time', text: time(shown.elapsed_seconds, isEstimated(shown)) },
    { key: 'cost', text: costWords(shown) },
    { key: 'tokens', text: tokens(shown.tokens) },
  ]
    .filter((fact) => fact.text)
    .map((fact, index) => (index === 0 ? { ...fact, label } : fact))
})

const explanation = computed(() => {
  const shown = usage.value
  if (!shown) return ''
  const parallel = span(shown.elapsed_seconds) !== span(shown.agent_seconds)
  return [
    t('workItem.usage.lineMeaning'),
    ...(shown.scope === 'item' ? [] : [t('workItem.usage.lineChildren')]),
    ...(parallel ? [t('workItem.usage.lineAgents', { time: span(shown.agent_seconds) })] : []),
    ...notes(shown).filter((note) => note !== t('workItem.usage.parallel')),
    t('workItem.usage.lineDetails'),
  ].join('\n')
})
</script>

<template>
  <button
    v-if="facts.length"
    class="usage-line"
    type="button"
    :title="explanation"
    :aria-description="explanation"
    @click="emit('details')"
  >
    <UsageFacts :facts="facts" />
  </button>
</template>

<style scoped>
/* A line of text and not a control: it gives back the height a button is given, and takes only
   the ink under the pointer. */
.usage-line {
  display: flex;
  align-items: center;
  max-width: 100%;
  min-block-size: var(--size-control-inline);
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  text-align: start;
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}
</style>
