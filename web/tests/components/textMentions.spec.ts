/**
 * `@` in the card's description and outcome editors tells what was chosen, as a comment's
 * does.
 *
 * The expectations come from the owner's decision that `@` makes a mention wherever a
 * person writes about work, and from the connection contract's "Mentions": a write names
 * the items it tells in `mentions`, and a number in its text tells nobody. Which of the
 * items a saved-again text already named is left out is the server's to decide, so a task
 * chosen and still standing in the text is sent each time it was chosen for that save.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorDescription from '@/widgets/work-item-inspector/components/InspectorDescription.vue'
import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'

import { publishWorkItemReport, updateWorkItemDescription } from '@/shared/api/planningApi.ts'
import { messages } from '@/shared/i18n/index.ts'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'

import { workItemFixture as record } from '../fixtures/workItem.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  publishWorkItemReport: vi.fn(),
  updateWorkItemDescription: vi.fn(),
}))

const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'en', messages })] })
const task = (reference: string): EditorSuggestion => ({
  key: reference,
  kind: 'task',
  name: reference,
  reference,
  title: '',
  detail: '',
})
/** What the editor emits when a person takes a row of its `@` list. */
const choose = (wrapper: VueWrapper, label: string, reference: string) => {
  const editor = wrapper
    .findAllComponents(MarkdownEditor)
    .find((found) => found.props('label') === label)
  if (!editor) throw new Error(`No editor named ${label}`)
  editor.vm.$emit('chose', task(reference))
}

beforeEach(() => {
  vi.mocked(updateWorkItemDescription).mockReset()
  vi.mocked(publishWorkItemReport).mockReset()
})

describe('the description editor', () => {
  it('tells the task chosen from its list, not a number typed, and forgets it once saved', async () => {
    const item = { ...record('Task', 4), description: 'Old words' }
    const wrapper = mount(InspectorDescription, {
      props: { item, writable: true },
      global: global(),
    })
    await wrapper.get('button').trigger('click')
    choose(wrapper, 'Description', 'MAIN-7')
    await wrapper.get('textarea').setValue('Old words. Ask MAIN-7, see MAIN-8')
    vi.mocked(updateWorkItemDescription).mockResolvedValueOnce(item)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(updateWorkItemDescription).toHaveBeenCalledExactlyOnceWith({
      id: item.work_item_id,
      description: 'Old words. Ask MAIN-7, see MAIN-8',
      expected_revision: item.revision,
      mentions: ['MAIN-7'],
    })
    // Saved, the choice is spent: the same words saved again choose nothing.
    await wrapper.get('button').trigger('click')
    await wrapper.get('textarea').setValue('Old words. Ask MAIN-7, see MAIN-8 again')
    vi.mocked(updateWorkItemDescription).mockResolvedValueOnce(item)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(vi.mocked(updateWorkItemDescription).mock.calls[1]?.[0]).not.toHaveProperty('mentions')
  })

  it('forgets what was chosen when the edit is cancelled', async () => {
    const item = { ...record('Task', 4), description: 'Old words' }
    const wrapper = mount(InspectorDescription, {
      props: { item, writable: true },
      global: global(),
    })
    await wrapper.get('button').trigger('click')
    choose(wrapper, 'Description', 'MAIN-7')
    await wrapper.get('textarea').setValue('Ask MAIN-7')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancel')
      ?.trigger('click')
    // Opened again, only what is chosen this time is told.
    await wrapper.get('button').trigger('click')
    choose(wrapper, 'Description', 'MAIN-9')
    await wrapper.get('textarea').setValue('Ask MAIN-7 and MAIN-9')
    vi.mocked(updateWorkItemDescription).mockResolvedValueOnce(item)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(vi.mocked(updateWorkItemDescription).mock.calls[0]?.[0]).toMatchObject({
      mentions: ['MAIN-9'],
    })
  })
})

describe('the outcome editor', () => {
  it('tells a task chosen in either field when the outcome is saved', async () => {
    const item = record('Task', 5)
    const wrapper = mount(InspectorDiscussion, {
      props: { item, writable: true },
      global: global(),
    })
    await wrapper.vm.askOutcome({ key: 'done', name: 'Done' })
    choose(wrapper, 'What was done', 'MAIN-7')
    choose(wrapper, 'What comes next', 'MAIN-9')
    await wrapper.get('textarea[aria-label="What was done"]').setValue('Handed MAIN-7 the parser')
    await wrapper.get('textarea[aria-label="What comes next"]').setValue('MAIN-9 and MAIN-10')
    vi.mocked(publishWorkItemReport).mockResolvedValueOnce(item)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(publishWorkItemReport).toHaveBeenCalledExactlyOnceWith({
      id: item.work_item_id,
      report: { done: 'Handed MAIN-7 the parser', next: 'MAIN-9 and MAIN-10' },
      make_current: true,
      expected_revision: item.revision,
      mentions: ['MAIN-7', 'MAIN-9'],
    })
    wrapper.unmount()
  })
})
