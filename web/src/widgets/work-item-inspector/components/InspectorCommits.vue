<script setup lang="ts">
/**
 * The commits attached to an item, in «Связи» under its evidence, newest first as the record
 * lists them.
 *
 * A commit is named by its repository and its hash, the pair that finds it, and opens what git
 * says of it (`InspectorCommitPeek`). Under the subject stand the project the repository is
 * registered as, when it was committed, and a mark where it was attached by hand: the server
 * attaches a commit itself when an agent's session makes one, which is the norm and says
 * nothing; one attached by hand is a person's or an agent's claim, and reads as one.
 *
 * Each row carries `data-commit`, its hash, and `data-attached`, who attached it.
 */
import { useI18n } from 'vue-i18n'

import { useCommitPeek } from '@/widgets/work-item-inspector/utils/commitPeek.ts'
import { commitName } from '@/widgets/work-item-inspector/utils/commitWords.ts'
import type { AttachedCommit } from '@/widgets/work-item-inspector/utils/commitWords.ts'

import VButton from '@/shared/ui/VButton.vue'

defineProps<{ commits: readonly AttachedCommit[] }>()
const { t, d } = useI18n()
const peek = useCommitPeek()

function when(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <div class="commits">
    <h4 class="commits-label">{{ t('commits.many') }}</h4>
    <ul class="commit-list">
      <li
        v-for="commit in commits"
        :key="`${commit.repository ?? ''}:${commit.hash}`"
        class="commit-row"
        :data-commit="commit.hash"
        :data-attached="commit.attached_by"
      >
        <VButton
          class="commit-name"
          variant="text"
          size="inline"
          :aria-label="t('commits.show', { commit: commitName(commit) })"
          @click="peek(commit)"
        >
          <span class="commit-name-words">{{ commitName(commit) }}</span>
        </VButton>
        <span
          v-if="commit.subject"
          class="commit-subject"
          >{{ commit.subject }}</span
        >
        <span class="commit-meta">
          <span
            v-if="commit.display_name"
            class="commit-project"
            >{{ commit.display_name }}</span
          >
          <span v-if="commit.committed_at">{{ when(commit.committed_at) }}</span>
          <span
            v-if="commit.attached_by === 'manual'"
            class="commit-manual"
            >{{ t('commits.manual') }}</span
          >
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.commits {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.commits-label {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.commit-list {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.commit-row {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.commit-name {
  justify-self: start;
  max-width: 100%;
}

.commit-name-words {
  font-family: var(--font-family-mono);
  overflow-wrap: anywhere;
}

.commit-subject {
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
}

/* The project, the time and the mark, each kept whole; the line wraps between them. */
.commit-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-3);
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.commit-manual {
  color: var(--color-text-muted);
  font-weight: 500;
}
</style>
