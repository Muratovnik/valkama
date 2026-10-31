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
 * Which item is open is in the route, not here. That is what makes an item
 * linkable: a reload comes back to it, Back closes it, and a bookmark is a work
 * item rather than a space. It reads the item out of the same `work-item` entity
 * the Kernel encodes — `{space_ref, reference}` — so there is one spelling of the
 * identity and the route carries it.
 *
 * The local trail holds navigation depth; the route holds the item's identity.
 * The route also holds how the space is looked at: the view, the chain every
 * view is narrowed to, and whether the board is grouped by epic.
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  chainTarget,
  groupingOf,
  usePlanningChainScope,
  withChain,
  withGrouping,
} from '@/pages/planning/composables/usePlanningChainScope.ts'
import type { ChainRefusal } from '@/pages/planning/composables/usePlanningChainScope.ts'
import { usePlanningMoves } from '@/pages/planning/composables/usePlanningMoves.ts'
import { usePlanningPortfolio } from '@/pages/planning/composables/usePlanningPortfolio.ts'
import { usePlanningSubscription } from '@/pages/planning/composables/usePlanningSubscription.ts'
import PlanningPortfolio from '@/pages/planning/PlanningPortfolio.vue'
import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'
import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'

import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'

import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import { CutoverPendingError, fetchPlanning } from '@/shared/api/planningApi.ts'
import type { PlanningConnectionState } from '@/shared/api/planningApi.ts'
import type { ChainScope, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import {
  planningSpaceEntity,
  planningWorkItemEntity,
  resolvePlanningRouteSelection,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
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
import { failureMessageKey, typedFailure } from '@/shared/api/typedFailure.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const props = defineProps<{
  context: PlatformContextReady | null
  primaryWriteScopeId: string | null
  route: PlatformRoute
  scope: OperatingScope
}>()

const emit = defineEmits<{
  'connection': [state: PlanningConnectionState]
  'entity': [entity?: EntityRef]
  'notice': [message: string]
  'open-project': [projectId: string]
  'open-session': [sessionId: string, clientFamily: string]
  'state': [state: Record<string, string | number | boolean>]
}>()

const { t } = useI18n()

const mappedResourceRefs = computed<EntityRef[]>(() => {
  const scope = props.scope
  if (scope.kind !== 'project') return []
  const project = props.context?.projects.find(
    (item) => item.project_id === scope.project_ref.project_id,
  )
  return (project?.resources ?? [])
    .filter((resource) => resource.state === 'mapped')
    .map((resource) => resource.resource_ref)
})

const routeSelection = computed(() =>
  resolvePlanningRouteSelection(
    props.route.entity,
    mappedResourceRefs.value,
    props.scope.kind === 'project',
  ),
)

/** The Kernel resource this project binds, which is what write ownership keys on. */
const boundSpace = computed<PlanningSpaceRef | undefined>(() =>
  routeSelection.value.status === 'ready' ? routeSelection.value.space_ref : undefined,
)

/** The canonical Kernel identity whose project binding owns local source access. */
const boundSpaceResourceRef = computed<PlanningSpaceEntityRef | undefined>(() => {
  const space = boundSpace.value
  return space === undefined ? undefined : (planningSpaceEntity(space) as PlanningSpaceEntityRef)
})

const projectId = computed(() =>
  props.scope.kind === 'project' ? props.scope.project_ref.project_id : undefined,
)

/**
 * The same answer as a string, for a child that takes one.
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

const {
  state: portfolio,
  load: loadPortfolio,
  invalidate: invalidatePortfolio,
} = usePlanningPortfolio(() => props.scope)
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
const version = ref(0)

/** Which item the route names, and how deep the operator went to get there. */
const open = computed(() =>
  routeSelection.value.status === 'ready'
    ? (routeSelection.value.work_item_ref?.reference ?? null)
    : null,
)

/**
 * A reference is unique only inside its planning space. Key the inspector by
 * the complete route identity so an equally named item in an attached store
 * cannot inherit the first item's selected panel, draft, error, or result.
 */
const openIdentity = computed(() => {
  const space = boundSpace.value
  const reference = open.value
  return space === undefined || reference === null
    ? ''
    : `${projectId.value}:${space.data_scope_id}:${space.space_key}:${reference}`
})
const trail = ref<string[]>([])
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

/** What the operator is told about a chain the route named and this space cannot show. */
function chainRefusalNotice(reference: string, why: ChainRefusal): string {
  if (why.kind === 'invalid') return t('graph.chainInvalid')
  // The card's own words, so the store a chain is missing from reads the same.
  if (why.kind === 'primary') return t('workItem.chain.primaryOnly')
  const cause = why.kind === 'failed' ? why.message : t('graph.chainElsewhere')
  return t('graph.chainUnavailable', { reference, cause })
}

/**
 * The route named a chain this space cannot show. It says so once and drops the
 * keys, so the field is the whole space and the address says the same.
 */
function refuseChain(reference: string, why: ChainRefusal) {
  emit('notice', chainRefusalNotice(reference, why))
  emit('state', withChain(props.route.state, null))
}

const {
  scoped: chainScope,
  pending: chainPending,
  enter: enterChain,
} = usePlanningChainScope({
  target: () => chainTarget(props.route.state),
  space: () => (boundSpace.value === undefined ? '' : planningKey.value),
  primary: () => primaryStore.value,
  spaceItems: () => model.value?.work_items ?? null,
  version: () => version.value,
  refused: refuseChain,
})

const selectedId = computed(
  () => model.value?.work_items.find((item) => item.reference === open.value)?.work_item_id ?? null,
)

const streamTarget = computed(() =>
  projectId.value === undefined || boundSpace.value === undefined
    ? null
    : { project: projectId.value, ...boundSpace.value },
)
const { connection: liveConnection, reconnect } = usePlanningSubscription(streamTarget, (next) => {
  const key = planningKey.value
  resource.value = beginResource(resource.value, key)
  resource.value = resolveResource(resource.value, resource.value.generation, key, next)
  version.value += 1
})
const liveWarning = computed(() =>
  liveConnection.value === 'reconnecting' ? t('workItem.liveUnavailable') : undefined,
)
watch(liveConnection, (state) => emit('connection', state), { immediate: true })

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
    const reason = t(failureMessageKey(typedFailure(error)))
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
    composerOpen.value = false
    invalidatePortfolio()
    void loadPlanning()
    if (props.scope.kind === 'global') void loadPortfolio()
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

function openItem(reference: string, related = false) {
  if (related && open.value !== null && open.value !== reference)
    trail.value = [...trail.value, open.value]
  show(reference)
}

function closeItem() {
  trail.value = []
  show(null)
}

function goBack() {
  const previous = trail.value.at(-1)
  if (previous === undefined) return
  trail.value = trail.value.slice(0, -1)
  show(previous)
}

/** Another view of the same field: a chain the route names narrows that one too. */
function setView(mode: PlanningViewMode) {
  emit('state', { ...props.route.state, view: mode })
}

/**
 * The view the operator is in, narrowed to a chain — an epic's lane asked for
 * its own — or, given null, widened back to the whole space by the chip.
 */
function narrow(chain: { reference: string; scope: ChainScope } | null) {
  emit('state', withChain(props.route.state, chain))
}

/** The card asked to see its chain: the graph, scoped to exactly that chain. */
function showChain(chain: WorkItemChain) {
  enterChain(chain)
  emit('state', {
    ...withChain(props.route.state, { reference: chain.root.reference, scope: chain.scope }),
    view: 'graph',
  })
}

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
  if (props.scope.kind === 'global') {
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
  <main
    v-if="scope.kind === 'global'"
    class="planning-frame"
    tabindex="-1"
    data-scroll-owner="planning-portfolio"
    :aria-label="t('platform.modules.planning')"
  >
    <div class="planning-frame-content">
      <PlatformStatePanel
        :state="portfolio"
        :empty-description="t('platform.planning.noSpacesDetail')"
        @retry="loadPortfolio"
      >
        <template #default="{ payload }">
          <PlanningPortfolio
            :projects="payload.projects"
            @open-project="(id) => emit('open-project', id)"
          />
        </template>
      </PlatformStatePanel>
    </div>
  </main>

  <div
    v-else-if="model"
    class="planning-workspace-shell"
  >
    <PlanningWorkspace
      :model="shownModel ?? model"
      :chain="chainScope"
      :chain-pending="chainPending"
      :grouping="grouping"
      :scope-key="planningKey"
      :selected-id="selectedId"
      :warning="liveWarning"
      :stale="stale"
      :version="version"
      :view="view"
      :writable="writable"
      @create="composerOpen = true"
      @exit-chain="narrow(null)"
      @group="(next) => emit('state', withGrouping(route.state, next))"
      @open="(reference) => openItem(reference)"
      @place="placeItem"
      @show-chain="(reference) => narrow({ reference, scope: 'chain' })"
      @view="setView"
    />

    <WorkItemInspector
      v-if="open && boundSpaceResourceRef"
      :key="openIdentity"
      :reference="open"
      :resource-ref="boundSpaceResourceRef"
      :project-id="inspectorProjectId"
      :can-go-back="canGoBack"
      :refresh-token="version"
      :workflow="model.workflow"
      :writable="writable"
      @back="goBack"
      @changed="loadPlanning"
      @chain="showChain"
      @close="closeItem"
      @open="(reference) => openItem(reference, true)"
      @session="(id, family) => emit('open-session', id, family)"
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
