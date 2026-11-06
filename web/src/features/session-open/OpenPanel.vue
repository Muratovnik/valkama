<script setup lang="ts">
/**
 * The panel a press opens when one press cannot carry the opening out: why it does
 * not simply open, when there is a why, and each action in the order it must be
 * taken. A browser may refuse a second outside program until the person acts again,
 * and the app's next step comes only with its answer, so an action is offered once
 * the one before it has run and the list can grow as the answers come.
 *
 * Focus starts on the first action and moves to the next as it is reached, unless the person
 * has moved it themselves while the action ran (`grantFocus`); Escape and the way back to the
 * button that opened it are the overlay's.
 *
 * A session long silent may have crashed with its row still saying it runs, and only the
 * person can see whether its window is open. So the way to resume it stands apart from
 * the actions, after a warning, takes no focus, and runs on no press but its own: not on
 * a press that follows another under a pointer that has not moved.
 */
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import type { OpenAction, Outcome, Refusal } from '@/features/session-open/openPlan.ts'
import {
  actionWords,
  refusalWords,
  unfinishedWords,
  whereWords,
} from '@/features/session-open/placeWords.ts'

import type { PlanOpens } from '@/shared/api/openPlanModel.ts'
import { grantFocus } from '@/shared/lib/focusRight.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { agoWords, spanWordsOf } from '@/shared/lib/timeSpan.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import { isStrayPress } from '@/shared/ui/strayPress.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  actions: readonly OpenAction[]
  /** Whose session it is: the holder or the action the panel came from. */
  context: string
  notice: Refusal | null
  /** What only its own press may run. */
  offer: OpenAction | null
  /** Where the actions lead, when the plan has said. */
  opens: PlanOpens | null
}>()

const emit = defineEmits<{ close: []; finished: [outcome: Outcome] }>()

const { d, t } = useI18n()

const actions = shallowRef<readonly OpenAction[]>([...props.actions])
/** The one action that can be taken now; those before it can be taken again. */
const reached = ref(0)
const running = ref(false)
const note = ref('')
const list = useTemplateRef<HTMLElement>('list')

const isRunning = computed(() => props.notice?.reason === 'live-in-terminal')
const title = computed(() => t(isRunning.value ? 'open.panel.running' : 'session.open'))
const explanation = computed(() => (props.notice ? refusalWords(t, props.notice) : ''))
/** What the actions amount to where the session cannot simply be opened: a look at it. */
const look = computed(() =>
  isRunning.value && props.opens?.opened_in
    ? t('open.panel.look', { where: whereWords(t, props.opens) })
    : '',
)

/** The actions as the panel offers them: the next to take leads, what lies ahead waits. */
const steps = computed(() =>
  actions.value.map((action, index) => ({
    label: actionWords(t, action),
    variant: index === reached.value ? ('primary' as const) : ('secondary' as const),
    waiting: index > reached.value,
  })),
)

/**
 * How long the session has said nothing, read when the panel opens, and it holds still.
 * In the units the agents' rows on the same card use, so the two never disagree.
 */
const silence = computed(() => {
  const since = new Date(props.notice?.silent_since ?? '')
  if (Number.isNaN(since.valueOf())) return ''
  return t('open.panel.silent', {
    when: d(since, 'activity'),
    ago: agoWords(since.valueOf(), Date.now(), spanWordsOf(t)),
  })
})
const offerLabel = computed(() => {
  const kind = props.offer?.steps[0]?.kind
  return kind ? t(`open.panel.offer.${kind}`) : ''
})

function buttonAt(index: number): HTMLElement | null {
  return list.value?.querySelectorAll('button').item(index) ?? null
}

onMounted(async () => {
  await nextTick()
  buttonAt(0)?.focus()
})

/** The same explanation twice says nothing new; the step's own word goes on instead. */
function noteOf(outcome: Extract<Outcome, { status: 'next' | 'refused' }>): string {
  const repeats = outcome.status === 'next' && outcome.notice?.reason === props.notice?.reason
  return repeats ? t('open.outcome.next') : unfinishedWords(t, outcome)
}

async function runOffer(event: MouseEvent) {
  if (running.value || !props.offer || isStrayPress(event)) return
  running.value = true
  let outcome: Outcome
  try {
    outcome = await props.offer.run()
  } finally {
    running.value = false
  }
  if (outcome.status === 'opened' || outcome.status === 'copied') emit('finished', outcome)
  else note.value = unfinishedWords(t, outcome)
}

async function run(index: number) {
  const action = actions.value[index]
  if (running.value || index > reached.value || !action) return
  running.value = true
  const right = grantFocus()
  let outcome: Outcome
  try {
    outcome = await action.run()
  } finally {
    running.value = false
  }
  if (outcome.status === 'opened' || outcome.status === 'copied') {
    emit('finished', outcome)
    return
  }
  note.value = noteOf(outcome)
  if (outcome.status !== 'next') return
  if (!actions.value.includes(outcome.next)) actions.value = [...actions.value, outcome.next]
  reached.value = Math.max(reached.value, index + 1)
  await nextTick()
  right.take(() => moveFocus(buttonAt(reached.value)))
}
</script>

<template>
  <DialogFrame
    :open="true"
    :title="title"
    :context="context"
    :close-label="t('drawer.close')"
    :busy="running"
    @close="emit('close')"
  >
    <div class="open-panel">
      <p
        v-if="explanation"
        class="open-panel-why"
      >
        {{ explanation }}
      </p>
      <p
        v-if="silence"
        class="open-panel-why"
      >
        {{ silence }}
      </p>
      <p
        v-if="look"
        class="open-panel-look"
      >
        {{ look }}
      </p>
      <div
        v-if="steps.length"
        ref="list"
        class="open-panel-steps"
      >
        <VButton
          v-for="(step, index) in steps"
          :key="index"
          :variant="step.variant"
          :disabled="step.waiting"
          @click="run(index)"
        >
          {{ step.label }}
        </VButton>
      </div>
      <div
        v-if="offer"
        class="open-panel-offer"
      >
        <p class="open-panel-warning">
          <VIcon
            class="open-panel-warning-mark"
            name="alert"
            :size="16"
          />
          <span>{{ t('open.panel.twoWriters') }}</span>
        </p>
        <VButton
          class="open-panel-resume"
          @click="runOffer"
          >{{ offerLabel }}</VButton
        >
      </div>
      <p
        class="open-panel-note"
        role="status"
      >
        {{ note }}
      </p>
    </div>
  </DialogFrame>
</template>

<style scoped>
.open-panel {
  display: grid;
  gap: var(--space-heading-content);
}

.open-panel-why {
  margin: 0;
  color: var(--color-text);
  font: var(--font-note);
}

.open-panel-look {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.open-panel-steps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Apart from the way to look at it: air above, and a warning before anything can be pressed. */
.open-panel-offer {
  display: grid;
  gap: var(--space-2);
  margin-block-start: var(--space-3);
}

.open-panel-warning {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  margin: 0;
  color: var(--color-text);
  font: var(--font-note);
}

.open-panel-warning-mark {
  flex: none;
  margin-block-start: var(--space-half);
  color: var(--color-warning);
}

.open-panel-resume {
  justify-self: start;
  max-width: 100%;
  white-space: normal;
}

.open-panel-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);

  &:empty {
    display: none;
  }
}
</style>
