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
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { closingRows } from '@/features/input-requests/utils/cancelRows.ts'

import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'

const props = defineProps<{ list: CancelList }>()
const { t } = useI18n()
const lead = ref<HTMLElement | null>(null)
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
    class="request-cancel-list"
    data-cancel-list
  >
    <p
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
/* Across the foot, over the answers it asks about again. */
.request-cancel-list {
  display: grid;
  flex: 1 1 100%;
  gap: var(--space-1);
  min-width: 0;
  overflow-wrap: anywhere;
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

.request-cancel-rows {
  display: grid;
  gap: var(--space-1);
  padding-inline-start: var(--space-5);
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
