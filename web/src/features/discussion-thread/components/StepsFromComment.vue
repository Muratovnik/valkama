<script setup lang="ts">
/**
 * The points of an entry's lists, offered as steps of the item: a box for each, every one
 * ticked but a point that cannot be a step, which says why beside it — the item has the
 * step already, a point above says the same, or it is longer than a step can be.
 *
 * The item's steps are read again whenever the card is, so a point another write has made a
 * step since turns into one the item has, and the boxes ticked stay as they were: a refused
 * write keeps them for the next press. The count under the list is the checklist as it will
 * stand, against the server's limit, and the button stays off past it saying how many to
 * clear.
 *
 * Nothing chosen here is text anyone wrote, so Escape and Cancel close at once.
 */
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAskedCancel } from '@/features/discussion-thread/composables/useAskedCancel.ts'
import {
  MAX_STEP_TEXT,
  MAX_STEPS,
  standings,
} from '@/features/discussion-thread/utils/stepPoints.ts'
import type { ListPoint, PointStanding } from '@/features/discussion-thread/utils/stepPoints.ts'

import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  error: string
  pending: boolean
  points: readonly ListPoint[]
  /** The item's steps as last read. */
  steps: readonly { text: string }[]
}>()
const emit = defineEmits<{ cancel: []; refresh: []; submit: [points: string[]] }>()
const { t } = useI18n()

const id = useId()
const form = ref<HTMLFormElement | null>(null)
const rows = computed(() => standings(props.points, props.steps))
/** Ticked when the form opened, every point that could be a step then. */
const openable = () => rows.value.flatMap((row, index) => (row.bar === null ? [index] : []))
const ticked = ref(new Set(openable()))
const chosen = computed(() =>
  rows.value.flatMap((row, index) =>
    row.bar === null && ticked.value.has(index) ? [row.point.source] : [],
  ),
)
const total = computed(() => props.steps.length + chosen.value.length)
const over = computed(() => total.value - MAX_STEPS)
const countLine = computed(() =>
  over.value > 0
    ? t('commentSteps.over', { total: total.value, max: MAX_STEPS, n: over.value }, over.value)
    : t('commentSteps.total', { n: total.value, max: MAX_STEPS }, total.value),
)
const isOver = computed(() => over.value > 0)
const canSend = computed(() => chosen.value.length > 0 && !isOver.value)
const addLabel = computed(() => t('commentSteps.add', chosen.value.length))
const countId = `${id}-count`
const depth = (point: ListPoint) => String(Math.min(point.depth, 3))
const barred = (row: PointStanding) => row.bar !== null
const isTicked = (row: PointStanding, index: number) => !barred(row) && ticked.value.has(index)
const barId = (row: PointStanding, index: number) =>
  barred(row) ? `${id}-bar-${index}` : undefined
const barWords = (row: PointStanding) => t(`commentSteps.${row.bar}`, { max: MAX_STEP_TEXT })

function pick(index: number, change: Event) {
  const next = new Set(ticked.value)
  if ((change.target as HTMLInputElement).checked) next.add(index)
  else next.delete(index)
  ticked.value = next
}
function send() {
  if (!props.pending && canSend.value) emit('submit', chosen.value)
}
const { cancel } = useAskedCancel(
  form,
  () => true,
  () => emit('cancel'),
)

/** The first box that can be ticked, or the way out when none can. */
function focusFirst() {
  const box = form.value?.querySelector<HTMLElement>('input:not(:disabled)')
  ;(box ?? form.value?.querySelector<HTMLElement>('.steps-cancel'))?.focus()
}
onMounted(focusFirst)

// A write disables the boxes, which drops focus on the page; a refused one gives it back.
let hadFocus = false
watch(
  () => props.pending,
  (pending) => {
    if (pending) hadFocus = form.value?.contains(document.activeElement) ?? false
    else if (hadFocus)
      void nextTick(() => {
        if (document.activeElement === document.body) focusFirst()
      })
  },
  { flush: 'pre' },
)
</script>

<template>
  <form
    ref="form"
    class="steps-form"
    @submit.prevent="send"
  >
    <fieldset
      class="steps-points"
      :disabled="pending"
    >
      <legend class="steps-legend">{{ t('commentSteps.legend') }}</legend>
      <ul class="steps-list">
        <li
          v-for="(row, index) in rows"
          :key="index"
          class="steps-point"
          :data-depth="depth(row.point)"
        >
          <label class="steps-choice">
            <input
              class="steps-box"
              type="checkbox"
              :checked="isTicked(row, index)"
              :disabled="barred(row)"
              :aria-describedby="barId(row, index)"
              @change="pick(index, $event)"
            />
            <span class="steps-words">{{ row.point.words }}</span>
          </label>
          <span
            v-if="barred(row)"
            :id="barId(row, index)"
            class="steps-bar"
            >{{ barWords(row) }}</span
          >
        </li>
      </ul>
    </fieldset>
    <div class="steps-foot">
      <p
        :id="countId"
        class="steps-count"
        role="status"
      >
        <span
          v-if="isOver"
          class="steps-over"
          >{{ countLine }}</span
        >
        <template v-else>{{ countLine }}</template>
      </p>
      <div class="steps-actions">
        <VButton
          class="steps-cancel"
          variant="text"
          :disabled="pending"
          @click="cancel"
          >{{ t('threads.cancel') }}</VButton
        >
        <VButton
          type="submit"
          variant="primary"
          :disabled="pending || !canSend"
          :aria-describedby="countId"
          >{{ addLabel }}</VButton
        >
      </div>
    </div>
    <p
      v-if="error"
      class="steps-error"
      role="alert"
    >
      {{ error }}
      <VButton
        variant="ghost"
        size="inline"
        :disabled="pending"
        @click="emit('refresh')"
        >{{ t('workItem.refreshDraft') }}</VButton
      >
    </p>
  </form>
</template>

<style scoped>
/* A recess cut into the entry's sheet: the form belongs to the entry above it, and its
   ground says it is the entry's and not one more entry. */
.steps-form {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3);
  background: var(--color-surface-recess);
  border-radius: var(--radius-card);

  /* A forced palette clears the recess, and with it where the form ends. */
  @media (forced-colors: active) {
    outline: 1px solid;
    outline-offset: -1px;
  }
}

.steps-points {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

.steps-legend {
  padding: 0;
  margin-block-end: var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.steps-list {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

.steps-point {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-3);
  justify-content: space-between;
  align-items: baseline;
  min-width: 0;

  &[data-depth='1'] {
    padding-inline-start: var(--space-5);
  }

  &[data-depth='2'] {
    padding-inline-start: calc(var(--space-5) * 2);
  }

  &[data-depth='3'] {
    padding-inline-start: calc(var(--space-5) * 3);
  }
}

/* The label is the whole row up to its reason, so a press anywhere on the words ticks. */
.steps-choice {
  display: flex;
  flex: 1 1 12rem;
  gap: var(--space-2);
  align-items: baseline;
  min-width: 0;
  min-block-size: var(--size-control-inline);
  padding-block: var(--space-1);
  font: var(--font-line);
  cursor: pointer;

  &:has(.steps-box:disabled) {
    color: var(--color-text-disabled);
    cursor: default;
  }
}

.steps-box {
  flex: none;
  margin: 0;
}

.steps-words {
  min-width: 0;
  overflow-wrap: anywhere;
}

.steps-bar {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.steps-foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  justify-content: space-between;
  align-items: center;
}

.steps-count {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.steps-over {
  color: var(--color-danger);
}

/* At the form's end, on the count's line or on a line of its own under it, as every form's
   buttons stand; wrapped, `space-between` alone put them at the start. */
.steps-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-inline-start: auto;
}

.steps-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
