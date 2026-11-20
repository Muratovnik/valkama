<script setup lang="ts">
/**
 * The open work an answer would cancel that its question did not ask about, as the server's
 * refusal of that answer listed it: what closes, with who holds it, and what outside waits on it.
 * It stands over the answers, whose asking stands again, and confirming that asking sends the
 * answer with this list's token.
 *
 * Its first line says what happened and is where focus lands after the refusal (`focus`); the
 * root carries `data-cancel-list`, and each of its lists its part (`data-cancel-part`, `closes` and
 * `waiting`), the hooks a check selects them by. What a row waits on stands on one line, its
 * reference never split at its hyphen (`data-cancel-waits`): on a phone «ждёт MAIN-» stood over «314».
 *
 * A long list is held to the room its question's asking leaves it over the answers (`data-step-room`,
 * `useStepAttention`), and the rest scrolls inside it, so its first line and the answers both stay
 * in view. While it scrolls, its scroll stops at its ends and does not carry on to the panel, which
 * would move the answers and end the asking; one that fits passes a wheel on to the panel. While it scrolls it is a stop of the keyboard, named by its first
 * line; with focus on that line the keys scroll it too.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver } from '@vueuse/core'

import { closingRows } from '@/features/input-requests/utils/cancelRows.ts'

import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'

const props = defineProps<{ list: CancelList }>()
const { t } = useI18n()
const lead = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const leadId = useId()
/** Whether it holds more than its room shows. */
const scrolls = ref(false)
useResizeObserver(root, () => {
  scrolls.value = Boolean(root.value && root.value.scrollHeight > root.value.clientHeight)
})
/** While it scrolls, a group named by its first line, and a stop of the keyboard. */
const stopRole = computed(() => (scrolls.value ? 'group' : undefined))
const stopName = computed(() => (scrolls.value ? leadId : undefined))
const stopIndex = computed(() => (scrolls.value ? 0 : undefined))
/** A row: its item's reference, the rest of its words, and what it waits on where it does. */
type Row = [reference: string, rest: string, waits?: string]
/** What closes, and under its own heading what waits on it, where anything does. */
const groups = computed((): { heading: string; name: string; rows: Row[] }[] => {
  const waiting = props.list.dependents.map((one): Row => [
    one.reference,
    `${one.title} ·`,
    t('requests.kinds.waitsOn', { reference: one.waits_on }),
  ])
  return [
    {
      name: 'closes',
      heading: '',
      rows: closingRows(props.list.cancels, t('requests.kinds.nobody')),
    },
    { name: 'waiting', heading: t('requests.kinds.dependents'), rows: waiting },
  ].filter(({ rows }) => rows.length)
})
defineExpose({ focus: () => moveFocus(lead.value) })
</script>

<template>
  <div
    ref="root"
    class="request-cancel-list"
    :role="stopRole"
    :aria-labelledby="stopName"
    :tabindex="stopIndex"
    data-cancel-list
    data-step-room
  >
    <p
      :id="leadId"
      ref="lead"
      class="request-cancel-lead focus-landing"
      role="alert"
      tabindex="-1"
    >
      {{ t('requests.kinds.listed') }}
    </p>
    <template
      v-for="group in groups"
      :key="group.name"
    >
      <p
        v-if="group.heading"
        class="request-cancel-label"
      >
        {{ group.heading }}
      </p>
      <ul
        class="request-cancel-rows"
        :data-cancel-part="group.name"
      >
        <li
          v-for="([reference, rest, waits], index) in group.rows"
          :key="index"
        >
          <span class="request-cancel-ref">{{ reference }}</span> {{ rest }}
          <span
            v-if="waits"
            class="request-cancel-waits"
            data-cancel-waits
            >{{ waits }}</span
          >
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
/* Across the foot, over the answers it asks about again; past the room the asking leaves it
   (`--step-room`, none until it asks), the rest scrolls inside it and stops at its ends. */
.request-cancel-list {
  --step-room: none;

  display: grid;
  flex: 1 1 100%;
  gap: var(--space-1);
  align-content: start;
  min-width: 0;
  max-block-size: var(--step-room);
  overflow-wrap: anywhere;
  overflow-y: auto;
}

/* Only while it scrolls, which is while it is a stop of the keyboard: a list that fits passes a
   wheel on to the panel, as a reader expects. */
.request-cancel-list[tabindex] {
  overscroll-behavior: contain;
}

.request-cancel-lead {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.request-cancel-label {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* A list with no marks stands on the column's edge, under the line over it, as the base rule
   sets every list: indented, what closes and what waits on it started 20px in from it. */
.request-cancel-rows {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.request-cancel-waits {
  white-space: nowrap;
}

.request-cancel-ref {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
