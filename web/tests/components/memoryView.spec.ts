/**
 * The Memory page, which is two screens rather than one screen with a filter.
 *
 * Globally there is no knowledge root to search, so the page shows the mapping
 * and the projects that cannot answer are in it. Inside a project there is a
 * root, so the page searches it and lists what the project's work points at.
 * Those are different questions, and the cases here are mostly about the answer
 * changing with the scope rather than shrinking.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MemoryView from '@/pages/memory/components/MemoryView.vue'

import { messages } from '@/shared/i18n/index'

import { present } from '../support/present.ts'

const providers = {
  interface_version: 'valkama-memory-api',
  providers: [
    {
      project_id: 'sample',
      title: 'Sample',
      provider_id: 'markdown-knowledge',
      capabilities: ['memory.search', 'memory.open'],
      root: '/projects/sample/docs',
      health: 'ready',
      reason: null,
    },
    {
      project_id: 'rootless',
      title: 'Rootless',
      provider_id: 'markdown-knowledge',
      capabilities: ['memory.search', 'memory.open'],
      root: '',
      health: 'unavailable',
      reason: { code: 'knowledge_root_absent', message: 'docs/ does not exist in this project' },
    },
  ],
}

const links = {
  interface_version: 'valkama-memory-api',
  project_id: 'sample',
  links: [
    {
      value: 'memory://record/abc123',
      label: 'Why the cutover was one-way',
      author: 'agent',
      attached_at: '2026-08-22T00:00:00Z',
      work_item_id: 'wi-0001',
      work_item_title: 'Convert the Board domain',
      work_item_key: 'QA-264',
      space_key: 'QA',
    },
  ],
  truncated: false,
}

const search = {
  interface_version: 'valkama-memory-api',
  project_id: 'sample',
  provider_id: 'markdown-knowledge',
  capabilities: ['memory.search', 'memory.open'],
  root: '/projects/sample/docs',
  results: [
    {
      connection_id: 'local',
      resource_type: 'markdown-document',
      external_id: 'decisions/0001-store.md',
      label: 'Store decision',
      observed_at: '2026-08-22T00:00:00Z',
      metadata: {},
      snippet: 'A ratchet only tightens.',
    },
  ],
  truncated: false,
  health: 'ready',
  reason: null,
}

const globalScope = { kind: 'global' } as const
const projectScope = { kind: 'project', project_ref: { project_id: 'sample' } } as const
const betaScope = { kind: 'project', project_ref: { project_id: 'beta' } } as const

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function memoryFetch() {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/memory/providers')) return { ok: true, json: async () => providers }
    if (url.startsWith('/api/memory/linked')) return { ok: true, json: async () => links }
    if (url.startsWith('/api/memory/search')) return { ok: true, json: async () => search }
    throw new Error(`unexpected request: ${url}`)
  })
}

function page(scope: typeof globalScope | typeof projectScope | typeof betaScope, query = '') {
  const i18n = createI18n({ legacy: false, locale: 'en', messages })
  return mount(MemoryView, { props: { scope, query }, global: { plugins: [i18n] } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MemoryView', () => {
  it('lists every project globally, including one that cannot be asked', async () => {
    vi.stubGlobal('fetch', memoryFetch())
    const wrapper = page(globalScope)
    await flushPromises()

    const rows = wrapper.findAll('.provider-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('/projects/sample/docs')
    // The unreachable one is listed rather than omitted, keeps its visible
    // project identity, and renders the stable reason code in this locale.
    expect(rows[1]?.find('.state-label').text()).toBe('Rootless')
    expect(rows[1]?.text()).toContain('The project has no docs directory.')
    expect(rows[1]?.text()).not.toContain('docs/ does not exist in this project')

    const buttons = wrapper.findAll('.provider-row button')
    expect(buttons[0]?.attributes('disabled')).toBeUndefined()
    expect(buttons[1]?.attributes('disabled')).toBeDefined()
  })

  it('opening a project is what changes the scope', async () => {
    vi.stubGlobal('fetch', memoryFetch())
    const wrapper = page(globalScope)
    await flushPromises()

    await present(wrapper.findAll('.provider-row button')[0], 'the first open button').trigger(
      'click',
    )
    expect(wrapper.emitted('open-project')).toEqual([['sample']])
  })

  it('shows the search and the attached pointers inside a project', async () => {
    vi.stubGlobal('fetch', memoryFetch())
    const wrapper = page(projectScope)
    await flushPromises()

    expect(wrapper.find('.memory-search').exists()).toBe(true)
    expect(wrapper.find('.provider-row').exists()).toBe(false)
    const link = present(wrapper.find('.link-row').element, 'the attached pointer')
    expect(link.textContent).toContain('Why the cutover was one-way')
    expect(link.textContent).toContain('memory://record/abc123')
    expect(link.textContent).toContain('QA-264')
  })

  it('reaching a pointer means reaching the work item it belongs to', async () => {
    vi.stubGlobal('fetch', memoryFetch())
    const wrapper = page(projectScope)
    await flushPromises()

    await wrapper.get('.link-row button').trigger('click')
    expect(wrapper.emitted('open-work-item')).toEqual([
      [{ planning_space: 'QA', reference: 'QA-264' }],
    ])
  })

  it('a search names the folder that answered and copies nothing', async () => {
    vi.stubGlobal('fetch', memoryFetch())
    const wrapper = page(projectScope)
    await flushPromises()

    await wrapper.get('.search-row input').setValue('ratchet')
    await wrapper.get('form.search-row').trigger('submit')
    expect(wrapper.emitted('state')).toEqual([[{ query: 'ratchet' }]])
    await wrapper.setProps({ query: 'ratchet' })
    await flushPromises()

    const results = wrapper.get('.result-row')
    expect(results.text()).toContain('Store decision')
    expect(results.text()).toContain('decisions/0001-store.md')
    expect(results.text()).toContain('A ratchet only tightens.')
    expect(wrapper.get('.search-provider').text()).toContain('/projects/sample/docs')
    // The query reaches the route, so the search survives a reload.
  })

  it('runs a route-owned query immediately after mount', async () => {
    vi.stubGlobal('fetch', memoryFetch())
    const wrapper = page(projectScope, 'ratchet')
    await flushPromises()

    expect(wrapper.get('.result-row').text()).toContain('Store decision')
    expect(wrapper.emitted('state')).toBeUndefined()
  })

  it('lets only the newest project links request commit', async () => {
    const sample = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    const beta = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('project=sample')) return sample.promise
        if (url.includes('project=beta')) return beta.promise
        throw new Error(`unexpected request: ${url}`)
      }),
    )
    const wrapper = page(projectScope)
    await wrapper.setProps({ scope: betaScope })
    beta.resolve({
      ok: true,
      json: async () => ({
        ...links,
        project_id: 'beta',
        links: [{ ...links.links[0], label: 'Beta pointer', value: 'memory://beta' }],
      }),
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Beta pointer')

    sample.resolve({ ok: true, json: async () => links })
    await flushPromises()
    expect(wrapper.text()).toContain('Beta pointer')
    expect(wrapper.text()).not.toContain('Why the cutover was one-way')
  })

  it('retains a same-project projection when its refresh fails', async () => {
    let linkedReads = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/memory/providers'))
          return { ok: true, json: async () => providers }
        if (url.startsWith('/api/memory/linked')) {
          linkedReads += 1
          if (linkedReads === 1) return { ok: true, json: async () => links }
          return { ok: false, status: 503, text: async () => 'refresh failed' }
        }
        throw new Error(`unexpected request: ${url}`)
      }),
    )
    const wrapper = page(projectScope)
    await flushPromises()
    expect(wrapper.text()).toContain('Why the cutover was one-way')

    await wrapper.setProps({ scope: globalScope })
    await flushPromises()
    await wrapper.setProps({ scope: projectScope })
    await flushPromises()

    expect(wrapper.text()).toContain('Why the cutover was one-way')
    expect(wrapper.text()).toContain('refresh failed')
  })

  it('a failing read is one refusal for the screen, not a half-drawn page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, text: async () => 'no store' })),
    )
    const wrapper = page(projectScope)
    await flushPromises()

    expect(wrapper.find('.memory-search').exists()).toBe(false)
    expect(wrapper.text()).toContain('503')
  })
})
