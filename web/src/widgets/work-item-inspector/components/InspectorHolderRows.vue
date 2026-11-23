<script setup lang="ts">
/**
 * Who is on an item, as the facts' rows: the holder's row with the card's one action, and the
 * row of the other sessions that follow it. They stand in the facts' block and share its
 * columns, each row drawing no box of its own (`InspectorFactRows.css`).
 *
 * The holder's words are bare, a way to the session where there is one: a plate of the same
 * weight as the chips above it made the row one more chip. The lease is a tooltip and, when
 * nobody is behind it any more, a warning dot: a detail of the holder, not a fact of its own.
 * The other sessions that follow the item are a row under it, each printed as its claim's
 * holder would be and kept whole on its line.
 *
 * A goal or a stage is held by nobody: its work is its tasks. Where the read says who works
 * on it, the row says «Работают: N» and names those sessions, each with the tasks it holds in
 * its hint, and the action's place says the goal is worked through its tasks.
 *
 * The action ends the holder's row where the drawer is wide and stands at full width under
 * everything else where it is not, within reach of a thumb. Its place is exposed: the host
 * shows the action again in the bar once this one has scrolled away.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import InspectorWriteActions from '@/widgets/work-item-inspector/components/InspectorWriteActions.vue'

import ExecutorLink from '@/features/session-open/ExecutorLink.vue'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import { holderRef } from '@/entities/work-item/utils/facets.ts'
import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { isWebAuthor } from '@/shared/api/webAuthor.ts'
import { actorSession, holderName, sessionStart } from '@/shared/lib/actor.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{
  busy: boolean
  item: WorkItem
  writable: boolean
}>()

const emit = defineEmits<{
  'claim': []
  'release': []
  'take-over': []
}>()

const { t, d } = useI18n()

/** The action's place on the card, which the bar takes over from once it has scrolled away. */
const actionCell = ref<HTMLElement | null>(null)

/**
 * Whether anyone is still behind another holder's claim, and until when.
 * Not on a finished item, whose holder is history, nor on this client's own
 * claim, which no session ever stands behind.
 */
const lease = computed(() => {
  const claim = props.item.claim
  return !props.item.open || !claim || isWebAuthor(claim.holder) ? null : claim
})
const leaseText = computed(() => {
  const claim = lease.value
  if (!claim) return ''
  let detail = t('workItem.lease.unconfirmedDetail')
  // A live lease with no date is one an open question to the owner holds: it names none.
  if (claim.state === 'live')
    detail = claim.expires_at
      ? t('workItem.lease.liveDetail', { date: when(claim.expires_at) })
      : ''
  else if (claim.state === 'stale') detail = t('workItem.lease.staleDetail')
  const state = t(`workItem.lease.${claim.state}`)
  const said = `${t('workItem.lease.label')}: ${state}`
  return detail ? `${said} — ${detail}` : said
})
const holder = computed(() => holderRef(props.item))
/** What the row calls its holder: who is on it, or on finished work who was. */
const holderLabel = computed(() =>
  props.item.open ? t('workItem.head.holder') : t('workItem.previousOwner'),
)
/**
 * A name's hint says what the line does not: the whole session id where the line prints its
 * start, never the name again. The name itself is said only while the line cuts it.
 */
function nameHint(raw: string, ...more: string[]) {
  const session = actorSession(raw)
  const whole = session === sessionStart(session) ? '' : session
  return { text: [whole, ...more].filter(Boolean).join('\n'), words: holderName(raw) }
}
/** The holder's hint: its whole session and the lease behind the claim. */
const holderHint = computed(() => nameHint(holder.value ?? '', leaseText.value))

/** The session behind the holder: its claim's, or on finished work its last claim's. */
const holderExecutor = computed(() =>
  props.item.open ? props.item.claim?.executor : props.item.last_claim_executor,
)

/**
 * Who works on a goal or a stage, as the read of the one item gives it; null on a task, and
 * where the read names nobody, whose row says what a goal's held-by row always said.
 */
const working = computed(() => {
  const given = props.item.participants
  return WORK_ITEM_TREE.isContainer(props.item) && given?.length ? given : null
})
/** The row is the holder's on a task, and says how many work on a goal that has any. */
const rowFact = computed(() => (working.value ? 'participants' : 'holder'))
const rowLabel = computed(() =>
  working.value ? t('workItem.facts.working', { count: working.value.length }) : holderLabel.value,
)
/** A participant's hint: its whole session, then the tasks it holds where it holds any. */
function participantHint(participant: NonNullable<WorkItem['participants']>[number]) {
  const holds = participant.holds.length
    ? t('workItem.facts.holds', { references: participant.holds.join(', ') })
    : ''
  return nameHint(participant.label, holds)
}

/** A name cut into its words, the dot kept with the word before it, a comma after all but the last. */
function namesOf(labels: string[]) {
  return labels.map((label, index) => {
    const comma = index < labels.length - 1 ? ',' : ''
    const words = `${holderName(label)}${comma}`
      .split(/ (?!·)/)
      .map((text, at) => ({ before: at ? ' ' : '', text }))
    return { label, words }
  })
}

/**
 * The sessions that follow the item, each by the label the server gives it, which is what a
 * claim of it records, printed as the holder is; the holder's row names its own. A name wider
 * than the line breaks only between its words.
 */
const followers = computed(() =>
  namesOf(
    (props.item.subscribers ?? [])
      .map(({ label }) => label)
      .filter((label) => label !== holder.value),
  ),
)
const participants = computed(() => {
  const all = working.value ?? []
  return namesOf(all.map(({ label }) => label)).map((name, at) => ({
    ...name,
    hint: participantHint(all[at]),
  }))
})

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}

defineExpose({ actionCell })
</script>

<template>
  <div
    class="card-row card-holder"
    :data-fact="rowFact"
  >
    <span class="card-row-label card-holder-label">{{ rowLabel }}</span>
    <p
      v-if="working"
      class="card-row-value card-holder-value card-working card-subscriber-list"
    >
      <span
        v-for="participant in participants"
        :key="participant.label"
        v-tooltip.detail="participant.hint"
        class="card-subscriber"
        data-participant
        ><template
          v-for="(word, at) in participant.words"
          :key="at"
          >{{ word.before }}<span class="card-subscriber-word">{{ word.text }}</span></template
        ></span
      >
    </p>
    <div
      v-else
      class="card-row-value card-holder-value"
    >
      <!-- A session's link says the holder in its own hint; a bare name carries it here. -->
      <ExecutorLink
        v-if="holderExecutor?.session"
        class="card-holder-link"
        :holder="holder"
        :executor="holderExecutor"
        :detail="leaseText"
      />
      <span
        v-else-if="holder"
        v-tooltip.detail="holderHint"
        class="card-holder-name one-line"
        >{{ holderName(holder) }}</span
      >
      <FacetMarks
        v-else
        surface="card"
        :item="item"
        :facets="['holder']"
      />
      <SemanticState
        v-if="lease?.state === 'stale'"
        class="card-holder-stale"
        dimension="claim-lease"
        state="stale"
        variant="dot"
        :label="t('workItem.lease.mark')"
      />
      <span
        v-if="leaseText"
        class="visually-hidden"
        >{{ leaseText }}</span
      >
    </div>
    <div
      v-if="writable"
      ref="actionCell"
      class="card-action"
    >
      <InspectorWriteActions
        :item="item"
        :busy="busy"
        @claim="emit('claim')"
        @release="emit('release')"
        @take-over="emit('take-over')"
      />
    </div>
  </div>
  <div
    v-if="followers.length"
    class="card-row card-subscribers"
    data-fact="subscribers"
  >
    <span class="card-row-label">{{ t('workItem.head.subscribers') }}</span>
    <p class="card-row-value card-subscriber-list">
      <span
        v-for="follower in followers"
        :key="follower.label"
        v-tooltip.detail="nameHint(follower.label)"
        class="card-subscriber"
        ><template
          v-for="(word, at) in follower.words"
          :key="at"
          >{{ word.before }}<span class="card-subscriber-word">{{ word.text }}</span></template
        ></span
      >
    </p>
  </div>
</template>

<style scoped src="./InspectorFactRows.css"></style>

<style scoped src="./InspectorHolderRows.css"></style>
