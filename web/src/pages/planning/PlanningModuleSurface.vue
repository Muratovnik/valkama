<script setup lang="ts">
/**
 * The Planning module's own surface: which space is open, and what is in it.
 *
 * Two boundaries meet here and neither owns the other. The Kernel answers which
 * project this is, which resource it is bound to, and who may write — that is
 * scope and ownership. Planning's own boundary answers what is in the space.
 * Keeping the second out of the Kernel projection is what let Kanban stop being
 * the model: `/api/planning` returns the workflow, the items and the links, and
 * each view projects what it needs from that one answer.
 *
 * Which item is open is in the route, not here (`usePlanningRouteSelection`),
 * which is what makes an item linkable.
 *
 * The local trail holds navigation depth; the route holds the item's identity.
 * Each step of the trail also holds where its card was left, which the card
 * hands over as it opens another, so Back reopens it there and not at its top.
 * The panel lives as long as any item is open and only the card inside it is
 * keyed by the item: going from a card to a card closes nothing, so it opens
 * nothing either.
 * The route also holds how the space is looked at: the view, the chain every
 * view is narrowed to, whether the board is grouped by epic, and the filter,
 * which the workspace owns and writes back within the manifest's bound.
 */
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { groupingOf, withGrouping } from '@/pages/planning/composables/usePlanningChainScope.ts'
import { usePlanningChainView } from '@/pages/planning/composables/usePlanningChainView.ts'
import { usePlanningMoves } from '@/pages/planning/composables/usePlanningMoves.ts'
import { usePlanningPortfolio } from '@/pages/planning/composables/usePlanningPortfolio.ts'
import { usePlanningReferenceLinks } from '@/pages/planning/composables/usePlanningReferenceLinks.ts'
import { usePlanningRouteSelection } from '@/pages/planning/composables/usePlanningRouteSelection.ts'
import { usePlanningSubscription } from '@/pages/planning/composables/usePlanningSubscription.ts'
import PlanningPortfolioFrame from '@/pages/planning/PlanningPortfolioFrame.vue'
import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'
import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'

import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'
import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import type { WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { CutoverPendingError, fetchPlanning } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { uiError, uiLoading, uiUnavailable } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  cancelResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import { INSPECTOR_DRAWER_STORAGE_KEY } from '@/shared/lib/shellLayout.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import ResizableInspector from '@/shared/ui/ResizableInspector.vue'

const props = defineProps<{
  context: PlatformContextReady | null
  primaryWriteScopeId: string | null
  route: PlatformRoute
  scope: OperatingScope
  /** The planning manifest's bound on the route state. */
  stateBytes: number
}>()

const emit = defineEmits<{
  /** The space's own stream, or null when no space is open and the shell's own connection speaks. */
  'connection': [state: PlanningConnectionState | null]
  'entity': [entity?: EntityRef]
  'notice': [message: string]
  'open-project': [projectId: string]
  'open-session': [sessionId: string, clientFamily: string]
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
  context: () => props.context,
  route: () => props.route,
  scope: () => props.scope,
})

/**
 * The project as a string, for a child that takes one.
 *
 * The inspector's Memory section searches a project's own knowledge, and a
 * global scope has no project to search: an empty string is what it renders as
 * "open this inside its project", where `undefined` would be a missing prop.
 */
const inspectorProjectId = computed(() => projectId.value ?? '')

const view = computed<PlanningViewMode>(() => {
  const value = props.route.state?.view
  return value === 'graph' || value === 'list' ? value : 'kanban'
})
// An address that opens on the graph downloads it beside the space read, not after it.
watch(view, (mode) => mode === 'graph' && graphView.prefetch(), { immediate: true })
const grouping = computed(() => groupingOf(props.route.state))

/**
 * The project the address names, when this workstation has no such project.
 * Its space can never load, so the page offers the projects that do exist.
 */
const missingProject = computed(() => {
  const scope = props.scope
  if (scope.kind !== 'project' || props.context === null) return null
  const id = scope.project_ref.project_id
  return props.context.projects.some((project) => project.project_id === id) ? null : id
})
const portfolioShown = computed(
  () => props.scope.kind === 'global' || missingProject.value !== null,
)

const {
  state: portfolio,
  load: loadPortfolio,
  invalidate: invalidatePortfolio,
} = usePlanningPortfolio(() => (missingProject.value ? { kind: 'global' } : props.scope))
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
const stale = computed(() => resource.value.status === 'refreshing')
const planning = ref<PlatformUiState>(uiLoading())
/** A space the route cannot bind is not loaded by asking again. */
const planningRetryable = computed(() => routeSelection.value.status !== 'unavailable')
const version = ref(0)
/** Moves when an agent changed: an open card reads again, and nothing else does. */
const agentsVersion = ref(0)

const trail = ref<{ left: InspectorReturn | null; reference: string }[]>([])
/** Where the card Back is reopening was left; read by that card alone. */
const returning = ref<InspectorReturn | null>(null)
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
    props.scope.kind === 'project' && props.primaryWriteScopeId === boundSpace.value?.data_scope_id,
)

const {
  branch: chainBranch,
  chain: chainScope,
  closed: chainClosed,
  exitBranch,
  failure: chainFailure,
  narrow,
  pending: chainPending,
  retry: retryChain,
  setClosed: setChainClosed,
  show: showChain,
  shown: chainShown,
} = usePlanningChainView({
  state: () => props.route.state,
  open: () => open.value,
  close: () => closeItem(),
  space: () => (boundSpace.value === undefined ? '' : planningKey.value),
  primary: () => primaryStore.value,
  spaceItems: () => model.value?.work_items ?? null,
  version: () => version.value,
  notice: (message) => emit('notice', message),
  write: (state) => emit('state', state),
})

const openRecord = computed(() =>
  model.value?.work_items.find((item) => item.reference === open.value),
)
/** The open item's epic, by reference: the card's facts line names it. */
const parentReference = computed(() => {
  const parent = openRecord.value?.parent_id
  return model.value?.work_items.find((item) => item.work_item_id === parent)?.reference ?? null
})
/** The card on show: every way of closing the panel asks it about its drafts first. */
const card = useTemplateRef<InstanceType<typeof WorkItemInspector>>('card')
const closePanel = () => card.value?.close()
/** The workspace owns the filter; the card's label chips reach it here. */
const workspace = useTemplateRef<{ toggleFilter: (token: WorkFilterToken) => void }>('workspace')
const filterFromCard = (token: WorkFilterToken) => workspace.value?.toggleFilter(token)

const selectedId = computed(() => openRecord.value?.work_item_id ?? null)

const streamTarget = computed(() =>
  projectId.value === undefined || boundSpace.value === undefined
    ? null
    : { project: projectId.value, ...boundSpace.value },
)
const { connection: liveConnection, reconnect } = usePlanningSubscription(
  streamTarget,
  (next) => {
    const key = planningKey.value
    resource.value = beginResource(resource.value, key)
    resource.value = resolveResource(resource.value, resource.value.generation, key, next)
    version.value += 1
  },
  () => {
    agentsVersion.value += 1
  },
)
watch(
  [liveConnection, streamTarget],
  ([state, target]) => emit('connection', target === null ? null : state),
  { immediate: true },
)

async function loadPlanning() {
  const project = projectId.value
  const space = boundSpace.value
  const key = planningKey.value
  resource.value = beginResource(resource.value, key)
  const generation = resource.value.generation
  if (
    routeSelection.value.status === 'unavailable' ||
    project === undefined ||
    space === undefined
  ) {
    resource.value = { ...cancelResource(resource.value), data: null }
    planning.value = uiUnavailable(t('platform.planning.bindingRequired'))
    return
  }
  if (model.value === null) planning.value = uiLoading()
  try {
    const next = await fetchPlanning({ project, ...space })
    if (generation !== resource.value.generation) return
    version.value += 1
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
  JSON.stringify([props.scope, boundSpace.value, props.context?.projects]),
)

watch(
  readKey,
  () => {
    trail.value = []
    returning.value = null
    composerOpen.value = false
    invalidatePortfolio()
    void loadPlanning()
    if (portfolioShown.value) void loadPortfolio()
  },
  { immediate: true },
)

const writable = computed(() => primaryStore.value && model.value !== null)

onBeforeUnmount(() => {
  resource.value = cancelResource(resource.value)
})

/** True once the operator reached this item from another one. */
const canGoBack = computed(() => trail.value.length > 0)

/** Route to one item of the bound space, or back to the space itself. */
function show(reference: string | null) {
  const space = boundSpace.value
  if (space === undefined) return
  emit(
    'entity',
    reference === null
      ? planningSpaceEntity(space)
      : planningWorkItemEntity({ space_ref: space, reference }),
  )
}

// References written in this space's texts open its items (see the composable).
usePlanningReferenceLinks(boundSpace, model, openItem)

function openItem(reference: string, related = false, left: InspectorReturn | null = null) {
  returning.value = null
  if (related && open.value !== null && open.value !== reference)
    trail.value = [...trail.value, { reference: open.value, left }]
  show(reference)
}

function closeItem() {
  trail.value = []
  returning.value = null
  show(null)
}

function goBack() {
  const previous = trail.value.at(-1)
  if (previous === undefined) return
  trail.value = trail.value.slice(0, -1)
  returning.value = previous.left
  show(previous.reference)
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

defineExpose({ refresh })
</script>

<template>
  <PlanningPortfolioFrame
    v-if="portfolioShown"
    :portfolio="portfolio"
    :missing-project="missingProject"
    @retry="loadPortfolio"
    @open-project="(id) => emit('open-project', id)"
  />

  <div
    v-else-if="model"
    class="planning-workspace-shell"
  >
    <PlanningWorkspace
      ref="workspace"
      :model="shownModel ?? model"
      :route-state="route.state"
      :state-bytes="stateBytes"
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
      @group="(next) => emit('state', withGrouping(route.state, next))"
      @open="(reference) => openItem(reference)"
      @place="placeItem"
      @show-chain="(reference) => narrow({ reference, scope: 'chain' })"
      @state="(state) => emit('state', state)"
      @view="setView"
    />

    <ResizableInspector
      surface-class="drawer"
      :content-key="openIdentity"
      :open="Boolean(open && boundSpaceResourceRef)"
      :label="openRecord?.title || open || ''"
      :resize-label="t('workItem.resize')"
      :storage-key="INSPECTOR_DRAWER_STORAGE_KEY"
      @close="closePanel"
    >
      <WorkItemInspector
        v-if="open && boundSpaceResourceRef"
        ref="card"
        :key="openIdentity"
        :reference="open"
        :resource-ref="boundSpaceResourceRef"
        :project-id="inspectorProjectId"
        :can-go-back="canGoBack"
        :return-to="returning"
        :refresh-token="version"
        :agents-token="agentsVersion"
        :workflow="model.workflow"
        :writable="writable"
        :parent-reference="parentReference"
        @back="goBack"
        @changed="loadPlanning"
        @chain="showChain"
        @close="closeItem"
        @filter="filterFromCard"
        @open="(reference, left) => openItem(reference, true, left)"
        @session="(id, family) => emit('open-session', id, family)"
      />
    </ResizableInspector>
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
    @close="composerOpen = false"
    @created="itemCreated"
  />
</template>

<style scoped>
.planning-frame {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-canvas);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.planning-frame-content {
  width: min(var(--size-module-column), 100%);
  min-height: 100%;
  padding: var(--space-6) var(--size-page-gutter) var(--space-12);
  margin: 0 auto;
}

.planning-workspace-shell {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
