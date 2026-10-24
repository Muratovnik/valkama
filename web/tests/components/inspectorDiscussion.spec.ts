import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorDescription from '@/widgets/work-item-inspector/components/InspectorDescription.vue'
import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import InspectorSummary from '@/widgets/work-item-inspector/components/InspectorSummary.vue'

import {
  commentWorkItem,
  publishWorkItemReport,
  selectWorkItemSummary,
  updateWorkItemDescription,
} from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import {
  deferred,
  getButton,
  workItemFixture as record,
  inspectorResourceRef as resourceRef,
  value,
} from '../fixtures/workItem.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  commentWorkItem: vi.fn(),
  publishWorkItemReport: vi.fn(),
  selectWorkItemSummary: vi.fn(),
  updateWorkItemDescription: vi.fn(),
}))
const now = '2026-08-27T18:00:00Z'
function editingPlugins() {
  return { plugins: [createI18n({ legacy: false, locale: 'en', messages })] }
}

describe('task description and discussion', () => {
  beforeEach(() => {
    vi.mocked(updateWorkItemDescription).mockReset()
    vi.mocked(commentWorkItem).mockReset()
    vi.mocked(publishWorkItemReport).mockReset()
    vi.mocked(selectWorkItemSummary).mockReset()
  })

  it('edits an empty description, retains it on conflict and retries with refreshed revision', async () => {
    const item = record('Task', 1)
    const wrapper = mount(InspectorDescription, {
      props: { item, writable: true },
      global: editingPlugins(),
    })
    expect(wrapper.text()).toContain('No description yet.')
    await wrapper.get('button').trigger('click')
    await wrapper.get('textarea').setValue('Draft description')
    vi.mocked(updateWorkItemDescription).mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { status: 409 }),
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('The task changed.')
    expect(value(wrapper, 'Description')).toBe('Draft description')
    await getButton(wrapper, 'Refresh task').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
    await wrapper.setProps({ item: { ...item, revision: 2, description: 'Remote description' } })
    expect(value(wrapper, 'Description')).toBe('Draft description')
    vi.mocked(updateWorkItemDescription).mockResolvedValueOnce({
      ...item,
      revision: 3,
      description: 'Draft description',
    })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(updateWorkItemDescription).toHaveBeenLastCalledWith({
      id: item.work_item_id,
      description: 'Draft description',
      expected_revision: 2,
    })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('edits a loaded description and preserves it after a failed request', async () => {
    const item = { ...record('Task', 1), description: 'Existing description' }
    const wrapper = mount(InspectorDescription, {
      props: { item, writable: true },
      global: editingPlugins(),
    })
    expect(wrapper.text()).toContain('Existing description')
    await wrapper.get('button').trigger('click')
    expect(value(wrapper, 'Description')).toBe('Existing description')
    await wrapper.get('textarea').setValue('Updated draft')
    vi.mocked(updateWorkItemDescription).mockRejectedValueOnce(new Error('offline'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(value(wrapper, 'Description')).toBe('Updated draft')
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('keeps comments while pending and on failure; clears only a confirmed success', async () => {
    const item = record('Task', 1)
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: editingPlugins(),
    })
    await wrapper.get('textarea').setValue('A useful comment')
    const request = deferred<void>()
    vi.mocked(commentWorkItem).mockReturnValueOnce(request.promise)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(commentWorkItem).toHaveBeenCalledTimes(1)
    expect(value(wrapper, 'Comment')).toBe('A useful comment')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    request.reject(new Error('offline'))
    await flushPromises()
    expect(value(wrapper, 'Comment')).toBe('A useful comment')
    await wrapper.setProps({ item: { ...item, revision: 2 } })
    expect(value(wrapper, 'Comment')).toBe('A useful comment')
    vi.mocked(commentWorkItem).mockResolvedValueOnce()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(value(wrapper, 'Comment')).toBe('')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('publishes a typed report as the outcome atomically and keeps a failed report draft', async () => {
    const item = record('Task', 4)
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: editingPlugins(),
    })
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('textarea[aria-label="What was done"]').setValue('Completed')
    await wrapper.get('textarea[aria-label="What comes next"]').setValue('Validate')
    await wrapper.get('.discussion-option:last-of-type input').setValue(true)
    vi.mocked(publishWorkItemReport).mockRejectedValueOnce(new Error('offline'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(value(wrapper, 'What was done')).toBe('Completed')
    expect(
      (wrapper.get('.discussion-option:last-of-type input').element as HTMLInputElement).checked,
    ).toBe(true)
    vi.mocked(publishWorkItemReport).mockResolvedValueOnce(item)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(publishWorkItemReport).toHaveBeenLastCalledWith({
      id: item.work_item_id,
      report: { done: 'Completed', next: 'Validate', why: '' },
      make_current: true,
      expected_revision: 4,
    })
    expect(value(wrapper, 'What was done')).toBe('')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('publishes history-only reports without replacing the selected outcome', async () => {
    const item = record('Task', 4)
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: editingPlugins(),
    })
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('textarea[aria-label="What was done"]').setValue('Investigation')
    await wrapper.get('textarea[aria-label="What comes next"]').setValue('Review')
    vi.mocked(publishWorkItemReport).mockResolvedValueOnce(item)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(publishWorkItemReport).toHaveBeenCalledWith({
      id: item.work_item_id,
      report: { done: 'Investigation', next: 'Review', why: '' },
      make_current: false,
    })
  })

  it('selects a prior report and shows unknown historical time without unsafe HTML', async () => {
    const item: WorkItem = {
      ...record('Task', 5),
      comments: [
        {
          id: 11,
          kind: 'report',
          author: 'user',
          body: '',
          at: null,
          report: { done: '<img src=x>', next: 'Review' },
        },
      ],
    }
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: editingPlugins(),
    })
    expect(wrapper.text()).toContain('Unknown time')
    expect(wrapper.text()).toContain('<img src=x>')
    expect(wrapper.find('img').exists()).toBe(false)
    vi.mocked(selectWorkItemSummary).mockResolvedValueOnce(item)
    await wrapper.get('.discussion-entry button').trigger('click')
    await flushPromises()
    expect(selectWorkItemSummary).toHaveBeenCalledWith({
      id: item.work_item_id,
      comment_id: 11,
      expected_revision: 5,
    })
    await wrapper.setProps({
      item: { ...item, summary_comment_id: 11, summary: { done: '<img src=x>', next: 'Review' } },
    })
    expect(wrapper.get('.discussion-label').text()).toContain('task outcome')
    expect(wrapper.find('.discussion-entry button').exists()).toBe(false)
    const outcome = mount(InspectorSummary, {
      props: {
        item: { ...item, summary_comment_id: 11, summary: { done: '<img src=x>', next: 'Review' } },
      },
      global: editingPlugins(),
    })
    expect(outcome.get('.outcome-link').element.tagName).toBe('BUTTON')
  })

  it('places backfilled reports by recorded time and labels missing historical metadata', () => {
    const item: WorkItem = {
      ...record('Task', 1),
      comments: [
        {
          id: 1,
          kind: 'comment',
          report: null,
          body: 'Later comment',
          author: 'user',
          at: '2026-08-27T13:00:00Z',
        },
        {
          id: 100,
          kind: 'report',
          report: { done: 'Earlier report', next: 'Review' },
          body: '',
          author: 'writer',
          at: '2026-08-27T15:00:00+03:00',
        },
        {
          id: 99,
          kind: 'report',
          report: { done: 'Historical report', next: 'Review' },
          body: '',
          author: '',
          at: null,
        },
      ],
    }
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: false },
      global: editingPlugins(),
    })
    const entries = wrapper.findAll('.discussion-entry')
    expect(entries.map((entry) => entry.attributes('id'))).toEqual([
      'work-report-99',
      'work-report-100',
      'work-report-1',
    ])
    expect(entries[0].text()).toContain('Author not recorded')
    expect(entries[0].text()).toContain('Unknown time')
    expect(item.comments.map((entry) => entry.id)).toEqual([1, 100, 99])
  })

  it('starts the outcome collapsed with an abridged preview and a link to the complete selected report', () => {
    const report = {
      done: 'Completed the first phase. '.repeat(40),
      next: 'Review every acceptance result.',
      why: 'Keep the full decision available.',
    }
    const item: WorkItem = {
      ...record('Task', 5),
      summary: report,
      summary_comment_id: 11,
      comments: [{ id: 11, kind: 'report', author: 'user', body: '', at: now, report }],
    }
    const wrapper = mount(InspectorOverview, {
      props: { item, resourceRef, writable: true },
      global: editingPlugins(),
    })
    const details = wrapper.get('.outcome details')
    expect(details.element.tagName).toBe('DETAILS')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('summary').text()).toBe('Task outcome')
    expect(details.get('.report').text()).toContain(report.next)
    expect(details.get('.report').text()).toContain(report.why)
    expect(wrapper.get('.outcome-preview-label').text()).toBe('Abbreviated preview')
    expect(wrapper.get('.outcome-preview-text').text()).toBe(report.done.trim())
    const link = wrapper.get('.outcome-link')
    expect(link.element.tagName).toBe('BUTTON')
    expect(link.element.closest('details')).toBeNull()
    const selectedReport = wrapper.get('#work-report-11 .report')
    expect(selectedReport.text()).toContain(report.done.trim())
    expect(selectedReport.text()).toContain(report.next)
    expect(selectedReport.text()).toContain(report.why)
    expect(wrapper.get('textarea[aria-label="Comment"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows read-only descriptions and reports without edit actions', () => {
    const item: WorkItem = {
      ...record('Task', 1),
      description: 'Read me',
      comments: [
        {
          id: 1,
          kind: 'report',
          report: { done: 'Done', next: 'Next' },
          body: '',
          author: 'user',
          at: now,
        },
      ],
    }
    const wrapper = mount(InspectorOverview, {
      props: { item, resourceRef, writable: false },
      global: editingPlugins(),
    })
    expect(wrapper.text()).toContain('Read me')
    expect(wrapper.text()).toContain('Done')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('does not clear a new item draft when an earlier item request finishes', async () => {
    const item = record('Task A', 1)
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: editingPlugins(),
    })
    const request = deferred<void>()
    vi.mocked(commentWorkItem).mockReturnValueOnce(request.promise)
    await wrapper.get('textarea').setValue('A note')
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ item: { ...item, work_item_id: 'other', reference: 'QA-321' } })
    request.resolve()
    await flushPromises()
    await wrapper.get('textarea').setValue('B note')
    expect(value(wrapper, 'Comment')).toBe('B note')
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
})
