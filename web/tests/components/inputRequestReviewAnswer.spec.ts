/**
 * A review once answered: its one-line summary and the points not simply accepted, every row
 * behind «Show all», the same form opening in place to change it, and its earlier answers read
 * as what each change changed. The form itself is `inputRequestReview.spec.ts`.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import { changeInputRequestAnswer } from '@/shared/api/inputRequestApi.ts'
import type { InputAnswers, InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { firstAnswer, requestEntry } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { recommendedAnswer, reviewFields } from '../support/reviewQuestion.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  changeInputRequestAnswer: vi.fn(),
}))

/** Fourteen accepted, P12 put off, P15 rejected with a comment, P9 an own variant, P17 left. */
const LEFT = new Set(['p9', 'p17', 'p17-steps', 'p15-steps'])
const answers: InputAnswers = {
  ...Object.fromEntries(Object.entries(recommendedAnswer).filter(([id]) => !LEFT.has(id))),
  p12: 'later',
  p15: 'reject',
}

function answered(change: Partial<InputRequestEntry['request']> = {}): InputRequestEntry {
  const entry = requestEntry()
  entry.request = {
    ...entry.request,
    fields: reviewFields,
    status: 'answered',
    ...firstAnswer,
    answers,
    own: { p9: 'Labels only, no filtering' },
    field_notes: { p15: 'Frozen until spring' },
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-11-05T18:40:00Z',
    revision: 2,
    ...change,
  }
  return entry
}

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  )
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
function card(entry: InputRequestEntry) {
  const wrapper: VueWrapper = mount(RequestCard, {
    props: {
      entry,
      'draft': EMPTY_DRAFT,
      'onUpdate:draft': (draft: unknown) => {
        void wrapper.setProps({ draft })
      },
    },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  wrappers.push(wrapper)
  return wrapper
}
const buttonNamed = (wrapper: VueWrapper, name: string | RegExp) =>
  present(
    wrapper.findAll('button').find((node) => {
      const said = node.attributes('aria-label') ?? node.text()
      return typeof name === 'string' ? said === name : name.test(said)
    }),
    String(name),
  )
async function press(wrapper: VueWrapper, name: string | RegExp) {
  await buttonNamed(wrapper, name).trigger('click')
  await flushPromises()
}

describe('the answered review', () => {
  it('reads as one line of counts and the points not simply accepted', () => {
    const wrapper = card(answered())
    expect(wrapper.get('.request-summary-counts').text()).toBe(
      'Accepted 14 · put off 1 · rejected 1 · own option 1 · undecided 1',
    )
    expect(wrapper.get('.request-summary-named').text()).toBe(
      'Put off: P12. Rejected: P15. Own option: P9. Undecided: P17.',
    )
    expect(wrapper.find('.request-option').exists()).toBe(false)
  })

  it('shows every row behind its press, with each verdict in a word and the steps whole', async () => {
    const wrapper = card(answered())
    const toggle = buttonNamed(wrapper, 'Show all 18 rows')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await press(wrapper, 'Show all 18 rows')
    const point = (label: string) =>
      present(
        wrapper.findAll('.request-summary-point').find((row) => row.text().startsWith(label)),
        label,
      )
    expect(point('P12 ').text()).toContain('put off')
    expect(point('P15 ').text()).toContain('rejected')
    expect(point('P15 ').text()).toContain('Frozen until spring')
    expect(point('P9 ').text()).toContain('Your own option')
    expect(point('P9 ').text()).toContain('Labels only, no filtering')
    expect(point('P17 ').text()).toContain('undecided')
    expect(point('P1 ').get('code').text()).toBe('shell-guard')
    // The steps of an accepted point, every option with what was chosen.
    const p10 = present(
      wrapper.findAll('.request-answer').find((field) => field.text().includes('Lock the browser')),
      'p10 steps',
    )
    expect(p10.findAll('.request-option')).toHaveLength(13)
    expect(p10.text().match(/selected/gu)).toHaveLength(5)
    // A point put off or rejected opened nothing, so nothing of its steps stands.
    expect(wrapper.text()).not.toContain('The «main first parent» rule')
    expect(buttonNamed(wrapper, 'Hide the rows').attributes('aria-expanded')).toBe('true')
  })

  it('shows the rows open where the question has few verdicts and no group', () => {
    const few = reviewFields.slice(0, 3).map((field) => ({ ...field, group: undefined }))
    const wrapper = card(
      answered({ fields: few, answers: { p1: 'accept', p3: 'reject' }, own: {}, field_notes: {} }),
    )
    expect(wrapper.text()).not.toContain('Show all')
    expect(wrapper.findAll('.request-summary-point')).toHaveLength(3)
    expect(wrapper.get('.request-summary-counts').text()).toBe(
      'Accepted 1 · rejected 1 · undecided 1',
    )
  })
})

describe('changing it', () => {
  it('opens the same form in place on the answer in force, and saves the whole new answer', async () => {
    const entry = answered()
    vi.mocked(changeInputRequestAnswer).mockReturnValue(new Promise(() => {}))
    const wrapper = card(entry)
    await press(wrapper, 'Change answer')
    const row = (label: string) =>
      present(
        wrapper.findAll('.request-point').find((node) => node.text().startsWith(label)),
        label,
      )
    const checked = (label: string) =>
      row(label)
        .findAll('[aria-checked="true"]')
        .map((node) => node.text())
    expect(checked('P12 ')).toEqual(['Later'])
    expect(checked('P9 ')).toEqual([])
    expect(row('P9 ').get<HTMLTextAreaElement>('textarea').element.value).toBe(
      'Labels only, no filtering',
    )
    expect(buttonNamed(wrapper, 'Save change').attributes('disabled')).toBeDefined()
    await present(
      row('P12 ')
        .findAll('[role="radio"]')
        .find((node) => node.text() === 'Accept'),
      'accept',
    ).trigger('click')
    await flushPromises()
    await press(wrapper, 'Save change')
    expect(changeInputRequestAnswer).toHaveBeenCalledOnce()
    const [, sent, parts] = present(vi.mocked(changeInputRequestAnswer).mock.calls[0], 'call')
    expect(sent).toEqual({ ...answers, p12: 'accept' })
    expect(parts).toMatchObject({
      own: { p9: 'Labels only, no filtering' },
      field_notes: { p15: 'Frozen until spring' },
    })
  })
})

describe('its earlier answers', () => {
  // In the order of the fields, which here put P12 before P10 as the real review did.
  it('read as what each change changed, row by row, in the person’s words', async () => {
    const before = {
      ...answers,
      'p10-steps': ['lock', 'dirty'],
      'p12': 'later',
    }
    const wrapper = card(
      answered({
        answers: { ...answers, 'p10-steps': ['dirty', 'managed'], 'p12': 'accept' },
        answer_version: 2,
        revision: 3,
        history: [
          {
            version: 1,
            answers: before,
            own: { p9: 'Labels only, no filtering' },
            field_notes: {},
            note: null,
            answered_by: 'user',
            by_person: true,
            answered_at: '2026-11-05T18:20:00Z',
          },
        ],
      }),
    )
    await press(wrapper, 'Previous answers (1)')
    expect(wrapper.findAll('.request-history-line').map((line) => line.text())).toEqual([
      'P12 put off → accepted',
      'P10 · Steps +serve --managed and the bundle from the working tree −Lock the browser suite with its owner; free ports or a variable',
      'P15 comment: Frozen until spring',
    ])
  })
})
