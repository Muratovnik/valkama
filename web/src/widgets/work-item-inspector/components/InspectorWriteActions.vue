<script setup lang="ts">
/**
 * The one thing to do about an item from its head, or why there is nothing.
 *
 * Who holds the item decides it. Nobody: «Взять», unless the item is an epic,
 * whose work is its tasks, or waits on an open blocker — then the reason stands
 * where the action would, so the head never offers a take its own facts argue
 * against. This client: «Отпустить». Another holder: a takeover, asked once in
 * place before the override is sent; release on someone else's claim was a
 * button the server refused on every press.
 *
 * A stale claim has nobody behind it, and the server releases it before it
 * takes the claim, so taking it over is an ordinary claim with no override to
 * confirm. A finished item offers nothing.
 *
 * A refusal of any of these is the host's to show, in the head that stays in
 * view while the body scrolls.
 *
 * Condensed, that head keeps an action in reach and lets a reason go with the
 * facts: a reason is a fact about the item, and a sentence kept beside the
 * sections in a phone-wide head squeezed them to one.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  busy: boolean
  item: WorkItem
  /** The reference of an open item this one waits on, or null for none. */
  waitingOn: string | null
  /** The head is condensed while the body is read: a reason steps out, an action stays. */
  condensed?: boolean
}>()

const emit = defineEmits<{
  'claim': []
  'release': []
  'take-over': []
}>()

/** Whether the takeover question is open, so the host can give it the width. */
const asking = defineModel<boolean>('asking', { default: false })

const { t } = useI18n()

type Action = 'claim' | 'release' | 'takeover' | 'stale' | 'epic' | 'waiting'

const action = computed<Action | null>(() => {
  const { item } = props
  if (item.state.is_terminal) return null
  if (item.claim_ref) {
    if (isWebAuthor(item.claim_ref)) return 'release'
    return item.claim_state === 'stale' ? 'stale' : 'takeover'
  }
  if (item.container) return 'epic'
  return props.waitingOn ? 'waiting' : 'claim'
})

const shown = computed(
  () =>
    action.value !== null &&
    !(props.condensed && (action.value === 'epic' || action.value === 'waiting')),
)

const takeoverQuestion = computed(() =>
  t('workItem.takeOverQuestion', { holder: holderName(props.item.claim_ref) }),
)

function takeOver() {
  asking.value = false
  emit('take-over')
}

/** A wait on a blocker carries the readiness facet's tone; an epic carries none. */
const WAITING_TONE = semanticStatePresentation({
  dimension: 'work-item-readiness',
  state: 'blocked',
}).tone
const waitingText = computed(() =>
  t('workItem.facet.waiting', { reference: props.waitingOn ?? '' }),
)
/** A stale claim is taken as a plain claim, but it is still a takeover to the reader. */
const claimLabel = computed(() =>
  action.value === 'stale' ? t('workItem.lease.takeOver') : t('workItem.claim'),
)
</script>

<template>
  <div
    v-if="shown"
    class="write-actions"
  >
    <p
      v-if="action === 'waiting'"
      class="write-reason"
      :data-tone="WAITING_TONE"
    >
      <VIcon
        class="write-reason-glyph"
        name="waiting"
        :size="14"
        :stroke-width="2"
      />
      {{ waitingText }}
    </p>
    <p
      v-else-if="action === 'epic'"
      class="write-reason"
    >
      <VIcon
        class="write-reason-glyph"
        name="kind-epic"
        :size="14"
        :stroke-width="2"
      />
      {{ t('workItem.head.epic') }}
    </p>
    <ConfirmStrip
      v-else-if="asking"
      :message="takeoverQuestion"
      :confirm-label="t('workItem.takeOverConfirm')"
      :cancel-label="t('workItem.cancel')"
      @confirm="takeOver"
      @cancel="asking = false"
    />
    <VButton
      v-else-if="action === 'takeover'"
      class="write-action"
      :disabled="busy"
      @click="asking = true"
    >
      {{ t('workItem.takeOver') }}
    </VButton>
    <VButton
      v-else-if="action === 'release'"
      class="write-action"
      variant="secondary"
      :disabled="busy"
      @click="emit('release')"
    >
      {{ t('workItem.release') }}
    </VButton>
    <VButton
      v-else
      class="write-action"
      variant="primary"
      :disabled="busy"
      @click="emit('claim')"
    >
      {{ claimLabel }}
    </VButton>
  </div>
</template>

<style scoped>
.write-actions {
  display: grid;
  min-width: 0;
}

/* Full width where the head stacks it under the labels; its own label's width
   where it ends the facts line. */
.write-action {
  width: 100%;
}

.write-reason {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-inline);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.write-reason-glyph {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);

  .write-reason[data-tone='danger'] & {
    color: var(--color-danger);
  }
}
</style>
