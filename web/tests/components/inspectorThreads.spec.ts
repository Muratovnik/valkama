/**
 * The threads as a person uses them on a card: reading them, and replying with what is kept
 * when a form is set aside and where focus lands after it.
 */
import { defineComponent, h, nextTick } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import { provideDraftGuard } from '@/widgets/work-item-inspector/utils/useDraftGuard.ts'

import { replyInThread, resolveThread } from '@/shared/api/planningApi.ts'

import { getButton } from '../fixtures/workItem.ts'
import {
  card,
  entryIds,
  inThread,
  key,
  MARK,
  open,
  plugins,
  reply,
  replyField,
  root,
  thread,
  track,
  unmountAll,
  written,
} from '../support/threadCard.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  replyInThread: vi.fn(),
  resolveThread: vi.fn(),
}))

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(replyInThread).mockReset()
  vi.mocked(resolveThread).mockReset()
})
afterEach(unmountAll)

describe('a thread on the card', () => {
  it('names its article by the root meta line, and says the mark once it has one', () => {
    const wrapper = open(card([root(1), root(2, { resolution: MARK })]))
    const name = (id: number) =>
      (thread(wrapper, id).attributes('aria-labelledby') ?? '')
        .split(' ')
        .map((part) => document.querySelector(`[id="${part}"]`)?.textContent?.trim())
        .join(' | ')
    expect(thread(wrapper, 1).element.tagName).toBe('ARTICLE')
    expect(name(1)).toContain('kolo')
    expect(name(2)).toMatch(/^Resolved · you · .* · Moved to MAIN-14 \| kolo/u)
  })

  it('shows the last two of four replies, and the button opens the rest on the first of them', async () => {
    const wrapper = open(card([root(1), reply(2, 1), reply(3, 1), reply(4, 1), reply(5, 1)]))
    const shownReplies = () => wrapper.findAll('.reply-text').map((entry) => entry.text())
    expect(shownReplies()).toEqual(['Reply 4', 'Reply 5'])
    const toggle = getButton(wrapper, 'Show 2 more replies')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    await nextTick()
    expect(shownReplies()).toEqual(['Reply 2', 'Reply 3', 'Reply 4', 'Reply 5'])
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement?.id).toBe('thread-comment-2')
  })

  it('shows three replies whole, with nothing to ask for', () => {
    const wrapper = open(card([root(1), reply(2, 1), reply(3, 1), reply(4, 1)]))
    expect(wrapper.findAll('.reply-text')).toHaveLength(3)
    expect(wrapper.find('.replies-toggle').exists()).toBe(false)
  })

  it('stays in place when a reply arrives while the card is open, and says so', async () => {
    const wrapper = open(card([root(1), root(2)]))
    expect(entryIds(wrapper)).toEqual(['work-report-2', 'work-report-1'])
    expect(thread(wrapper, 1).text()).not.toContain('New reply')
    await wrapper.setProps({ item: card([root(1), root(2), reply(3, 1)]) })
    expect(entryIds(wrapper)).toEqual(['work-report-2', 'work-report-1'])
    expect(thread(wrapper, 1).text()).toContain('New reply')
  })

  it('stands a new thread on top while the card is open', async () => {
    const wrapper = open(card([root(1), root(2)]))
    await wrapper.setProps({ item: card([root(1), root(2), root(3)]) })
    expect(entryIds(wrapper)[0]).toBe('work-report-3')
  })

  it('offers no reply and no mark on a card that cannot be written', () => {
    const wrapper = open(card([root(1, { resolution: MARK }), root(2)]), { writable: false })
    expect(thread(wrapper, 2).find('button').exists()).toBe(false)
  })
})

describe('replying', () => {
  it('sends under the root, closes the field and lands on the new reply once it is read', async () => {
    const item = card([root(1), reply(2, 1)])
    const wrapper = open(item)
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(replyField(wrapper).element)
    await replyField(wrapper).setValue('My answer')
    vi.mocked(replyInThread).mockResolvedValueOnce(written(3, 1))
    key(replyField(wrapper), 'Enter', { ctrlKey: true })
    await flushPromises()
    expect(replyInThread).toHaveBeenCalledWith({
      id: item.work_item_id,
      body: 'My answer',
      reply_to: 1,
    })
    expect(resolveThread).not.toHaveBeenCalled()
    expect(wrapper.find('textarea[aria-label="Your reply"]').exists()).toBe(false)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    // Not read yet: focus waits on the way back rather than on the page.
    expect(document.activeElement?.id).toBe('thread-reply-comment-1')
    await wrapper.setProps({
      item: card([root(1), reply(2, 1), reply(3, 1, { by_person: true })]),
    })
    await flushPromises()
    expect(document.activeElement?.id).toBe('thread-comment-3')
    expect(thread(wrapper, 1).text()).not.toContain('New reply')
  })

  it('keeps the words and says why when the write fails', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('My answer')
    vi.mocked(replyInThread).mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { status: 409 }),
    )
    await thread(wrapper, 1).get('.reply-composer').trigger('submit')
    await flushPromises()
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('My answer')
    expect(thread(wrapper, 1).get('[role="alert"]').text()).toContain('The task changed.')
    await getButton(wrapper, 'Refresh task').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('closes an empty field on Escape, keeps the card, and comes back to Reply', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await nextTick()
    const card$ = vi.fn()
    document.addEventListener('keydown', card$)
    key(replyField(wrapper), 'Escape')
    await flushPromises()
    document.removeEventListener('keydown', card$)
    expect(wrapper.find('textarea[aria-label="Your reply"]').exists()).toBe(false)
    expect(card$).not.toHaveBeenCalled()
    expect(document.activeElement?.id).toBe('thread-reply-comment-1')
  })

  it('asks about a field with words in it on Escape, and keeps the key from the card', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('Words')
    const card$ = vi.fn()
    document.addEventListener('keydown', card$)
    key(replyField(wrapper), 'Escape')
    await flushPromises()
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('Words')
    expect(wrapper.find('.confirm-strip').exists()).toBe(true)
    expect(document.activeElement?.textContent?.trim()).toBe('Keep writing')
    // Back in the field, a second Escape answers the question with keep.
    key(replyField(wrapper), 'Escape')
    await flushPromises()
    document.removeEventListener('keydown', card$)
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('Words')
    expect(card$).not.toHaveBeenCalled()
  })

  it('asks before Cancel drops words, and answering stay keeps them', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('Words')
    await getButton(wrapper, 'Cancel').trigger('click')
    await getButton(wrapper, 'Keep writing').trigger('click')
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('Words')
    await getButton(wrapper, 'Cancel').trigger('click')
    await getButton(wrapper, 'Discard').trigger('click')
    await flushPromises()
    expect(wrapper.find('textarea[aria-label="Your reply"]').exists()).toBe(false)
    expect(thread(wrapper, 1).text()).not.toContain('Draft')
    await inThread(wrapper, 1, 'Reply').trigger('click')
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps the draft when another thread opens its field, and marks whose it is', async () => {
    const wrapper = open(card([root(1), root(2)]))
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('First words')
    await inThread(wrapper, 2, 'Reply').trigger('click')
    expect(wrapper.findAll('textarea[aria-label="Your reply"]')).toHaveLength(1)
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('')
    expect(thread(wrapper, 1).text()).toContain('Draft')
    await inThread(wrapper, 1, 'Reply').trigger('click')
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('First words')
    expect(thread(wrapper, 1).text()).not.toContain('Draft')
  })

  it('counts a reply set aside as a draft the card asks about before leaving', async () => {
    let unsaved: readonly string[] = []
    const Host = defineComponent({
      setup() {
        const guard = provideDraftGuard()
        return () => {
          unsaved = guard.unsaved.value
          return h(InspectorDiscussion, { item: card([root(1), root(2)]), writable: true })
        }
      },
    })
    const wrapper = mount(Host, { attachTo: document.body, global: { plugins } })
    track(wrapper)
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('Words')
    await flushPromises()
    expect(unsaved).toEqual(['reply'])
    await inThread(wrapper, 2, 'Resolve').trigger('click')
    await wrapper.get('input[aria-label], .resolve-form input').setValue('A decision')
    await flushPromises()
    expect(unsaved).toEqual(['reply', 'resolution'])
  })

  it('marks after the reply when asked, and lands on the thread', async () => {
    const item = card([root(1)])
    const wrapper = open(item)
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('Settled')
    await wrapper.get('.reply-mark input').setValue(true)
    vi.mocked(replyInThread).mockResolvedValueOnce(written(2, 1))
    vi.mocked(resolveThread).mockResolvedValueOnce({
      work_item: 'MAIN-12',
      comment_id: 1,
      resolution: MARK,
    })
    await wrapper.get('.reply-composer').trigger('submit')
    await flushPromises()
    expect(resolveThread).toHaveBeenCalledWith({
      id: item.work_item_id,
      comment_id: 1,
      resolution: '',
    })
    expect(wrapper.find('.reply-mark-failed').exists()).toBe(false)
    expect(document.activeElement?.id).toBe('work-report-1')
  })

  it('offers the mark again when the reply went through and the mark did not', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('Settled')
    await wrapper.get('.reply-mark input').setValue(true)
    vi.mocked(replyInThread).mockResolvedValueOnce(written(2, 1))
    vi.mocked(resolveThread).mockRejectedValueOnce(new Error('offline'))
    await wrapper.get('.reply-composer').trigger('submit')
    await flushPromises()
    // The reply is on the server: its field is gone and the card reads it again.
    expect(wrapper.find('textarea[aria-label="Your reply"]').exists()).toBe(false)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.get('.reply-mark-failed').attributes('role')).toBe('alert')
    expect(wrapper.get('.reply-mark-failed').text()).toContain(
      'The reply was sent, but the thread could not be marked.',
    )
    vi.mocked(resolveThread).mockRejectedValueOnce(new Error('offline'))
    await getButton(wrapper, 'Mark again').trigger('click')
    await flushPromises()
    expect(wrapper.find('.reply-mark-failed').exists()).toBe(true)
    vi.mocked(resolveThread).mockResolvedValueOnce({
      work_item: 'MAIN-12',
      comment_id: 1,
      resolution: MARK,
    })
    await getButton(wrapper, 'Mark again').trigger('click')
    await flushPromises()
    expect(wrapper.find('.reply-mark-failed').exists()).toBe(false)
    expect(replyInThread).toHaveBeenCalledTimes(1)
  })

  it('offers no mark on a thread already marked', async () => {
    const wrapper = open(card([root(1, { resolution: MARK })]))
    await inThread(wrapper, 1, 'Expand').trigger('click')
    await inThread(wrapper, 1, 'Reply').trigger('click')
    expect(wrapper.find('.reply-mark').exists()).toBe(false)
  })
})
