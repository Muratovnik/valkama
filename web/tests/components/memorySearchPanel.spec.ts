import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MemorySearchPanel from '@/pages/memory/components/MemorySearchPanel.vue'

import { searchMemory } from '@/shared/api/memoryApi.ts'
import type { MemorySearch } from '@/shared/api/memoryApi.ts'
import { messages } from '@/shared/i18n/index.ts'

vi.mock('@/shared/api/memoryApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/memoryApi.ts')>()),
  searchMemory: vi.fn(),
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

function answer(label: string): MemorySearch {
  return {
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
        label,
        observed_at: '2026-08-22T00:00:00Z',
        metadata: {},
        snippet: 'A ratchet only tightens.',
      },
    ],
    truncated: false,
    health: 'ready',
    reason: null,
  }
}

function mountSearch() {
  return mount(MemorySearchPanel, {
    props: { projectId: 'sample', query: 'ratchet' },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
    },
  })
}

describe('MemorySearchPanel resource state', () => {
  beforeEach(() => vi.mocked(searchMemory).mockReset())

  it('renders a localized cold failure and executes its retry', async () => {
    const initial = deferred<MemorySearch>()
    vi.mocked(searchMemory).mockReturnValueOnce(initial.promise)
    const wrapper = mountSearch()
    expect(wrapper.find('.platform-state-panel[data-tone="info"][aria-busy="true"]').exists()).toBe(
      true,
    )

    initial.reject(
      Object.assign(new Error('private transport path C:\\users\\operator'), {
        code: 'memory_search_failed',
        retryable: true,
        status: 503,
      }),
    )
    await flushPromises()

    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Memory search could not be completed.')
    expect(wrapper.text()).not.toContain('private transport')

    vi.mocked(searchMemory).mockResolvedValueOnce(answer('Recovered result'))
    await wrapper.get('.platform-state-retry').trigger('click')
    await flushPromises()

    expect(searchMemory).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.result-row').text()).toContain('Recovered result')
  })

  it('keeps the exact result node through refresh and degraded retry', async () => {
    vi.mocked(searchMemory).mockResolvedValueOnce(answer('Accepted result'))
    const wrapper = mountSearch()
    await flushPromises()
    const accepted = wrapper.get('.result-row').element

    const refresh = deferred<MemorySearch>()
    vi.mocked(searchMemory).mockReturnValueOnce(refresh.promise)
    await wrapper.get('form.search-row').trigger('submit')

    expect(wrapper.get('.result-row').element).toBe(accepted)
    expect(wrapper.find('.platform-state-banner').exists()).toBe(false)
    expect(wrapper.find('.visually-hidden[role="status"]').exists()).toBe(true)

    refresh.reject({ code: 'memory_search_failed', retryable: true, status: 503 })
    await flushPromises()

    expect(wrapper.get('.result-row').element).toBe(accepted)
    expect(wrapper.get('.platform-state-banner').text()).toContain(
      'Memory search could not be completed.',
    )

    vi.mocked(searchMemory).mockResolvedValueOnce(answer('Updated result'))
    await wrapper.get('.search-recovery button').trigger('click')
    await flushPromises()

    expect(searchMemory).toHaveBeenCalledTimes(3)
    expect(wrapper.get('.result-row').text()).toContain('Updated result')
  })
})
