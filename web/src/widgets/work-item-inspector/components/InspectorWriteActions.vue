<script setup lang="ts">
/**
 * The one thing to do about an item from its head, or why there is nothing.
 *
 * Who holds the item decides it. Nobody: «Взять», unless the item is an epic,
 * whose work is its tasks, or waits on an open blocker — then the reason stands
 * where the action would, so the head never offers a take its own facts argue
 * against. This client: «Отпустить». Another holder: a takeover, and the host asks
 * once before the override is sent; release on someone else's claim was a button
 * the server refused on every press.
 *
 * A stale claim has nobody behind it, and the server releases it before it
 * takes the claim, so taking it over is an ordinary claim with no override to
 * confirm. A finished item offers nothing.
 *
 * A refusal of any of these is the host's to show, in the band that stays in
 * view while the card scrolls.
 *
 * It stands twice on a card, with the facts and in the bar once the facts have
 * scrolled away. The bar holds an action and no reason: a reason is a fact about
 * the item, and it goes with the facts.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { openBlockers } from '@/widgets/work-item-inspector/utils/openBlockers.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    busy: boolean
    item: WorkItem
    /** Whether a reason stands where there is no action to offer. */
    reasons?: boolean
  }>(),
  { reasons: true },
)

const emit = defineEmits<{
  'claim': []
  'release': []
  'take-over': []
}>()

const { t } = useI18n()

type Action = 'claim' | 'release' | 'takeover' | 'stale' | 'epic' | 'waiting'

/** The reference of an open item this one waits on, or null for none. */
const waitingOn = computed(() => openBlockers(props.item)[0]?.reference ?? null)

const action = computed<Action | null>(() => {
  const { item } = props
  if (item.state.is_terminal) return null
  if (item.claim_ref) {
    if (isWebAuthor(item.claim_ref)) return 'release'
    return item.claim_state === 'stale' ? 'stale' : 'takeover'
  }
  if (item.container) return 'epic'
  return waitingOn.value ? 'waiting' : 'claim'
})

const shown = computed(
  () =>
    action.value !== null &&
    (props.reasons || (action.value !== 'epic' && action.value !== 'waiting')),
)

/** A wait on a blocker carries the readiness facet's tone; an epic carries none. */
const WAITING_TONE = semanticStatePresentation({
  dimension: 'work-item-readiness',
  state: 'blocked',
}).tone
const waitingText = computed(() =>
  t('workItem.facet.waiting', { reference: waitingOn.value ?? '' }),
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
    <VButton
      v-else-if="action === 'takeover'"
      class="write-action"
      size="compact"
      :disabled="busy"
      @click="emit('take-over')"
    >
      {{ t('workItem.takeOver') }}
    </VButton>
    <VButton
      v-else-if="action === 'release'"
      class="write-action"
      size="compact"
      variant="secondary"
      :disabled="busy"
      @click="emit('release')"
    >
      {{ t('workItem.release') }}
    </VButton>
    <VButton
      v-else
      class="write-action"
      size="compact"
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
   where it ends the facts line or stands in the bar. */
.write-action {
  width: 100%;
}

/* As tall as the action it stands in for, so it lines up with the facts' first row. */
.write-reason {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-height-compact);
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
