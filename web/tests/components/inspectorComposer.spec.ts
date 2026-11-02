/**
 * The card's composer: a comment, written in the markdown editor, previewed as
 * the thread will draw it, sent with Ctrl+Enter. There is no second kind of entry
 * to choose: a work report is what agents write through their tools, and the one
 * a person writes is the outcome a closing move asks for.
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

const labels = (wrapper: ReturnType<typeof mountComposer>) =>
  wrapper.findAll('form textarea').map((field) => field.attributes('aria-label'))

describe('the card composer', () => {
  beforeEach(() => {
    vi.mocked(commentWorkItem).mockReset().mockResolvedValue()
    vi.mocked(publishWorkItemReport).mockReset()
  })

  it('writes a comment and offers nothing else to write', () => {
    const wrapper = mountComposer()
    expect(labels(wrapper)).toEqual(['Comment'])
    expect(wrapper.text()).not.toContain('Work report')
    expect(wrapper.find('form input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.findAll('form [role="group"][aria-label="What to publish"]')).toHaveLength(0)
    // The section's heading names the field, so the label is left to a reader.
    expect(wrapper.find('form label[for]').exists()).toBe(false)
    expect(wrapper.get('button[type="submit"]').text()).toBe('Add note')
  })

  it('previews the text as the thread will draw it and keeps the draft for writing on', async () => {
    const wrapper = mountComposer()
    await wrapper.get('textarea').setValue('**Done**, see <b>raw</b>')
    await getButton(wrapper, 'Preview').trigger('click')
    expect(wrapper.get('textarea').element.closest('[inert]')).not.toBeNull()
    expect(wrapper.get('form strong').text()).toBe('Done')
    expect(wrapper.find('form b').exists()).toBe(false)
    await getButton(wrapper, 'Write').trigger('click')
    expect(wrapper.get('textarea').element.closest('[inert]')).toBeNull()
    expect(value(wrapper, 'Comment')).toBe('**Done**, see <b>raw</b>')
  })

  it('sends a comment with Ctrl+Enter from the field, exactly as it was written', async () => {
    const wrapper = mountComposer()
    await wrapper.get('textarea').setValue('    indented\nLooks right\n')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(commentWorkItem).toHaveBeenCalledExactlyOnceWith({
      id: '00000000-0000-4000-8000-000000000320',
      body: '    indented\nLooks right\n',
    })
    expect(publishWorkItemReport).not.toHaveBeenCalled()
  })

  it('does not send a comment of nothing but space', async () => {
    const wrapper = mountComposer()
    await wrapper.get('textarea').setValue('  \n ')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(commentWorkItem).not.toHaveBeenCalled()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('puts a refused comment’s reason and the way to recover in the editor’s foot', async () => {
    const wrapper = mountComposer()
    await wrapper.get('textarea').setValue('A draft')
    vi.mocked(commentWorkItem).mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { status: 409 }),
    )
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const foot = wrapper.get('.markdown-foot')
    expect(foot.get('[role="alert"]').text()).toContain('The task changed.')
    expect(foot.text()).toContain('Refresh task')
    expect(foot.text()).not.toContain('Ctrl+Enter')
    expect(value(wrapper, 'Comment')).toBe('A draft')
    await getButton(wrapper, 'Refresh task').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })
})
