/**
 * An option's label is markdown as its description is: code in it reads as code, with no
 * backticks left, in the form, in what is chosen under it and in the answered question.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { firstAnswer, requestEntry } from '../support/inputRequests.ts'

const field: InputRequestField = {
  id: 'way',
  label: 'Way',
  type: 'choice',
  required: true,
  options: [
    {
      id: 'per_block',
      label: 'The standard `vue/max-lines-per-block`, see [the rule](https://example.com/rule)',
      description: `${'A limit on each block of the file. '.repeat(8)}`,
    },
    { id: 'plain', label: 'Leave it as it is' },
  ],
}
const mounted: ReturnType<typeof mount>[] = []
// A path in a label asks the server what it is; the question here is only how it reads.
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  ),
)
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
})

function card(change: Partial<InputRequestEntry['request']>, draft = EMPTY_DRAFT) {
  const entry = requestEntry()
  entry.request = { ...entry.request, fields: [field], ...change }
  const wrapper = mount(RequestCard, {
    props: { entry, draft },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  mounted.push(wrapper)
  return wrapper
}

it('draws code in a label as code, and a link in it as its words inside the form', () => {
  const wrapper = card({})
  const label = wrapper.findAll('.request-option-label')[0]
  expect(label?.text()).toBe('The standard vue/max-lines-per-block, see the rule')
  expect(label?.find('code').text()).toBe('vue/max-lines-per-block')
  // A press inside a radio's label would select it as well as follow the link.
  expect(label?.find('a').exists()).toBe(false)
  expect(wrapper.findAll('.request-option-label')[1]?.html()).toContain('>Leave it as it is<')
})

it('names the radio by those words, not by the markdown', () => {
  const wrapper = card({})
  const radio = wrapper.get('input[value="per_block"]')
  const named = wrapper.get(`#${radio.attributes('aria-labelledby') ?? ''}`)
  expect(named.text()).not.toContain('`')
})

it('draws a chosen label the same way where it stands whole under the options', async () => {
  const wrapper = card({}, { ...EMPTY_DRAFT, answers: { way: 'per_block' } })
  await flushPromises()
  const chosen = wrapper.get('.request-chosen')
  expect(chosen.text()).not.toContain('`')
  expect(chosen.find('code').text()).toBe('vue/max-lines-per-block')
})

it('keeps the link of an answered label, where no radio stands', () => {
  const wrapper = card({
    status: 'answered',
    answers: { way: 'per_block' },
    ...firstAnswer,
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-10-24T12:00:00Z',
    revision: 2,
  })
  const label = wrapper.get('.request-option-label')
  expect(label.text()).not.toContain('`')
  expect(label.get('a').attributes('href')).toBe('https://example.com/rule')
})
