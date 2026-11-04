import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

import InspectorMemory from '@/widgets/work-item-inspector/components/InspectorMemory.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import { fetchMemoryProviders, searchMemory } from '@/shared/api/memoryApi.ts'
import { createWorkItem } from '@/shared/api/planningApi.ts'
import { validateReadModel, validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import { i18n as appI18n, messages } from '@/shared/i18n/index.ts'

import { planningReadModel, workItem } from '../browser/planningFixtures.ts'

vi.mock('@/shared/api/memoryApi.ts', () => ({
  fetchMemoryProviders: vi.fn(),
  searchMemory: vi.fn(),
}))
vi.mock('@/shared/api/planningApi.ts', () => ({ createWorkItem: vi.fn() }))
const i18n = (locale = 'en') =>
  createI18n({
    legacy: false,
    locale,
    messages,
    datetimeFormats: {
      en: appI18n.global.getDateTimeFormat('en'),
      ru: appI18n.global.getDateTimeFormat('ru'),
    },
  })
const model = () => validateReadModel(structuredClone(planningReadModel))
function workspace(locale = 'en', large = false) {
  const data = model()
  const item = data.work_items[0]
  if (!item) throw new Error('Expected fixture item')
  if (large)
    data.work_items = Array.from({ length: 1201 }, (_, index) => ({
      ...item,
      work_item_id: `item-${index}`,
      number: index + 1,
      reference: `MAIN-${index + 1}`,
      title: index === 1200 ? 'Late delivery milestone' : `Earlier work ${index}`,
    }))
  const wrapper = mount(PlanningWorkspace, {
    props: {
      model: data,
      routeState: undefined,
      stale: false,
      stateBytes: 2048,
      version: 1,
      view: 'list' as const,
      writable: true,
      // The route answers a write with the state it was given, as the shell does.
      onState: (state: Record<string, string | number | boolean>) =>
        wrapper.setProps({ routeState: state }),
    },
    global: { plugins: [i18n(locale)] },
  })
  return wrapper
}
function button(wrapper: ReturnType<typeof workspace>, text: string) {
  const found = wrapper
    .findAll('button')
    .find((entry) => (entry.text() || entry.attributes('aria-label')) === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

describe('work discovery', () => {
  // The list draws all 1201 rows twice, which is the point and is heavy: 0.6 s alone, 2 s
  // beside the rest of the suite, and past the 5 s default on a busy machine.
  it('finds late work by trimmed case-insensitive reference and title, then clears', async () => {
    const wrapper = workspace('en', true)
    const input = wrapper.get('input[aria-label="Filter work"]')
    await input.setValue('  main-1201  ')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.get('tbody').text()).toContain('Late delivery milestone')
    expect(wrapper.get('.workspace-figures').text()).toBe('1 of 1201 open · Reset')
    await input.setValue(' DELIVERY MILESTONE ')
    expect(wrapper.get('tbody').text()).toContain('MAIN-1201')
    await button(wrapper, 'Clear the text').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1201)
    expect(wrapper.emitted('view')).toBeUndefined()
  }, 15_000)
  it('intersects the text with a preset and resets a filtered empty result', async () => {
    const wrapper = workspace()
    await button(wrapper, 'Workable').trigger('click')
    expect(wrapper.get('.data-empty').text()).toContain('No work matches this filter.')
    expect(wrapper.get('.workspace-chips').text()).toBe('Workable')
    await wrapper.get('input').setValue('MAIN-264')
    expect(wrapper.get('.data-empty').text()).toContain('No work matches this filter.')
    await button(wrapper, 'Clear the text').trigger('click')
    expect(wrapper.find('.data-empty').exists()).toBe(true)
    await button(wrapper, 'Reset the filter').trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.emitted('view')).toBeUndefined()
  })
  it.each(['en', 'ru'])(
    'counts open claims in %s independently of workflow category',
    async (locale) => {
      const wrapper = workspace(locale)
      const data = model()
      const item = data.work_items[0]
      if (!item) throw new Error('Expected fixture item')
      data.work_items = [
        { ...item, claim_ref: 'Owner', state: { ...item.state, category: 'backlog' } },
        {
          ...item,
          work_item_id: 'done',
          claim_ref: 'Owner',
          state: { ...item.state, is_terminal: true, category: 'completed' },
        },
        { ...item, work_item_id: 'active', claim_ref: '' },
      ]
      await wrapper.setProps({ model: data })
      expect(wrapper.get('.workspace-figures').text()).toBe(
        locale === 'en' ? '2 open of 3' : '2\u{A0}открытых из 3',
      )
      // The held count rides its preset.
      expect(wrapper.findAll('.filter-preset').at(-1)?.text()).toBe(
        locale === 'en' ? 'Assigned 1' : 'Назначено 1',
      )
    },
  )
  it('keeps the filter through a refresh and drops it with an address that has none', async () => {
    const wrapper = workspace()
    const assigned = () => wrapper.findAll('.filter-preset').at(-1)
    await assigned()?.trigger('click')
    await wrapper.get('input').setValue('missing')
    await wrapper.setProps({ model: model(), version: 2 })
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('missing')
    expect(assigned()?.attributes('aria-pressed')).toBe('true')
    // A space switch writes the new space's address without the filter.
    await wrapper.setProps({ routeState: undefined })
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    expect(assigned()?.attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('tbody').text()).toContain('MAIN-264')
  })
  it('keeps references, dates and long claims through sorting and opening', async () => {
    const data = model()
    const item = data.work_items[0]
    if (!item) throw new Error('Expected fixture item')
    item.claim_ref = 'A long task owner with a descriptive session name'
    const wrapper = mount(WorkItemList, {
      props: { items: data.work_items, links: data.links },
      global: { plugins: [i18n()] },
    })
    const header = wrapper.get('th')
    await header.get('button').trigger('click')
    expect(wrapper.findAll('tbody tr').map((row) => row.get('.list-open').text())).toEqual([
      'MAIN-264',
      'MAIN-265',
    ])
    expect(wrapper.get('tbody').text()).toContain(item.claim_ref)
    expect(wrapper.get('tbody tr').findAll('td')).toHaveLength(7)
    expect(wrapper.get('tbody tr td:last-child').text()).not.toBe('')
    await wrapper.get('tbody tr').get('.list-open').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['MAIN-264']])
    await header.get('button').trigger('click')
    expect(header.attributes('aria-sort')).toBe('descending')
    expect(wrapper.findAll('tbody tr').map((row) => row.get('.list-open').text())).toEqual([
      'MAIN-265',
      'MAIN-264',
    ])
  })
})
describe('supporting copy', () => {
  it('keeps memory diagnostics available in a closed disclosure and attaches results', async () => {
    vi.mocked(fetchMemoryProviders).mockResolvedValue({
      interface_version: 'valkama-memory-api',
      providers: [
        {
          project_id: 'example-project',
          title: 'Example project',
          provider_id: 'markdown-knowledge',
          capabilities: ['memory.search', 'memory.open'],
          root: '/project/docs',
          health: 'ready',
          reason: null,
        },
      ],
    })
    vi.mocked(searchMemory).mockResolvedValue({
      interface_version: 'valkama-memory-api',
      project_id: 'example-project',
      provider_id: 'technical-provider',
      capabilities: ['memory.search', 'memory.open'],
      root: '/project/docs',
      health: 'ready',
      reason: null,
      truncated: false,
      results: [
        {
          external_id: 'note-1',
          label: 'Release decision',
          snippet: 'Reviewed plan',
          connection_id: 'docs',
          metadata: {},
          observed_at: '',
          resource_type: 'document',
        },
      ],
    })
    const wrapper = mount(InspectorMemory, {
      props: {
        item: validateWorkItemRecord(workItem),
        projectId: 'example-project',
        writable: true,
      },
      global: { plugins: [i18n()] },
    })
    await wrapper.get('input').setValue('release')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Source: /project/docs')
    const details = wrapper.get('details')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('summary').text()).toBe('Technical details')
    expect(details.text()).toContain('technical-provider')
    expect(details.text()).toContain('memory.open')
    expect(details.text()).toContain('/project/docs')
    await wrapper.get('.memory-result button').trigger('click')
    expect(wrapper.emitted('attach')).toEqual([[{ value: 'note-1', label: 'Release decision' }]])
  })
  it.each([
    ['en', 'New work'],
    ['ru', 'Новая работа'],
  ])(
    'creates work with the concise %s title and existing form semantics',
    async (locale, title) => {
      vi.mocked(createWorkItem).mockResolvedValue(validateWorkItemRecord(workItem))
      const wrapper = mount(WorkItemComposer, {
        props: { open: true, space: 'MAIN' },
        global: {
          plugins: [i18n(locale)],
          stubs: { OverlayHost: { template: '<div><slot /></div>' } },
        },
      })
      expect(wrapper.text()).toContain(title)
      await wrapper.get('input').setValue('  Ship the improvement  ')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(createWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Ship the improvement', space: 'MAIN' }),
      )
      expect(wrapper.emitted('created')).toEqual([['MAIN-264']])
    },
  )
})
