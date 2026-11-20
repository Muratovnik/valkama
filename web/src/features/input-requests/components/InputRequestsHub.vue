<script setup lang="ts">
/**
 * The questions waiting for an answer, every space's, or those on what one space's board holds
 * when the window was opened from a place narrowed to it (`scope`), narrowed to its project too
 * when the place was, and to the tasks of the Volumes page's kind and label when the page has
 * them. The narrowing stands as a chip over the list naming the space, the project, the kind
 * and the label, and the subtitle says it; the chip is the way back to every space's questions
 * (`all`). The rail's count is always every space's: a
 * second reader keeps it while the list is narrowed.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import RequestNavigator from '@/features/input-requests/components/RequestNavigator.vue'
import { useInputRequests } from '@/features/input-requests/composables/useInputRequests.ts'
import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'
import { holdsDraft } from '@/features/input-requests/utils/answerChange.ts'
import { questionScopeWords } from '@/features/input-requests/utils/questionScopeWords.ts'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import { requestListView } from '@/features/input-requests/utils/requestListView.ts'
import { hasDraft } from '@/features/input-requests/utils/validateAnswers.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import type { QuestionScope } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { DIALOG_ROOM_BESIDE_DOCUMENT } from '@/shared/lib/shellLayout.ts'
import { useSpaceNames } from '@/shared/lib/spaceNames.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'
import ScopeChip from '@/shared/ui/ScopeChip.vue'

const props = defineProps<{
  open: boolean
  pane?: OverlayPaneNames | null
  /** The space and its project, or every space, and the tasks whose questions the list shows. */
  scope?: QuestionScope | null
}>()
const emit = defineEmits<{
  'all': []
  'close': []
  'count': [value: PendingCount | null]
  'open': [route: PlatformRoute]
  'pane-close': []
  'pane-fit': [fit: PaneFit | null]
  'select': [target: PlanningTarget]
}>()
const { t } = useI18n()
const RequestList = requestListView.component
const drafts = ref<Record<string, RequestDraft>>({})
/** The list on show; until its code is resident it holds nothing a reader is in. */
const list = ref<Partial<InstanceType<typeof RequestList>> | null>(null)
/** A question answered elsewhere stays while it holds something typed, chosen or focused here. */
const holding = (entry: InputRequestEntry) =>
  holdsDraft(entry.request, drafts.value[requestIdentity(entry)]) ||
  (list.value?.holdsFocus?.(entry) ?? false)
/**
 * A question that stopped waiting is put aside under «Answered» at the first read after which
 * it holds nothing typed or chosen, no form of a change stands open in it, and neither the
 * pointer nor the keyboard is in it or after it in the list, which it would move from under them.
 */
function settles(entry: InputRequestEntry) {
  const draft = drafts.value[requestIdentity(entry)]
  const kept = Boolean(draft && (draft.changing !== null || hasDraft(draft)))
  return !kept && !(list.value?.holdsReader?.(entry) ?? false)
}
const everywhere = reactive(useInputRequests(() => 'all', holding, settles))
const within = reactive(useInputRequests(() => props.scope ?? null, holding, settles))
/** The reader the list shows: the space's while the window is narrowed to one. */
const shown = computed(() => (props.scope ? within : everywhere))
const inPlace = computed(() =>
  shown.value.entries.filter((entry) => !(requestIdentity(entry) in shown.value.settled)),
)
const answered = computed(() =>
  shown.value.entries.filter((entry) => requestIdentity(entry) in shown.value.settled),
)
const waiting = computed(
  () =>
    new Set(
      shown.value.entries
        .filter((entry) => shown.value.waits(entry))
        .map((entry) => requestIdentity(entry)),
    ),
)
const spaces = useSpaceNames()
const words = computed(() => questionScopeWords(props.scope ?? null, spaces.value, t))
function refresh() {
  void shown.value.refresh()
}
function changed(entry: InputRequestEntry) {
  shown.value.changed(entry)
}
function remove(entry: InputRequestEntry) {
  delete drafts.value[requestIdentity(entry)]
  shown.value.dismiss(entry)
}
watch(
  () => everywhere.count,
  (value) => emit('count', value),
  { immediate: true },
)
watch(
  () => props.open,
  (open) => {
    if (open) refresh()
  },
)
</script>

<template>
  <DialogFrame
    placement="start"
    :open="open"
    :title="t('requests.title')"
    :subtitle="words.subtitle"
    :close-label="t('requests.close')"
    :pane="pane"
    :pane-room="DIALOG_ROOM_BESIDE_DOCUMENT"
    steady-scroll
    @close="emit('close')"
    @pane-close="emit('pane-close')"
    @pane-fit="(fit) => emit('pane-fit', fit)"
  >
    <ScopeChip
      v-if="scope"
      class="requests-scope"
      data-part="scope"
      :label="words.chip"
      :exit-label="words.exit"
      @exit="emit('all')"
    />
    <RequestList
      ref="list"
      :entries="inPlace"
      :answered="answered"
      :waiting="waiting"
      :result="shown.result"
      :loading="shown.loading"
      :failed="shown.failed"
      :partial="shown.partial"
      :drafts="drafts"
      recommend-all
      @refresh="refresh"
      @updated="changed"
      @dismiss="remove"
      @draft="(key, value) => (drafts[key] = value)"
      @select="emit('select', $event)"
      @open="emit('open', $event)"
    />
    <template #actions="{ scroller }">
      <RequestNavigator :scroller="scroller" />
    </template>
    <template #pane>
      <slot name="pane" />
    </template>
  </DialogFrame>
</template>

<style scoped>
/* The body is a grid, which would stretch the chip across the window. */
.requests-scope {
  justify-self: start;
}
</style>
