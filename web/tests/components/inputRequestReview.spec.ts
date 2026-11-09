/**
 * A review answered in the thread, by the plan's rules and its check table: verdicts with no
 * value until chosen, Accept filling the steps once, Accept recommended filling only what is
 * undecided, the undecided count said over Send, a required row stopping the send, a comment
 * standing for a verdict, groups that fold, and a head and foot that stay in sight.
 * The real 25-field form in a browser is `production-question-review.spec.ts`.
 */
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestCard from '@/features/input-requests/components/RequestCard.vue'
import { EMPTY_DRAFT } from '@/features/input-requests/utils/validateAnswers.ts'

import { answerInputRequest } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { requestEntry } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'
import { recommendedAnswer, reviewFields } from '../support/reviewQuestion.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.resetAllMocks()
  // A path in a label asks the server what it is; nothing here waits for that.
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

function asked(fields: InputRequestField[] = reviewFields): InputRequestEntry {
  const entry = requestEntry()
  entry.request = { ...entry.request, fields }
  return entry
}
function card(entry = asked()) {
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
type Wrapper = VueWrapper
const point = (wrapper: Wrapper, label: string) =>
  present(
    wrapper.findAll('.request-point').find((row) => row.text().includes(label)),
    `point ${label}`,
  )
const segment = (row: DOMWrapper<Element>, word: string) =>
  present(
    row.findAll('[role="radio"]').find((node) => node.text() === word),
    `segment ${word}`,
  )
async function decide(wrapper: Wrapper, label: string, word: string) {
  await segment(point(wrapper, label), word).trigger('click')
  await flushPromises()
}
const buttonNamed = (wrapper: Wrapper, name: string) =>
  present(
    wrapper
      .findAll('button')
      .find((node) => node.text() === name || node.attributes('aria-label') === name),
    name,
  )
async function press(wrapper: Wrapper, name: string) {
  await buttonNamed(wrapper, name).trigger('click')
  await flushPromises()
}
const ticked = (wrapper: Wrapper) =>
  wrapper
    .findAll<HTMLInputElement>('input[type="checkbox"]')
    .filter((box) => box.element.checked)
    .map((box) => box.element.value)
/** The review with one point required and recommending nothing, so a fill leaves it undecided. */
const requiredWithout = (id: string) =>
  reviewFields.map(({ recommended, ...field }) =>
    field.id === id
      ? { ...field, required: true }
      : { ...field, ...(recommended && { recommended }) },
  )
const head = (wrapper: Wrapper) => wrapper.get('.request-review-head')
const foot = (wrapper: Wrapper) => wrapper.get('footer')

describe('a point', () => {
  it('has no verdict until one is chosen, and Tab stops on its first word choosing nothing', () => {
    const row = point(card(), 'P1 ')
    expect(row.findAll('[aria-checked="true"]')).toHaveLength(0)
    expect(row.findAll('[role="radio"][tabindex="0"]').map((node) => node.text())).toEqual([
      'Accept',
    ])
  })

  it('draws code in its label as code', () => {
    const label = point(card(), 'P1 ').get('.request-point-label')
    expect(label.text()).not.toContain('`')
    expect(label.get('code').text()).toBe('shell-guard')
  })

  it('says the recommendation in words while undecided or decided otherwise', async () => {
    const wrapper = card()
    expect(point(wrapper, 'P2 ').text()).toContain('recommended: accept')
    await decide(wrapper, 'P2 ', 'Accept')
    expect(point(wrapper, 'P2 ').text()).not.toContain('recommended')
    await decide(wrapper, 'P2 ', 'Reject')
    expect(point(wrapper, 'P2 ').text()).toContain('recommended: accept')
  })

  it('tells a reader that Accept opens the steps below, and only where it does', () => {
    const wrapper = card()
    const accept = segment(point(wrapper, 'P4 '), 'Accept')
    const said = wrapper.get(`#${accept.attributes('aria-describedby') ?? ''}`)
    expect(said.text()).toBe('Opens below: Steps')
    expect(segment(point(wrapper, 'P1 '), 'Accept').attributes('aria-describedby')).toBeUndefined()
  })

  it('makes its description’s toggle a tab stop only while focus is in the row', async () => {
    const row = point(card(), 'P1 ')
    const toggle = row.get('.request-point-toggle')
    expect(toggle.attributes('tabindex')).toBe('-1')
    await segment(row, 'Accept').trigger('focusin')
    expect(toggle.attributes('tabindex')).toBe('0')
  })
})

describe('accepting a point with steps', () => {
  it('opens the recommended steps under it and leaves focus in the segments', async () => {
    const wrapper = card()
    expect(wrapper.text()).not.toContain('Mark the 14 refusals')
    const accept = segment(point(wrapper, 'P4 '), 'Accept')
    ;(accept.element as HTMLElement).focus()
    await accept.trigger('click')
    await flushPromises()
    expect(ticked(wrapper)).toEqual(['p4a', 'p4b', 'p4c'])
    expect(point(wrapper, 'P4 ').text()).toContain('3 of 3')
    expect(document.activeElement).toBe(accept.element)
  })

  it('fills them once: steps taken back stay taken back across another verdict', async () => {
    const wrapper = card()
    await decide(wrapper, 'P10 ', 'Accept')
    expect(ticked(wrapper)).toEqual(['lock', 'dirty', 'managed', 'click', 'mutant'])
    expect(point(wrapper, 'P10 ').text()).toContain('5 of 13')
    await wrapper.get('input[value="lock"]').setValue(false)
    await decide(wrapper, 'P10 ', 'Later')
    expect(ticked(wrapper)).toEqual([])
    await decide(wrapper, 'P10 ', 'Accept')
    expect(ticked(wrapper)).toEqual(['dirty', 'managed', 'click', 'mutant'])
  })

  it('names the count beside the point as what describes its steps', async () => {
    const wrapper = card()
    await decide(wrapper, 'P5 ', 'Accept')
    await wrapper.get('input[value="p5a"]').setValue(false)
    const steps = present(
      wrapper.findAll('fieldset').find((group) => group.text().includes('Do not name')),
      'steps',
    )
    const said = steps.attributes('aria-describedby') ?? ''
    expect(wrapper.get(`[id="${said}"]`).text()).toBe('4 of 5')
  })

  it('a way under Accept is chosen with its recommended option', async () => {
    const wrapper = card()
    await decide(wrapper, 'P13 ', 'Accept')
    const radio = wrapper.get<HTMLInputElement>('input[type="radio"][value="per_block"]')
    expect(radio.element.checked).toBe(true)
  })
})

describe('Accept recommended', () => {
  it('fills only what is undecided, keeps focus and says what it did once', async () => {
    const wrapper = card()
    await decide(wrapper, 'P15 ', 'Reject')
    expect(head(wrapper).text()).toContain('Decided 1 of 18')
    const fill = buttonNamed(wrapper, 'Accept recommended')
    ;(fill.element as HTMLElement).focus()
    await fill.trigger('click')
    await flushPromises()
    expect(head(wrapper).text()).toContain('Decided 18 of 18')
    expect(segment(point(wrapper, 'P15 '), 'Reject').attributes('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(fill.element)
    expect(head(wrapper).get('[role="status"]').text()).toBe(
      'Filled from the recommendation: 17 rows',
    )
    // Undone by hand like any choice.
    await decide(wrapper, 'P1 ', 'Later')
    expect(head(wrapper).text()).toContain('Decided 18 of 18')
  })

  it('is not offered where nothing is recommended', () => {
    const bare = reviewFields.map((field) => ({ ...field, recommended: undefined }))
    expect(card(asked(bare)).text()).not.toContain('Accept recommended')
  })
})

describe('sending', () => {
  it('says how many points are undecided over Send, and sends without them', async () => {
    const entry = asked(reviewFields.slice(0, 5))
    vi.mocked(answerInputRequest).mockReturnValue(new Promise(() => {}))
    const wrapper = card(entry)
    await flushPromises()
    expect(foot(wrapper).text()).toContain('Undecided: 4. The agent will read them as undecided.')
    await decide(wrapper, 'P1 ', 'Later')
    await decide(wrapper, 'P4 ', 'Accept')
    expect(foot(wrapper).text()).toContain('Undecided: 2. The agent will read them as undecided.')
    await press(wrapper, 'Send')
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(
      entry,
      { 'p1': 'later', 'p4': 'accept', 'p4-steps': ['p4a', 'p4b', 'p4c'] },
      '',
      { own: {}, field_notes: {} },
    )
  })

  it('stops at a required point left undecided and takes focus to it', async () => {
    const wrapper = card(asked(requiredWithout('p6')))
    await press(wrapper, 'Accept recommended')
    await press(wrapper, 'Send')
    expect(answerInputRequest).not.toHaveBeenCalled()
    const row = point(wrapper, 'P6 ')
    expect(row.text()).toContain('Choose a decision.')
    expect(row.get('[role="radiogroup"]').attributes('aria-invalid')).toBe('true')
    expect(row.element.contains(document.activeElement)).toBe(true)
  })

  it('stops at steps all taken back under Accept, and says how to put it right', async () => {
    const wrapper = card()
    await press(wrapper, 'Accept recommended')
    for (const id of ['p4a', 'p4b', 'p4c'])
      await wrapper.get(`input[value="${id}"]`).setValue(false)
    await press(wrapper, 'Send')
    expect(answerInputRequest).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Choose “Steps” or change the decision.')
    expect(point(wrapper, 'P4 ').text()).toContain('0 of 3')
  })

  // The owner's rule: a point's comment with no verdict is its own option, and counts as decided.
  it('sends the comment of a point with no verdict as its own option', async () => {
    const entry = asked()
    vi.mocked(answerInputRequest).mockReturnValue(new Promise(() => {}))
    const wrapper = card(entry)
    await press(wrapper, 'Comment: P9 Labels in a list row and a filter by label')
    await point(wrapper, 'P9 ').get('textarea').setValue('Labels only, no filtering')
    expect(head(wrapper).text()).toContain('Decided 1 of 18')
    await press(wrapper, 'Accept recommended')
    expect(point(wrapper, 'P9 ').findAll('[aria-checked="true"]')).toHaveLength(0)
    expect(head(wrapper).text()).toContain('Decided 18 of 18')
    await press(wrapper, 'Send')
    const rest = Object.fromEntries(Object.entries(recommendedAnswer).filter(([id]) => id !== 'p9'))
    expect(answerInputRequest).toHaveBeenCalledExactlyOnceWith(entry, rest, '', {
      own: { p9: 'Labels only, no filtering' },
      field_notes: {},
    })
  })
})

describe('the form in the thread', () => {
  it('stands in its groups, each counting what is decided, and folds on its heading', async () => {
    const wrapper = card()
    const headings = wrapper.findAll('.request-group-toggle')
    expect(headings.map((node) => node.text())).toEqual([
      'Hooks and client modsdecided 0 of 3',
      'Checks and skill textsdecided 0 of 2',
      'Instructionsdecided 0 of 5',
      'Valkama: codedecided 0 of 6',
      'Lab and small thingsdecided 0 of 2',
    ])
    const first = present(headings[0], 'first heading')
    expect(first.attributes('aria-expanded')).toBe('true')
    await first.trigger('click')
    expect(first.attributes('aria-expanded')).toBe('false')
    expect(point(wrapper, 'P1 ').isVisible()).toBe(false)
  })

  it('keeps its head and foot to the panel’s edges, and a plain question’s foot where it was', async () => {
    const wrapper = card()
    await flushPromises()
    expect(head(wrapper).attributes('data-stuck-edge')).toBe('start')
    expect(foot(wrapper).attributes('data-stuck-edge')).toBe('end')
    const plain = card(requestEntry())
    expect(plain.find('.request-review').exists()).toBe(false)
    expect(plain.get('footer').attributes('data-stuck-edge')).toBeUndefined()
  })

  it('opens a folded group to show the point a send stopped at', async () => {
    const wrapper = card(asked(requiredWithout('p2')))
    await present(wrapper.findAll('.request-group-toggle')[0], 'heading').trigger('click')
    await decide(wrapper, 'P6 ', 'Accept')
    await press(wrapper, 'Send')
    await nextTick()
    expect(point(wrapper, 'P2 ').isVisible()).toBe(true)
    expect(point(wrapper, 'P2 ').element.contains(document.activeElement)).toBe(true)
  })
})
