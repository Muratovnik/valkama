/**
 * The card's composer: a comment or a work report chosen up front, written in
 * the markdown editor, previewed as the thread will draw it, sent with
 * Ctrl+Enter. The report keeps the server's three-section model.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'

import { commentWorkItem, publishWorkItemReport } from '@/shared/api/planningApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { getButton, workItemFixture as record, value } from '../fixtures/workItem.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  commentWorkItem: vi.fn(),
  publishWorkItemReport: vi.fn(),
}))

function mountComposer() {
  return mount(InspectorDiscussion, {
    props: { item: record('Task', 3), writable: true },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
}

describe('the card composer', () => {
  beforeEach(() => {
    vi.mocked(commentWorkItem).mockReset().mockResolvedValue()
    vi.mocked(publishWorkItemReport).mockReset()
  })

  it('offers a comment or a work report of three sections as one choice', async () => {
    const wrapper = mountComposer()
    expect(wrapper.findAll('form textarea').map((field) => field.attributes('aria-label'))).toEqual(
      ['Comment'],
    )
    expect(getButton(wrapper, 'Comment').attributes('aria-pressed')).toBe('true')
    await getButton(wrapper, 'Work report').trigger('click')
    expect(getButton(wrapper, 'Work report').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('form textarea').map((field) => field.attributes('aria-label'))).toEqual(
      ['What was done', 'Why this way', 'What comes next'],
    )
    // The one checkbox left is the choice the report makes about the item.
    expect(wrapper.findAll('form input[type="checkbox"]')).toHaveLength(1)
    expect(wrapper.get('form .discussion-option').text()).toBe('Make task outcome')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Publish report')
  })

  it('previews the text as the thread will draw it and keeps the draft for writing on', async () => {
    const wrapper = mountComposer()
    await wrapper.get('textarea').setValue('**Done**, see <b>raw</b>')
    await getButton(wrapper, 'Preview').trigger('click')
    expect(wrapper.find('form textarea').exists()).toBe(false)
    expect(wrapper.get('form strong').text()).toBe('Done')
    expect(wrapper.find('form b').exists()).toBe(false)
    await getButton(wrapper, 'Write').trigger('click')
    expect(value(wrapper, 'Comment')).toBe('**Done**, see <b>raw</b>')
  })

  it('previews a report section by section, under the labels it will carry', async () => {
    const wrapper = mountComposer()
    await getButton(wrapper, 'Work report').trigger('click')
    await wrapper.get('textarea[aria-label="What was done"]').setValue('- one\n- two')
    await getButton(wrapper, 'Preview').trigger('click')
    expect(wrapper.findAll('form li').map((item) => item.text())).toEqual(['one', 'two'])
    expect(wrapper.text()).toContain('What comes next')
    expect(wrapper.text()).toContain('Nothing to preview yet.')
  })

  it('sends a comment and a report with Ctrl+Enter from the field being written', async () => {
    const wrapper = mountComposer()
    await wrapper.get('textarea').setValue('Looks right')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(commentWorkItem).toHaveBeenCalledExactlyOnceWith({
      id: '00000000-0000-4000-8000-000000000320',
      body: 'Looks right',
    })
    await getButton(wrapper, 'Work report').trigger('click')
    await wrapper.get('textarea[aria-label="What was done"]').setValue('Shipped')
    await wrapper.get('textarea[aria-label="What comes next"]').setValue('Watch')
    vi.mocked(publishWorkItemReport).mockResolvedValueOnce(record('Task', 4))
    await wrapper
      .get('textarea[aria-label="Why this way"]')
      .trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(publishWorkItemReport).toHaveBeenCalledExactlyOnceWith({
      id: '00000000-0000-4000-8000-000000000320',
      report: { done: 'Shipped', next: 'Watch', why: '' },
      make_current: false,
    })
  })

  it('does not send an incomplete report on Ctrl+Enter', async () => {
    const wrapper = mountComposer()
    await getButton(wrapper, 'Work report').trigger('click')
    await wrapper.get('textarea[aria-label="What was done"]').setValue('Only this')
    await wrapper
      .get('textarea[aria-label="What was done"]')
      .trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(publishWorkItemReport).not.toHaveBeenCalled()
  })
})
