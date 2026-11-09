import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import RelatedWorkPicker from '@/widgets/work-item-inspector/components/RelatedWorkPicker.vue'

import { createWorkItem, linkWorkItems } from '@/shared/api/planningApi.ts'
import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import { searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'
import type { PlanningSearchResult } from '@/shared/api/planningSearchApi.ts'
import { messages } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { workItem } from '../browser/planningFixtures.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  createWorkItem: vi.fn(),
  linkWorkItems: vi.fn(),
}))
vi.mock('@/shared/api/planningSearchApi.ts', () => ({ searchPlanningWorkItems: vi.fn() }))
const data = () =>
  validateWorkItemRecord({ ...structuredClone(workItem), summary_comment_id: null })
const candidate = (number: number): PlanningSearchResult => ({
  work_item_id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  planning_space_id: workItem.planning_space_id,
  reference: `MAIN-${number}`,
  title: `Candidate ${number}`,
  state: { name: 'Dev' },
  claim_ref: 'Alex',
})
const ignoreResults = (_items: PlanningSearchResult[]) => {}
const dialogStub = {
  props: ['error', 'open'],
  emits: ['submit'],
  template:
    '<form @submit.prevent="$emit(\'submit\')"><slot/><p role="alert">{{ error }}</p><slot name="footer"/></form>',
}
const i18n = () =>
  createI18n({ legacy: false, locale: 'en', messages, missingWarn: false, fallbackWarn: false })
function picker(direction: 'incoming' | 'outgoing' = 'outgoing') {
  return mount(RelatedWorkPicker, {
    props: {
      item: data(),
      open: true,
      writable: true,
      initialKind: 'blocks',
      initialDirection: direction,
    },
    global: { plugins: [i18n()], stubs: { DialogFrame: dialogStub } },
  })
}
async function search(wrapper: ReturnType<typeof picker>, text = 'Candidate') {
  await wrapper.get('input[type="text"]').setValue(text)
  await vi.advanceTimersByTimeAsync(251)
  await flushPromises()
}
async function modeNew(wrapper: ReturnType<typeof picker>) {
  wrapper.findAllComponents(ChoiceSelect)[2].vm.$emit('update:modelValue', 'new')
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('related task picker', () => {
  it('searches exact space, excludes self/exact duplicates, and swaps incoming writes', async () => {
    const item = data()
    const duplicate = { ...candidate(2), work_item_id: item.links[0].work_item_id }
    vi.mocked(searchPlanningWorkItems).mockResolvedValue([
      { ...candidate(1), work_item_id: item.work_item_id },
      duplicate,
      candidate(3),
    ])
    const wrapper = picker('incoming')
    await search(wrapper)
    expect(searchPlanningWorkItems).toHaveBeenCalledWith(
      'Candidate',
      item.planning_space_id,
      expect.any(AbortSignal),
    )
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('In progress · Alex')
    await wrapper.get('input[type="radio"]').setValue()
    vi.mocked(linkWorkItems).mockRejectedValueOnce(new Error('Link refused'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Link refused')
    expect(wrapper.get('input[type="radio"]').element).toHaveProperty('checked', true)
    expect(wrapper.get('input[type="text"]').element).toHaveProperty('value', 'Candidate')
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await vi.advanceTimersByTimeAsync(251)
    await flushPromises()
    expect(wrapper.get('input[type="radio"]').element).toHaveProperty('checked', true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(linkWorkItems).toHaveBeenLastCalledWith({
      id: candidate(3).work_item_id,
      other: item.work_item_id,
      kind: 'blocks',
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('allows the other direction of an existing link', async () => {
    const item = data()
    vi.mocked(searchPlanningWorkItems).mockResolvedValue([
      { ...candidate(2), work_item_id: item.links[0].work_item_id },
    ])
    const wrapper = picker('outgoing')
    await search(wrapper)
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('retains failed creation draft, then retries only linking after partial success', async () => {
    const wrapper = picker('incoming')
    await modeNew(wrapper)
    await wrapper.get('input[type="text"]').setValue('New milestone')
    vi.mocked(createWorkItem).mockRejectedValueOnce(new Error('Creation refused'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('input[type="text"]').element).toHaveProperty('value', 'New milestone')
    const created = { ...data(), work_item_id: candidate(7).work_item_id, reference: 'MAIN-7' }
    vi.mocked(createWorkItem).mockResolvedValue(created)
    vi.mocked(linkWorkItems).mockRejectedValueOnce(new Error('Link refused'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('MAIN-7')
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true, initialDirection: 'outgoing' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(createWorkItem).toHaveBeenCalledTimes(2)
    expect(linkWorkItems).toHaveBeenLastCalledWith({
      id: created.work_item_id,
      other: data().work_item_id,
      kind: 'blocks',
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('aborts old searches and ignores stale completion', async () => {
    let finishOld: (items: PlanningSearchResult[]) => void = ignoreResults
    vi.mocked(searchPlanningWorkItems).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve
        }),
    )
    const wrapper = picker()
    await search(wrapper, 'old')
    const signal = vi.mocked(searchPlanningWorkItems).mock.calls[0][2]
    vi.mocked(searchPlanningWorkItems).mockResolvedValueOnce([candidate(9)])
    await search(wrapper, 'new')
    expect(signal.aborted).toBe(true)
    finishOld([candidate(8)])
    await flushPromises()
    expect(wrapper.text()).toContain('Candidate 9')
    expect(wrapper.text()).not.toContain('Candidate 8')
    wrapper.unmount()
  })

  it('keeps the query and clears busy feedback on search failure; forbids read-only writes', async () => {
    vi.mocked(searchPlanningWorkItems).mockRejectedValue(new Error('Request timed out'))
    const wrapper = picker()
    await search(wrapper, 'retained')
    expect(wrapper.text()).toContain('Request timed out')
    expect(wrapper.get('input[type="text"]').element).toHaveProperty('value', 'retained')
    await modeNew(wrapper)
    await wrapper.get('input[type="text"]').setValue('Draft')
    await wrapper.setProps({ writable: false })
    await wrapper.get('form').trigger('submit')
    expect(createWorkItem).not.toHaveBeenCalled()
    expect(linkWorkItems).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('grouped related tasks', () => {
  it('groups direction, adds from one section action, preserves open and removes incoming correctly', async () => {
    const item = data()
    item.links.push({ ...item.links[0], direction: 'outgoing' })
    const wrapper = mount(InspectorRelations, {
      props: { item, writable: true },
      global: { plugins: [i18n()], stubs: { RelatedWorkPicker: true } },
    })
    expect(wrapper.findAll('.relation-group')).toHaveLength(2)
    // One add action for the section, not a floating plus per group; the
    // picker's own kind and direction choices cover what the group plus preset.
    expect(wrapper.findAll('.relation-group button').map((button) => button.text())).not.toContain(
      '+',
    )
    await wrapper.get('.section-header-actions button').trigger('click')
    expect(wrapper.getComponent(RelatedWorkPicker).props()).toMatchObject({
      open: true,
      initialKind: 'relates-to',
      initialDirection: 'outgoing',
    })
    await wrapper.findAll('.link-open')[0].trigger('click')
    expect(wrapper.emitted('open')).toEqual([[item.links[0].reference]])
    vi.mocked(linkWorkItems).mockRejectedValueOnce(new Error('Removal refused'))
    await wrapper.findAll('.link-remove')[1].trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Removal refused')
    expect(wrapper.emitted('changed')).toBeUndefined()
    await wrapper.findAll('.link-remove')[1].trigger('click')
    await flushPromises()
    expect(linkWorkItems).toHaveBeenLastCalledWith({
      id: item.links[0].work_item_id,
      other: item.work_item_id,
      kind: 'blocks',
      remove: true,
    })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    await wrapper.setProps({ writable: false })
    expect(wrapper.findAll('.link-remove')).toHaveLength(0)
    wrapper.unmount()
  })

  it('shows a symmetric kind as one group, whichever item recorded the link', () => {
    const item = data()
    const related = { ...item.links[0], kind: 'relates-to' as const }
    item.links = [
      { ...related, direction: 'outgoing' as const },
      {
        ...related,
        direction: 'incoming' as const,
        work_item_id: item.work_item_id.replace(/.$/u, '9'),
      },
    ]
    const wrapper = mount(InspectorRelations, {
      props: { item, writable: true },
      global: { plugins: [i18n()], stubs: { RelatedWorkPicker: true } },
    })
    const groups = wrapper.findAll('.relation-group')
    expect(groups).toHaveLength(1)
    expect(groups[0].get('.group-heading').text()).toBe('Relates to 2')
    expect(groups[0].findAll('.link-row')).toHaveLength(2)
    // The count stands apart from the words it counts, in the accessible text too.
    expect(wrapper.get('h3').text()).toBe('Related work 2')
    wrapper.unmount()
  })
})
