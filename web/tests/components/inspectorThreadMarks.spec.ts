/**
 * The mark on a thread, the thread of a question and the filter that reads by the mark.
 */
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { replyInThread, resolveThread } from '@/shared/api/planningApi.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { getButton } from '../fixtures/workItem.ts'
import { requestEntry } from '../support/inputRequests.ts'
import {
  card,
  entryIds,
  inThread,
  key,
  MARK,
  open,
  reply,
  replyField,
  root,
  thread,
  time,
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

function asked() {
  const entry = requestEntry()
  entry.request = { ...entry.request, status: 'pending', created_at: time(1) }
  return entry
}
const talked = () => [root(1), root(2, { resolution: MARK }), root(3)]
const unresolved = (wrapper: VueWrapper) => getButton(wrapper, 'Unresolved 2')
const count = (wrapper: VueWrapper) => wrapper.get('.section-header-count').text()

describe('a question has a thread too', () => {
  it('replies under the question, shows the replies there, and offers no mark', async () => {
    const entry = asked()
    const id = entry.request.request_id
    const under = root(2, { reply_to_request: id, body: 'Which docs?' })
    const item = card([under])
    const wrapper = open(item, { questions: [entry] })
    const tail = wrapper.get('.thread-question .thread-tail')
    expect(tail.text()).toContain('Which docs?')
    expect(wrapper.find('.thread-entry').exists()).toBe(false)
    await getButton(wrapper, 'Reply').trigger('click')
    expect(wrapper.find('.reply-mark').exists()).toBe(false)
    await replyField(wrapper).setValue('All of them')
    vi.mocked(replyInThread).mockResolvedValueOnce({
      ...written(3, 0),
      reply_to: null,
      reply_to_request: id,
    })
    await tail.get('.reply-composer').trigger('submit')
    await flushPromises()
    expect(replyInThread).toHaveBeenCalledWith({
      id: item.work_item_id,
      body: 'All of them',
      reply_to_request: id,
    })
  })

  it('still shows a reply when its question could not be read', () => {
    const under = root(2, { reply_to_request: 'unread-question', body: 'Which docs?' })
    const wrapper = open(card([under]), { questionsUnread: true })
    expect(wrapper.get('.thread-row').text()).toContain('Which docs?')
    expect(wrapper.get('.thread-row').text()).toContain(
      'Replies to an entry this card could not read',
    )
  })
})

describe('marking', () => {
  it('sends the decision, and focus lands on the thread as it folds', async () => {
    const item = card([root(1), reply(2, 1)])
    const wrapper = open(item)
    await inThread(wrapper, 1, 'Resolve').trigger('click')
    await nextTick()
    const field = wrapper.get('.resolve-form input')
    expect(document.activeElement).toBe(field.element)
    await field.setValue('  Moved to MAIN-14 ')
    vi.mocked(resolveThread).mockResolvedValueOnce({
      work_item: 'MAIN-12',
      comment_id: 1,
      resolution: MARK,
    })
    await wrapper.get('.resolve-form').trigger('submit')
    await flushPromises()
    expect(resolveThread).toHaveBeenCalledWith({
      id: item.work_item_id,
      comment_id: 1,
      resolution: 'Moved to MAIN-14',
    })
    expect(document.activeElement?.id).toBe('work-report-1')
    await wrapper.setProps({ item: card([root(1, { resolution: MARK }), reply(2, 1)]) })
    await flushPromises()
    expect(document.activeElement?.id).toBe('work-report-1')
    expect(thread(wrapper, 1).classes()).toContain('is-folded')
    expect(thread(wrapper, 1).text()).toContain('Moved to MAIN-14')
    expect(thread(wrapper, 1).text()).toContain('Root 1')
    expect(wrapper.find('.reply-text').exists()).toBe(false)
  })

  it('sends a blank decision as an empty one', async () => {
    const item = card([root(1)])
    const wrapper = open(item)
    await inThread(wrapper, 1, 'Resolve').trigger('click')
    vi.mocked(resolveThread).mockResolvedValueOnce({
      work_item: 'MAIN-12',
      comment_id: 1,
      resolution: { ...MARK, text: '' },
    })
    await wrapper.get('.resolve-form').trigger('submit')
    await flushPromises()
    expect(resolveThread).toHaveBeenCalledWith({
      id: item.work_item_id,
      comment_id: 1,
      resolution: '',
    })
  })

  it("hints at a task in this card's own space, and names no number in it", async () => {
    const wrapper = open({ ...card([root(1)]), reference: 'DOCS-3' })
    await inThread(wrapper, 1, 'Resolve').trigger('click')
    expect(wrapper.get('.resolve-form input').attributes('placeholder')).toBe(
      'to DOCS-…, postponed, declined',
    )
  })

  it('goes back on Escape to Resolve from an empty line, keeping the card', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Resolve').trigger('click')
    const card$ = vi.fn()
    document.addEventListener('keydown', card$)
    key(wrapper.get('.resolve-form input'), 'Escape')
    await flushPromises()
    document.removeEventListener('keydown', card$)
    expect(card$).not.toHaveBeenCalled()
    expect(wrapper.find('.resolve-form').exists()).toBe(false)
    expect(document.activeElement?.id).toBe('thread-resolve-comment-1')
  })

  it('asks on Escape before it drops a decision, and drops it only on that answer', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Resolve').trigger('click')
    await wrapper.get('.resolve-form input').setValue('Half a decision')
    const card$ = vi.fn()
    document.addEventListener('keydown', card$)
    key(wrapper.get('.resolve-form input'), 'Escape')
    await flushPromises()
    document.removeEventListener('keydown', card$)
    expect(card$).not.toHaveBeenCalled()
    expect(wrapper.get('.resolve-form .confirm-strip').text()).toContain(
      'Discard this draft decision?',
    )
    expect((wrapper.get('.resolve-form input').element as HTMLInputElement).value).toBe(
      'Half a decision',
    )
    await wrapper.get('.resolve-form .confirm-go').trigger('click')
    await flushPromises()
    expect(wrapper.find('.resolve-form').exists()).toBe(false)
    expect(document.activeElement?.id).toBe('thread-resolve-comment-1')
    await inThread(wrapper, 1, 'Resolve').trigger('click')
    expect((wrapper.get('.resolve-form input').element as HTMLInputElement).value).toBe('')
  })

  it('keeps the decision and says why when the mark is refused', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Resolve').trigger('click')
    await wrapper.get('.resolve-form input').setValue('A decision')
    vi.mocked(resolveThread).mockRejectedValueOnce(new Error('offline'))
    await wrapper.get('.resolve-form').trigger('submit')
    await flushPromises()
    expect((wrapper.get('.resolve-form input').element as HTMLInputElement).value).toBe(
      'A decision',
    )
    expect(wrapper.get('.resolve-error').attributes('role')).toBe('alert')
  })

  it('opens a folded thread by a button that stays and says its state', async () => {
    const wrapper = open(card([root(1, { resolution: MARK }), reply(2, 1)]))
    const toggle = inThread(wrapper, 1, 'Expand')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    ;(toggle.element as HTMLButtonElement).focus()
    await toggle.trigger('click')
    expect(toggle.attributes('aria-label')).toBe('Collapse')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(toggle.element)
    expect(thread(wrapper, 1).text()).toContain('Reply 2')
  })

  it('takes the mark off with the same button that placed it, which keeps focus', async () => {
    const item = card([root(1, { resolution: MARK })])
    const wrapper = open(item)
    await inThread(wrapper, 1, 'Expand').trigger('click')
    const button = inThread(wrapper, 1, 'Reopen')
    ;(button.element as HTMLButtonElement).focus()
    vi.mocked(resolveThread).mockResolvedValueOnce({
      work_item: 'MAIN-12',
      comment_id: 1,
      resolution: null,
    })
    await button.trigger('click')
    await flushPromises()
    expect(resolveThread).toHaveBeenCalledWith({
      id: item.work_item_id,
      comment_id: 1,
      reopen: true,
    })
    await wrapper.setProps({ item: card([root(1)]) })
    await flushPromises()
    expect(button.attributes('aria-label')).toBe('Resolve')
    expect(document.activeElement).toBe(button.element)
  })

  it('says a reply came after the mark', () => {
    const wrapper = open(
      card([
        root(1, { resolution: MARK }),
        reply(2, 1, { at: time(51) }),
        root(3, { resolution: MARK }),
        reply(4, 3),
      ]),
    )
    expect(thread(wrapper, 1).text()).toContain('Reply after the mark')
    expect(thread(wrapper, 3).text()).not.toContain('Reply after the mark')
  })

  it('takes focus to the thread when an agent marks it under the reader', async () => {
    const wrapper = open(card([root(1)]))
    const button = inThread(wrapper, 1, 'Reply')
    ;(button.element as HTMLButtonElement).focus()
    await wrapper.setProps({ item: card([root(1, { resolution: MARK })]) })
    await flushPromises()
    expect(document.activeElement?.id).toBe('work-report-1')
  })

  it('does not fold a thread with a form open in it, whoever marks it', async () => {
    const wrapper = open(card([root(1)]))
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await replyField(wrapper).setValue('Words')
    await wrapper.setProps({ item: card([root(1, { resolution: MARK })]) })
    expect((replyField(wrapper).element as HTMLTextAreaElement).value).toBe('Words')
  })
})

describe('the history tab', () => {
  it.each(['en', 'ru'] as const)(
    'names what the mark and a changed answer write in %s',
    (locale) => {
      const { activity } = messages[locale]
      expect(activity.comment_resolved).toBeTruthy()
      expect(activity.comment_reopened).toBeTruthy()
      expect(activity.request_changed).toBeTruthy()
    },
  )
})

describe('the filter', () => {
  it('says how many are open in the heading whichever way it is set', async () => {
    const wrapper = open(card(talked()))
    expect(wrapper.get('.section-header').text()).toContain('2 unresolved')
    await unresolved(wrapper).trigger('click')
    expect(wrapper.get('.section-header').text()).toContain('2 unresolved')
  })

  it('counts threads in the heading, both numbers in one unit and each named', () => {
    // Two threads hold four entries: a reply is not a thread, and a question is one, and
    // while it waits, an unresolved one, as the unresolved view shows it.
    const replied = card([root(1), reply(2, 1), root(3, { resolution: MARK })])
    expect(count(open(replied, { questions: [asked()] }))).toBe('3 threads · 2 unresolved')
    expect(count(open(card([root(1, { resolution: MARK }), reply(2, 1)])))).toBe('1')
  })

  it.each([
    ['en', 1, '1 thread · 1 unresolved'],
    ['en', 5, '5 threads · 5 unresolved'],
    ['ru', 1, '1 ветка · 1 неразобранная'],
    ['ru', 2, '2 ветки · 2 неразобранных'],
    ['ru', 5, '5 веток · 5 неразобранных'],
    ['ru', 11, '11 веток · 11 неразобранных'],
    ['ru', 21, '21 ветка · 21 неразобранная'],
  ] as const)('words the heading in %s for %i threads', (locale, n, words) => {
    const i18n = createI18n({ legacy: false, locale, messages, pluralRules })
    const { t } = i18n.global
    expect(`${t('threads.threadCount', n)} · ${t('threads.unresolvedCount', n)}`).toBe(words)
  })

  it('does not stand on a card with no comment thread', () => {
    const entry = requestEntry()
    const wrapper = open(card([]), { questions: [entry] })
    expect(wrapper.find('.thread-filter').exists()).toBe(false)
  })

  it('hides what is settled, says how much, and brings it back on the first of it', async () => {
    const wrapper = open(card(talked()))
    await unresolved(wrapper).trigger('click')
    expect(entryIds(wrapper)).toEqual(['work-report-3', 'work-report-1'])
    expect(wrapper.get('.thread-hidden').text()).toContain('1 resolved thread hidden')
    await getButton(wrapper, 'Show all').trigger('click')
    await flushPromises()
    expect(entryIds(wrapper)).toEqual(['work-report-3', 'work-report-2', 'work-report-1'])
    expect(wrapper.find('.thread-hidden').exists()).toBe(false)
    expect(document.activeElement?.id).toBe('work-report-2')
  })

  it('says when nothing is open', async () => {
    const wrapper = open(card([root(1, { resolution: MARK })]))
    await getButton(wrapper, 'Unresolved 0').trigger('click')
    expect(wrapper.get('.data-empty').text()).toBe('No unresolved threads.')
    expect(wrapper.get('.thread-hidden').text()).toContain('1 resolved thread hidden')
  })

  it('remembers the choice for the window', async () => {
    const wrapper = open(card(talked()))
    await unresolved(wrapper).trigger('click')
    unmountAll()
    const again = open(card(talked()))
    expect(entryIds(again)).toEqual(['work-report-3', 'work-report-1'])
    expect(again.find('.thread-hidden').exists()).toBe(true)
  })

  it('keeps a thread marked in this view where the reader left it until the view changes', async () => {
    const wrapper = open(card(talked()))
    await unresolved(wrapper).trigger('click')
    await inThread(wrapper, 3, 'Resolve').trigger('click')
    vi.mocked(resolveThread).mockResolvedValueOnce({
      work_item: 'MAIN-12',
      comment_id: 3,
      resolution: MARK,
    })
    await wrapper.get('.resolve-form').trigger('submit')
    await flushPromises()
    await wrapper.setProps({
      item: card([root(1), root(2, { resolution: MARK }), root(3, { resolution: MARK })]),
    })
    await flushPromises()
    expect(entryIds(wrapper)).toEqual(['work-report-3', 'work-report-1'])
    expect(document.activeElement?.id).toBe('work-report-3')
    await getButton(wrapper, 'All').trigger('click')
    await getButton(wrapper, 'Unresolved 1').trigger('click')
    expect(entryIds(wrapper)).toEqual(['work-report-1'])
  })

  it('hides a thread an agent marks, unless words are waiting in it', async () => {
    const wrapper = open(card(talked()))
    await unresolved(wrapper).trigger('click')
    await inThread(wrapper, 3, 'Reply').trigger('click')
    await replyField(wrapper).setValue('Words')
    await inThread(wrapper, 1, 'Reply').trigger('click')
    await wrapper.setProps({
      item: card([
        root(1, { resolution: MARK }),
        root(2, { resolution: MARK }),
        root(3, { resolution: MARK }),
      ]),
    })
    // 1 has the open form and 3 the words set aside, so neither goes; only 2 is hidden.
    expect(entryIds(wrapper)).toEqual(['work-report-3', 'work-report-1'])
    expect(thread(wrapper, 3).text()).toContain('Draft')
    expect(wrapper.get('.thread-hidden').text()).toContain('1 resolved thread hidden')
  })

  it('never hides the report the card names as its outcome', async () => {
    const report = root(4, {
      kind: 'report',
      body: '',
      report: { done: 'Done', next: 'Next' },
      resolution: MARK,
    })
    const item = { ...card([root(1), report]), summary_comment_id: 4 }
    const wrapper = open(item)
    await getButton(wrapper, 'Unresolved 1').trigger('click')
    expect(entryIds(wrapper)).toContain('work-report-4')
  })
})
