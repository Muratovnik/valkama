/**
 * The shell's layer of reference links: another known space's items, and
 * sessions the server knows. Each links only once it resolves, and is text
 * otherwise.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppReferenceLinks } from '@/app/composables/useAppReferenceLinks.ts'

import { fetchSessionContext } from '@/shared/api/api.ts'
import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { GlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'
import RichText from '@/shared/ui/RichText.vue'

vi.mock('@/shared/api/api.ts', () => ({ fetchSessionContext: vi.fn() }))
vi.mock('@/shared/api/planningGlobalSearchApi.ts', () => ({
  searchGlobalPlanningWorkItems: vi.fn(),
}))

const space = { data_scope_id: '123e4567-e89b-42d3-a456-426614174000', space_key: 'MAIN' }
const session = '0f8fad5b-d9cb-469f-a165-70867728950e'
const target = { project_id: 'example', space_ref: space, reference: 'MAIN-12', writable: true }

function mountShell(source: string) {
  const openTarget = vi.fn()
  const openSession = vi.fn()
  const say = vi.fn()
  const wrapper = mount(
    {
      components: { RichText },
      props: { source: { type: String, required: true } },
      setup() {
        useAppReferenceLinks({
          projects: () => [
            {
              project_id: 'example',
              title: 'Example',
              binding_state: 'mapped',
              resources: [{ resource_ref: planningSpaceEntity(space), state: 'mapped' }],
            },
          ],
          openTarget,
          openSession,
          say,
        })
      },
      template: '<RichText :source="source" />',
    },
    {
      props: { source },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
    },
  )
  return { wrapper, openTarget, openSession, say }
}

/** A search row for one reference, as the global search answers it. */
function found(reference: string): GlobalPlanningSearch['items'][number] {
  return {
    target: { ...target, reference },
    item: {
      work_item_id: '00000000-0000-4000-8000-000000000012',
      planning_space_id: '00000000-0000-4000-8000-000000000001',
      reference,
      title: 'Parser',
      state: { name: 'Dev' },
      claim_ref: '',
    },
  }
}

function search(items: GlobalPlanningSearch['items']): GlobalPlanningSearch {
  return {
    interface_version: 'valkama-planning-search',
    query: 'MAIN-12',
    limit: 50,
    has_more: false,
    items,
    coverage: [],
  }
}

describe('the shell layer of reference links', () => {
  beforeEach(() => {
    vi.mocked(fetchSessionContext).mockReset()
    vi.mocked(searchGlobalPlanningWorkItems).mockReset()
  })

  it('links an item of a known space and opens what the search finds for it exactly', async () => {
    vi.mocked(fetchSessionContext).mockResolvedValue({ resolved: false } as ResolvedRef)
    const { wrapper, openTarget, say } = mountShell('MAIN-12 and SHA-256 and OTHER-3')
    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['MAIN-12'])
    expect(buttons[0]?.attributes('title')).toBe('Open task MAIN-12')
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValueOnce(
      search([found('MAIN-120'), found('MAIN-12')]),
    )
    await buttons[0]?.trigger('click')
    await flushPromises()
    expect(searchGlobalPlanningWorkItems).toHaveBeenCalledWith('MAIN-12', expect.any(AbortSignal))
    expect(openTarget).toHaveBeenCalledExactlyOnceWith({ ...target, reference: 'MAIN-12' })
    expect(say).not.toHaveBeenCalled()
  })

  it('says a known-space reference was not found rather than opening a near match', async () => {
    const { wrapper, openTarget, say } = mountShell('MAIN-12')
    // Text that only mentions it, and a longer number, are not it.
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValueOnce(search([found('MAIN-120')]))
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(openTarget).not.toHaveBeenCalled()
    expect(say).toHaveBeenCalledExactlyOnceWith('Task MAIN-12 was not found.')
  })

  it('keeps a session id as text until the server knows it, then opens it', async () => {
    vi.mocked(fetchSessionContext).mockResolvedValueOnce({ resolved: true } as ResolvedRef)
    const { wrapper, openSession } = mountShell(`ran in ${session}`)
    expect(wrapper.find('button').exists()).toBe(false)
    await flushPromises()
    const link = wrapper.get('button')
    expect(link.text()).toBe(session)
    expect(link.classes()).toContain('identifier')
    await link.trigger('click')
    expect(openSession).toHaveBeenCalledExactlyOnceWith(session)
    expect(fetchSessionContext).toHaveBeenCalledTimes(1)
  })

  it('keeps an id the server does not know, or cannot be asked about, as text', async () => {
    vi.mocked(fetchSessionContext).mockResolvedValueOnce({ resolved: false } as ResolvedRef)
    const unknown = mountShell(`ran in ${session}`)
    await flushPromises()
    expect(unknown.wrapper.find('button').exists()).toBe(false)
    vi.mocked(fetchSessionContext).mockRejectedValueOnce(new Error('offline'))
    const failed = mountShell('ran in 1f8fad5b-d9cb-469f-a165-70867728950e')
    await flushPromises()
    expect(failed.wrapper.find('button').exists()).toBe(false)
  })
})
