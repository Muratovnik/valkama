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
 * at the foot: a task filed under it meanwhile is refused as work still open.
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { closingFailure } from '@/features/work-item-closing/closingFailure.ts'

import StepMark from '@/entities/work-item/components/StepMark.vue'

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

const ticked = ref(new Set<string>())
const busy = ref(false)
const error = ref('')
const hintId = useId()
const boxId = useId()

watch(
  () => props.open,
  (open) => {
    if (!open) return
    ticked.value = new Set(props.item.checklist.filter((step) => step.done).map((step) => step.id))
    error.value = ''
  },
  { immediate: true },
)

function toggle(id: string) {
  const next = new Set(ticked.value)
  if (!next.delete(id)) next.add(id)
  ticked.value = next
}
const unticked = computed(() => props.item.checklist.some((step) => !ticked.value.has(step.id)))
/** The press names the hint that says why it is unavailable, and nothing while it is not. */
const describedBy = computed(() => (unticked.value ? hintId : undefined))
const ticks = (id: string) => ticked.value.has(id)

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

async function submit() {
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
    error.value = closingFailure(error_)
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
    :close-label="t('workItem.closeActions.confirm.keep')"
    :busy="busy"
    :error="error"
    @close="emit('close')"
    @submit="submit"
  >
    <section
      v-if="item.checklist.length"
      class="confirm-part"
      data-part="conditions"
    >
      <h3 class="confirm-heading">{{ t('workItem.closeActions.confirm.conditions') }}</h3>
      <ul class="confirm-steps">
        <li
          v-for="step in item.checklist"
          :key="step.id"
          class="confirm-step"
        >
          <button
            :id="`${boxId}-${step.id}`"
            class="confirm-box"
            type="button"
            role="checkbox"
            :aria-checked="ticks(step.id)"
            :disabled="busy"
            @click="toggle(step.id)"
          >
            <StepMark :done="ticks(step.id)" />
          </button>
          <label
            class="confirm-step-text"
            :for="`${boxId}-${step.id}`"
            ><RichText
              :source="step.text"
              inline
          /></label>
        </li>
      </ul>
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
      v-if="closed.length"
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
    <template #footer>
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

.confirm-count,
.confirm-hint {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.confirm-hint {
  margin: 0;
}

.confirm-steps,
.confirm-closed {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  list-style: none;
}

.confirm-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
  font: var(--font-line);
}

/* The press around the card's own box (`StepMark`), at the box's size. */
.confirm-box {
  display: inline-grid;
  place-items: center;
  min-block-size: 0;
  padding: 0;
  margin-block-start: var(--space-half);
  border: 0;
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.confirm-step-text {
  min-width: 0;
  overflow-wrap: anywhere;
  cursor: pointer;
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
