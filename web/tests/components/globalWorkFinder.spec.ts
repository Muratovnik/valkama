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

function finder(projects: { project_id: string; title: string }[] = []) {
  const wrapper = mount(GlobalWorkFinder, {
    props: { open: true, projects },
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

/** A source the search could not read, and the code it gave for why. */
function away(project: string, key: string, reason: string) {
  return {
    project_id: project,
    space_ref: { data_scope_id: '44444444-4444-4444-8444-444444444444', space_key: key },
    status: 'unavailable' as const,
    reason,
  }
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
    expect(wrapper.text()).toContain('No matching tasks in the projects that were searched.')
    expect(wrapper.text()).toContain('Not every project was searched')
    expect(wrapper.text()).toContain('Could not be read: attached-project · TASK')
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
    expect(wrapper.text()).toContain('Not every project was searched')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('More matches are available.')
    source.status = 'searched'
    source.reason = null
    response.has_more = true
    await search(wrapper, 'refined')
    expect(wrapper.text()).toContain('More matches are available.')
    expect(wrapper.text()).not.toContain('Not every project was searched')
  })

  it('names each source it could not search and why, above the results', async () => {
    const response = finderResponse()
    const searched = present(response.coverage[0], 'searched source')
    response.coverage = [
      searched,
      away('demo-project', 'AWAY', 'store_not_attached'),
      ...['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].map((key) =>
        away(`${key.toLowerCase()}-project`, key, 'store_unreadable'),
      ),
      away('odd-project', 'ODD', 'C:/private/reason'),
    ]
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(response)
    const wrapper = finder()
    await search(wrapper)
    const lines = wrapper.findAll('.finder-skipped-line').map((line) => line.text())
    expect(lines).toEqual([
      'Store not attached: demo-project · AWAY',
      'Store could not be opened: one-project · ONE, two-project · TWO, three-project · THREE and 2 more',
      'Could not be read: odd-project · ODD',
    ])
    expect(wrapper.text()).not.toContain('C:/private')
    // The notice is in the live region and comes before the rows it qualifies,
    // not after a list that may be longer than the dialog.
    const status = wrapper.get('[role="status"]')
    expect(status.text()).toContain('Store not attached')
    const listbox = wrapper.get('[role="listbox"]').element
    expect(
      status.element.compareDocumentPosition(listbox) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('opens the first result on Enter with no arrow key, and shows its reference', async () => {
    const response = finderResponse('main-12')
    const exact = present(response.items[0], 'exact item')
    response.items = [
      exact,
      {
        target: { ...exact.target, project_id: 'other-project' },
        item: { ...exact.item, work_item_id: '55555555-5555-4555-8555-555555555555' },
      },
    ]
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(response)
    const wrapper = finder()
    await search(wrapper, 'main-12')
    await flushPromises()
    const first = present(wrapper.findAll('[role="option"]')[0], 'first option')
    expect(first.get('.command-reference').text()).toBe('TASK-7')
    const input = wrapper.get('[role="combobox"]')
    expect(input.attributes('aria-activedescendant')).toBe(first.attributes('id'))
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([[finderTarget()]])
  })

  it('opens the first result once it arrives when Enter came first', async () => {
    let resolve: (value: GlobalPlanningSearch) => void = vi.fn()
    vi.mocked(searchGlobalPlanningWorkItems).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const wrapper = finder()
    const input = wrapper.get('[role="combobox"]')
    await input.setValue('needle')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.text()).toContain('the first match opens when it arrives')
    expect(wrapper.emitted('select')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(251)
    resolve(finderResponse())
    await flushPromises()
    expect(wrapper.emitted('select')).toEqual([[finderTarget()]])
  })

  it('forgets an early Enter when the query changes before the rows arrive', async () => {
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(finderResponse('needles'))
    const wrapper = finder()
    const input = wrapper.get('[role="combobox"]')
    await input.setValue('needle')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('needles')
    await vi.advanceTimersByTimeAsync(251)
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('names a failure that stopped every source', async () => {
    vi.mocked(searchGlobalPlanningWorkItems).mockRejectedValue(
      Object.assign(new Error('HTTP 409'), { code: 'project_registry_unavailable', status: 409 }),
    )
    const wrapper = finder()
    await search(wrapper)
    expect(wrapper.text()).toContain('The project list could not be read, so nothing was searched.')
    const retry = wrapper.get('button.finder-retry')
    expect(retry.text()).toBe('Retry search')
    // Enter on the button is the button's: the list's submit must not cancel it.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    expect(retry.element.dispatchEvent(enter)).toBe(true)
  })

  it('shows a safe error and retries the same query', async () => {
    vi.mocked(searchGlobalPlanningWorkItems)
      .mockRejectedValueOnce(new Error('C:/private/store'))
      .mockResolvedValueOnce(finderResponse())
    const wrapper = finder()
    await search(wrapper)
    expect(wrapper.text()).toContain('The search could not finish.')
    expect(wrapper.text()).not.toContain('C:/private')
    await wrapper.get('button.button').trigger('click')
    await vi.advanceTimersByTimeAsync(251)
    await flushPromises()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
  })

  // A result said the project's slug, which is what the server routes by and
  // what nobody reads. The title the app already lists is what the rail shows.
  it('names a result and a skipped source by the project title, and falls back to the id', async () => {
    const response = finderResponse()
    response.coverage.push(away('unlisted-project', 'GONE', 'store_unreadable'))
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(response)
    const wrapper = finder([{ project_id: 'attached-project', title: 'Attached title' }])
    await search(wrapper)
    const option = wrapper.get('[role="option"]').text()
    expect(option).toContain('Attached title · In progress')
    expect(option).not.toContain('attached-project')
    expect(wrapper.get('.finder-skipped-line').text()).toBe(
      'Store could not be opened: unlisted-project · GONE',
    )
  })

  // The shared reason mapping is the one the question list uses, so every code
  // it can return needs a text here: a missing key would print the raw key.
  it('gives every skipped-source code the finder text, never the raw key', async () => {
    const codes = [
      'store_not_attached',
      'store_unreadable',
      'attached_list_unreadable',
      'space_missing',
      'binding_conflict',
      'search_failed',
      'requests_unavailable',
      'a raw server sentence',
    ]
    const response = finderResponse()
    response.coverage = codes.map((code, index) => away(`p${index}`, `K${index}`, code))
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(response)
    const wrapper = finder()
    await search(wrapper)
    const text = wrapper.get('.finder-feedback').text()
    expect(text).not.toContain('finder.reasons')
    expect(text).not.toContain('a raw server sentence')
    // Seven codes name a reason of their own, and the raw sentence falls in `other`.
    expect(wrapper.findAll('.finder-skipped-line')).toHaveLength(8)
    expect(text).toContain(globalFinderMessages.en.finder.reasons.requests_unavailable)
    expect(text).toContain(globalFinderMessages.en.finder.reasons.other)
  })

  // The query survives a close, and the reopened field used to keep the caret
  // at its end: the next typing extended the old query instead of replacing it.
  it('selects the kept query when it reopens, so the next typing replaces it', async () => {
    vi.mocked(searchGlobalPlanningWorkItems).mockResolvedValue(finderResponse('MAIN-12'))
    const wrapper = finder()
    await search(wrapper, 'MAIN-12')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await vi.advanceTimersByTimeAsync(2)
    const input = wrapper.get('[role="combobox"]').element as HTMLInputElement
    expect(input.value).toBe('MAIN-12')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'MAIN-12'.length])
    expect(document.activeElement).toBe(input)
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
