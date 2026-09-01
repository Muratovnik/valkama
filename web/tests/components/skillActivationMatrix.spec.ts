/**
 * The one thing this screen could get badly wrong.
 *
 * "Off in this project" and "this client has no per-project answer" look
 * identical in a grid of switches, and only one of them is a decision somebody
 * made. So the cases here are almost entirely about which cells offer a control
 * and which only report — the fictional universality §15.4 forbids is a switch
 * that appears to change one project and changes every one.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SkillActivationMatrix from '@/pages/skills/components/SkillActivationMatrix.vue'

import { messages } from '@/shared/i18n/index'

import { skillsPayload } from '../browser/skillsFixtures.ts'
import { present } from '../support/present.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from '../support/request.ts'

function statusOf(enabled: boolean | null): string {
  if (enabled === null) return 'unavailable'
  return enabled ? 'enabled' : 'disabled'
}

function cell(enabled: boolean | null, over: Record<string, unknown> = {}) {
  return {
    enabled,
    can_toggle: enabled !== null,
    status: statusOf(enabled),
    reason: null,
    project_scope: true,
    ...over,
  }
}

const matrix = {
  interface_version: 'skills',
  as_of: '2026-08-22T00:00:00Z',
  clients: [
    { id: 'codex', project_scope: false },
    { id: 'claude', project_scope: true },
  ],
  // Both on one board, which is the live registry's own shape rather than an
  // edge case: a project's single human-readable field is the board it posts
  // to, and projects are meant to be able to share one.
  projects: [
    { project_id: 'alpha', project_title: 'Shared Board' },
    { project_id: 'beta', project_title: 'Shared Board' },
  ],
  skills: [
    {
      key: 'global:review',
      name: 'review',
      scope: 'global',
      owner_project_id: null,
      skill_ref: {
        provider_id: 'filesystem-catalogue',
        root_id: 'global-agent-skills',
        skill_id: 'review',
        content_hash: null,
      },
      cells: [
        {
          project_id: 'alpha',
          clients: {
            claude: cell(false),
            codex: cell(true, {
              project_scope: false,
              can_toggle: false,
              reason: 'codex_activation_is_not_project_scoped',
            }),
          },
        },
        {
          project_id: 'beta',
          clients: {
            claude: cell(true),
            codex: cell(true, {
              project_scope: false,
              can_toggle: false,
              reason: 'codex_activation_is_not_project_scoped',
            }),
          },
        },
      ],
    },
  ],
  truncated: false,
}

function matrixFetch(post?: () => unknown) {
  // The write goes through `secureFetch`, which fetches a session token first,
  // so a mock without the bootstrap never reaches the endpoint under test.
  return vi.fn(
    withSecurityBootstrap(async (input, init) => {
      const url = requestUrl(input)
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(post?.() ?? {}), { status: 200 })
      }
      if (url.startsWith('/api/modules/skills/matrix')) {
        return new Response(JSON.stringify(matrix), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }),
  )
}

function page(props: { revision?: number; skillKey?: string } = {}) {
  const i18n = createI18n({ legacy: false, locale: 'en', messages })
  return mount(SkillActivationMatrix, { props, global: { plugins: [i18n] } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SkillActivationMatrix', () => {
  it('offers a switch only where the client holds a per-project answer', async () => {
    vi.stubGlobal('fetch', matrixFetch())
    const wrapper = page()
    await flushPromises()

    // Two projects × two clients, and exactly the two Claude cells are
    // controls. The Codex cells report a value they cannot vary here.
    expect(wrapper.findAll('.matrix-cell')).toHaveLength(4)
    expect(wrapper.findAll('.toggle-switch, [role="switch"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('One setting everywhere')
    expect(wrapper.text()).toContain('only per-project settings are editable here')
  })

  it('shows one global skill off in one project and on in another', async () => {
    vi.stubGlobal('fetch', matrixFetch())
    const wrapper = page()
    await flushPromises()

    const switches = wrapper.findAll('[role="switch"]')
    expect(switches[0]?.attributes('aria-checked')).toBe('false')
    expect(switches[1]?.attributes('aria-checked')).toBe('true')
  })

  it('a toggle names the project it is changing', async () => {
    const fetch = matrixFetch(() => skillsPayload)
    vi.stubGlobal('fetch', fetch)
    const wrapper = page()
    await flushPromises()

    await present(wrapper.findAll('[role="switch"]')[0], 'the first switch').trigger('click')
    await flushPromises()

    const write = present(
      fetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST'),
      'the activation write',
    )
    const body = JSON.parse(requestBody((write[1] as RequestInit).body))
    expect(body).toEqual({
      key: 'global:review',
      client: 'claude',
      enabled: true,
      project: 'alpha',
    })
    expect(wrapper.emitted('updated')?.at(-1)).toEqual([skillsPayload])
  })

  it('disables every affected switch until one matrix write settles', async () => {
    const write = deferred<Response>()
    const delegate = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return write.promise
      if (requestUrl(input).startsWith('/api/modules/skills/matrix')) {
        return new Response(JSON.stringify(matrix), { status: 200 })
      }
      throw new Error(`unexpected request: ${requestUrl(input)}`)
    })
    vi.stubGlobal('fetch', withSecurityBootstrap(delegate as typeof fetch))
    const wrapper = page()
    await flushPromises()

    await present(wrapper.findAll('[role="switch"]')[0], 'the first switch').trigger('click')
    await vi.waitFor(() =>
      expect(
        wrapper
          .findAll('[role="switch"]')
          .every((control) => control.attributes('disabled') === ''),
      ).toBe(true),
    )
    await present(wrapper.findAll('[role="switch"]')[1], 'the second switch').trigger('click')
    expect(delegate.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)

    write.resolve(new Response(JSON.stringify(skillsPayload), { status: 200 }))
    await flushPromises()
    expect(
      wrapper
        .findAll('[role="switch"]')
        .every((control) => control.attributes('disabled') === undefined),
    ).toBe(true)
  })

  it('tells two projects apart when they share one board', async () => {
    // A synthetic reading has `sample-project` and `example-workspace` both reading
    // `Alpha Workspace`, so two columns carried one word and a switch under
    // either looked like a switch under the other. That is this screen's own
    // failure mode moved one axis over.
    vi.stubGlobal('fetch', matrixFetch())
    const wrapper = page()
    await flushPromises()

    expect(wrapper.findAll('.matrix-project-id').map((node) => node.text())).toEqual([
      'alpha',
      'beta',
    ])
    expect(wrapper.findAll('.matrix-project-title').map((node) => node.text())).toEqual([
      'Shared Board',
      'Shared Board',
    ])
  })

  it('a payload that is not a matrix is a failed read, not a blank screen', async () => {
    // It used to reach the render and throw inside a `v-for`, which shows as an
    // empty module rather than as the read that failed.
    const fetch = vi.fn(async () => new Response(JSON.stringify({ interface_version: 'skills' })))
    vi.stubGlobal('fetch', fetch)
    const wrapper = page()
    await flushPromises()

    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(
      'Valkama could not read project and client activation for this comparison.',
    )
    expect(wrapper.get('.platform-state-retry').text()).toBe('Retry')
    await wrapper.get('.platform-state-retry').trigger('click')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.matrix-table').exists()).toBe(false)
  })

  it('commits only the newest comparison request', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    vi.stubGlobal('fetch', fetch)
    const wrapper = page({ revision: 0 })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await wrapper.setProps({ revision: 1 })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const newest = structuredClone(matrix)
    newest.skills[0].name = 'newest-review'
    second.resolve(new Response(JSON.stringify(newest)))
    await flushPromises()
    expect(wrapper.get('.matrix-caption').text()).toContain('newest-review')

    const stale = structuredClone(matrix)
    stale.skills[0].name = 'stale-review'
    first.resolve(new Response(JSON.stringify(stale)))
    await flushPromises()
    expect(wrapper.get('.matrix-caption').text()).toContain('newest-review')
    expect(wrapper.get('.matrix-caption').text()).not.toContain('stale-review')
  })

  it('keeps the comparison visible when a same-key refresh fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(matrix)))
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetch)
    const wrapper = page({ revision: 0 })
    await flushPromises()

    await wrapper.setProps({ revision: 1 })
    await flushPromises()
    expect(wrapper.find('.matrix-table').exists()).toBe(true)
    expect(wrapper.get('.platform-state-banner').text()).toContain(
      'Valkama could not read project and client activation for this comparison.',
    )
    expect(wrapper.get('.matrix-recovery button').text()).toBe('Retry')
  })
})
