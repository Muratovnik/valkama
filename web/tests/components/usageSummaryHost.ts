/**
 * The head of an item's Agents tab, or another part of the card that reads its numbers, mounted
 * on its own the way the inspector provides it: the item's read has answered with the usage a
 * spec hands it and never reads again.
 */
import { computed, defineComponent, h, ref } from 'vue'
import type { Component } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'

import AgentsUsageSummary from '@/widgets/work-item-inspector/components/AgentsUsageSummary.vue'
import { provideInspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'
import type { InspectorUsage } from '@/widgets/work-item-inspector/utils/useInspectorRecord.ts'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

const settled = () => Promise.resolve()
export function mountSummary(
  usage: ItemUsage,
  options: { container?: boolean; locale?: 'en' | 'ru'; part?: Component } = {},
) {
  const part = options.part ?? AgentsUsageSummary
  const draw = () => h(part)
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
        isContainer: computed(() => options.container ?? false),
        read,
        rows: computed(() => answer.value),
        runs: read,
        news: () => usage.reference,
        readable: () => true,
        reference: () => usage.reference,
      })
      return draw
    },
  })
  const i18n = createI18n({
    legacy: false,
    locale: options.locale ?? 'en',
    messages,
    pluralRules,
  })
  return mount(Host, { attachTo: document.body, global: { plugins: [i18n] } })
}
