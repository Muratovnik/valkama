<script setup lang="ts">
/**
 * The Planning module's own surface: which space is open, and what is in it.
 *
 * Two boundaries meet here and neither owns the other. The scope answers which
 * space this is and whether it narrows to one project, and the Kernel who may
 * write — that is scope and ownership. Planning's own boundary answers what is in the space.
 * Keeping the second out of the Kernel projection is what let Kanban stop being
 * the model: `/api/planning` returns the workflow, the items and the links, and
 * each view projects what it needs from that one answer.
 *
 * Which item is open is in the route, not here (`usePlanningRouteSelection`),
 * which is what makes an item linkable.
 *
 * The local trail holds navigation depth (`usePlanningCardTrail`); the route holds
 * the item's identity.
 * Each step of the trail also holds where its card was left, which the card
 * hands over as it opens another, so Back reopens it there and not at its top.
 * The panel lives as long as any item is open and only the card inside it is
 * keyed by the item: going from a card to a card closes nothing, so it opens
 * nothing either.
 * Nor does the panel wait for the space: a card its address names opens and
 * reads its own record beside the space's first read, which carries every item
 * of the space, and what the card takes from the space — its parent's
 * reference, the states it may move to — comes in when the space does.
 * The route also holds how the space is looked at: the view, the chain every
 * view is narrowed to, whether the board is grouped by goal, and the filter,
 * which the workspace owns and writes back within the manifest's bound. A saved
 * view is that state under a name, kept for the space it was saved in.
 *
 * So the bar over the views stands while a space is read, first or after a switch,
 * and only the stage under it waits. It used to give way to a page that said
 * «Loading», which took the view away for as long as the read ran.
 */
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenCardModel } from '@/pages/planning/composables/useOpenCardModel.ts'
import { usePlanningCardTrail } from '@/pages/planning/composables/usePlanningCardTrail.ts'
import {
  chainTarget,
  groupingOf,
  viewOf,
  withGrouping,
} from '@/pages/planning/composables/usePlanningChainScope.ts'
import { usePlanningChainView } from '@/pages/planning/composables/usePlanningChainView.ts'
import { usePlanningDownloads } from '@/pages/planning/composables/usePlanningDownloads.ts'
import { usePlanningMoves } from '@/pages/planning/composables/usePlanningMoves.ts'
import { usePlanningPortfolio } from '@/pages/planning/composables/usePlanningPortfolio.ts'
import { usePlanningReferenceLinks } from '@/pages/planning/composables/usePlanningReferenceLinks.ts'
import { usePlanningRouteSelection } from '@/pages/planning/composables/usePlanningRouteSelection.ts'
import { usePlanningSubscription } from '@/pages/planning/composables/usePlanningSubscription.ts'
import PlanningCardPanel from '@/pages/planning/PlanningCardPanel.vue'
import type { PlanningCardProps } from '@/pages/planning/PlanningCardPanel.vue'
import PlanningPortfolioFrame from '@/pages/planning/PlanningPortfolioFrame.vue'
import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'
import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'
import { readingModel } from '@/pages/planning/utils/readingModel.ts'
import { withoutUnreadValues } from '@/pages/planning/utils/savedViewReads.ts'

import { provideDefaultProject } from '@/widgets/work-item-inspector/utils/memorySource.ts'

import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { CutoverPendingError, fetchPlanning } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import { planningWorkItemEntity, sameSpace } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { uiError, uiLoading, uiUnavailable } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  cancelResource,
  createResource,
  holdsResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  context: PlatformContextReady | null
  primaryWriteScopeId: string | null
  route: PlatformRoute
  scope: OperatingScope
  /** The planning manifest's bound on the route state. */
  stateBytes: number
  /** An address asked the open card to go to its waiting question. */
  questionAsked?: boolean
}>()

const emit = defineEmits<{
  /** The space's own stream, or null when no space is open and the shell's own connection speaks. */
  'connection': [state: PlanningConnectionState | null]
  'entity': [entity?: EntityRef]
  /** Search every project for this text: the finder is the app's, not the module's. */
  'find': [text: string]
  'notice': [message: string]
  'open-space': [space: PlanningSpaceRef]
  'question-taken': []
  'state': [state: Record<string, string | number | boolean>]
}>()

const { t } = useI18n()

const {
  open,
  openIdentity,
  projectId,
  selection: routeSelection,
  space: boundSpace,
  spaceResourceRef: boundSpaceResourceRef,
} = usePlanningRouteSelection({
  route: () => props.route,
  scope: () => props.scope,
})

/** The space the scope names as this workstation lists it; undefined at the top or when absent. */
const listedSpace = computed(() => {
  const space = boundSpace.value
  return space && props.context?.spaces.find((item) => sameSpace(item, space))
})

/**
 * The project the card's Memory searches: the one the scope narrows to, else the space's
 * default one. A space with no project has none to search, and an empty string is what the
 * card renders as that, where `undefined` would be a missing prop.
 */
const inspectorProjectId = computed(
  () => projectId.value ?? listedSpace.value?.default_project ?? '',
)
provideDefaultProject(() => projectId.value === undefined)

const view = computed<PlanningViewMode>(() => viewOf(props.route.state))
const grouping = computed(() => groupingOf(props.route.state))
/** The space a saved view belongs to: the store and the key, which the project does not change. */
const viewPlace = computed(() =>
  boundSpace.value ? `${boundSpace.value.data_scope_id}:${boundSpace.value.space_key}` : '',
)

/**
 * The key of the space the address names, when this workstation has no such space.
 * It can never load, so the page offers the spaces that do exist.
 */
const missingSpace = computed(() => {
  const scope = props.scope
  return scope.kind !== 'space' || props.context === null || listedSpace.value
    ? null
    : scope.space_ref.space_key
})
const portfolioShown = computed(() => props.scope.kind === 'global' || missingSpace.value !== null)

const {
  state: portfolio,
  load: loadPortfolio,
  invalidate: invalidatePortfolio,
} = usePlanningPortfolio()
/**
 * Planning's own read model, held beside its status rather than inside one.
 *
 * `PlatformUiState` bounds an adapter payload at 256KB, which is the right rule
 * for a state an adapter supplies and the wrong container for a first-party read
 * model that legitimately carries two thousand items. The status drives the
 * panel; the model is what the views read.
 */
const resource = shallowRef(createResource<PlanningReadModel>())
const model = computed(() => resource.value.data)
usePlanningDownloads(view, model)
const stale = computed(() => resource.value.status === 'refreshing')
const planning = ref<PlatformUiState>(uiLoading())
/** A space the route cannot bind is not loaded by asking again. */
const planningRetryable = computed(() => routeSelection.value.status !== 'unavailable')
const version = ref(0)
/**
 * Moves with `version` once the space has been drawn, and is what the open card reads again on.
 * A card its address opens reads beside the space's first read rather than after it, so that
 * read answers nothing the card has not just read itself, and the card is not asked twice.
 */
const cardVersion = ref(0)
/** The space answered again; the card hears it only when it is news to what was drawn. */
function spaceAnswered(drawn: boolean) {
  version.value += 1
  if (drawn) cardVersion.value += 1
}
/** Moves when an agent changed: an open card reads again, and nothing else does. */
const agentsVersion = ref(0)

const trail = usePlanningCardTrail({ open: () => open.value, show })
const { closeItem, openItem, reset: resetTrail } = trail
const composerOpen = ref(false)

const planningKey = computed(() =>
  JSON.stringify([props.scope, boundSpace.value, routeSelection.value.status]),
)

/**
 * The bound space is the confirmed writable primary store. Writes reach that
 * store alone, and so does the chain endpoint, which is why an attached store's
 * card has no chain and a chain its address names is refused the same way.
 */
const primaryStore = computed(
  () =>
    props.scope.kind === 'space' && props.primaryWriteScopeId === boundSpace.value?.data_scope_id,
)

const {
  branch: chainBranch,
  chain: chainScope,
  closed: chainClosed,
  exitBranch,
  failure: chainFailure,
  narrow,
  own: ownChain,
  pending: chainPending,
  retry: retryChain,
  setClosed: setChainClosed,
  show: showChain,
  shown: chainShown,
} = usePlanningChainView({
  state: () => props.route.state,
  open: () => open.value,
  close: () => closeItem(),
  // The address names the space before the context says which store is the primary, and a
  // chain asked for then would be refused for a store not yet known: it waits for both.
  space: () => (boundSpace.value === undefined || props.context === null ? '' : planningKey.value),
  primary: () => primaryStore.value,
  spaceItems: () => model.value?.work_items ?? null,
  version: () => version.value,
  notice: (message) => emit('notice', message),
  write: (state) => emit('state', state),
})

/**
 * An address holding a value this build does not read — a grouping, a view or a filter value
 * a build before this one wrote — is written again without it, as a chain it cannot name is
 * above, so the address says what the views show and a view saved from it keeps no such value.
 * A chain that cannot be named goes first: its refusal says so, and its write comes back here.
 */
watch(
  () => props.route.state,
  (state) => {
    if (chainTarget(state).status === 'invalid') return
    const read = withoutUnreadValues(state)
    if (read !== null) emit('state', read)
  },
  { immediate: true },
)

const { openRecord, parent } = useOpenCardModel(model, open)
/** The card on show, in the panel every host of a card shares. */
const panel = useTemplateRef<InstanceType<typeof PlanningCardPanel>>('panel')
/** The workspace owns the filter; the card's label chips reach it here. */
const workspace = useTemplateRef<{ toggleFilter: (token: WorkFilterToken) => void }>('workspace')
const filterFromCard = (token: WorkFilterToken) => workspace.value?.toggleFilter(token)

const selectedId = computed(() => openRecord.value?.work_item_id ?? null)

/** What the open card is read and written with here, from the space the board holds. */
const shownCard = computed((): PlanningCardProps | null =>
  open.value && boundSpaceResourceRef.value
    ? {
        reference: open.value,
        resourceRef: boundSpaceResourceRef.value,
        projectId: inspectorProjectId.value,
        refreshToken: cardVersion.value,
        agentsToken: agentsVersion.value,
        workflow: model.value?.workflow ?? null,
        spaceReading: reading.value,
        writable: writable.value,
        parent: parent.value,
        ownChain: ownChain.value,
        kind: openRecord.value?.kind,
        questionAsked: props.questionAsked,
        onChanged: loadPlanning,
        onChain: showChain,
        onFilter: filterFromCard,
        onQuestionTaken: () => emit('question-taken'),
      }
    : null,
)

/**
 * Whether the page holds this space, or its read failed. The stream waits for the read
 * and opens with the revision it answered, so its first frame is not the same model
 * again — built twice at once on the server and parsed twice here. What changed after
 * the read, the stream still sends; after a failed read, it sends the space itself.
 */
const spaceRead = computed(() => {
  const read = resource.value
  return read.key === planningKey.value || (read.status === 'error' && read.pendingKey === null)
})
/**
 * The space and, where the scope narrows, its project: what the views show of it. Nothing
 * is read before the spaces are: the list says whether the space is there at all, and a read
 * started before it was read the space again once it came. A space this workstation does
 * not list is neither read nor streamed: it can never answer.
 */
const streamTarget = computed(() => {
  const space = boundSpace.value
  if (space === undefined || props.context === null || missingSpace.value !== null) return null
  return projectId.value === undefined ? { ...space } : { project: projectId.value, ...space }
})
/**
 * The space's stream counts as connecting while it waits for the read, so the shell
 * opens no stream of its own for the live-work frame in the meantime.
 */
const openStreamTarget = computed(() => (spaceRead.value ? streamTarget.value : null))
const { connection: liveConnection, reconnect } = usePlanningSubscription(
  openStreamTarget,
  (next, returning) => {
    const key = planningKey.value
    // A frame equal to the space the page holds is no news. The stream already leaves out
    // the model the read answered; this keeps any other copy of it from reading an open
    // card twice. Back from a dropped connection it is news whatever it says: what the
    // space does not carry, a question or a history, may have moved while the page was away.
    if (!returning && holdsResource(resource.value, key, next)) return
    const drawn = returning || model.value !== null
    resource.value = beginResource(resource.value, key)
    resource.value = resolveResource(resource.value, resource.value.generation, key, next)
    spaceAnswered(drawn)
  },
  () => {
    agentsVersion.value += 1
  },
  () => model.value?.revision,
)
watch(
  [liveConnection, streamTarget],
  ([state, target]) => emit('connection', target === null ? null : state),
  { immediate: true },
)

async function loadPlanning() {
  // Until the spaces are read the page stays as it starts, loading: see `streamTarget`.
  if (props.context === null) return
  const target = streamTarget.value
  const key = planningKey.value
  resource.value = beginResource(resource.value, key)
  const generation = resource.value.generation
  if (routeSelection.value.status === 'unavailable' || target === null) {
    resource.value = { ...cancelResource(resource.value), data: null }
    planning.value = uiUnavailable(t('platform.planning.otherSpace'))
    return
  }
  if (model.value === null) planning.value = uiLoading()
  try {
    const next = await fetchPlanning(target)
    if (generation !== resource.value.generation) return
    spaceAnswered(model.value !== null)
    if (next.planning_space === null) {
      resource.value = { ...cancelResource(resource.value), data: null }
      planning.value = uiUnavailable(t('workItem.noSpace'))
      return
    }
    resource.value = resolveResource(resource.value, generation, key, next)
  } catch (error) {
    if (generation !== resource.value.generation) return
    if (error instanceof CutoverPendingError) {
      resource.value = { ...cancelResource(resource.value), data: null }
      planning.value = uiUnavailable(t('workItem.cutoverPending'))
      return
    }
    const message = failureMessage(typedFailure(error))
    const reason = t(message.key, message.params ?? {})
    resource.value = rejectResource(resource.value, generation, key, reason)
    if (model.value === null) planning.value = uiError(reason)
    else emit('notice', reason)
  }
}

/**
 * What a read of this space depends on, as one value that can be compared.
 *
 * A string, not an array. A watcher whose getter returns a fresh array compares
 * two different references every time, so it fires on any dependency touch
 * rather than on a change — which re-read the whole space on every item opened
 * and cleared the trail with it, so Back was never offered.
 *
 * The open item is deliberately not in here: it changes the route and not what
 * the space would answer.
 */
const readKey = computed(() =>
  JSON.stringify([props.scope, boundSpace.value, props.context?.spaces]),
)

watch(
  readKey,
  () => {
    resetTrail()
    composerOpen.value = false
    invalidatePortfolio()
    void loadPlanning()
    if (portfolioShown.value) void loadPortfolio()
  },
  { immediate: true },
)

/**
 * A bound space is being read and nothing of it is drawn yet. Nothing of the space it
 * replaces is drawn either: the views read a space with nothing in it.
 */
const reading = computed(
  () =>
    model.value === null && planning.value.status === 'loading' && boundSpace.value !== undefined,
)
const writable = computed(() => primaryStore.value && (model.value !== null || reading.value))

onBeforeUnmount(() => {
  resource.value = cancelResource(resource.value)
})

/** Route to one item of the bound space, or back to the space itself, which names no entity. */
function show(reference: string | null) {
  const space = boundSpace.value
  if (space === undefined) return
  emit(
    'entity',
    reference === null ? undefined : planningWorkItemEntity({ space_ref: space, reference }),
  )
}

// References written in this space's texts open its items (see the composable).
usePlanningReferenceLinks(boundSpace, model, openFromPage)

/**
 * What this layer answers while a card is open is a document standing beside it, and the
 * card answers for leaving itself: its draft guard first, then Back to where it was left.
 */
function openFromPage(reference: string) {
  if (!panel.value?.openFrom(reference)) openItem(reference)
}

/** Another view of the same field: a chain the route names narrows that one too. */
const setView = (mode: PlanningViewMode) => emit('state', { ...props.route.state, view: mode })

/**
 * A move on the board: a transition when the tile changed state, a placement
 * when it only changed place, and the workflow decides whether a transition is
 * allowed. A refused move is reported and the space re-read, so the tile goes
 * back to where the store still says it is rather than lying about the drop.
 * `shownModel` is the space with the moves still on their way drawn in, which is
 * what the views read.
 */
const { model: shownModel, place: placeItem } = usePlanningMoves({
  model,
  notice: (message) => emit('notice', message),
  reload: loadPlanning,
  unwritable: () => (writable.value ? null : t('platform.coreWrites.primaryOwnerRequired')),
})

function itemCreated(reference: string) {
  composerOpen.value = false
  void loadPlanning()
  show(reference)
}

async function refresh() {
  if (portfolioShown.value) {
    await loadPortfolio()
    if (!['empty', 'ready'].includes(portfolio.value.status))
      throw new Error('Planning directory refresh failed')
    return
  }
  await loadPlanning()
  if (resource.value.status !== 'ready' || resource.value.data === null || resource.value.error)
    throw new Error('Planning refresh failed')
  reconnect()
}

defineExpose({ refresh, selectedId })
</script>

<template>
  <PlanningPortfolioFrame
    v-if="portfolioShown"
    :portfolio="portfolio"
    :missing-space="missingSpace"
    @retry="loadPortfolio"
    @open-space="(space) => emit('open-space', space)"
  />

  <div
    v-else-if="model || reading"
    class="planning-workspace-shell"
  >
    <PlanningWorkspace
      ref="workspace"
      :model="shownModel ?? model ?? readingModel"
      :reading="!model"
      :route-state="route.state"
      :state-bytes="stateBytes"
      :view-place="viewPlace"
      :chain="chainScope"
      :chain-branch="chainBranch"
      :chain-pending="chainPending"
      :chain-closed="chainClosed"
      :chain-failure="chainFailure"
      :graph-focus="chainShown"
      :grouping="grouping"
      :selected-id="selectedId"
      :stale="stale"
      :version="version"
      :view="view"
      :writable="writable"
      @chain-closed="setChainClosed"
      @retry-chain="retryChain"
      @create="composerOpen = true"
      @exit-chain="narrow(null)"
      @exit-branch="exitBranch"
      @find="(text) => emit('find', text)"
      @group="(next) => emit('state', withGrouping(route.state, next))"
      @open="(reference) => openItem(reference)"
      @place="placeItem"
      @show-chain="(reference) => narrow({ reference, scope: 'chain' })"
      @state="(state) => emit('state', state)"
      @view="setView"
    />

    <PlanningCardPanel
      ref="panel"
      :identity="openIdentity"
      :label="openRecord?.title || open || ''"
      :trail="trail"
      :card="shownCard"
    />
  </div>
  <main
    v-else
    class="planning-frame"
    tabindex="-1"
    data-scroll-owner="planning-state"
    :aria-label="t('platform.modules.planning')"
  >
    <div class="planning-frame-content">
      <PlatformStatePanel
        :state="planning"
        :retryable="planningRetryable"
        @retry="loadPlanning"
      />
    </div>
  </main>

  <WorkItemComposer
    v-if="model?.planning_space"
    :key="`${boundSpace?.data_scope_id ?? ''}:${boundSpace?.space_key ?? ''}`"
    :open="composerOpen"
    :space="model.planning_space.planning_space_id"
    :items="model.work_items"
    @close="composerOpen = false"
    @created="itemCreated"
  />
</template>

<style scoped src="./planning-frame.css"></style>

<style scoped>
.planning-workspace-shell {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
