import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorMemory from '@/widgets/work-item-inspector/components/InspectorMemory.vue'

import { fetchMemoryProviders, searchMemory } from '@/shared/api/memoryApi.ts'
import type { MemoryProviders, MemorySearch } from '@/shared/api/memoryApi.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages } from '@/shared/i18n/index.ts'

import { memoryProviders, memorySearch } from '../browser/memoryFixtures.ts'
import { projectId, workItem } from '../browser/planningFixtures.ts'

vi.mock('@/shared/api/memoryApi.ts', () => ({
  fetchMemoryProviders: vi.fn(),
  searchMemory: vi.fn(),
}))

function mountMemory(item = workItem) {
  return mount(InspectorMemory, {
    props: { item, projectId, writable: true },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
}

describe('InspectorMemory source identity', () => {
  beforeEach(() => {
    vi.mocked(fetchMemoryProviders)
      .mockReset()
      .mockResolvedValue(memoryProviders as MemoryProviders)
    vi.mocked(searchMemory)
      .mockReset()
      .mockResolvedValue(memorySearch as MemorySearch)
  })

  it('names the folder it searches under the field, and nothing more, before searching', async () => {
    const wrapper = mountMemory()
    await flushPromises()
    expect(wrapper.get('.memory-hint').text()).toBe('Searches C:/projects/sample/docs')
    expect(wrapper.find('.memory-source').exists()).toBe(false)
    expect(searchMemory).not.toHaveBeenCalled()
  })

  it('says in one line why a project cannot be searched and leads to the check that repairs it', async () => {
    vi.mocked(fetchMemoryProviders).mockResolvedValue({
      ...memoryProviders,
      providers: [{ ...memoryProviders.providers[1], project_id: projectId }],
    } as MemoryProviders)
    vi.mocked(searchMemory).mockResolvedValue({
      ...memorySearch,
      health: 'unavailable',
      results: [],
      root: '',
      reason: { code: 'knowledge_root_absent', message: 'docs/ does not exist in this project' },
    } as MemorySearch)
    const wrapper = mountMemory()
    await flushPromises()
    const source = wrapper.get('.memory-source')
    expect(source.classes()).toContain('data-empty')
    expect(source.get('.empty-title').text()).toBe('The project has no docs/ folder to search.')
    const repair = source.get('a')
    expect(repair.text()).toBe('Diagnostics')
    expect(parsePlatformRoute(repair.attributes('href') ?? '')).toMatchObject({
      module_id: 'settings',
      scope: { kind: 'project', project_ref: { project_id: projectId } },
      state: { section: 'diagnostics' },
    })
    await wrapper.get('input').setValue('decision')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Nothing matched.')
    expect(wrapper.get('.memory-source .empty-title').text()).toBe(
      'The project has no docs/ folder to search.',
    )
  })

  it('names a project the registry does not hold', async () => {
    vi.mocked(fetchMemoryProviders).mockResolvedValue({
      ...memoryProviders,
      providers: [],
    } as MemoryProviders)
    const wrapper = mountMemory()
    await flushPromises()
    expect(wrapper.get('.memory-source .empty-title').text()).toBe(
      'The project is not registered with Valkama.',
    )
  })

  it('retries failed provider discovery in place without losing search input', async () => {
    vi.mocked(fetchMemoryProviders)
      .mockReset()
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce(memoryProviders as MemoryProviders)
    const wrapper = mountMemory()
    await wrapper.get('input').setValue('release decision')
    await flushPromises()
    expect(wrapper.get('.memory-source').text()).toContain(
      "The project's documents could not be checked.",
    )
    await wrapper.get('.memory-source button').trigger('click')
    await flushPromises()
    expect(fetchMemoryProviders).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.memory-source').exists()).toBe(false)
    expect(wrapper.get('.memory-hint').text()).toBe('Searches C:/projects/sample/docs')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('release decision')
  })

  it('lists an attached memory pointer by label and id without offering to open it', async () => {
    const wrapper = mountMemory({
      ...workItem,
      refs: [
        {
          kind: 'memory',
          value: 'mem_0123456789',
          label: 'Release decision',
          author: 'agent',
          at: '2026-08-15T00:00:00Z',
        },
      ],
    })
    await flushPromises()
    const row = wrapper.get('.memory-row')
    expect(row.text()).toContain('Release decision')
    expect(row.text()).toContain('mem_0123456789')
    expect(row.find('a').exists()).toBe(false)
    expect(row.find('button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Saved memory references')
  })
})
