/**
 * One scope-keyed Improvements snapshot, its live replacement, and its commands.
 *
 * The ResourceState generation orders HTTP and SSE arrivals together. A same-key
 * request keeps the committed snapshot visible; changing scope isolates it before
 * the next answer arrives. Case detail has its own generation because it is a
 * disclosure read, not a second source for the page snapshot.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  analyzeImprovements,
  approveImprovement,
  cancelImprovementJob,
  fetchImprovementCase,
  fetchImprovementsSnapshot,
  runImprovementAction,
  saveImprovementProfile,
  startEvaluation,
  subscribeImprovements,
} from '@/entities/improvement/api/improvementsApi.ts'
import type { ImprovementsStream } from '@/entities/improvement/api/improvementsApi.ts'
import type {
  ImprovementAction,
  ImprovementActionRequest,
  ImprovementCase,
  ImprovementCaseDetail,
  ImprovementCaseSummary,
  ImprovementJob,
  ImprovementProfile,
  ImprovementsReadModel,
} from '@/entities/improvement/utils/improvementDerivations.ts'
import {
  canCancelImprovementJob,
  improvementActivationState,
  IMPROVEMENTS_INTERFACE_VERSION,
  visibleImprovementJobs,
} from '@/entities/improvement/utils/improvementDerivations.ts'

import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { uiReady } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  cancelResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'

type RuntimeSource = {
  active: () => boolean
  scope: () => string
}

type ActionOptions = Partial<Omit<ImprovementActionRequest, 'scope' | 'action'>>

const keyFor = (scope: string): string => `improvements:${scope}`

/** A profile may only be enabled once it says what it is for. */
const canEnableProfile = (profile: ImprovementProfile): boolean =>
  Boolean(
    profile.purpose.trim() && profile.expected_behavior.trim() && profile.planning_space.trim(),
  )

export function useImprovementsRuntime(source: RuntimeSource) {
  const { t } = useI18n()
  const resource = ref(createResource<Observed<ImprovementsReadModel>>()) as Ref<
    ResourceState<Observed<ImprovementsReadModel>>
  >
  const selected = ref<ImprovementCase | null>(null)
  const cancellingJobId = ref<number | null>(null)
  const saving = ref(false)
  const busy = ref(false)
  const message = ref('')
  const operationFailure = ref<TypedFailure | null>(null)
  const stream = ref<ImprovementsStream | null>(null)
  const settingsOpen = ref(false)
  const selectingCaseId = ref<number | null>(null)
  let viewGeneration = 0
  let detailGeneration = 0
  let activeScope: string | null = null

  const state = computed<PlatformUiState<ImprovementsReadModel>>(() =>
    resourceUiState(resource.value, { failureReason: () => 'improvements.loadError' }),
  )
  const snapshot = computed(() => ('payload' in state.value ? state.value.payload : null))
  const profile = computed(() => snapshot.value?.profile ?? null)
  const cases = computed(() => snapshot.value?.cases ?? [])
  const jobs = computed(() => snapshot.value?.jobs ?? [])
  const signalSummary = computed(() => snapshot.value?.signal_summary ?? null)
  const visibleJobs = computed(() => visibleImprovementJobs(jobs.value))
  const activation = computed(() =>
    profile.value && signalSummary.value
      ? improvementActivationState(profile.value, signalSummary.value, cases.value.length)
      : null,
  )
  const canAnalyze = computed(
    () =>
      profile.value?.enabled === true &&
      profile.value.capabilities.can_analyze &&
      activation.value?.status !== 'needs_evidence',
  )
  const operationError = computed(() => {
    if (operationFailure.value === null) return ''
    const copy = failureMessage(operationFailure.value)
    return t(copy.key, copy.params ?? {})
  })

  function isCurrent(scope: string, generation: number): boolean {
    return source.active() && source.scope() === scope && viewGeneration === generation
  }

  function clearOperationNotice() {
    message.value = ''
    operationFailure.value = null
  }

  function failOperation(error: unknown, fallback = 'mutation_failed') {
    message.value = ''
    operationFailure.value = typedFailure(error, fallback)
  }

  function caseFromDetail(detail: ImprovementCaseDetail, scope: string): ImprovementCase | null {
    if (signalSummary.value === null) return null
    return {
      ...detail,
      interface_version: IMPROVEMENTS_INTERFACE_VERSION,
      scope,
      signal_summary: signalSummary.value,
    }
  }

  async function select(
    item: ImprovementCaseSummary,
    scope = source.scope(),
    generation = viewGeneration,
  ) {
    const request = ++detailGeneration
    selectingCaseId.value = item.id
    try {
      const detail = await fetchImprovementCase(scope, item.id)
      if (isCurrent(scope, generation) && detailGeneration === request) selected.value = detail
    } catch (error) {
      if (isCurrent(scope, generation) && detailGeneration === request)
        failOperation(error, 'request_failed')
    } finally {
      if (detailGeneration === request) selectingCaseId.value = null
    }
  }

  function syncSelection(payload: ImprovementsReadModel, scope: string, generation: number) {
    const currentId = selected.value?.id
    const next =
      (currentId === undefined
        ? undefined
        : payload.cases.find((candidate) => candidate.id === currentId)) ?? payload.cases[0]
    if (next === undefined) {
      detailGeneration += 1
      selectingCaseId.value = null
      selected.value = null
      return
    }
    void select(next, scope, generation)
  }

  function commitSnapshot(
    payload: ImprovementsReadModel,
    scope: string,
    generation: number,
    resourceGeneration: number,
  ): boolean {
    if (!isCurrent(scope, generation)) return false
    const before = resource.value
    const next = resolveResource(before, resourceGeneration, keyFor(scope), {
      at: new Date().toISOString(),
      state: uiReady(payload),
    })
    if (next === before) return false
    resource.value = next
    syncSelection(payload, scope, generation)
    return true
  }

  function commitStreamSnapshot(payload: ImprovementsReadModel, scope: string, generation: number) {
    if (!isCurrent(scope, generation)) return
    resource.value = beginResource(resource.value, keyFor(scope))
    commitSnapshot(payload, scope, generation, resource.value.generation)
  }

  async function loadSnapshot(
    scope = source.scope(),
    generation = viewGeneration,
  ): Promise<boolean> {
    if (!isCurrent(scope, generation)) return false
    resource.value = beginResource(resource.value, keyFor(scope))
    const requestGeneration = resource.value.generation
    try {
      return commitSnapshot(
        await fetchImprovementsSnapshot(scope),
        scope,
        generation,
        requestGeneration,
      )
    } catch (error) {
      if (!isCurrent(scope, generation)) return false
      resource.value = rejectResource(
        resource.value,
        requestGeneration,
        keyFor(scope),
        typedFailure(error),
      )
      return false
    }
  }

  function failStream(error: unknown, scope: string, generation: number) {
    if (!isCurrent(scope, generation)) return
    const key = keyFor(scope)
    // The independent HTTP request owns the cold-load outcome. A transport
    // refusal may only degrade a snapshot that has already been accepted.
    if (resource.value.data === null) return
    resource.value = beginResource(resource.value, key)
    const streamFailureGeneration = resource.value.generation
    resource.value = rejectResource(
      resource.value,
      streamFailureGeneration,
      key,
      typedFailure(error, 'stream_disconnected'),
    )
  }

  function openStream(scope: string, generation: number) {
    stream.value?.close()
    try {
      stream.value = subscribeImprovements(
        scope,
        (payload) => commitStreamSnapshot(payload, scope, generation),
        (error) => failStream(error, scope, generation),
      )
    } catch (error) {
      stream.value = null
      failStream(error, scope, generation)
    }
  }

  function closeStream() {
    stream.value?.close()
    stream.value = null
  }

  async function refreshAfterMutation(scope: string, generation: number) {
    if (isCurrent(scope, generation)) await loadSnapshot(scope, generation)
  }

  async function saveProfile(next: ImprovementProfile) {
    const scope = source.scope()
    const generation = viewGeneration
    if (next.enabled && !canEnableProfile(next)) {
      operationFailure.value = null
      message.value = t('improvements.profileRequired')
      return
    }
    clearOperationNotice()
    saving.value = true
    try {
      await saveImprovementProfile({
        ...next,
        scope,
        expected_revision: next.revision,
      })
      if (!isCurrent(scope, generation)) return
      settingsOpen.value = false
      message.value = t('improvements.profileSaved')
      await refreshAfterMutation(scope, generation)
    } catch (error) {
      if (isCurrent(scope, generation)) failOperation(error)
    } finally {
      if (isCurrent(scope, generation)) saving.value = false
    }
  }

  async function runNow() {
    const scope = source.scope()
    const generation = viewGeneration
    if (!canAnalyze.value) return
    clearOperationNotice()
    busy.value = true
    try {
      await analyzeImprovements({ scope, trigger: 'manual' })
      if (!isCurrent(scope, generation)) return
      message.value = t('improvements.analysisQueued')
      await refreshAfterMutation(scope, generation)
    } catch (error) {
      if (isCurrent(scope, generation)) failOperation(error)
    } finally {
      if (isCurrent(scope, generation)) busy.value = false
    }
  }

  async function action(actionName: ImprovementAction, options: ActionOptions = {}) {
    const current = selected.value
    const scope = source.scope()
    const generation = viewGeneration
    if (!current) return
    clearOperationNotice()
    busy.value = true
    try {
      const result =
        actionName === 'approve'
          ? await approveImprovement(scope, current.id, current.revision, options.reason ?? '')
          : await runImprovementAction(scope, current.id, actionName, {
              ...options,
              expected_revision: current.revision,
            })
      if (!isCurrent(scope, generation)) return
      const detail = 'case' in result ? result.case : result
      selected.value = caseFromDetail(detail, scope)
      message.value = t('improvements.actionApplied')
      await refreshAfterMutation(scope, generation)
    } catch (error) {
      if (isCurrent(scope, generation)) failOperation(error)
    } finally {
      if (isCurrent(scope, generation)) busy.value = false
    }
  }

  async function evaluate(phase: 'baseline' | 'candidate', repo: string, gitRef: string) {
    const current = selected.value
    const scope = source.scope()
    const generation = viewGeneration
    if (!current || !repo.trim() || !gitRef.trim()) {
      operationFailure.value = null
      message.value = t('improvements.evalRequired')
      return
    }
    clearOperationNotice()
    busy.value = true
    try {
      await startEvaluation({
        scope,
        case_id: current.id,
        phase,
        repo: repo.trim(),
        git_ref: gitRef.trim(),
      })
      if (!isCurrent(scope, generation)) return
      message.value = t('improvements.evalQueued', { phase: t(`improvements.phase.${phase}`) })
      await refreshAfterMutation(scope, generation)
    } catch (error) {
      if (isCurrent(scope, generation)) failOperation(error)
    } finally {
      if (isCurrent(scope, generation)) busy.value = false
    }
  }

  async function cancelJob(job: ImprovementJob) {
    if (!canCancelImprovementJob(job) || cancellingJobId.value !== null) return
    const scope = source.scope()
    const generation = viewGeneration
    clearOperationNotice()
    cancellingJobId.value = job.id
    try {
      await cancelImprovementJob(scope, job.id)
      if (!isCurrent(scope, generation)) return
      message.value = t('improvements.jobCancelled', { id: job.id })
      await refreshAfterMutation(scope, generation)
    } catch (error) {
      if (isCurrent(scope, generation)) failOperation(error)
    } finally {
      if (isCurrent(scope, generation)) cancellingJobId.value = null
    }
  }

  async function retryLoad() {
    if (!source.active()) return
    await loadSnapshot(source.scope(), viewGeneration)
  }

  async function activateView() {
    viewGeneration += 1
    detailGeneration += 1
    const generation = viewGeneration
    const scope = source.scope()
    closeStream()
    clearOperationNotice()
    busy.value = false
    saving.value = false
    cancellingJobId.value = null
    selectingCaseId.value = null
    settingsOpen.value = false
    if (!source.active()) {
      resource.value = cancelResource(resource.value)
      return
    }
    if (activeScope !== scope) selected.value = null
    activeScope = scope
    openStream(scope, generation)
    await loadSnapshot(scope, generation)
  }

  onMounted(() => void activateView())
  onBeforeUnmount(() => {
    viewGeneration += 1
    detailGeneration += 1
    closeStream()
    resource.value = cancelResource(resource.value)
  })
  watch([() => source.active(), () => source.scope()], () => void activateView())

  return {
    action,
    activation,
    busy,
    canAnalyze,
    cancelJob,
    cancellingJobId,
    cases,
    evaluate,
    jobs,
    message,
    operationError,
    profile,
    retryLoad,
    runNow,
    saveProfile,
    saving,
    select,
    selected,
    settingsOpen,
    signalSummary,
    state,
    visibleJobs,
  }
}
