import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'

import { commentWorkItem, publishWorkItemReport } from '@/shared/api/planningApi.ts'
import { checklistCommentMessages } from '@/shared/i18n/checklistCommentMessages.ts'
import { messages } from '@/shared/i18n/index.ts'

import { deferred, getButton, inspectorResourceRef, workItemFixture } from '../fixtures/workItem.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  commentWorkItem: vi.fn(),
  publishWorkItemReport: vi.fn(),
}))

const stepA = '00000000-0000-4000-8000-000000000010'
const stepB = '00000000-0000-4000-8000-000000000011'
function itemFixture() {
  const item = workItemFixture('Checklist comments', 1)
  item.checklist = [stepA, stepB].map((id) => ({
    id,
    text: id === stepA ? 'First step' : 'Second step',
    done: false,
    claimed_by: '',
    done_by: '',
  }))
  return item
}
function global() {
  return {
    plugins: [
      createI18n({
        legacy: false,
        locale: 'en',
        messages: { en: { ...messages.en, ...checklistCommentMessages.en } },
      }),
    ],
  }
}

describe('checklist-linked comments', () => {
  beforeEach(() => {
    vi.mocked(commentWorkItem).mockReset()
    vi.mocked(publishWorkItemReport).mockReset()
  })

  it('opens the composer from the separate step action, focuses it and submits only the stable target id', async () => {
    const item = itemFixture()
    item.checklist.reverse()
    const wrapper = mount(InspectorOverview, {
      attachTo: document.body,
      props: { item, writable: true, resourceRef: inspectorResourceRef },
      global: global(),
    })
    const form = wrapper.get('form')
    const scroll = vi.fn()
    Object.defineProperty(form.element, 'scrollIntoView', { value: scroll, configurable: true })
    await wrapper.get('textarea[aria-label="Comment"]').setValue('Existing plain draft')
    const action = present(
      wrapper.findAll('button').find((button) => button.text() === 'Discuss step'),
      'step action',
    )
    expect(action.element.closest('[role="checkbox"]')).toBeNull()
    expect(action.attributes('type')).toBe('button')
    await action.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(form.element)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
    expect(wrapper.get('.step-context').text()).toContain('Second step')
    expect(
      (wrapper.get('textarea[aria-label="Comment"]').element as HTMLTextAreaElement).value,
    ).toBe('Existing plain draft')
    vi.mocked(commentWorkItem).mockResolvedValueOnce()
    await form.trigger('submit')
    await flushPromises()
    expect(commentWorkItem).toHaveBeenCalledExactlyOnceWith({
      id: item.work_item_id,
      body: 'Existing plain draft',
      checklist_item_id: stepB,
    })
    expect(wrapper.find('.step-context').exists()).toBe(false)
    wrapper.unmount()
  })

  it('retains the selected context on refresh and failure, without rebinding a removed or renamed step', async () => {
    const item = itemFixture()
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: global(),
    })
    await wrapper.vm.discussStep(stepA)
    await wrapper.get('textarea').setValue('Keep this draft')
    const renamed = {
      ...item,
      revision: 2,
      checklist: item.checklist.map((step) => ({ ...step, text: 'Renamed step' })).reverse(),
    }
    await wrapper.setProps({ item: renamed })
    expect(wrapper.get('.step-context').text()).toContain('First step')
    expect(wrapper.get('.step-context').text()).toContain('Step text has changed')
    vi.mocked(commentWorkItem).mockRejectedValueOnce(new Error('offline'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('.step-context').text()).toContain('First step')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Keep this draft')
    await wrapper.setProps({
      item: { ...renamed, checklist: renamed.checklist.filter((step) => step.id !== stepA) },
    })
    expect(wrapper.get('.step-context').text()).toContain('Step has been removed')
    await getButton(wrapper, 'Remove step link').trigger('click')
    vi.mocked(commentWorkItem).mockResolvedValueOnce()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(commentWorkItem).toHaveBeenLastCalledWith({
      id: item.work_item_id,
      body: 'Keep this draft',
    })
    wrapper.unmount()
  })

  it('renders frozen quotes by id after reorder, rename and deletion in read-only scope', async () => {
    const item = itemFixture()
    item.comments = [
      {
        id: 1,
        kind: 'comment',
        author: 'user',
        at: item.created_at,
        body: 'A note',
        report: null,
        checklist_item_id: stepA,
        checklist_item_text: 'First step',
      },
    ]
    item.checklist.reverse()
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: false },
      global: global(),
    })
    expect(wrapper.get('blockquote').text()).toBe('Checklist stepFirst step')
    await wrapper.setProps({
      item: { ...item, checklist: item.checklist.map((step) => ({ ...step, text: 'Changed' })) },
    })
    expect(wrapper.get('blockquote').text()).toBe('Step text has changedFirst step')
    await wrapper.setProps({ item: { ...item, checklist: [] } })
    expect(wrapper.get('blockquote').text()).toBe('Step has been removedFirst step')
    expect(wrapper.text()).toContain('A note')
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.vm.discussStep(stepA)
    expect(wrapper.find('.step-context').exists()).toBe(false)
    expect(commentWorkItem).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps report fields while selecting a step and never anchors a report', async () => {
    const item = itemFixture()
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: global(),
    })
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('textarea[aria-label="What was done"]').setValue('Report delivery')
    await wrapper.get('textarea[aria-label="What comes next"]').setValue('Report next')
    await wrapper.vm.discussStep(stepA)
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Your report draft is retained')
    await getButton(wrapper, 'Remove step link').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(
      (wrapper.get('textarea[aria-label="What was done"]').element as HTMLTextAreaElement).value,
    ).toBe('Report delivery')
    vi.mocked(publishWorkItemReport).mockResolvedValueOnce(item)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(publishWorkItemReport).toHaveBeenCalledExactlyOnceWith({
      id: item.work_item_id,
      report: { done: 'Report delivery', next: 'Report next', why: '' },
      make_current: false,
    })
    expect(commentWorkItem).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('clears the anchor on item change and ignores completion of the previous item request', async () => {
    const item = itemFixture()
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: global(),
    })
    await wrapper.vm.discussStep(stepA)
    await wrapper.get('textarea').setValue('First item note')
    const request = deferred<void>()
    vi.mocked(commentWorkItem).mockReturnValueOnce(request.promise)
    await wrapper.get('form').trigger('submit')
    const next = {
      ...item,
      work_item_id: '00000000-0000-4000-8000-000000000321',
      checklist: [present(item.checklist[1], 'second step')],
    }
    await wrapper.setProps({ item: next })
    expect(wrapper.find('.step-context').exists()).toBe(false)
    request.resolve()
    await flushPromises()
    expect(wrapper.emitted('changed')).toBeUndefined()
    await wrapper.vm.discussStep(stepA)
    expect(wrapper.find('.step-context').exists()).toBe(false)
    await wrapper.vm.discussStep(stepB)
    await wrapper.get('textarea').setValue('Second item note')
    vi.mocked(commentWorkItem).mockResolvedValueOnce()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(commentWorkItem).toHaveBeenLastCalledWith({
      id: next.work_item_id,
      body: 'Second item note',
      checklist_item_id: stepB,
    })
    wrapper.unmount()
  })
})
