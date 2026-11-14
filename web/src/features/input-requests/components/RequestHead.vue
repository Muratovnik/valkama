<script setup lang="ts">
/**
 * The head of a question. In the list of everything waiting it begins with whose task it is and
 * its title (`RequestHeader`), which stays in sight while the block scrolls; everywhere it says
 * who asked and when, and ends that line with what acts on the answer: the comment on the block
 * where no head that sticks carries it, or the change of an answer, beside the host's own icons
 * (`actions`). While a change is open its icon keeps its room unseen, so the time beside it does
 * not move.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestHeader from '@/features/input-requests/components/RequestHeader.vue'
import RequestNoteToggle from '@/features/input-requests/components/RequestNoteToggle.vue'
import type { QuestionRecord } from '@/features/input-requests/utils/questionRecord.ts'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { actorName, actorSession } from '@/shared/lib/actor.ts'
import EntryAction from '@/shared/ui/EntryAction.vue'
import EntryHead from '@/shared/ui/EntryHead.vue'
import MetaLine from '@/shared/ui/MetaLine.vue'

const props = defineProps<{
  /** The answer can be changed from here. */
  changeable: boolean
  /** The form of a change is open. */
  changing: boolean
  entry: InputRequestEntry
  /** The id of the line that says who asked, which names the question in a card's discussion. */
  metaId: string
  /** The press of the comment on the block, how it stands, and what it is on; null without one. */
  noteToggle: { disabled: boolean; name: string; open: boolean; written: boolean } | null
  project: QuestionRecord['project']
  space: QuestionRecord['space']
  standalone: boolean
  /** The id of the title, which names the question in the list. */
  titleId: string
}>()
const emit = defineEmits<{
  'change-answer': []
  'note': []
  'select': [target: PlanningTarget]
}>()
const { t, d } = useI18n()
const header = ref<InstanceType<typeof RequestHeader> | null>(null)
/** How much of the panel's top the head that sticks covers; none where no head sticks. */
const height = computed(() => header.value?.height ?? 0)
const request = computed(() => props.entry.request)
const asked = computed(() => d(new Date(request.value.created_at), 'activity'))
/** An agent asks, whatever name it signs with: this interface asks nothing. */
const authorName = computed(() => actorName(request.value.author))
const authorSession = computed(() => actorSession(request.value.author))
defineExpose({ height })
</script>

<template>
  <RequestHeader
    v-if="standalone"
    ref="header"
    :entry="entry"
    :project="project"
    :space="space"
    :title-id="titleId"
    @select="emit('select', $event)"
  >
    <template #actions>
      <!-- It reaches past its box rather than growing it: grown, it made the head that sticks
           a line taller on a phone, over a title of four lines there already. -->
      <RequestNoteToggle
        v-if="noteToggle"
        :disabled="noteToggle.disabled"
        :name="noteToggle.name"
        :open="noteToggle.open"
        :written="noteToggle.written"
        :title="t('requests.questionNote')"
        reach
        @press="emit('note')"
      />
    </template>
  </RequestHeader>
  <EntryHead>
    <MetaLine
      :id="metaId"
      class="request-meta"
      :when="asked"
      :session="authorSession"
      >{{ authorName }}</MetaLine
    >
    <template #actions>
      <RequestNoteToggle
        v-if="noteToggle && !standalone"
        :disabled="noteToggle.disabled"
        :name="noteToggle.name"
        :open="noteToggle.open"
        :written="noteToggle.written"
        :title="t('requests.questionNote')"
        @press="emit('note')"
      />
      <EntryAction
        v-else-if="changeable || changing"
        class="request-change"
        icon="edit"
        :class="{ 'is-away': changing }"
        :label="t('requests.changeAnswer')"
        @click="emit('change-answer')"
      />
      <slot name="actions" />
    </template>
  </EntryHead>
</template>

<style scoped>
.request-change.is-away {
  visibility: hidden;
}
</style>
