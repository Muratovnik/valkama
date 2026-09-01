import { defineComponent, h, nextTick, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlatformActivity } from '@/shared/api/platformActivity.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { SessionsPayload } from '@/shared/types/session.ts'

import { modulesPayload } from '../support/moduleRegistrations.ts'

const fetchModules = vi.fn()
const listActivity = vi.fn()
const listSessions = vi.fn()
const subscribeActivity = vi.fn()
const subscribeSessions = vi.fn()

vi.mock('@/shared/api/platformApi.ts', () => ({
  fetchModules: (...args: unknown[]) => fetchModules(...args),
}))

vi.mock('@/shared/api/api.ts', () => ({
  listActivity: (...args: unknown[]) => listActivity(...args),
  listSessions: (...args: unknown[]) => listSessions(...args),
  subscribeActivity: (...args: unknown[]) => subscribeActivity(...args),
  subscribeSessions: (...args: unknown[]) => subscribeSessions(...args),
}))

const { usePlatformLiveFeed } = await import('@/app/composables/usePlatformLiveFeed.ts')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

const renderEmpty = () => h('div')

function session(id: string, step: string, lastSeen: string) {
  return {
    attention: '',
    attention_seen: false,
    client: 'Codex',
    client_family: 'codex' as const,
    current_step: step,
    cwd: 'C:/workspace',
    ended_at: null,
    id,
    label: id,
    last_seen: lastSeen,
    quiet_seconds: 0,
    started_at: '2026-08-24T12:00:00Z',
    status: 'active' as const,
    work_item: null,
  }
}

function mountFeed() {
  const contextReady = ref(null) as Parameters<typeof usePlatformLiveFeed>[0]['contextReady']
  const moduleAuthorityReady = ref(false)
  const notice = ref('')
  const writeRoute = vi.fn<(next: PlatformRoute) => void>()
  let feed!: ReturnType<typeof usePlatformLiveFeed>

  const Host = defineComponent({
    setup() {
      feed = usePlatformLiveFeed({
        contextReady,
        moduleAuthorityReady,
        notice,
        text: {
          failure: (failure) => `failure:${failure.code}`,
          primaryBindingRequired: () => 'binding required',
          refreshed: () => 'refreshed',
        },
        loadContext: vi.fn(async () => {}),
        syncRouteResources: vi.fn(async () => {}),
        writeRoute,
      })
      return renderEmpty
    },
  })

  const wrapper = mount(Host)
  return { feed, moduleAuthorityReady, notice, wrapper }
}

describe('platform live resources', () => {
  let _activityListener: ((payload: PlatformActivity[]) => void) | undefined
  let sessionListener: ((payload: SessionsPayload) => void) | undefined
  let sessionFailure:
    ((failure: { code: string; retryable: boolean; status: number | null }) => void) | undefined
  let activityClose: ReturnType<typeof vi.fn>
  let sessionClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    _activityListener = undefined
    sessionListener = undefined
    sessionFailure = undefined
    activityClose = vi.fn()
    sessionClose = vi.fn()
    fetchModules.mockReset()
    listActivity.mockReset()
    listSessions.mockReset()
    subscribeActivity.mockReset()
    subscribeSessions.mockReset()
    fetchModules.mockResolvedValue(modulesPayload())
    listActivity.mockResolvedValue([])
    listSessions.mockResolvedValue({ inbox: [], sessions: [] })
    subscribeActivity.mockImplementation((listener: (payload: PlatformActivity[]) => void) => {
      _activityListener = listener
      return { close: activityClose }
    })
    subscribeSessions.mockImplementation(
      (
        listener: (payload: SessionsPayload) => void,
        onFailure: (failure: { code: string; retryable: boolean; status: number | null }) => void,
      ) => {
        sessionListener = listener
        sessionFailure = onFailure
        return { close: sessionClose }
      },
    )
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps a newer stream frame when the startup list resolves later', async () => {
    const startup = deferred<SessionsPayload>()
    listSessions.mockReturnValue(startup.promise)
    const { feed, wrapper } = mountFeed()
    await flushPromises()

    sessionListener?.({
      inbox: [],
      sessions: [session('session-1', 'new stream frame', '2026-08-24T12:05:00Z')],
    })
    await nextTick()
    startup.resolve({
      inbox: [],
      sessions: [session('session-1', 'stale list frame', '2026-08-24T12:01:00Z')],
    })
    await flushPromises()

    expect(feed.sessions.value[0]?.current_step).toBe('new stream frame')
    wrapper.unmount()
  })

  it('retains authoritative modules and owned streams during background refresh', async () => {
    const { feed, moduleAuthorityReady, wrapper } = mountFeed()
    await flushPromises()
    expect(feed.modulesAuthoritative.value).toBe(true)

    const refresh = deferred<ReturnType<typeof modulesPayload>>()
    fetchModules.mockReturnValueOnce(refresh.promise)
    const pending = feed.refreshAll()
    await nextTick()

    expect(feed.modulesAuthoritative.value).toBe(true)
    expect(moduleAuthorityReady.value).toBe(true)
    expect(activityClose).not.toHaveBeenCalled()
    expect(sessionClose).not.toHaveBeenCalled()

    refresh.resolve(modulesPayload())
    await pending
    wrapper.unmount()
  })

  it('keeps per-session revisions stable when only another session changes', async () => {
    const { feed, wrapper } = mountFeed()
    await flushPromises()
    sessionListener?.({
      inbox: [],
      sessions: [
        session('selected', 'unchanged', '2026-08-24T12:01:00Z'),
        session('other', 'first', '2026-08-24T12:01:00Z'),
      ],
    })
    await nextTick()

    const revisions = (
      feed as unknown as { sessionRevisions?: { value: Readonly<Record<string, string>> } }
    ).sessionRevisions
    const selectedRevision = revisions?.value.selected
    expect(selectedRevision).toBeTruthy()

    sessionListener?.({
      inbox: [],
      sessions: [
        session('selected', 'unchanged', '2026-08-24T12:01:00Z'),
        session('other', 'changed', '2026-08-24T12:02:00Z'),
      ],
    })
    await nextTick()

    expect(revisions?.value.selected).toBe(selectedRevision)
    expect(revisions?.value.other).not.toBe(selectedRevision)
    wrapper.unmount()
  })

  it('keeps modules and projects refresh failure through safe typed copy', async () => {
    const { feed, moduleAuthorityReady, notice, wrapper } = mountFeed()
    await flushPromises()
    const titles = feed.modules.value.map((module) => module.module_id)

    fetchModules.mockRejectedValueOnce(new Error('DISTINCT private module failure /srv/secret'))
    await feed.refreshAll()

    expect(feed.modules.value.map((module) => module.module_id)).toEqual(titles)
    expect(feed.modulesAuthoritative.value).toBe(true)
    expect(moduleAuthorityReady.value).toBe(true)
    expect(feed.modulesFailure.value).toEqual({
      code: 'request_failed',
      retryable: true,
      status: null,
    })
    expect(notice.value).toBe('failure:request_failed')
    expect(JSON.stringify(feed.modulesFailure.value)).not.toContain(
      'DISTINCT private module failure',
    )
    wrapper.unmount()
  })

  it('ignores a session callback after its stream owner closes', async () => {
    const { feed, wrapper } = mountFeed()
    await flushPromises()
    const closedListener = sessionListener
    closedListener?.({
      inbox: [],
      sessions: [session('session-1', 'owned frame', '2026-08-24T12:01:00Z')],
    })
    await nextTick()

    wrapper.unmount()
    closedListener?.({
      inbox: [],
      sessions: [session('session-1', 'orphan frame', '2026-08-24T12:02:00Z')],
    })
    await nextTick()

    expect(feed.sessions.value[0]?.current_step).toBe('owned frame')
    expect(sessionClose).toHaveBeenCalledOnce()
  })

  it('retains exact rows on stream failure and retries one replacement list and stream', async () => {
    const { feed, wrapper } = mountFeed()
    await flushPromises()
    const row = session('selected', 'committed', '2026-08-24T12:01:00Z')
    sessionListener?.({ inbox: [], sessions: [row] })
    await nextTick()

    sessionFailure?.({ code: 'stream_disconnected', status: null, retryable: true })
    await nextTick()

    expect(feed.sessions.value).toEqual([row])
    expect(feed.sessionsState.value.status).toBe('degraded')
    expect(
      feed.sessionsState.value.status === 'degraded' ? feed.sessionsState.value.reason : '',
    ).toBe('failure:stream_disconnected')

    const listsBefore = listSessions.mock.calls.length
    const streamsBefore = subscribeSessions.mock.calls.length
    feed.retrySessions()
    await flushPromises()

    expect(sessionClose).toHaveBeenCalledOnce()
    expect(listSessions).toHaveBeenCalledTimes(listsBefore + 1)
    expect(subscribeSessions).toHaveBeenCalledTimes(streamsBefore + 1)
    wrapper.unmount()
  })
})
