<script setup lang="ts">
/**
 * What is attached to the item as evidence of its work — sessions, memory records, links —
 * with the plan anchor it was raised from first, each with who attached it and when, then
 * its commits (`InspectorCommits`). The heading counts both.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorCommits from '@/widgets/work-item-inspector/components/InspectorCommits.vue'

import OpenAction from '@/features/session-open/OpenAction.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import { sourceDocument } from '@/shared/lib/textReferences.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import RichInlines from '@/shared/ui/RichInlines.vue'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'

const props = defineProps<{ item: WorkItem }>()
const { t, d } = useI18n()

const commits = computed(() => props.item.commits ?? [])
const count = computed(() => props.item.refs.length + commits.value.length)
const any = computed(() => count.value > 0 || Boolean(props.item.source))

/**
 * The plan anchor is one of the item's references, so its whole path stands
 * here with them, a link of the card's own layer; the head offers it only as an
 * icon. It is drawn as written rather than parsed, because Markdown would read a
 * backslash or an underscore in a path as its own. A value that holds no path is text.
 */
const sourceNodes = computed<RichInline[]>(() => {
  const reference = sourceDocument(props.item.source)
  return reference
    ? [{ kind: 'reference', code: false, reference }]
    : [{ kind: 'text', text: props.item.source }]
})

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <section class="evidence">
    <SectionHeader
      :title="t('workItem.refs')"
      :count="count || ''"
    />
    <ul
      v-if="item.refs.length || item.source"
      class="ref-list"
    >
      <li
        v-if="item.source"
        class="ref-row"
      >
        <span class="ref-kind">{{ t('workItem.source') }}</span>
        <span class="ref-value"><RichInlines :nodes="sourceNodes" /></span>
      </li>
      <li
        v-for="reference in item.refs"
        :key="`${reference.kind}-${reference.value}-${reference.at}`"
        class="ref-row"
      >
        <span class="ref-kind">{{ t(`reference.${reference.kind}`) }}</span>
        <OpenAction
          v-if="reference.kind === 'session'"
          class="ref-session"
          :session="reference.value"
          :name="reference.label || reference.value"
          :detail="reference.value"
        /><RichText
          v-else
          class="ref-value"
          :source="reference.label || reference.value"
          inline
        />
        <span class="ref-meta">{{
          t('workItem.refAttached', {
            author: actorName(reference.author),
            at: when(reference.at),
          })
        }}</span>
      </li>
    </ul>
    <InspectorCommits
      v-if="commits.length"
      :commits="commits"
    />
    <DataEmptyState
      v-if="!any"
      :title="t('workItem.noRefs')"
      :description="t('workItem.refsIntro')"
      inline
    />
  </section>
</template>

<style scoped>
.evidence {
  display: grid;
  gap: var(--space-heading-content);
}

.ref-list {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.ref-row {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.ref-kind {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.ref-session {
  justify-self: start;
}

.ref-value {
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
}

.ref-meta {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}
</style>
