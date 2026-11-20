<script setup lang="ts">
/**
 * The questions of one scope, with the state of reading them.
 *
 * Refresh stands on the same line as the sentence that says what it would
 * refresh — the count, the failure, or that there is nothing — or inside the
 * empty state when there is nothing at all. It used to stand alone on a row of
 * its own above that sentence, a button with nothing beside it to act on.
 *
 * Answering or declining a question removes the buttons that were focused, and
 * focus used to fall to the page under the dialog. The list moves it on: to the
 * next open question, or, with none left, to how the one just answered ended.
 * It went to the count line at the top once, which scrolled a long list away
 * from the card the reader was in. It moves on only from the question focus is
 * in: a reader who went elsewhere while the answer was out stays there, as the
 * question itself leaves them (`grantFocus`), and a reader who moved it to another control of the
 * same question while the answer was out stays on that control.
 *
 * A refresh the reader asked for that fails puts focus on the sentence saying
 * so, unless they have moved focus since they asked; one the poll started leaves
 * focus where it is.
 *
 * A question that stopped waiting can be removed from here. Focus goes to the question
 * after it, or the one before, and with none left to the way to read the list again.
 *
 * What stopped waiting and was put aside (`answered`) stands folded under «Answered (N)» after
 * the rest, and opens in place. What waits carries its identity as `data-request-waiting`, which
 * is what the way through the list in the dialog's head counts and goes to.
 *
 * Where the list is told to (`recommendAll`), it offers to accept what is recommended in all its
 * blocks that wait (`RequestRecommendedAll`), and each of them is filled and written by its own
 * record, under no right to move focus: the reader stays on that action.
 *
 * Each question is the record of its kind (`kindRecord`): a choice of options, answered by its
 * form, or a kind its server purpose names, which shows its own content (`RequestKindSubject`)
 * and is answered by its kind's buttons, which say what they send over what the form holds: the
 * answer that takes a group of findings on names how many go once some are unticked
 * (`answersOver`). Where the list holds questions of more than one kind,
 * tabs over it (`useKindTabs`) show all of them or one kind's; the list holds only the questions
 * of the tab shown, so the way through the list in the dialog's head counts that tab's, and focus
 * moves on within it.
 *
 * Over the questions of «All» and of the triage tab stands the line of each space whose stack
 * waits for a triage review past its thresholds (`RequestTriageDue`), as the read carries it. It is
 * a line of the window and no question: nothing answers it, and focus never moves on to it. Its
 * «Show findings» asks for that space's board (`open`), which the shell opens over the window.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import RequestKindSubject from '@/features/input-requests/components/RequestKindSubject.vue'
import RequestListNotes from '@/features/input-requests/components/RequestListNotes.vue'
import RequestRecommendedAll from '@/features/input-requests/components/RequestRecommendedAll.vue'
import RequestTriageDue from '@/features/input-requests/components/RequestTriageDue.vue'
import { useKindTabs } from '@/features/input-requests/composables/useKindTabs.ts'
import type { Outcome } from '@/features/input-requests/composables/useRequestWrites.ts'
import { useUnderReader } from '@/features/input-requests/composables/useUnderReader.ts'
import { holdsDraft } from '@/features/input-requests/utils/answerChange.ts'
import { kindRecord } from '@/features/input-requests/utils/questionKinds.ts'
import { answersOver } from '@/features/input-requests/utils/questionRecord.ts'
import type {
  QuestionRecord,
  RecommendedAnswer,
} from '@/features/input-requests/utils/questionRecord.ts'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry, InputRequestList } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { grantFocus, NO_FOCUS_RIGHT } from '@/shared/lib/focusRight.ts'
import type { FocusRight } from '@/shared/lib/focusRight.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import { useTabIds } from '@/shared/ui/tabIds.ts'
import TabPanel from '@/shared/ui/TabPanel.vue'
import TabStrip from '@/shared/ui/TabStrip.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VDisclosure from '@/shared/ui/VDisclosure.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /** What stopped waiting and was put aside, folded after the rest. */
    answered: InputRequestEntry[]
    drafts: Record<string, RequestDraft>
    /** What stands in its place: what waits, and what stopped waiting while it was read. */
    entries: InputRequestEntry[]
    failed: boolean
    loading: boolean
    partial: boolean
    result: InputRequestList | null
    /** The identities of the questions still waiting. */
    waiting: ReadonlySet<string>
    /** It offers to accept what is recommended in all the blocks that wait. */
    recommendAll?: boolean
  }>(),
  { recommendAll: false },
)
const emit = defineEmits<{
  dismiss: [entry: InputRequestEntry]
  draft: [key: string, value: RequestDraft]
  open: [route: PlatformRoute]
  refresh: []
  select: [target: PlanningTarget]
  updated: [entry: InputRequestEntry]
}>()
const { t } = useI18n()
const busyMark = computed(() => props.loading || undefined)
// A poll runs every half minute. Once there is an answer it stays on screen
// while the next one is read, so neither the empty message nor a "checking"
// line blinks in and out of the layout on every poll; `aria-busy` says it.
const all = computed(() => [...props.entries, ...props.answered])
const empty = computed(() => Boolean(props.result) && !props.failed && !all.value.length)
const emptyLabel = computed(() => {
  return t(props.partial ? 'requests.partialEmpty' : 'requests.empty')
})
/**
 * The questions still waiting, which the rail's badge and the head's count say too. Answered
 * ones stay on screen with their outcome, so counting the cards said 2 beside a rail's 1.
 */
const waiting = computed(() => props.waiting.size)
/** The same condition the rail's count carries as its plus: a source or a page was not read. */
const incomplete = computed(() => props.partial || Boolean(props.result?.has_more))
/** Whether a question here holds anything typed or chosen that a failed read must not cost. */
const drafted = computed(() =>
  props.entries.some((entry) => holdsDraft(entry.request, props.drafts[requestIdentity(entry)])),
)
/**
 * The first read, said as every wait is (`loadingPresence`): nothing for a read that
 * answers quickly, and once said, long enough to be read, with what it found held back
 * meanwhile. A poll with an answer on screen is no wait.
 */
const { shown: firstShown, held: firstHeld } = useLoadingPresence(
  () => props.loading && !props.result,
)
/** What the refresh beside it would change: the first read, its failure, or the count. */
const statusText = computed(() => {
  if (firstHeld.value) return firstShown.value ? t('platform.states.loading') : ''
  if (props.failed) return t(drafted.value ? 'requests.error' : 'requests.errorBare')
  if (waiting.value)
    return t(incomplete.value ? 'requests.countIncomplete' : 'requests.count', {
      count: waiting.value,
    })
  // The questions below stay to say how they ended: none of them waits, and the line says that
  // of them rather than that there are none.
  if (all.value.length) return t('requests.noneWaiting')
  return ''
})
/** Each question as the record of its kind, its answers in the person's words. */
const records = computed(
  () =>
    new Map(
      all.value.map((entry) => [
        requestIdentity(entry),
        kindRecord(entry, (option) => t(`requests.kinds.answers.${option}`)),
      ]),
    ),
)
const recordOf = (entry: InputRequestEntry) =>
  records.value.get(requestIdentity(entry)) ?? kindRecord(entry, String)
const tabIds = useTabIds()
const kinds = useKindTabs(
  () => props.entries.map((entry) => recordOf(entry)),
  () => props.waiting,
)
/** The panel is named by its tab only while tabs stand over it. */
const panelTabs = computed(() => (kinds.offered.value ? tabIds : null))
const inTab = (entry: InputRequestEntry) => kinds.shows(recordOf(entry).kind)
/** What stands in the tab shown, and what was put aside of it, and how many that is. */
const shown = computed(() => props.entries.filter((entry) => inTab(entry)))
const shownAnswered = computed(() => props.answered.filter((entry) => inTab(entry)))
const shownAll = computed(() => [...shown.value, ...shownAnswered.value])
/** The spaces whose triage is due, over «All» and the triage tab only. */
const dueLines = computed(() => (kinds.shows('triage') ? (props.result?.triage_due ?? []) : []))
const answeredLabel = computed(() =>
  t('requests.hub.answered', { count: shownAnswered.value.length }),
)
type CardHandle = {
  $el: Element | null
  focus: () => void
  focusOutcome: () => void
  holdsFocus: () => boolean
  send: (draft: RequestDraft, right: FocusRight) => Promise<Outcome>
}
const cards: Record<string, CardHandle | null> = {}
const errorLine = ref<HTMLElement | null>(null)
const emptyRefresh = ref<InstanceType<typeof VButton> | null>(null)
/** A refresh the reader pressed is still running; its failure is theirs to hear about. */
const asked = ref(false)
let refreshRight = NO_FOCUS_RIGHT
function askRefresh() {
  asked.value = true
  refreshRight = grantFocus()
  emit('refresh')
}
watch(
  () => props.loading,
  async (loading) => {
    if (loading || !asked.value) return
    asked.value = false
    if (!props.failed) return
    await nextTick()
    refreshRight.take(() => moveFocus(errorLine.value))
  },
)
async function dismiss(entry: InputRequestEntry) {
  const at = shownAll.value.findIndex(
    (candidate) => requestIdentity(candidate) === requestIdentity(entry),
  )
  const neighbour = shownAll.value[at + 1] ?? shownAll.value[at - 1]
  emit('dismiss', entry)
  await nextTick()
  if (neighbour) cards[requestIdentity(neighbour)]?.focus()
  else moveFocus(emptyRefresh.value?.$el as HTMLElement | undefined)
}
/** Whether the keyboard is inside this question, which the list must not take away. */
function holdsFocus(entry: InputRequestEntry) {
  return cards[requestIdentity(entry)]?.holdsFocus() ?? false
}
const root = ref<HTMLElement | null>(null)
const movesUnderReader = useUnderReader(root)
/** Whether putting this question aside now would move something from under the reader. */
function holdsReader(entry: InputRequestEntry) {
  return movesUnderReader(cards[requestIdentity(entry)]?.$el)
}
/** Folded until opened, and then open as the person left it while more is put aside. */
const answeredOpen = ref(false)
function draftFor(entry: InputRequestEntry) {
  return props.drafts[requestIdentity(entry)] ?? EMPTY_DRAFT
}
/** A question's answers as its buttons say them over what its form holds now. */
const answersOf = (entry: InputRequestEntry) =>
  answersOver(
    recordOf(entry).answers,
    draftFor(entry),
    (answer, n) => t('requests.kinds.counted', { answer, n }),
    t('requests.kinds.tickFirst', { drop: t('requests.kinds.answers.drop') }),
  )
/** The blocks that wait in the tab shown, as the records of their kinds. */
const waitingRecords = computed(() =>
  shown.value
    .filter((entry) => props.waiting.has(requestIdentity(entry)))
    .map((entry) => recordOf(entry)),
)
const recordDraft = (record: QuestionRecord) => draftFor(record.entry)
/**
 * One block accepted as filled: the form holds what goes, so a write that fails keeps it, and
 * the block's own record writes it.
 */
async function sendFilled({ draft, record }: RecommendedAnswer): Promise<Outcome> {
  const key = requestIdentity(record.entry)
  emit('draft', key, draft)
  return (await cards[key]?.send(draft, NO_FOCUS_RIGHT)) ?? 'held'
}
/** What waits names itself to the way through the list in the head; nothing else does. */
function waitingMark(entry: InputRequestEntry) {
  const key = requestIdentity(entry)
  return props.waiting.has(key) ? key : undefined
}
/**
 * Moves focus on from the question once its answer has landed, under the answer's own right: a
 * person who has moved focus since the answer began keeps it where they put it.
 */
async function updated(entry: InputRequestEntry, right: FocusRight) {
  emit('updated', entry)
  const key = requestIdentity(entry)
  // A form still open keeps the keyboard, and a changed answer is still this question's.
  if (entry.request.status === 'pending' || props.drafts[key]?.changing != null) return
  if (!cards[key]?.holdsFocus()) return
  await nextTick()
  if (entry.request.answer_version > 1) {
    right.take(() => cards[key]?.focusOutcome())
    return
  }
  const list = shown.value
  const at = list.findIndex((candidate) => requestIdentity(candidate) === key)
  const next = [...list.slice(at + 1), ...list.slice(0, Math.max(at, 0))].find((candidate) =>
    props.waiting.has(requestIdentity(candidate)),
  )
  right.take(() => {
    if (next) cards[requestIdentity(next)]?.focus()
    else cards[key]?.focusOutcome()
  })
}
defineExpose({ holdsFocus, holdsReader })
</script>

<template>
  <div
    ref="root"
    class="request-list"
    :aria-busy="busyMark"
  >
    <!-- Stands from the start of the first read, so the wait's word, written into its
         status line only once the wait is shown, is announced. -->
    <div
      v-if="statusText || firstHeld"
      class="request-toolbar"
    >
      <p
        v-if="failed"
        ref="errorLine"
        class="request-error focus-landing"
        role="alert"
        tabindex="-1"
      >
        {{ statusText }}
      </p>
      <p
        v-else
        class="request-status"
        role="status"
      >
        {{ statusText }}
      </p>
      <!-- Not disabled while a read runs: the focused button would drop focus to
           the page, and a second press while one is running starts nothing. -->
      <VButton
        v-tooltip.name="t('requests.refresh')"
        variant="ghost"
        :aria-label="t('requests.refresh')"
        icon
        @click="askRefresh"
      >
        <VIcon name="refresh" />
      </VButton>
    </div>
    <!-- What the first read found is held back while its wait is shown. -->
    <template v-if="!firstHeld">
      <RequestListNotes :result="result" />
      <DataEmptyState
        v-if="empty"
        :title="emptyLabel"
        compact
      >
        <template #action>
          <VButton
            ref="emptyRefresh"
            @click="askRefresh"
            >{{ t('requests.refresh') }}</VButton
          >
        </template>
      </DataEmptyState>
      <TabStrip
        v-if="kinds.offered.value"
        :model-value="kinds.tab.value"
        :label="t('requests.kinds.label')"
        :sections="kinds.options.value"
        :tabs="tabIds"
        @update:model-value="(tab) => (kinds.chosen.value = tab)"
      />
      <TabPanel
        class="request-panel"
        :tabs="panelTabs"
        :value="kinds.tab.value"
      >
        <RequestTriageDue
          v-if="dueLines.length"
          :lines="dueLines"
          @open="emit('open', $event)"
        />
        <RequestRecommendedAll
          v-if="recommendAll"
          :draft-of="recordDraft"
          :records="waitingRecords"
          :send="sendFilled"
        />
        <RequestCard
          v-for="entry in shown"
          :key="requestIdentity(entry)"
          :ref="(card) => (cards[requestIdentity(entry)] = card as CardHandle | null)"
          :entry="entry"
          :draft="draftFor(entry)"
          :kind="recordOf(entry).kind"
          :answers="answersOf(entry)"
          :data-request-waiting="waitingMark(entry)"
          standalone
          @update:draft="emit('draft', requestIdentity(entry), $event)"
          @updated="updated"
          @dismiss="dismiss"
          @select="emit('select', $event)"
        >
          <template #subject="{ disabled }">
            <RequestKindSubject
              :entry="entry"
              :kind="recordOf(entry).kind"
              :disabled="disabled"
              :draft="draftFor(entry)"
              @update:draft="emit('draft', requestIdentity(entry), $event)"
            />
          </template>
        </RequestCard>
        <VDisclosure
          v-if="shownAnswered.length"
          v-model:open="answeredOpen"
        >
          <template #summary>{{ answeredLabel }}</template>
          <div class="request-answered">
            <RequestCard
              v-for="entry in shownAnswered"
              :key="requestIdentity(entry)"
              :ref="(card) => (cards[requestIdentity(entry)] = card as CardHandle | null)"
              :entry="entry"
              :draft="draftFor(entry)"
              standalone
              @update:draft="emit('draft', requestIdentity(entry), $event)"
              @updated="updated"
              @dismiss="dismiss"
              @select="emit('select', $event)"
            />
          </div>
        </VDisclosure>
      </TabPanel>
    </template>
  </div>
</template>

<style scoped>
/* The column is the list's width, whatever a card holds that will not break. */
.request-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
}

/* The questions of the tab shown, and what was put aside, stand at the list's own step. */
.request-panel,
.request-answered {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
}

/* The sentence and the refresh it describes share one line; the button keeps
   its size and the sentence takes the rest. */
.request-toolbar {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  align-items: center;
}

.request-status,
.request-error {
  min-width: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

/* Across the line up to the refresh, so that the ring focus brings stands round the line as it
   does round a failed send, and not round the words alone like a chip. */
.request-error {
  flex: 1 1 auto;
  color: var(--color-danger);
}
</style>
