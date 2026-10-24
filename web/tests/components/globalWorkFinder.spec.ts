import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import GlobalWorkFinder from '@/features/global-find/GlobalWorkFinder.vue'

import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { GlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import { globalFinderMessages } from '@/shared/i18n/globalFinderMessages.ts'
import OverlayHost from '@/shared/ui/OverlayHost.vue'

import { finderResponse, finderTarget } from '../support/globalFinder.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/planningGlobalSearchApi.ts', () => ({
  searchGlobalPlanningWorkItems: vi.fn(),
}))
const wrappers: ReturnType<typeof mount>[] = []
const i18n = () => createI18n({ legacy: false, locale: 'en', messages: globalFinderMessages })

function finder() {
  const wrapper = mount(GlobalWorkFinder, {
    props: { open: true },
    attachTo: document.body,
    global: { plugins: [i18n()], stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}

async function search(wrapper: ReturnType<typeof finder>, query = 'needle') {
  await wrapper.get('[role="combobox"]').setValue(query)
  await vi.advanceTimersByTimeAsync(251)
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
})

afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  await flushPromises()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('global task finder', () => {
  it('focuses search after opening, uses Reka arrows and Enter, and emits the exact target', async () => {
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(finderResponse())
    const wrapper = finder()
    await vi.advanceTimersByTimeAsync(2)
    expect(document.activeElement).toBe(wrapper.get('[role="combobox"]').element)
    expect(wrapper.text()).toContain('All mapped projects')
    await search(wrapper)
    const option = wrapper.get('[role="option"]')
    expect(option.text()).toContain('attached-project')
    expect(option.text()).toContain('TASK-7')
    expect(option.text()).toContain('In progress')
    expect(option.text()).toContain('Read only')
    const input = wrapper.get('[role="combobox"]')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe(option.attributes('id'))
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([[finderTarget()]])
  })

  it('makes the full result clickable', async () => {
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(finderResponse())
    const wrapper = finder()
    await search(wrapper)
    await wrapper.get('[role="option"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[finderTarget()]])
  })

  it('clears old results immediately and ignores out-of-order completion', async () => {
    let resolveOld: (value: GlobalPlanningSearch) => void = vi.fn()
    vi.mocked(searchGlobalPlanningWorkItems)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve
        }),
      )
      .mockResolvedValueOnce(finderResponse('new query'))
    const wrapper = finder()
    await search(wrapper, 'old query')
    const oldSignal = present(
      vi.mocked(searchGlobalPlanningWorkItems).mock.calls[0],
      'old search',
    )[1]
    await search(wrapper, 'new query')
    expect(oldSignal.aborted).toBe(true)
    resolveOld({ ...finderResponse('old query'), items: [] })
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    await wrapper.get('[role="combobox"]').setValue('next query')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Searching mapped projects')
  })

  it('aborts on close and unmount and suppresses stale errors', async () => {
    let rejectOld: (value: Error) => void = vi.fn()
    vi.mocked(searchGlobalPlanningWorkItems).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject
        }),
    )
    const wrapper = finder()
    await search(wrapper)
    const firstSignal = present(
      vi.mocked(searchGlobalPlanningWorkItems).mock.calls[0],
      'first search',
    )[1]
    await wrapper.setProps({ open: false })
    expect(firstSignal.aborted).toBe(true)
    rejectOld(new Error('private path'))
    await flushPromises()
    await wrapper.setProps({ open: true })
    await vi.advanceTimersByTimeAsync(251)
    const secondSignal = present(
      vi.mocked(searchGlobalPlanningWorkItems).mock.calls[1],
      'second search',
    )[1]
    expect(wrapper.text()).not.toContain('could not finish')
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(secondSignal.aborted).toBe(true)
  })

  it('distinguishes empty, incomplete and truncated results without exposing raw reasons', async () => {
    const response = { ...finderResponse(), items: [] }
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(response)
    const wrapper = finder()
    await search(wrapper)
    expect(wrapper.text()).toContain('No matching tasks.')
    const source = present(response.coverage[0], 'source coverage')
    source.status = 'unavailable'
    source.reason = 'C:/private/database.sqlite'
    response.has_more = true
    await search(wrapper, 'other query')
    expect(wrapper.text()).toContain('Some sources are unavailable.')
    expect(wrapper.text()).toContain('source unavailable')
    expect(wrapper.text()).toContain('More matches are available.')
    expect(wrapper.text()).not.toContain('No matching tasks.')
    expect(wrapper.text()).not.toContain('database.sqlite')
  })

  it('keeps partial-source warnings distinct from a complete truncated result', async () => {
    const response = finderResponse()
    const source = present(response.coverage[0], 'source coverage')
    source.status = 'unavailable'
    source.reason = 'source_unavailable'
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(response)
    const wrapper = finder()
    await search(wrapper)
    expect(wrapper.text()).toContain('Results are incomplete.')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('More matches are available.')
    source.status = 'searched'
    source.reason = null
    response.has_more = true
    await search(wrapper, 'refined')
    expect(wrapper.text()).toContain('More matches are available.')
    expect(wrapper.text()).not.toContain('Results are incomplete.')
  })

  it('shows a safe error and retries the same query', async () => {
    vi.mocked(searchGlobalPlanningWorkItems)
      .mockRejectedValueOnce(new Error('C:/private/store'))
      .mockResolvedValueOnce(finderResponse())
    const wrapper = finder()
    await search(wrapper)
    expect(wrapper.text()).toContain('Search could not finish.')
    expect(wrapper.text()).not.toContain('C:/private')
    await wrapper.get('button.button').trigger('click')
    await vi.advanceTimersByTimeAsync(251)
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
  })

  it('closes only the command layer on Escape and restores drawer focus', async () => {
    const Host = defineComponent({
      components: { GlobalWorkFinder, OverlayHost },
      data: () => ({ finderOpen: false }),
      template:
        '<OverlayHost :open="true" layer="drawer" variant="drawer" title="Task drawer"><button id="drawer-launch" @click="finderOpen = true">Find</button></OverlayHost><GlobalWorkFinder :open="finderOpen" @close="finderOpen = false"/>',
    })
    const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [i18n()] } })
    wrappers.push(wrapper)
    await flushPromises()
    const trigger = present(
      document.querySelector<HTMLButtonElement>('#drawer-launch'),
      'drawer trigger',
    )
    expect(document.activeElement).toBe(trigger)
    trigger.click()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2)
    const input = present(
      document.querySelector<HTMLInputElement>('[role="combobox"]'),
      'finder input',
    )
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2)
    expect(document.activeElement).toBe(trigger)
    const drawer = present(document.querySelector('[role="dialog"]'), 'drawer dialog')
    expect(drawer.contains(trigger)).toBe(true)
    const labelId = present(drawer.getAttribute('aria-labelledby'), 'drawer title id')
    expect(document.querySelector(`[id="${labelId}"]`)?.textContent).toBe('Task drawer')
  })
})
