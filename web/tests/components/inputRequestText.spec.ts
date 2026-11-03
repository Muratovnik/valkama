/**
 * A text answer to a question is written in the markdown editor, because the
 * answered request draws it as markdown: previewed as it will read, refused
 * where it is written, sent with Ctrl+Enter.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import { answerInputRequest } from '@/shared/api/inputRequestApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { requestEntry } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))

type Wrapper = ReturnType<typeof mount>
const wrappers: Wrapper[] = []
const button = (wrapper: Wrapper, name: string) =>
  present(
    wrapper.findAll('button').find((control) => control.text() === name),
    name,
  )
function card(entry = requestEntry(), draft = EMPTY_DRAFT) {
  const wrapper = mount(RequestCard, {
    props: {
      entry,
      draft,
      'onUpdate:draft': (draft) => {
        void wrapper.setProps({ draft })
      },
    },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  wrappers.push(wrapper)
  return wrapper
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

describe('a text answer to a question', () => {
  // The form comes back with the words of a draft the host kept, which nobody asked to open.
  it('stands open from the start around words already written', () => {
    const wrapper = card(requestEntry(), { ...EMPTY_DRAFT, note: 'Something' })
    expect(wrapper.get('textarea').element.value).toBe('Something')
  })

  // The answered request draws a text answer as markdown, so it is written in
  // the markdown editor: previewed as it will read, sent with Ctrl+Enter.
  it('writes a text answer as markdown, previews it and sends it on Ctrl+Enter', async () => {
    const entry = requestEntry()
    entry.request.fields = [
      { id: 'note', label: 'Reason', type: 'text', required: true, options: [] },
    ]
    vi.mocked(answerInputRequest).mockResolvedValue({
      ...entry,
      request: {
        ...entry.request,
        status: 'answered',
        answers: { note: 'Use **v2**' },
        revision: 2,
      },
    })
    const wrapper = card(entry)
    const view = (name: string) =>
      present(
        wrapper.findAll('button[aria-pressed]').find((control) => control.text() === name),
        name,
      )
    // Asked while the answer is shown as a preview, the empty answer is
    // refused where it is written.
    await view('Preview').trigger('click')
    expect(wrapper.get('textarea').element.closest('[inert]')).not.toBeNull()
    await button(wrapper, 'Send').trigger('click')
    await flushPromises()
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(wrapper.get('textarea').element)

    await wrapper.get('textarea').setValue('Use **v2**')
    await view('Preview').trigger('click')
    expect(wrapper.get('.request-fields strong').text()).toBe('v2')
    await view('Write').trigger('click')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, { note: 'Use **v2**' }, '')
    expect(wrapper.get('.request-state strong').text()).toBe('v2')
  })

  it('offers no write-or-preview switch for a question without a text answer', () => {
    expect(card().find('button[aria-pressed]').exists()).toBe(false)
  })
})
