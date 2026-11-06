<script setup lang="ts">
/**
 * The foot of a question: what it can do (`RequestActions`), the asking before a change is
 * thrown away, and why the last write did not go through.
 *
 * A form answered row by row is long, so its foot stays in sight at the bottom edge of the
 * panel that scrolls it while any of the form is (`stuck`), with Send and the comment on the
 * question under the hand. Over it stands how many points are still undecided: the question
 * can be sent so, and the agent reads them as undecided, which is said before and not after.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestActions from '@/features/input-requests/components/RequestActions.vue'
import RequestNoteToggle from '@/features/input-requests/components/RequestNoteToggle.vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import ConfirmStrip from '@/shared/ui/ConfirmStrip.vue'

const props = withDefaults(
  defineProps<{
    /** Throwing away a change was asked, and the next word decides. */
    askingCancel: boolean
    busy: boolean
    changing: boolean
    declining: boolean
    disabled: boolean
    dismissable: boolean
    /** Why the last write did not go through; empty while nothing failed. */
    error: string
    /** The comment on the question can be opened from here, how it stands, and what it is on. */
    note: { disabled: boolean; open: boolean; written: boolean; title?: string } | null
    refreshable: boolean
    standalone: boolean
    /** The form is long enough to keep this in sight while it scrolls. */
    stuck: boolean
    /** Points of a review shown with no decision. */
    undecided: number
    waiting: boolean
    /** What the strip asks once a change is cancelled, where the change is not to an answer. */
    cancelMessage?: string
    /** Somebody waits on the answer, so it can be refused. */
    declinable?: boolean
    /** What the strip's way on says, where it discards something other than an answer. */
    discardWord?: string
    /** What Send says, where it sends something other than an answer. */
    sendWord?: string
  }>(),
  { cancelMessage: undefined, declinable: true, discardWord: undefined, sendWord: undefined },
)
const emit = defineEmits<{
  'discard': []
  'dismiss': []
  'keep': []
  'note': []
  'onward': []
  'open': []
  'refresh': []
  'way-out': []
}>()
const { t } = useI18n()
/** Which edge of the scrolling panel it keeps to, for what moves focus clear of it. */
const edge = computed(() => (props.stuck ? 'end' : undefined))
const actions = ref<InstanceType<typeof RequestActions> | null>(null)
const errorLine = ref<HTMLElement | null>(null)

defineExpose({
  focusError: () => moveFocus(errorLine.value),
  focusWayOut: () => actions.value?.focusWayOut(),
})
</script>

<template>
  <footer
    class="request-foot"
    :class="{ 'is-stuck': stuck }"
    :data-stuck-edge="edge"
  >
    <p
      v-if="undecided"
      class="request-undecided"
    >
      {{ t('requests.review.undecidedNote', { n: undecided }) }}
    </p>
    <ConfirmStrip
      v-if="askingCancel"
      class="request-confirm"
      tone="danger"
      :cancel-label="t('requests.keepChanging')"
      :confirm-label="discardWord ?? t('requests.discardChange')"
      :message="cancelMessage ?? t('requests.cancelAsked')"
      @cancel="emit('keep')"
      @confirm="emit('discard')"
    />
    <RequestActions
      v-show="!askingCancel"
      ref="actions"
      :busy="busy"
      :changing="changing"
      :declinable="declinable"
      :declining="declining"
      :disabled="disabled"
      :dismissable="dismissable"
      :refreshable="refreshable"
      :send-word="sendWord"
      :standalone="standalone"
      :waiting="waiting"
      @dismiss="emit('dismiss')"
      @onward="emit('onward')"
      @open="emit('open')"
      @refresh="emit('refresh')"
      @way-out="emit('way-out')"
    >
      <RequestNoteToggle
        v-if="note"
        :disabled="note.disabled"
        :open="note.open"
        :title="note.title ?? t('requests.questionNote')"
        :written="note.written"
        reach
        @press="emit('note')"
      />
    </RequestActions>
    <p
      v-if="error"
      ref="errorLine"
      class="request-error focus-landing"
      role="alert"
      tabindex="-1"
    >
      {{ error }}
    </p>
  </footer>
</template>

<style scoped>
/* What `RequestActions` asks lies against this, and takes no room in it unless a note is open. */
.request-foot {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
  container-type: inline-size;
}

/* At the panel's lower edge while the form above it scrolls, on the question's own ground, so
   that what passes under it is covered and not read through. Its padding is the gap the card
   keeps between its rows, carried with it. */
.request-foot.is-stuck {
  position: sticky;
  inset-block-end: 0;
  z-index: 1;
  padding-block: var(--space-2) var(--space-3);
  margin-block-end: calc(-1 * var(--space-3));
  background: var(--color-surface-sheet);

  /* A forced palette clears that ground, and with it the edge of what stays put. */
  @media (forced-colors: active) {
    outline: 1px solid CanvasText;
  }
}

.request-undecided {
  flex: 1 1 100%;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.request-confirm {
  flex: 1 1 100%;
}

.request-error {
  flex: 1 1 100%;
  min-width: 0;
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
