<script setup lang="ts">
/**
 * The answers a change replaced, behind a press, newest first: what the agent was told
 * before, who said it and when. The answer in force stands above with its options; these
 * are the record of what stood, one line per field.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { versionLines } from '@/features/input-requests/utils/answerDisplay.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { plainText } from '@/shared/lib/richText.ts'
import VButton from '@/shared/ui/VButton.vue'

type Request = InputRequestEntry['request']

const props = defineProps<{ request: Request }>()
const { t, d } = useI18n()
const open = ref(false)
const versions = computed(() =>
  [...props.request.history].reverse().map((version) => ({
    ...version,
    lines: versionLines(props.request.fields, version, t),
    who: who(version),
    when: d(new Date(version.answered_at), 'activity'),
  })),
)
/** "You" is the server's word about the call, as in the answer in force. */
function who({ by_person: person, answered_by: by }: Request['history'][number]) {
  if (person) return t('requests.you')
  return by ? actorName(by) : ''
}
</script>

<template>
  <div class="request-history">
    <VButton
      class="request-history-toggle"
      variant="ghost"
      size="inline"
      :aria-expanded="open"
      @click="open = !open"
      >{{ t('requests.previous', { count: request.history.length }) }}</VButton
    >
    <ol
      v-if="open"
      class="request-history-list"
    >
      <li
        v-for="version in versions"
        :key="version.version"
        class="request-history-version"
      >
        <div class="request-history-meta">
          <span>{{ version.who }}</span>
          <span>{{ version.when }}</span>
        </div>
        <p
          v-for="line in version.lines"
          :key="line.id"
          class="request-history-line"
        >
          {{ line.text }}
        </p>
        <p
          v-if="version.note"
          class="request-history-line"
        >
          {{ t('requests.questionNoteSaid', { text: plainText(version.note) }) }}
        </p>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.request-history {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.request-history-toggle {
  justify-self: start;
}

.request-history-list {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

.request-history-version {
  display: grid;
  gap: var(--space-half);
  min-width: 0;
  padding-inline-start: var(--space-2);
  border-inline-start: 1px solid var(--color-rule-strong);
}

.request-history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.request-history-line {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  overflow-wrap: anywhere;
}
</style>
