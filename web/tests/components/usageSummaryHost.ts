/**
 * The head of an item's Agents tab, mounted on its own the way the inspector provides it: the
 * item's read has answered with the usage a spec hands it and never reads again.
 */
import { computed, defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'

import AgentsUsageSummary from '@/widgets/work-item-inspector/components/AgentsUsageSummary.vue'
import { provideInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import type { InspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

const settled = () => Promise.resolve()
const drawSummary = () => h(AgentsUsageSummary)

export function mountSummary(usage: ItemUsage) {
  const answer = ref<ItemUsage | null>(usage)
  const read = {
    failed: ref(false),
    read: settled,
    settled,
    usage: answer,
    version: ref(0),
  } as unknown as InspectorUsage['read']
  const Host = defineComponent({
    setup() {
      provideInspectorUsage({
        isEpic: computed(() => false),
        read,
        rows: computed(() => answer.value),
        runs: read,
        news: () => usage.reference,
        readable: () => true,
        reference: () => usage.reference,
      })
      return drawSummary
    },
  })
  const i18n = createI18n({ legacy: false, locale: 'en', messages, pluralRules })
  return mount(Host, { attachTo: document.body, global: { plugins: [i18n] } })
}
