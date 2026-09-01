import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SessionFeed from '@/widgets/session-detail/SessionFeed.vue'

import { messages } from '@/shared/i18n/index.ts'
import type { SessionFeed as SessionFeedPayload } from '@/shared/types/session.ts'

const fetchSessionFeed = vi.fn()

vi.mock('@/shared/api/api', () => ({
  fetchSessionFeed: (...args: unknown[]) => fetchSessionFeed(...args),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function payload(session: string, detail: string): SessionFeedPayload {
  return {
    session,
    events: [
      {
        at: 'not-a-date',
        detail: JSON.stringify({ summary: detail }),
        id: detail === 'first event' ? 1 : 2,
        kind: 'turn.completed',
        klass: 'stream',
        server: 'codex',
        status: 'complete',
        tool: '',
      },
    ],
  }
}

function mountFeed() {
  return mount(SessionFeed, {
    props: { sessionId: 'selected', revision: 'r1' },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'ru',
          fallbackLocale: 'en',
          messages,
        }),
      ],
    },
  })
}

describe('session feed refresh lifecycle', () => {
  beforeEach(() => fetchSessionFeed.mockReset())

  it('keeps the selected session feed visible while its newer revision loads', async () => {
    fetchSessionFeed.mockResolvedValueOnce(payload('selected', 'first event'))
    const wrapper = mountFeed()
    await flushPromises()
    expect(wrapper.text()).toContain('first event')

    const next = deferred<SessionFeedPayload>()
    fetchSessionFeed.mockReturnValueOnce(next.promise)
    await wrapper.setProps({ revision: 'r2' })

    expect(wrapper.text()).toContain('first event')
    expect(wrapper.get('ol').attributes('aria-busy')).toBe('true')

    next.resolve(payload('selected', 'second event'))
    await flushPromises()
    expect(wrapper.text()).toContain('second event')
    expect(wrapper.text()).not.toContain('first event')
  })

  it('does not show the previous session feed under a new session identity', async () => {
    fetchSessionFeed.mockResolvedValueOnce(payload('selected', 'first event'))
    const wrapper = mountFeed()
    await flushPromises()

    const next = deferred<SessionFeedPayload>()
    fetchSessionFeed.mockReturnValueOnce(next.promise)
    await wrapper.setProps({ sessionId: 'other', revision: 'other-r1' })

    expect(wrapper.text()).not.toContain('first event')
    expect(wrapper.find('.feed-empty').exists()).toBe(false)

    next.resolve(payload('other', 'other event'))
    await flushPromises()
    expect(wrapper.text()).toContain('other event')
  })

  it('renders loading, empty, cold failure, and an executable retry', async () => {
    const initial = deferred<SessionFeedPayload>()
    fetchSessionFeed.mockReturnValueOnce(initial.promise)
    const wrapper = mountFeed()
    const loadingPanel = wrapper.get('.platform-state-panel')
    expect(loadingPanel.attributes('data-tone')).toBe('info')
    expect(loadingPanel.attributes('aria-busy')).toBe('true')

    initial.resolve({ session: 'selected', events: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('События этой сессии не зафиксированы.')

    fetchSessionFeed.mockRejectedValueOnce({
      code: 'session_feed_failed',
      status: 500,
      retryable: true,
    })
    await wrapper.setProps({ revision: 'r2' })
    await flushPromises()
    expect(wrapper.find('.platform-state-panel.error').exists()).toBe(false)
    expect(wrapper.text()).toContain('Не удалось загрузить активность сессии.')
    expect(wrapper.get('button').text()).toContain('Повторить')

    fetchSessionFeed.mockResolvedValueOnce(payload('selected', 'after retry'))
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(fetchSessionFeed).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('after retry')
  })

  it('retains the exact feed on same-key failure and rejects a late prior generation', async () => {
    fetchSessionFeed.mockResolvedValueOnce(payload('selected', 'first event'))
    const wrapper = mountFeed()
    await flushPromises()

    const stale = deferred<SessionFeedPayload>()
    fetchSessionFeed.mockReturnValueOnce(stale.promise)
    await wrapper.setProps({ revision: 'r2' })
    stale.reject({ code: 'session_feed_failed', status: 500, retryable: true })
    await flushPromises()
    expect(wrapper.text()).toContain('first event')
    expect(wrapper.text()).toContain('Не удалось загрузить активность сессии.')

    const old = deferred<SessionFeedPayload>()
    const current = deferred<SessionFeedPayload>()
    fetchSessionFeed.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await wrapper.setProps({ sessionId: 'old', revision: 'old-r1' })
    await wrapper.setProps({ sessionId: 'current', revision: 'current-r1' })
    current.resolve(payload('current', 'current event'))
    await flushPromises()
    old.resolve(payload('old', 'late old event'))
    await flushPromises()
    expect(wrapper.text()).toContain('current event')
    expect(wrapper.text()).not.toContain('late old event')
  })
})
