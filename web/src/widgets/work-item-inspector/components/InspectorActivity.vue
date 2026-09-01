<script setup lang="ts">
/**
 * One chronological record: what the lifecycle did, what evidence was attached,
 * and what a person wrote, newest first.
 *
 * The three streams share one list because a reader reconstructing what happened
 * does not care which table an entry came from.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { buildActivity } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
  writable: boolean
}>()

const emit = defineEmits<{ comment: [body: string] }>()

const { t, d } = useI18n()

const entries = computed(() => buildActivity(props.item))
const note = ref('')
const canSend = computed(() => note.value.trim().length > 0)

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}

function send() {
  const body = note.value.trim()
  if (!body || !props.writable) return
  emit('comment', body)
  note.value = ''
}
</script>

<template>
  <div class="activity">
    <ol
      v-if="entries.length"
      class="feed"
    >
      <li
        v-for="entry in entries"
        :key="entry.key"
        class="entry"
        :data-kind="entry.kind"
      >
        <div class="entry-line">
          <span class="entry-title">{{ t(entry.titleKey) }}</span>
          <span class="entry-at">{{ when(entry.at) }}</span>
        </div>
        <p
          v-if="entry.detail"
          class="entry-detail"
        >
          {{ entry.detail }}
        </p>
        <p
          v-if="entry.reference"
          class="entry-reference"
        >
          {{ entry.reference.value }}
        </p>
        <p
          v-if="entry.author"
          class="entry-author"
        >
          {{ actorName(entry.author) }}
          <span
            v-if="actorSession(entry.author)"
            class="entry-session"
            >{{ actorSession(entry.author) }}</span
          >
        </p>
      </li>
    </ol>
    <DataEmptyState
      v-else
      :title="t('workItem.noActivity')"
      compact
    />

    <form
      v-if="writable"
      class="note-form"
      @submit.prevent="send"
    >
      <VTextInput
        v-model="note"
        :label="t('workItem.note')"
        :hint="t('workItem.noteHint')"
        :rows="3"
        :maxlength="8000"
      />
      <VButton
        class="note-action"
        type="submit"
        :disabled="!canSend"
      >
        {{ t('workItem.noteSend') }}
      </VButton>
    </form>
  </div>
</template>

<style scoped>
.activity {
  display: grid;
  gap: var(--space-5);
}

.feed {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  list-style: none;
}

/* A comment is the one entry a person wrote, so it is the one entry that gets a
   ground of its own; a lifecycle event is a line in a log. */
.entry {
  display: grid;
  gap: var(--space-hair);
  min-width: 0;

  &[data-kind='comment'] {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-sheet);
    border-radius: var(--radius-card);
  }
}

.entry-line {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: baseline;
}

.entry-title {
  color: var(--color-text);
  font: var(--font-strong);
}

.entry-at {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.entry-detail {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-line);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.entry-reference {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.entry-author {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.entry-session {
  font-variant-numeric: tabular-nums;
}

/* The field takes the column and the action does not: a note is a paragraph, and
   a button as wide as one reads as the form's own edge. */
.note-form {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-rule);

  .note-action {
    justify-self: start;
  }
}
</style>
