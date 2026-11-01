<script setup lang="ts">
/**
 * The record behind a commit or memory id written in a card's text.
 *
 * Valkama holds one record of either: the ref on this card, with who attached
 * it, when and under what label. That is shown first, because it answers
 * without asking anyone. A commit is then looked up the way the planning tools
 * look one up (`/api/ref`): git, in the repository the card's project is
 * registered at and in the configured document roots, names its subject and
 * the files it changed. A memory id is a pointer into AgentMemory,
 * which this process cannot read, so the dialog says so rather than pretending
 * to have looked.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { resolveRef } from '@/shared/api/api.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import RichText from '@/shared/ui/RichText.vue'

const props = defineProps<{
  record: WorkItem['refs'][number]
  /** The card's planning space, by its exact identity; none outside a project. */
  space?: string
}>()
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()

const resolved = ref<ResolvedRef | null>(null)
const failed = ref(false)
const loading = ref(false)

watch(
  () => `${props.record.kind}:${props.record.value}:${props.space ?? ''}`,
  (_key, _previous, onCleanup) => {
    resolved.value = null
    failed.value = false
    if (props.record.kind !== 'commit') return
    let current = true
    onCleanup(() => {
      current = false
    })
    loading.value = true
    resolveRef('commit', props.record.value, props.space)
      .then((answer) => {
        if (current) resolved.value = answer
      })
      .catch(() => {
        if (current) failed.value = true
      })
      .finally(() => {
        if (current) loading.value = false
      })
  },
  { immediate: true },
)

const attached = computed(() => {
  const date = new Date(props.record.at)
  return t('workItem.refAttached', {
    author: actorName(props.record.author),
    at: Number.isNaN(date.valueOf()) ? props.record.at : d(date, 'activity'),
  })
})
/** What the lookup found, or why there is nothing more to show. */
const finding = computed(() => {
  if (props.record.kind === 'memory') return t('textLinks.memoryPointer')
  if (loading.value) return t('textLinks.loading')
  if (failed.value) return t('textLinks.failed')
  return resolved.value?.resolved ? '' : t('textLinks.commitMissing')
})
</script>

<template>
  <DialogFrame
    :open="true"
    :title="t(`reference.${record.kind}`)"
    :context="record.value"
    :close-label="t('drawer.close')"
    @close="emit('close')"
  >
    <div class="peek">
      <RichText
        v-if="record.label && record.label !== record.value"
        class="peek-label"
        :source="record.label"
        inline
      />
      <p class="peek-meta">{{ attached }}</p>
      <p
        v-if="resolved?.resolved && resolved.repository"
        class="peek-meta peek-path"
      >
        {{ resolved.repository }}
      </p>
      <pre
        v-if="resolved?.resolved"
        class="peek-detail"
        >{{ resolved.detail }}</pre>
      <p
        v-if="finding"
        class="peek-meta"
        role="status"
      >
        {{ finding }}
      </p>
    </div>
  </DialogFrame>
</template>

<style scoped>
.peek {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.peek-label {
  font: var(--font-editor);
}

.peek-meta {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

.peek-path {
  font-family: var(--font-family-mono);
}

.peek-detail {
  max-height: calc(20 * 1lh);
  padding: var(--space-2) var(--space-3);
  margin: 0;
  font: var(--font-code);
  background: var(--color-surface-recess);
  overflow: auto;
  border-radius: var(--radius-control);
}
</style>
