<script setup lang="ts">
/**
 * «Confirm close» of a goal or a stage nothing is open under any more: whoever confirms checks
 * what was done against its conditions of the whole, or against its description where it has
 * none, and sees what closed without being done and what left, each with its reason.
 *
 * Confirming completes it under the guards a task meets, so every condition must be ticked: the
 * conditions stand as boxes, those already done ticked, and «Confirm» is not available until
 * all are, the reason under them. A condition a former holder marked is ticked again by the
 * confirmation, which is what confirms it. A goal with no summary gets the one the owner's own
 * confirmation writes. A refused write keeps the window and the boxes as they are, its reason
 * at the foot.
 *
 * Work that opened under it while the window was open puts it back at work, and the server
 * refuses the close for that (`openedUnder`): the window then says so, naming the work where the
 * refusal names it (each `data-opened`, whole on its line), and that there is nothing to confirm.
 * Its one press closes the window, which then reads the goal again, as does any other way out of
 * it. No press offers to take it back to work: its state is what the work under it derives, and
 * no write does that.
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { openedUnder } from '@/features/work-item-closing/openedUnder.ts'

import StepChoices from '@/entities/work-item/components/StepChoices.vue'
import { writeFailure } from '@/entities/work-item/utils/writeFailure.ts'

import { confirmWorkItemClose } from '@/shared/api/planningClosingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import RichText from '@/shared/ui/RichText.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  item: WorkItem
  open: boolean
  /** The workflow's key of the completed state it closes into. */
  state: string
}>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()

/** The summary the owner's confirmation writes, for a goal or a stage that has none. */
const CONFIRMED = {
  done: 'Confirmed by the owner: all work under it is closed.',
  next: 'Nothing: the work under it is closed.',
}

const ticked = ref<ReadonlySet<string>>(new Set())
const busy = ref(false)
const error = ref('')
/** The work that opened under it, once the server refused the close for it; null before. */
const reopened = ref<string[] | null>(null)
const hintId = useId()

watch(
  () => props.open,
  (open) => {
    if (!open) return
    ticked.value = new Set(props.item.checklist.filter((step) => step.done).map((step) => step.id))
    error.value = ''
    reopened.value = null
  },
  { immediate: true },
)

const unticked = computed(() => props.item.checklist.some((step) => !ticked.value.has(step.id)))
/** The press names the hint that says why it is unavailable, and nothing while it is not. */
const describedBy = computed(() => (unticked.value ? hintId : undefined))

/** What closed under it without being done, each said with how it went and its reason. */
const closed = computed(() =>
  [
    ...(props.item.confirmation?.cancelled ?? []).map((entry) => ({ ...entry, how: 'cancelled' })),
    ...(props.item.confirmation?.moved_out ?? []).map((entry) => ({ ...entry, how: 'movedOut' })),
  ].map((entry) => {
    const how = t(`workItem.closeActions.confirm.${entry.how}`)
    return {
      reference: entry.reference,
      said: entry.reason
        ? t('workItem.closeActions.confirm.reason', { how, reason: entry.reason })
        : how,
    }
  }),
)

/** Where the references stand in the sentence that names them. */
const SLOT = '\u0000'
/**
 * What the window says once work opened under it, a goal's words or a stage's, cut around the
 * references it names: each stands whole on its line, never broken at its hyphen.
 */
const reopenedText = computed(() => {
  const opened = reopened.value ?? []
  const whose = props.item.kind === 'stage' ? 'stage' : 'goal'
  const said = opened.length
    ? t(`workItem.closeActions.confirm.reopened.${whose}`, { references: SLOT })
    : t(`workItem.closeActions.confirm.reopened.${whose}Unnamed`)
  const [before, after = ''] = said.split(SLOT)
  return {
    before,
    after,
    references: opened.map((reference, index) => ({ reference, separator: index ? ', ' : '' })),
  }
})

/** The frame's close says what it does: once the goal is at work again it only closes. */
const closeLabel = computed(() =>
  t(`workItem.closeActions.confirm.${reopened.value ? 'reopened.close' : 'keep'}`),
)
/** Any way out of the window once the goal is at work again lets the card read it again. */
const leave = () => (reopened.value ? emit('done') : emit('close'))

async function submit() {
  if (reopened.value) {
    emit('done')
    return
  }
  if (busy.value || unticked.value) return
  busy.value = true
  error.value = ''
  try {
    await confirmWorkItemClose({
      id: props.item.reference,
      state: props.state,
      ticks: props.item.checklist
        .filter((step) => !step.done || step.by_previous_holder)
        .map((step) => step.id),
      summary: props.item.summary ? undefined : CONFIRMED,
    })
    emit('done')
  } catch (error_) {
    reopened.value = openedUnder(error_, props.item.reference)
    if (!reopened.value) error.value = writeFailure(error_, t)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DialogFrame
    :open="open"
    :title="t('workItem.closeActions.confirm.title')"
    :context="`${item.reference} · ${item.title}`"
    :close-label="closeLabel"
    :busy="busy"
    :error="error"
    @close="leave"
    @submit="submit"
  >
    <p
      v-if="reopened"
      class="confirm-reopened"
      data-part="reopened"
      role="status"
    >
      {{ reopenedText.before
      }}<template
        v-for="entry in reopenedText.references"
        :key="entry.reference"
        >{{ entry.separator
        }}<span
          class="confirm-opened"
          :data-opened="entry.reference"
          >{{ entry.reference }}</span
        ></template
      >{{ reopenedText.after }}
    </p>
    <section
      v-else-if="item.checklist.length"
      class="confirm-part"
      data-part="conditions"
    >
      <h3 class="confirm-heading">{{ t('workItem.closeActions.confirm.conditions') }}</h3>
      <StepChoices
        v-model="ticked"
        :steps="item.checklist"
        :disabled="busy"
      />
      <p
        v-if="unticked"
        :id="hintId"
        class="confirm-hint"
      >
        {{ t('workItem.closeActions.confirm.unticked') }}
      </p>
    </section>
    <section
      v-else
      class="confirm-part"
      data-part="description"
    >
      <h3 class="confirm-heading">{{ t('workItem.closeActions.confirm.none') }}</h3>
      <RichText
        v-if="item.description"
        class="confirm-description"
        :source="item.description"
      />
    </section>
    <section
      v-if="closed.length && !reopened"
      class="confirm-part"
      data-part="closed"
    >
      <h3 class="confirm-heading">
        {{ t('workItem.closeActions.confirm.closed') }}
        <span class="confirm-count">{{ closed.length }}</span>
      </h3>
      <ul class="confirm-closed">
        <li
          v-for="entry in closed"
          :key="entry.reference"
          class="confirm-closed-row"
          :data-reference="entry.reference"
        >
          <span class="confirm-reference">{{ entry.reference }}</span>
          <span class="confirm-why">{{ entry.said }}</span>
        </li>
      </ul>
    </section>
    <template
      v-if="reopened"
      #footer
    >
      <VButton
        variant="primary"
        type="submit"
        >{{ t('workItem.closeActions.confirm.reopened.close') }}</VButton
      >
    </template>
    <template
      v-else
      #footer
    >
      <VButton @click="emit('close')">{{ t('workItem.closeActions.confirm.keep') }}</VButton>
      <VButton
        variant="primary"
        type="submit"
        :disabled="unticked"
        :aria-describedby="describedBy"
        >{{ t('workItem.closeActions.confirm.submit') }}</VButton
      >
    </template>
  </DialogFrame>
</template>

<style scoped>
.confirm-part {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.confirm-heading {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  margin: 0;
  color: var(--color-text);
  font: var(--font-section-title);
}

.confirm-reopened {
  margin: 0;
  color: var(--color-text);
  font: var(--font-note);
  overflow-wrap: anywhere;
}

.confirm-opened {
  white-space: nowrap;
}

.confirm-count,
.confirm-hint {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.confirm-hint {
  margin: 0;
}

.confirm-closed {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  list-style: none;
}

.confirm-closed-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-rule);
  font: var(--font-line);
}

.confirm-reference {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.confirm-why {
  min-width: 0;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}
</style>
