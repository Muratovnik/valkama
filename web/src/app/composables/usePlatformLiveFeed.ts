import { computed, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

import {
  listActivity,
  listSessions,
  subscribeActivity,
  subscribeSessions,
} from '@/shared/api/api.ts'
import { activitySpaceKey } from '@/shared/api/platformActivity.ts'
import type { PlatformActivity } from '@/shared/api/platformActivity.ts'
import { fetchModules } from '@/shared/api/platformApi.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleManifest, ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import { planningSpaceRef, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { resolveManifestRouteAuthority } from '@/shared/api/platformRoute.ts'
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
import { typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
import type { AgentSession, SessionsPayload } from '@/shared/types/session.ts'

export type ConnectionState = 'connecting' | 'live' | 'reconnecting'

interface LiveFeedInputs {
  contextReady: Ref<PlatformContextReady | null>
  moduleAuthorityReady: Ref<boolean>
  /** The shell's one status line; the feed writes outcomes into it. */
  notice: Ref<string>
  text: {
    failure: (failure: TypedFailure) => string
    primaryBindingRequired: () => string
    refreshed: () => string
  }
  loadContext: () => Promise<void>
  /** Reload everything the current route needs. */
  syncRouteResources: () => Promise<void>
  writeRoute: (next: PlatformRoute) => void
}

const NOTICE_LIFETIME_MS = 3200
const MODULES_KEY = 'modules'
const ACTIVITY_KEY = 'activity'
const SESSIONS_KEY = 'sessions:global'

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A feed revision changes only when facts about this exact session change.
 *
 * `quiet_seconds` is deliberately absent: it is presentation time derived by
 * the monitor and must not turn a clock tick into a refetch of durable events.
 */
function sessionRevision(session: AgentSession): string {
  return JSON.stringify([
    session.attention,
    session.attention_seen,
    session.current_step,
    session.ended_at,
    session.execution_id ?? '',
    session.last_seen,
    session.presence ?? '',
    session.status,
    session.work_item,
  ])
}

/**
 * Where an activity row navigates, or nowhere.
 *
 * The row names a work item by reference, which carries its space key and says
 * nothing about which store that space lives in. Exactly one mapped resource
 * may answer to that key: zero means the row belongs to no bound project, and
 * two means the answer would be a guess, which is the failure the Kernel
 * refuses everywhere else too.
 */
export function resolveActivityRoute(
  item: PlatformActivity,
  context: PlatformContextReady | null,
  registrations: readonly ModuleRegistration[],
): PlatformRoute | null {
  return resolveWorkItemRoute(activitySpaceKey(item), item.reference, context, registrations)
}

/**
 * The same question asked by a session: which route opens this exact item.
 *
 * Shared with the activity row rather than written twice, because the rule it
 * enforces is the one that matters — exactly one mapped resource may answer to
 * a space key — and two copies of a rule are two chances to relax one of them.
 */
export function resolveWorkItemRoute(
  key: string,
  reference: string,
  context: PlatformContextReady | null,
  registrations: readonly ModuleRegistration[],
): PlatformRoute | null {
  const candidates = (context?.projects ?? [])
    .filter((project) => project.binding_state === 'mapped')
    .flatMap((project) =>
      project.resources
        .filter((resource) => resource.state === 'mapped')
        .flatMap((resource) => {
          const space = safeSpaceRef(resource.resource_ref)
          return space?.space_key === key ? [{ project, space }] : []
        }),
    )
  if (candidates.length !== 1) return null
  const [{ project, space }] = candidates
  const next: PlatformRoute = {
    module_id: 'planning',
    scope: { kind: 'project', project_ref: { project_id: project.project_id } },
    entity: planningWorkItemEntity({ space_ref: space, reference }),
  }
  const registration = registrations.find(
    (candidate) => candidate.manifest.module_id === 'planning' && candidate.state === 'enabled',
  )
  if (
    !registration ||
    resolveManifestRouteAuthority(registration.manifest, next).status === 'unavailable'
  )
    return null
  return next
}

/** A resource that is not a planning space, or is malformed, simply does not match. */
function safeSpaceRef(resource: EntityRef): PlanningSpaceRef | undefined {
  try {
    return planningSpaceRef(resource)
  } catch {
    return undefined
  }
}

/**
 * What the shell knows about the running system, and how it stays current.
 *
 * Sessions and activity arrive over two event streams rather than by polling,
 * with one list read at startup so the first paint is not empty. The
 * connection state is derived from whether those reads succeed, which is why
 * every loader here sets it.
 */
export function usePlatformLiveFeed(inputs: LiveFeedInputs) {
  const moduleResource = ref(createResource<readonly ModuleRegistration[]>()) as Ref<
    ResourceState<readonly ModuleRegistration[]>
  >
  const activityResource = ref(createResource<PlatformActivity[]>()) as Ref<
    ResourceState<PlatformActivity[]>
  >
  const sessionResource = ref(createResource<Observed<SessionsPayload>>()) as Ref<
    ResourceState<Observed<SessionsPayload>>
  >
  const moduleRegistrations = computed(() => moduleResource.value.data ?? [])
  const modules = computed<readonly ModuleManifest[]>(() =>
    moduleRegistrations.value
      .filter((registration) => registration.state === 'enabled')
      .map((registration) => registration.manifest),
  )
  const modulesAuthoritative = computed(() => moduleResource.value.data !== null)
  const modulesSettled = computed(
    () => moduleResource.value.status !== 'idle' && moduleResource.value.status !== 'loading',
  )
  const modulesFailure = computed<TypedFailure | null>(() => moduleResource.value.failure)
  const sessionsState = computed(() =>
    resourceUiState(sessionResource.value, {
      empty: (payload) => payload.sessions.length === 0,
      emptyReason: 'monitor.empty',
      failureReason: inputs.text.failure,
    }),
  )
  const sessionRevisions = ref<Readonly<Record<string, string>>>({})
  const connectionState = ref<ConnectionState>('connecting')
  const refreshing = ref(false)

  async function loadModules() {
    moduleResource.value = beginResource(moduleResource.value, MODULES_KEY)
    const generation = moduleResource.value.generation
    try {
      const payload = await fetchModules()
      moduleResource.value = resolveResource(
        moduleResource.value,
        generation,
        MODULES_KEY,
        payload.modules,
      )
    } catch (error) {
      const failure = typedFailure(error, 'request_failed')
      moduleResource.value = rejectResource(moduleResource.value, generation, MODULES_KEY, failure)
      connectionState.value = 'reconnecting'
      throw failure
    } finally {
      inputs.moduleAuthorityReady.value = modulesAuthoritative.value
    }
  }

  async function refreshAll() {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await Promise.all([loadModules(), inputs.loadContext(), inputs.syncRouteResources()])
      connectionState.value = 'live'
      inputs.notice.value = inputs.text.refreshed()
    } catch (error) {
      inputs.notice.value = inputs.text.failure(typedFailure(error, 'request_failed'))
    } finally {
      refreshing.value = false
      window.setTimeout(() => (inputs.notice.value = ''), NOTICE_LIFETIME_MS)
    }
  }

  function updateSessionRevisions(payload: SessionsPayload) {
    sessionRevisions.value = Object.fromEntries(
      payload.sessions.map((session) => [session.id, sessionRevision(session)]),
    )
  }

  let activityEpoch = 0
  let sessionEpoch = 0
  let activityStream: { close: () => void } | null = null
  let sessionStream: { close: () => void } | null = null

  function commitActivity(payload: PlatformActivity[], epoch: number) {
    if (epoch !== activityEpoch) return
    activityResource.value = beginResource(activityResource.value, ACTIVITY_KEY)
    const generation = activityResource.value.generation
    activityResource.value = resolveResource(
      activityResource.value,
      generation,
      ACTIVITY_KEY,
      payload,
    )
    connectionState.value = 'live'
  }

  function commitSessions(payload: SessionsPayload, epoch: number) {
    if (epoch !== sessionEpoch) return
    sessionResource.value = beginResource(sessionResource.value, SESSIONS_KEY)
    const generation = sessionResource.value.generation
    sessionResource.value = resolveResource(sessionResource.value, generation, SESSIONS_KEY, {
      at: new Date().toISOString(),
      state: uiReady(payload),
    })
    updateSessionRevisions(payload)
    connectionState.value = 'live'
  }

  /** Whether a row leads anywhere, which is the same question as following it. */
  function activityNavigable(item: PlatformActivity): boolean {
    return resolveActivityRoute(item, inputs.contextReady.value, moduleRegistrations.value) !== null
  }

  /**
   * Follow an activity only when exactly one bound project answers to its space.
   */
  function selectActivity(item: PlatformActivity) {
    const next = resolveActivityRoute(item, inputs.contextReady.value, moduleRegistrations.value)
    if (!next) {
      inputs.notice.value = inputs.text.primaryBindingRequired()
      return
    }
    inputs.writeRoute(next)
  }

  function moduleEnabled(moduleId: string): boolean {
    return (
      modulesAuthoritative.value &&
      moduleRegistrations.value.some(
        (registration) =>
          registration.manifest.module_id === moduleId && registration.state === 'enabled',
      )
    )
  }

  const activities = computed(() =>
    moduleEnabled('planning') ? (activityResource.value.data ?? []) : [],
  )
  const sessions = computed(() =>
    moduleEnabled('sessions') && 'payload' in sessionsState.value
      ? sessionsState.value.payload.sessions
      : [],
  )

  function startActivityFeed() {
    const epoch = ++activityEpoch
    activityResource.value = beginResource(activityResource.value, ACTIVITY_KEY)
    const listGeneration = activityResource.value.generation
    activityStream = subscribeActivity((payload) => commitActivity(payload, epoch))
    void listActivity()
      .then((payload) => {
        if (epoch !== activityEpoch) return
        const resolved = resolveResource(
          activityResource.value,
          listGeneration,
          ACTIVITY_KEY,
          payload,
        )
        if (resolved === activityResource.value) return
        activityResource.value = resolved
        connectionState.value = 'live'
      })
      .catch((error: unknown) => {
        if (epoch !== activityEpoch) return
        activityResource.value = rejectResource(
          activityResource.value,
          listGeneration,
          ACTIVITY_KEY,
          failureText(error),
        )
        connectionState.value = 'reconnecting'
      })
  }

  function stopActivityFeed() {
    activityEpoch += 1
    activityStream?.close()
    activityStream = null
    activityResource.value = cancelResource(activityResource.value)
  }

  function startSessionFeed() {
    const epoch = ++sessionEpoch
    sessionResource.value = beginResource(sessionResource.value, SESSIONS_KEY)
    const listGeneration = sessionResource.value.generation
    sessionStream = subscribeSessions(
      (payload) => commitSessions(payload, epoch),
      (failure) => failSessions(failure, epoch),
    )
    void listSessions()
      .then((payload) => {
        if (epoch !== sessionEpoch) return
        const resolved = resolveResource(sessionResource.value, listGeneration, SESSIONS_KEY, {
          at: new Date().toISOString(),
          state: uiReady(payload),
        })
        if (resolved === sessionResource.value) return
        sessionResource.value = resolved
        updateSessionRevisions(payload)
        connectionState.value = 'live'
      })
      .catch((error: unknown) => {
        if (epoch !== sessionEpoch) return
        sessionResource.value = rejectResource(
          sessionResource.value,
          listGeneration,
          SESSIONS_KEY,
          typedFailure(error, 'sessions_request_failed'),
        )
        connectionState.value = 'reconnecting'
      })
  }

  function failSessions(failure: TypedFailure, epoch: number) {
    if (epoch !== sessionEpoch) return
    if (sessionResource.value.pendingKey !== SESSIONS_KEY)
      sessionResource.value = beginResource(sessionResource.value, SESSIONS_KEY)
    sessionResource.value = rejectResource(
      sessionResource.value,
      sessionResource.value.generation,
      SESSIONS_KEY,
      failure,
    )
    connectionState.value = 'reconnecting'
  }

  function stopSessionFeed() {
    sessionEpoch += 1
    sessionStream?.close()
    sessionStream = null
    sessionResource.value = cancelResource(sessionResource.value)
  }

  /** Replace the owned list and stream once, retaining the committed snapshot. */
  function retrySessions() {
    stopSessionFeed()
    startSessionFeed()
  }

  function syncOwnedFeeds() {
    if (moduleEnabled('planning')) {
      if (activityStream === null) startActivityFeed()
    } else if (activityStream !== null) stopActivityFeed()
    if (moduleEnabled('sessions')) {
      if (sessionStream === null) startSessionFeed()
    } else if (sessionStream !== null) stopSessionFeed()
  }

  watch([moduleRegistrations, modulesAuthoritative], syncOwnedFeeds)
  void Promise.all([loadModules(), inputs.loadContext()])
    .then(async () => {
      await inputs.syncRouteResources()
      connectionState.value = 'live'
    })
    .catch(() => {
      connectionState.value = 'reconnecting'
    })

  onUnmounted(() => {
    stopActivityFeed()
    stopSessionFeed()
  })

  return {
    modules,
    moduleRegistrations,
    modulesAuthoritative,
    modulesSettled,
    modulesFailure,
    activities,
    sessions,
    sessionsState,
    sessionRevisions,
    connectionState,
    refreshing,
    loadModules,
    refreshAll,
    retrySessions,
    activityNavigable,
    selectActivity,
  }
}
