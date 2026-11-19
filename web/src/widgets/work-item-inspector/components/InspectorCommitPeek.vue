<script setup lang="ts">
/**
 * An attached commit, opened from «Связи» or from its hash in the card's text (`useCommitPeek`).
 *
 * The record the card holds answers first, without asking anyone: the repository and the hash,
 * the project, the subject, when it was committed and who attached it. Then git is asked
 * (`GET /api/commit`), in that repository's registered root alone, for the files it changed.
 * A commit of no known repository has nowhere to be asked, and the dialog says so.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { commitName } from '@/widgets/work-item-inspector/utils/commitWords.ts'
import type { AttachedCommit } from '@/widgets/work-item-inspector/utils/commitWords.ts'

import { fetchCommit } from '@/shared/api/api.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'

const props = defineProps<{ commit: AttachedCommit }>()
const emit = defineEmits<{ close: [] }>()
const { t, d } = useI18n()

const resolved = ref<ResolvedRef | null>(null)
const failed = ref(false)
const loading = ref(false)

watch(
  () => `${props.commit.repository ?? ''}:${props.commit.hash}`,
  (_key, _previous, onCleanup) => {
    resolved.value = null
    failed.value = false
    const { repository, hash } = props.commit
    if (!repository) return
    let current = true
    onCleanup(() => {
      current = false
    })
    loading.value = true
    fetchCommit(repository, hash)
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
const name = computed(() => commitName(props.commit))
/**
 * The lookup said as every wait is (`loadingPresence`): nothing for a commit found quickly,
 * and once said, long enough to be read, with what was found held back meanwhile.
 */
const { shown: waitShown, held: waitHeld } = useLoadingPresence(() => loading.value)

/** The project, when it was committed, and who attached it where a person did. */
const meta = computed(() => {
  const { attached_by, committed_at, display_name } = props.commit
  const date = committed_at ? new Date(committed_at) : null
  return [
    display_name,
    date && !Number.isNaN(date.valueOf()) ? d(date, 'activity') : committed_at,
    attached_by === 'manual' ? t('commits.manual') : null,
  ]
    .filter(Boolean)
    .join(' · ')
})

/** What the lookup found, or why there is nothing more to show. */
const finding = computed(() => {
  if (!props.commit.repository) return t('commits.noRepository')
  if (waitHeld.value) return waitShown.value ? t('platform.states.loading') : ''
  if (failed.value) return t('textLinks.failed')
  return resolved.value?.resolved ? '' : resolved.value?.detail || t('textLinks.commitMissing')
})
</script>

<template>
  <DialogFrame
    :open="true"
    :title="t('reference.commit')"
    :context="name"
    :close-label="t('drawer.close')"
    @close="emit('close')"
  >
    <div class="peek">
      <p
        v-if="commit.subject"
        class="peek-subject"
      >
        {{ commit.subject }}
      </p>
      <p
        v-if="meta"
        class="peek-meta"
      >
        {{ meta }}
      </p>
      <pre
        v-if="resolved?.resolved && !waitHeld"
        class="peek-detail"
        >{{ resolved.detail }}</pre>
      <!-- Stands empty from the start of the lookup, so its word is announced when shown. -->
      <p
        v-if="finding || waitHeld"
        class="peek-meta peek-finding"
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

.peek-subject {
  margin: 0;
  font: var(--font-editor);
  overflow-wrap: anywhere;
}

.peek-meta {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}

/* One line tall before a wait's word arrives, so the word moves nothing when it does. */
.peek-finding {
  min-height: 1lh;
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
