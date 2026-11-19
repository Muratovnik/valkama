<script setup lang="ts">
/**
 * «Cancel goal»: everything open under a goal or a stage closes with it, so the window shows that
 * list before anything closes, and the press names how many cards it cancels.
 *
 * The list is the server's: the cancel's first call, sent as the window opens, is refused with
 * it and its token, and closes nothing. The press sends the same cancel with that token. When the
 * work under it changed in between, a task filed, a holder or a state changed, the server refuses
 * again with the new list: the window shows that one, marks the rows that are new or changed, and
 * asks again, the press naming the new count. Nothing closes until a list read in the window is
 * the one confirmed.
 *
 * Under the list stand the cards outside it that wait on one of it, linked to block it or put off
 * until it: they come back or are freed when it closes. A list that could not be read leaves the
 * press unavailable and offers to read it again.
 *
 * A close needs a summary, so every call carries the one the cancel writes (`cancelSummary`), and
 * the reason under the list is its `why` and the `why` of every card it closes: the press waits
 * for one. The first call carries none yet; it is refused before anything is written.
 */
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { cancelSummary } from '@/features/work-item-closing/cancelSummary.ts'
import { closingFailure } from '@/features/work-item-closing/closingFailure.ts'

import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import { CancelListError } from '@/shared/api/planningApi.ts'
import { cancelWorkItem } from '@/shared/api/planningClosingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
  open: boolean
  /** The workflow's key of the cancelled state it closes into. */
  state: string
  /** The reason already given, where a cancel asked in place opened the window. */
  given?: string
}>()
const emit = defineEmits<{ close: []; done: [] }>()
const { t } = useI18n()

type Row = CancelList['cancels'][number]
const list = ref<CancelList | null>(null)
/** Each row of the list read before this one, by reference, as its state and holders. */
const before = ref<Map<string, string> | null>(null)
const busy = ref(false)
const readFailed = ref('')
const failure = ref('')
const reason = ref('')
/** A missing reason is said once the press asked for it, and only while it is still missing. */
const asked = ref(false)
const error = computed(() =>
  asked.value && !reason.value.trim()
    ? t('workItem.closeActions.cancelGoal.reasonMissing')
    : failure.value,
)
const field = useTemplateRef<{ control: () => HTMLInputElement | null }>('field')

const said = (row: Row) =>
  JSON.stringify([row.state?.key ?? row.container_state, [...row.holder].sort()])

/** The first call: refused with the list, or, with nothing open under it, the cancel itself. */
async function send(cancels?: string) {
  busy.value = true
  failure.value = ''
  const why = reason.value.trim()
  try {
    await cancelWorkItem({
      id: props.item.reference,
      state: props.state,
      cancels,
      reason: why || undefined,
      summary: cancelSummary(props.item, why),
    })
    emit('done')
  } catch (error_) {
    if (error_ instanceof CancelListError) {
      if (cancels !== undefined && list.value)
        before.value = new Map(list.value.cancels.map((row) => [row.reference, said(row)]))
      list.value = error_.list
      readFailed.value = ''
    } else if (cancels === undefined) readFailed.value = closingFailure(error_)
    else failure.value = closingFailure(error_)
  } finally {
    busy.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    list.value = null
    before.value = null
    readFailed.value = ''
    failure.value = ''
    asked.value = false
    reason.value = props.given ?? ''
    if (open) void send()
  },
  { immediate: true },
)

/**
 * What a row's mark says: new to the list, changed since it was read, or nothing, and then the
 * row carries no mark at all.
 */
function change(row: Row): 'new' | 'changed' | undefined {
  const was = before.value?.get(row.reference)
  if (!before.value) return undefined
  if (was === undefined) return 'new'
  return was === said(row) ? undefined : 'changed'
}
const changed = computed(
  () =>
    before.value !== null &&
    (list.value?.cancels.some((row) => change(row) !== undefined) ?? false),
)

const stateName = useStateName()
const stateWord = (row: Row) => {
  if (row.state) return stateName(row.state)
  return row.container_state ? t(`workItem.containerState.${row.container_state}`) : ''
}
const stateMark = (row: Row) => row.state?.category ?? row.container_state ?? ''
const holders = (row: Row) =>
  row.holder.length
    ? t('workItem.closeActions.cancelGoal.holder', {
        holder: row.holder.map((holder) => holderName(holder)).join(', '),
      })
    : t('workItem.closeActions.cancelGoal.nobody')
const waits = (row: CancelList['dependents'][number]) =>
  t(
    row.how === 'deferred'
      ? 'workItem.closeActions.cancelGoal.waitsDeferred'
      : 'workItem.closeActions.cancelGoal.waitsOn',
    { reference: row.waits_on },
  )
const count = computed(() => list.value?.cancels.length ?? 0)
/** A stage's window says «stage» where a goal's says «goal». */
const stage = computed(() => props.item.kind === 'stage')
const title = computed(() =>
  t(`workItem.closeActions.cancelGoal.${stage.value ? 'titleStage' : 'title'}`),
)
const intro = computed(() =>
  t(`workItem.closeActions.cancelGoal.${stage.value ? 'introStage' : 'intro'}`),
)

function submit() {
  if (busy.value || !list.value) return
  if (!reason.value.trim()) {
    asked.value = true
    field.value?.control()?.focus()
    return
  }
  void send(list.value.list_token)
}
</script>

<template>
  <DialogFrame
    :open="open"
    :title="title"
    :context="`${item.reference} · ${item.title}`"
    :close-label="t('workItem.closeActions.cancelGoal.keep')"
    :busy="busy"
    :error="error"
    steady-scroll
    @close="emit('close')"
    @submit="submit"
  >
    <p
      v-if="changed"
      class="cancel-changed"
      role="alert"
    >
      <VIcon
        class="cancel-changed-glyph"
        name="alert"
        :size="16"
      />
      {{ t('workItem.closeActions.cancelGoal.changed') }}
    </p>
    <p
      v-if="!list && !readFailed"
      class="cancel-note"
    >
      {{ t('workItem.closeActions.cancelGoal.reading') }}
    </p>
    <div
      v-else-if="readFailed"
      class="cancel-failed"
    >
      <p class="cancel-note">
        {{ t('workItem.closeActions.cancelGoal.readFailed') }} {{ readFailed }}
      </p>
      <VButton @click="send()">{{ t('workItem.closeActions.cancelGoal.retry') }}</VButton>
    </div>
    <template v-if="list">
      <section class="cancel-part">
        <h3 class="cancel-heading">
          {{ intro }}
        </h3>
        <ul class="cancel-rows">
          <li
            v-for="row in list.cancels"
            :key="row.reference"
            class="cancel-row"
            :data-reference="row.reference"
            :data-change="change(row)"
          >
            <span class="cancel-reference">{{ row.reference }}</span>
            <span
              v-slash-breaks="row.title"
              class="cancel-title"
            />
            <span class="cancel-facts">
              <SemanticState
                dimension="work-item-state"
                :state="stateMark(row)"
                :label="stateWord(row)"
              />
              <span class="cancel-holder">{{ holders(row) }}</span>
              <span
                v-if="change(row)"
                class="cancel-mark"
                >{{ t(`workItem.closeActions.cancelGoal.${change(row)}Row`) }}</span
              >
            </span>
          </li>
        </ul>
      </section>
      <section
        v-if="list.dependents.length"
        class="cancel-part"
      >
        <h3 class="cancel-heading">{{ t('workItem.closeActions.cancelGoal.dependents') }}</h3>
        <ul class="cancel-rows">
          <li
            v-for="row in list.dependents"
            :key="`${row.reference}:${row.waits_on}`"
            class="cancel-row"
            :data-reference="row.reference"
          >
            <span class="cancel-reference">{{ row.reference }}</span>
            <span
              v-slash-breaks="row.title"
              class="cancel-title"
            />
            <span class="cancel-facts">{{ waits(row) }}</span>
          </li>
        </ul>
      </section>
      <VTextInput
        ref="field"
        v-model="reason"
        class="cancel-reason"
        :label="t('workItem.closeActions.cancelGoal.reason')"
        :rows="2"
        :maxlength="400"
        :disabled="busy"
      />
    </template>
    <template #footer>
      <VButton @click="emit('close')">{{ t('workItem.closeActions.cancelGoal.keep') }}</VButton>
      <VButton
        variant="danger"
        type="submit"
        :disabled="!list"
        >{{ t('workItem.closeActions.cancelGoal.confirm', { n: count }, count) }}</VButton
      >
    </template>
  </DialogFrame>
</template>

<style scoped>
.cancel-part {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.cancel-heading {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.cancel-rows {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* The number in a column of its own, the title beside it, and under the title where it stands
   and who holds it. */
.cancel-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-rule);
  font: var(--font-line);

  &[data-change] {
    background: var(--color-surface-muted);
  }
}

.cancel-reference {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.cancel-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.cancel-facts {
  display: flex;
  flex-wrap: wrap;
  grid-column: 2;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.cancel-mark,
.cancel-changed {
  color: var(--color-warning);
}

.cancel-changed {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  margin: 0;
  font: var(--font-detail);
}

.cancel-changed-glyph {
  flex: none;
}

.cancel-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.cancel-failed {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}
</style>
