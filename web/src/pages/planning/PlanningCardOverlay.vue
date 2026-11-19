<script setup lang="ts">
/**
 * A Planning card opened over another module's page, which stays as it was under it.
 *
 * The address names the card as the board's does, as the work-item entity of the module's own
 * route, so Back closes it and a reload reopens it over the same view. The card is the board's
 * card: it reads its own record, and what it takes from its space — the states it may move to,
 * its parent, the labels a label is attached from — comes from one read of that space beside it,
 * into places the card already holds for them, as it does on the board.
 *
 * The card opens in its own space whatever the page stands in, as a reference press found it.
 *
 * A space that cannot be read is said as the board says it, in the board's words, and the card
 * stays: it reads and writes its own record without the space, so a field such as the priority
 * keeps working, and the state, whose moves only the space knows, is shown and not offered.
 *
 * A page may name the section its cards open on, such as the System events of a page of events;
 * the card it opened shows that section first, and a card opened from that card its own first.
 *
 * What only the board has stays there. A chain shown on the graph goes to the board's graph, and
 * a label pressed on the card, which narrows the board, narrows nothing here.
 */
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenCardModel } from '@/pages/planning/composables/useOpenCardModel.ts'
import { usePlanningCardTrail } from '@/pages/planning/composables/usePlanningCardTrail.ts'
import { withBranch, withChain } from '@/pages/planning/composables/usePlanningChainScope.ts'
import { usePlanningReferenceLinks } from '@/pages/planning/composables/usePlanningReferenceLinks.ts'
import PlanningCardPanel from '@/pages/planning/PlanningCardPanel.vue'
import type { PlanningCardProps } from '@/pages/planning/PlanningCardPanel.vue'

import { provideDefaultProject } from '@/widgets/work-item-inspector/utils/memorySource.ts'
import type { InspectorSection } from '@/widgets/work-item-inspector/utils/useInspectorSections.ts'

import { CutoverPendingError, fetchPlanning } from '@/shared/api/planningApi.ts'
import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import {
  planningSpaceEntity,
  planningWorkItemEntity,
  resolvePlanningRouteSelection,
  sameSpace,
} from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'

const props = defineProps<{
  context: PlatformContextReady | null
  /** The module route's entity: a work item opens its card, anything else nothing. */
  entity: EntityRef | undefined
  primaryWriteScopeId: string | null
  scope: OperatingScope
  /** The section a card the page opened shows first; null for the card's own first. */
  opensOn?: InspectorSection | null
  /** An address asked the open card to go to its waiting question. */
  questionAsked?: boolean
}>()

const emit = defineEmits<{
  /** Another card of the space, or none: the module's route names it. */
  'entity': [entity?: EntityRef]
  /** A place only the board has, such as a chain on its graph. */
  'go': [route: PlatformRoute]
  /** The card's space could not be read, in the words the board says it with. */
  'notice': [message: string]
  'question-taken': []
}>()

const { t } = useI18n()

/**
 * The card the entity names, and the project its Memory is asked in: the page's own where the
 * page stands in the card's space and narrows to a project, else the space's default one.
 */
const bound = computed(() => {
  const selection = resolvePlanningRouteSelection(props.entity)
  if (props.entity?.kind !== 'work-item' || selection.status !== 'ready') return null
  const item = selection.work_item_ref
  if (!item) return null
  const { scope } = props
  const own =
    scope.kind === 'space' && sameSpace(scope.space_ref, item.space_ref)
      ? scope.project_ref?.project_id
      : undefined
  const listed = props.context?.spaces.find((space) => sameSpace(space, item.space_ref))
  return {
    projectId: own ?? listed?.default_project ?? '',
    defaultProject: own === undefined,
    item,
  }
})

provideDefaultProject(() => bound.value?.defaultProject ?? false)
const open = computed(() => bound.value?.item.reference ?? null)
const space = computed(() => bound.value?.item.space_ref)
const resourceRef = computed(() => (space.value ? planningSpaceEntity(space.value) : undefined))
const identity = computed(() =>
  bound.value
    ? `${bound.value.projectId}:${bound.value.item.space_ref.data_scope_id}:${bound.value.item.space_ref.space_key}:${bound.value.item.reference}`
    : '',
)
/** Writes reach the primary store alone, as they do from the board. */
const writable = computed(
  () =>
    props.primaryWriteScopeId !== null && props.primaryWriteScopeId === space.value?.data_scope_id,
)

/** The card's space, read once per space it opens in and again after the card changed it. */
const model = shallowRef<PlanningReadModel | null>(null)
const reading = ref(false)
const spaceKey = computed(() => (bound.value ? JSON.stringify(bound.value.item.space_ref) : ''))
let generation = 0
async function readSpace() {
  generation += 1
  const asked = generation
  const target = bound.value
  if (!target) {
    model.value = null
    reading.value = false
    return
  }
  reading.value = true
  try {
    const next = await fetchPlanning(target.item.space_ref)
    if (asked !== generation) return
    model.value = next.planning_space ? next : null
    if (!next.planning_space) emit('notice', t('workItem.noSpace'))
  } catch (error) {
    if (asked !== generation) return
    model.value = null
    emit('notice', spaceUnread(error))
  } finally {
    if (asked === generation) reading.value = false
  }
}
/** Why the space could not be read, as the board says it of the same read. */
function spaceUnread(error: unknown): string {
  if (error instanceof CutoverPendingError) return t('workItem.cutoverPending')
  const message = failureMessage(typedFailure(error))
  return t(message.key, message.params ?? {})
}
watch(
  spaceKey,
  () => {
    model.value = null
    void readSpace()
  },
  { immediate: true },
)

const { openRecord, parent } = useOpenCardModel(model, open)

function show(reference: string | null) {
  const at = space.value
  emit(
    'entity',
    reference === null || at === undefined
      ? undefined
      : planningWorkItemEntity({ space_ref: at, reference }),
  )
}
const trail = usePlanningCardTrail({ open: () => open.value, show })
// Closed from outside the card, by Back or by another module: the walk ends with it.
watch(open, (reference) => {
  if (reference === null) trail.reset()
})

const panel = useTemplateRef<InstanceType<typeof PlanningCardPanel>>('panel')

// References to the card's space open in the card, through its departure and onto its trail.
usePlanningReferenceLinks(space, model, (reference) => {
  if (!panel.value?.openFrom(reference)) trail.openItem(reference)
})

/** The chain on the board's graph, in the card's space: the overlay has no graph of its own. */
function showChain(chain: WorkItemChain, branch: string | null) {
  const target = bound.value
  if (!target) return
  const state = withChain(undefined, { reference: chain.root.reference, scope: chain.scope })
  emit('go', {
    module_id: 'planning',
    scope: { kind: 'space', space_ref: target.item.space_ref },
    state: { ...withBranch(state, branch), view: 'graph' },
  })
}

/** The work item whose card is on show, by the id a sender of alerts knows it by. */
const selectedId = computed(() => openRecord.value?.work_item_id ?? null)

/** What the open card is read and written with here, from the one read of its space. */
const shownCard = computed((): PlanningCardProps | null =>
  open.value && resourceRef.value && bound.value
    ? {
        reference: open.value,
        resourceRef: resourceRef.value,
        projectId: bound.value.projectId,
        refreshToken: 0,
        workflow: model.value?.workflow ?? null,
        spaceReading: reading.value,
        writable: writable.value,
        parent: parent.value,
        kind: openRecord.value?.kind,
        questionAsked: props.questionAsked,
        opensOn: trail.canGoBack.value ? null : props.opensOn,
        onChanged: readSpace,
        onChain: showChain,
        onQuestionTaken: () => emit('question-taken'),
      }
    : null,
)

defineExpose({ selectedId })
</script>

<template>
  <PlanningCardPanel
    ref="panel"
    :identity="identity"
    :label="openRecord?.title || open || ''"
    :trail="trail"
    :card="shownCard"
  />
</template>
