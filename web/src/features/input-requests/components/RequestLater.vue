<script setup lang="ts">
/**
 * What the answer that puts a question off opens in place: when to come back to it, a day, a count
 * of new comments, both, or the close of a card, and the press that puts it off.
 *
 * They are one choice (`UntilChoice`), the card found among the open cards of the question's
 * space.
 *
 * Put off is not available until a day, a count or a card is chosen, and not for a day already
 * gone or a count that is no whole number from 1 to 999; the reason stands under it, where the
 * press would have been read. What is chosen is part of what the form holds, so it stays while the
 * question is open, and is said as unsent if the question closes some other way.
 *
 * The press stands under the fields whether a reason stands or not, and the reason holds the room
 * of each it can come to say (`UntilReason`), so a value becoming valid moves nothing. With the
 * press beside the fields once the reason went, the fields gave it their width and the card's
 * field, beside the day and the count until then, went under them; and what stood under the press
 * rose.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import UntilChoice, { untilProblem } from '@/entities/work-item/components/UntilChoice.vue'
import UntilReason from '@/entities/work-item/components/UntilReason.vue'

import { localDay } from '@/shared/api/analyticsAddress.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The write it started is out: the press keeps focus and takes no second press. */
  busy: boolean
  /** Nothing here can be written now. */
  disabled: boolean
  /** The question put off, in whose space the card is found. */
  entry: InputRequestEntry
  /** The id the answer that opened it names as what it controls. */
  panelId: string
  /** The day, the count, both, or the card's number chosen, as the field holds it; else empty. */
  value: string
  /** Why the answer that opened it cannot be sent now, which keeps the press unavailable too. */
  blocked?: string
}>()
const emit = defineEmits<{ 'put-off': []; 'update:value': [value: string] }>()
const { t } = useI18n()
const reasonId = useId()
const root = ref<HTMLElement | null>(null)
/** The first day it can be put off to, as the calendar names it. */
const today = localDay(new Date())
const scope = computed(() => ({
  own: props.entry.request.work_item_id,
  space: props.entry.target.space_ref,
}))
/** Why it cannot be put off yet; empty once it can. */
const reason = computed(() => {
  if (props.blocked) return props.blocked
  const problem = untilProblem(props.value, today)
  return problem ? t(problem) : ''
})
/** The answer's own reason, whose room the one shown holds too while it is given. */
const blockedRoom = computed(() => (props.blocked ? [props.blocked] : []))
const busyMark = computed(() => props.busy || undefined)
const pressDisabled = computed(() => props.disabled || reason.value !== '')
const reasonRef = computed(() => (reason.value ? reasonId : undefined))
const fieldsDisabled = computed(() => props.disabled || props.busy)

defineExpose({
  takeFocus: () => root.value?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true }),
})
</script>

<template>
  <div
    :id="panelId"
    ref="root"
    class="request-later"
    role="group"
    :aria-label="t('requests.record.laterName')"
  >
    <UntilChoice
      layout="line"
      :value="value"
      :scope="scope"
      :today="today"
      :disabled="fieldsDisabled"
      @update:value="(chosen) => emit('update:value', chosen)"
    />
    <div class="request-later-press">
      <VButton
        variant="primary"
        :aria-describedby="reasonRef"
        :aria-disabled="busyMark"
        :disabled="pressDisabled"
        @click="emit('put-off')"
        >{{ t('requests.record.putOff') }}</VButton
      >
      <UntilReason
        :id="reasonId"
        :reason="reason"
        :also="blockedRoom"
      />
    </div>
  </div>
</template>

<style scoped>
/* The day, the count and the card on their line, and the press under them. */
.request-later {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
}

.request-later-press {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
  min-width: 0;
}
</style>
