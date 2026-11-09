<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorDescription from '@/widgets/work-item-inspector/components/InspectorDescription.vue'
import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import InspectorSummary from '@/widgets/work-item-inspector/components/InspectorSummary.vue'
import { provideCardSteps } from '@/widgets/work-item-inspector/utils/entrySteps.ts'
import { checklistProgress } from '@/widgets/work-item-inspector/utils/inspectorActivity.ts'
import { openBlockers } from '@/widgets/work-item-inspector/utils/openBlockers.ts'
import type { StateMove } from '@/widgets/work-item-inspector/utils/useInspectorWrites.ts'

import { useItemQuestions } from '@/features/input-requests/composables/useItemQuestions.ts'
import ExecutorLink from '@/features/session-open/ExecutorLink.vue'

import { uploadImage } from '@/shared/api/imageApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { plainText } from '@/shared/lib/richText.ts'
import { semanticStatePresentation, statePresentation } from '@/shared/lib/uiSystem.ts'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { provideEditorImages } from '@/shared/ui/useEditorImages.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  item: WorkItem
  writable: boolean
  target?: PlanningTarget
}>()

const emit = defineEmits<{
  'changed': []
  /** What was pressed is about to go, and focus must not go with it. */
  'hold-focus': []
  'refresh': []
  /** The move the outcome was asked for, now that it has one. */
  'resume': [stateKey: string]
  'tick': [itemId: string, done: boolean]
}>()

const { t } = useI18n()
/**
 * The card's questions, read again whenever its record is: the stream's news of a
 * change reaches them the way it reaches a comment.
 */
const questions = useItemQuestions(
  () => props.target,
  () => props.item,
)
const asking = defineModel<boolean>('asking', { default: false })
watch(questions.waiting, (now) => (asking.value = now), { immediate: true })
/** What was read, for the card's history to name a question by: no read of its own. */
const read = defineModel<readonly InputRequestEntry[]>('questions', { default: () => [] })
watch(questions.entries, (now) => (read.value = now), { immediate: true })
const questionEntries = questions.entries
const questionsUnread = questions.unread
const questionsCut = questions.cut
/** The Refresh pressed goes with the failure it answers. */
function readQuestions() {
  emit('hold-focus')
  void questions.refresh()
}
function answered(entry: InputRequestEntry) {
  questions.changed(entry)
  emit('changed')
}
const discussion = ref<InstanceType<typeof InspectorDiscussion> | null>(null)
const checklistSection = ref<HTMLElement | null>(null)
const checklistHead = ref<InstanceType<typeof SectionHeader> | null>(null)
function discussStep(stepId: string) {
  void discussion.value?.discussStep(stepId)
}

/** What a closing guard asks for: the item's outcome, before this move can go on. */
function askOutcome(move: StateMove) {
  return discussion.value?.askOutcome(move)
}

/**
 * After the flush: pressed from another section, Overview has not been shown yet. Focus
 * goes with the view, to the heading of the list, ringed when a key pressed (`moveFocus`):
 * what was pressed stays far above, and the next Tab should start from the list.
 */
async function revealChecklist() {
  await nextTick()
  checklistSection.value?.scrollIntoView({ block: 'start' })
  moveFocus(checklistHead.value?.$el as HTMLElement | undefined, { preventScroll: true })
}
provideCardSteps({
  item: () => props.item,
  refresh: () => emit('refresh'),
  reveal: () => void revealChecklist(),
})
// A picture pasted into any text of this card — its description, a comment, a reply, an
// answer — is kept for this item, and goes when the item does.
provideEditorImages((file, signal) => uploadImage(props.item.work_item_id, file, signal))

// A closed item is neither blocked nor waiting on a next step: both read as
// live instructions, and on a Done card they were stale ones.
const blockers = computed(() => openBlockers(props.item))
const nextStep = computed(() =>
  props.item.state.is_terminal ? undefined : props.item.checklist.find((step) => !step.done),
)
const steps = computed(() => checklistProgress(props.item))
const stepCount = computed(() =>
  steps.value.total ? t('workItem.checklistProgress', steps.value) : '',
)
/** Where the next step stands in the list; the only step stands nowhere in particular. */
const nextStepPlace = computed(() => {
  const { checklist } = props.item
  if (!nextStep.value || checklist.length < 2) return ''
  return t('workItem.nextStep.place', {
    at: checklist.indexOf(nextStep.value) + 1,
    total: checklist.length,
  })
})
function stepState(done: boolean) {
  return done ? 'done' : 'open'
}
/** The step's box, which its text labels; one card is open at a time, its ids its own. */
const checklistId = useId()
const stepBox = (stepId: string) => `${checklistId}-${stepId}`
/** Who a step names: its holder while it is open, whoever did it once it is done. */
const stepHolder = (step: WorkItem['checklist'][number]) =>
  step.done ? step.done_by : step.claimed_by
const stepHolderKey = (step: WorkItem['checklist'][number]) =>
  step.done ? 'workItem.stepDoneBy' : 'workItem.stepHeldBy'
/** A blocker as the facet registry words a wait: «Ждёт MAIN-12», then what it is. */
const blockerTone = semanticStatePresentation({
  dimension: 'work-item-readiness',
  state: 'blocked',
}).tone

/** After the flush: pressed from another section, Overview has not been shown yet. */
async function revealQuestion() {
  await nextTick()
  discussion.value?.revealQuestion()
}

defineExpose({ askOutcome, readQuestions: questions.readNow, revealChecklist, revealQuestion })
</script>

<template>
  <div class="overview">
    <ul
      v-if="blockers.length"
      class="blockers"
    >
      <li
        v-for="link in blockers"
        :key="link.reference"
        class="blocker"
      >
        <VIcon
          class="blocker-glyph"
          name="waiting"
          :data-tone="blockerTone"
          :size="14"
          :stroke-width="2"
        />
        <RichText
          class="blocker-text"
          :source="`${t('workItem.facet.waiting', { reference: link.reference })} — ${link.title}`"
          inline
        />
      </li>
    </ul>
    <!-- A line and the step's words, with no heading of its own: it answers the question
         the card is opened with, and a heading stood over one sentence. -->
    <div
      v-if="nextStep"
      class="next-step"
    >
      <div class="next-step-line">
        <p class="next-step-label">
          {{ t('workItem.nextStep.label') }}
          <template v-if="nextStepPlace">
            <span aria-hidden="true">·</span>
            {{ nextStepPlace }}
          </template>
        </p>
        <VButton
          v-if="nextStepPlace"
          class="next-step-all"
          variant="text"
          size="inline"
          @click="revealChecklist"
        >
          {{ t('workItem.nextStep.all') }}
          <VIcon
            name="arrow-down"
            :size="14"
          />
        </VButton>
      </div>
      <p class="next-step-text">
        <RichText
          :source="nextStep.text"
          inline
        />
      </p>
    </div>

    <InspectorDescription
      :item="item"
      :writable="writable"
      @changed="emit('changed')"
      @refresh="emit('refresh')"
    />

    <!-- Absent while there is no step: no action here adds one, so a heading and a
         sentence saying so held the first screen for nothing. -->
    <section
      v-if="item.checklist.length"
      ref="checklistSection"
      class="overview-section"
    >
      <SectionHeader
        ref="checklistHead"
        class="checklist-head focus-landing"
        tabindex="-1"
        :title="t('workItem.checklist')"
        :count="stepCount"
      />
      <ul class="checklist">
        <!-- The step, its one action at the row's end, and who holds or closed
             it directly under the step's own text. The action used to be a full
             button on a row of its own, so each holder line sat closer to the
             next step than to the one it described. Where a pointer can hover,
             the action comes up under it and the keyboard (`reveal.css`). -->
        <li
          v-for="step in item.checklist"
          :key="step.id"
          class="step-row reveal-row"
        >
          <!-- A checkbox, not a toggle button: a step is done or not done, and
               `aria-pressed` would announce it as a control that stays in.
               The step's text is its label rather than part of the button, so a
               reference in it is a link of its own; a press on the text ticks
               the step as a press on the box does, and a press on a link in it
               follows the link. -->
          <button
            :id="stepBox(step.id)"
            class="step"
            type="button"
            role="checkbox"
            :class="{ done: step.done }"
            :data-tone="statePresentation('checklist-step', stepState(step.done)).tone"
            :disabled="!writable"
            :aria-checked="step.done"
            @click="emit('tick', step.id, !step.done)"
          >
            <span
              class="step-mark"
              aria-hidden="true"
            >
              <VIcon
                v-if="step.done"
                name="check"
                :size="13"
              />
            </span>
          </button>
          <label
            class="step-text"
            :class="{ done: step.done, writable }"
            :for="stepBox(step.id)"
            ><RichText
              :source="step.text"
              inline
          /></label>
          <VButton
            v-if="writable"
            v-tooltip.name="t('checklistComment.discuss')"
            class="step-discuss reveal"
            variant="ghost"
            size="inline"
            :aria-label="t('checklistComment.discussStep', { step: plainText(step.text) })"
            icon
            @click="discussStep(step.id)"
          >
            <VIcon
              name="message-square"
              :size="16"
            />
          </VButton>
          <span
            v-if="stepHolder(step)"
            class="step-holder"
            >{{ t(stepHolderKey(step))
            }}<span
              class="step-holder-dot"
              aria-hidden="true"
              >·</span
            ><ExecutorLink
              :holder="stepHolder(step)"
              :executor="step.executor"
          /></span>
        </li>
      </ul>
    </section>

    <InspectorSummary :item="item" />
    <InspectorDiscussion
      ref="discussion"
      :item="item"
      :questions="questionEntries"
      :questions-cut="questionsCut"
      :questions-unread="questionsUnread"
      :writable="writable"
      @answered="answered"
      @read-questions="readQuestions"
      @changed="emit('changed')"
      @refresh="emit('refresh')"
      @resume="(stateKey) => emit('resume', stateKey)"
    />
  </div>
</template>

<style scoped src="./InspectorOverview.css"></style>

<style scoped src="@/shared/ui/reveal.css"></style>
