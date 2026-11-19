/**
 * A question about a task an agent files in an accepted goal, in the list of everything waiting:
 * it shows the task's description, its goal by number and title, and the goal's conditions. The
 * goal is read by the reference the task's card names it by (`parent`), with the exact read of
 * one item in the space that reference names. Where that read fails, or the task stands in no
 * goal now, one line says so in the goal's place, and the question is answered all the same.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RequestList from '@/features/input-requests/components/RequestList.vue'
import { requestIdentity } from '@/features/input-requests/utils/requestIdentity.ts'
import type { RequestDraft } from '@/features/input-requests/utils/validateAnswers.ts'

import { answerInputRequest } from '@/shared/api/inputRequestApi.ts'
import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'
import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { WorkItem, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { fetchPlanningWorkItemBrief } from '@/shared/api/platformPlanningApi.ts'
import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
} from '@/shared/api/platformPlanningPayload.ts'
import { messages } from '@/shared/i18n/index.ts'

import brief from '../fixtures/server/card-brief.json'
import card from '../fixtures/server/card.json'
import proposed from '../fixtures/server/request-proposed-goal.json'
import { firstAnswer, requestList } from '../support/inputRequests.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/inputRequestApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/inputRequestApi.ts')>()),
  answerInputRequest: vi.fn(),
}))
vi.mock('@/shared/api/planningApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/planningApi.ts')>()),
  fetchWorkItem: vi.fn(),
}))
vi.mock('@/shared/api/platformPlanningApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/platformPlanningApi.ts')>()),
  fetchPlanningWorkItemBrief: vi.fn(),
}))
// Every record is in view: what a kind reads from its card is read once it is.
vi.mock('@vueuse/core', async (original) => {
  const { ref } = await import('vue')
  return {
    ...(await original<typeof import('@vueuse/core')>()),
    useElementVisibility: () => ref(true),
  }
})

type Wrapper = VueWrapper
const wrappers: Wrapper[] = []

/** The question about a task in a goal, as the server asks it. */
function taskQuestion(): InputRequestEntry {
  const entry = validateInputRequestDetail(structuredClone(proposed))
  const [answer, until] = entry.request.fields
  if (!answer || !until) throw new Error('the question lost a field')
  const options = ['do', 'later', 'out', 'drop'].map((id) => ({ id, label: `Server ${id}` }))
  return {
    ...entry,
    request: {
      ...entry.request,
      purpose: 'task',
      action: undefined,
      fields: [{ ...answer, options }, until],
    },
  }
}
/** The task's card, under the goal `parent` names, or under none. */
function taskCard(parent: string | null): WorkItem {
  const read = validatePlanningWorkItemPayload(structuredClone(card))
  if (read.state.status !== 'ready') throw new Error('the card read is not ready')
  return { ...read.state.payload.work_item, description: 'Deliver the export.', parent }
}
const GOAL = 'MAIN-330'
/** A condition of the goal, open. */
const step = (id: string, text: string) => ({
  id,
  text,
  done: false,
  claimed_by: '',
  done_by: '',
  by_previous_holder: false,
})
function goalRead() {
  const read = validatePlanningWorkItemBriefPayload(structuredClone(brief))
  if (read.state.status !== 'ready') throw new Error('the brief read is not ready')
  const item: WorkItemBrief = {
    ...read.state.payload.work_item,
    reference: GOAL,
    kind: 'goal',
    title: 'Every export says what it wrote',
    checklist: [
      step('00000000-0000-4000-8000-000000000901', 'The export names each field'),
      step('00000000-0000-4000-8000-000000000902', 'A failed field says why'),
    ],
  }
  return { ...read, state: { ...read.state, payload: { work_item: item } } }
}

function list(entry: InputRequestEntry) {
  const wrapper: Wrapper = mount(RequestList, {
    props: {
      answered: [],
      drafts: {},
      entries: [entry],
      failed: false,
      loading: false,
      partial: false,
      result: requestList([entry]),
      waiting: new Set([requestIdentity(entry)]),
      onDraft: (key: string, draft: RequestDraft) => {
        const { drafts } = wrapper.props() as { drafts: Record<string, RequestDraft> }
        void wrapper.setProps({ drafts: { ...drafts, [key]: draft } })
      },
    },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  wrappers.push(wrapper)
  return wrapper
}
const subject = (wrapper: Wrapper) => wrapper.get('[data-kind-subject="task"]')
const part = (wrapper: Wrapper, name: string) => subject(wrapper).find(`[data-kind-part="${name}"]`)
/** What an element says, its words joined by single spaces. */
const said = (found: { text: () => string }) => found.text().replaceAll(/\s+/gu, ' ')

beforeEach(() => {
  vi.resetAllMocks()
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('a question about a task in a goal', () => {
  it('shows the task, its goal by number and title, and the goal’s conditions', async () => {
    const entry = taskQuestion()
    vi.mocked(fetchWorkItem).mockResolvedValue(taskCard(GOAL))
    vi.mocked(fetchPlanningWorkItemBrief).mockResolvedValue(goalRead())
    const wrapper = list(entry)
    await flushPromises()

    expect(part(wrapper, 'description').text()).toBe('Deliver the export.')
    expect(part(wrapper, 'goal').text()).toContain('Its goal')
    expect(
      part(wrapper, 'goal')
        .findAll('li')
        .map((row) => said(row)),
    ).toEqual(['MAIN-330 Every export says what it wrote'])
    expect(
      part(wrapper, 'conditions')
        .findAll('li')
        .map((step) => step.text()),
    ).toEqual(['The export names each field', 'A failed field says why'])
    expect(part(wrapper, 'conditions').text()).toContain('Conditions of the goal')
    // The goal is read by the reference the card names, in the space that reference names.
    expect(vi.mocked(fetchPlanningWorkItemBrief).mock.calls.map(([ref]) => ref)).toEqual([
      { reference: GOAL, space_ref: entry.target.space_ref },
    ])
  })

  it.each([
    ['its goal could not be read', new Error('offline'), 'The goal could not be read.'],
    [
      'its goal is no longer there',
      // As the read of a missing item fails: its HTTP status on the error.
      Object.assign(new Error('Exact work item is unavailable'), { status: 404 }),
      'The task stands in no goal now.',
    ],
  ])('says so in a line where %s, and is answered all the same', async (_, failure, line) => {
    const entry = taskQuestion()
    vi.mocked(fetchWorkItem).mockResolvedValue(taskCard(GOAL))
    vi.mocked(fetchPlanningWorkItemBrief).mockRejectedValue(failure)
    vi.mocked(answerInputRequest).mockResolvedValue({
      ...entry,
      request: {
        ...entry.request,
        status: 'answered',
        answers: { answer: 'do' },
        ...firstAnswer,
        answered_by: 'user',
        by_person: true,
        resolved_at: '2026-10-24T12:00:00Z',
        revision: 1,
      },
    })
    const wrapper = list(entry)
    await flushPromises()

    expect(said(part(wrapper, 'goal'))).toBe(line)
    expect(part(wrapper, 'conditions').exists()).toBe(false)
    expect(part(wrapper, 'description').text()).toBe('Deliver the export.')
    const press = wrapper.findAll('button').find((button) => button.text() === 'Do')
    await present(press, 'button Do').trigger('click')
    await flushPromises()
    expect(vi.mocked(answerInputRequest).mock.calls.map(([, values]) => values)).toEqual([
      { answer: 'do' },
    ])
  })

  it('says it stands in no goal, with no read, where its card names none', async () => {
    vi.mocked(fetchWorkItem).mockResolvedValue(taskCard(null))
    const wrapper = list(taskQuestion())
    await flushPromises()

    expect(said(part(wrapper, 'goal'))).toBe('The task stands in no goal now.')
    expect(fetchPlanningWorkItemBrief).not.toHaveBeenCalled()
  })
})
