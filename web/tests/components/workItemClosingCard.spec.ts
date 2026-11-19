/**
 * Where a card's closing actions start and what they leave on the card.
 *
 * A move that closes work or puts it off is not sent as it is chosen from the state's menu: it
 * asks first, in place for a task's cancel and in a window for the rest. An accepted open goal
 * stands in no state, so its menu holds only its closing actions. Put-off work says until when
 * at the top of Overview, and a step a former holder marked is confirmed beside its mark.
 */
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorHindrances from '@/widgets/work-item-inspector/components/InspectorHindrances.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import InspectorStateRow from '@/widgets/work-item-inspector/components/InspectorStateRow.vue'
import { provideInspectorClosing } from '@/widgets/work-item-inspector/utils/useInspectorClosing.ts'
import type { InspectorClosing } from '@/widgets/work-item-inspector/utils/useInspectorClosing.ts'

import CancelReasonStrip from '@/features/work-item-closing/CancelReasonStrip.vue'

import { CancelListError } from '@/shared/api/planningApi.ts'
import { cancelWorkItem } from '@/shared/api/planningClosingApi.ts'
import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

import { stateOf, workItemFixture } from '../fixtures/workItem.ts'

vi.mock('@/shared/api/planningClosingApi.ts', () => ({ cancelWorkItem: vi.fn() }))

const i18n = () => createI18n({ legacy: false, locale: 'en', messages, missingWarn: false })
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const STATES = [
  ['dev', 'Dev', 'active'],
  ['later', 'Later', 'deferred'],
  ['dropped', 'Dropped', 'cancelled'],
  ['done', 'Done', 'completed'],
] as const
const WORKFLOW: PlanningWorkflow = {
  workflow_id: id(700),
  name: 'Default',
  initial_state_id: id(900),
  states: STATES.map(([key, name, category], index) => ({
    state_id: id(900 + index),
    key,
    name,
    category,
    is_terminal: category === 'cancelled' || category === 'completed',
    position: index,
  })),
  transitions: [1, 2, 3].map((to) => ({ from: id(900), to: id(900 + to) })),
}
const task = (): WorkItem => ({
  ...workItemFixture('Tray', 1),
  state: { ...WORKFLOW.states[0], position: undefined } as unknown as WorkItem['state'],
})
const goal = (container_state: WorkItem['container_state']): WorkItem => ({
  ...workItemFixture('Release', 1),
  kind: 'goal',
  state: null,
  container_state,
})

/** The state's row inside a card that owns its closing writes, which the test reads. */
function stateRow(item: WorkItem) {
  let closing: InspectorClosing | null = null
  const Card = defineComponent({
    setup() {
      closing = provideInspectorClosing({
        item: shallowRef(item),
        changed: vi.fn(),
        workflow: () => WORKFLOW,
      })
      return () =>
        h(InspectorStateRow, {
          asking: false,
          busy: false,
          item,
          spaceReading: false,
          workflow: WORKFLOW,
          writable: true,
        })
    },
  })
  const wrapper = mount(Card, { global: { plugins: [i18n()] } })
  return { wrapper, closing: closing as unknown as InspectorClosing }
}
const choose = async (wrapper: ReturnType<typeof stateRow>['wrapper'], value: string) => {
  wrapper.getComponent(ChoiceSelect).vm.$emit('update:modelValue', value)
  await flushPromises()
}
const options = (wrapper: ReturnType<typeof stateRow>['wrapper']) =>
  (
    (wrapper.getComponent(ChoiceSelect) as unknown as VueWrapper).props() as {
      options: { label: string }[]
    }
  ).options.map((option) => option.label)

beforeEach(() => vi.resetAllMocks())

describe("a task's state menu", () => {
  it('asks the reason in place for a cancel, and opens the window for putting it off', async () => {
    const { wrapper, closing } = stateRow(task())
    await choose(wrapper, 'dropped')
    expect(wrapper.emitted()).not.toHaveProperty('fact')
    expect(closing.asking.value).toMatchObject({ key: 'dropped', name: 'Dropped' })
    expect(closing.shown.value).toBeNull()

    await choose(wrapper, 'later')
    expect(closing.shown.value).toBe('defer')
    expect(closing.asking.value).toBeNull()
  })
})

describe("an accepted open goal's state menu", () => {
  it('offers only its closing actions, confirming only while it awaits that', () => {
    expect(options(stateRow(goal('in_progress')).wrapper)).toEqual([
      'In progress',
      'Put off…',
      'Cancel…',
    ])
    const awaiting = stateRow(goal('awaiting_confirmation')).wrapper
    expect(options(awaiting)).toEqual([
      'Awaiting confirmation',
      'Confirm close',
      'Put off…',
      'Cancel…',
    ])
    expect(awaiting.get('[data-closing="confirm"]').text()).toBe('Confirm close')
    expect(stateRow(goal('in_progress')).wrapper.find('[data-closing="confirm"]').exists()).toBe(
      false,
    )
  })

  it('lists what a cancel closes when work is open under it, and asks in place otherwise', async () => {
    const working = stateRow(goal('in_progress'))
    await choose(working.wrapper, 'action:cancel')
    expect(working.closing.shown.value).toBe('cancel-goal')
    expect(working.closing.goal.value).toMatchObject({ key: 'dropped', name: 'Dropped' })

    const waiting = stateRow(goal('awaiting_confirmation'))
    await choose(waiting.wrapper, 'action:cancel')
    expect(waiting.closing.shown.value).toBeNull()
    expect(waiting.closing.asking.value).toMatchObject({ key: 'dropped', name: 'Dropped' })

    await waiting.wrapper.get('[data-closing="confirm"]').trigger('click')
    expect(waiting.closing.shown.value).toBe('confirm')
    expect(waiting.closing.goal.value).toMatchObject({ key: 'done', name: 'Done' })
  })
})

const strip = (item: WorkItem) =>
  mount(CancelReasonStrip, {
    props: { item, state: { key: 'dropped', name: 'Dropped' } },
    global: { plugins: [i18n()] },
    attachTo: document.body,
  })

describe('the reason a cancel asks in place', () => {
  it('sends nothing without a reason, and cancels with it as the summary’s why', async () => {
    vi.mocked(cancelWorkItem).mockResolvedValue()
    const item = { ...task(), summary: { done: 'Half the tray', next: 'The rest' } }
    const wrapper = strip(item)
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
    expect(wrapper.text()).toContain('Cancel QA-320? The card closes as «Dropped».')
    await wrapper.get('button.confirm-go').trigger('click')
    expect(cancelWorkItem).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBe('Say why it is cancelled.')

    await wrapper.get('textarea').setValue('Duplicate of QA-12')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.get('button.confirm-go').trigger('click')
    await flushPromises()
    expect(cancelWorkItem).toHaveBeenCalledWith({
      id: 'QA-320',
      state: 'dropped',
      reason: 'Duplicate of QA-12',
      summary: {
        done: 'Half the tray',
        next: 'Nothing: it was cancelled.',
        why: 'Duplicate of QA-12',
      },
    })
    expect(wrapper.emitted('done')).toHaveLength(1)
    wrapper.unmount()
  })

  it('goes on in the window when the server answers with a list, the reason kept', async () => {
    vi.mocked(cancelWorkItem).mockRejectedValue(
      new CancelListError({ cancels: [], dependents: [], list_token: 't1' }),
    )
    const wrapper = strip(goal(null))
    await wrapper.get('textarea').setValue('Not needed')
    await wrapper.get('button.confirm-go').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('list')).toEqual([['Not needed']])
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the task as it was on Escape', async () => {
    const wrapper = strip(task())
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(cancelWorkItem).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

const deferred = (until: Partial<NonNullable<WorkItem['deferred']>>): WorkItem => ({
  ...task(),
  state: { ...stateOf(task()), key: 'later', name: 'Later', category: 'deferred' },
  deferred: {
    until: null,
    until_item: null,
    reason: 'After the release',
    since: '2026-11-01T10:00:00Z',
    by: { author: 'owner', session_id: null },
    reached_at: null,
    ...until,
  },
})
const hindrances = (item: WorkItem) =>
  mount(InspectorHindrances, { props: { item }, global: { plugins: [i18n()] } })

describe('put-off work and a marked step on Overview', () => {
  it('says until which day or which card’s close, and why it waits', () => {
    const day = hindrances(deferred({ until: '2026-11-20T00:00:00+00:00' }))
    expect(day.get('[data-hindrance="deferred"]').text()).toBe(
      'Put off until November 20 — After the release',
    )
    const card = hindrances(deferred({ until_item: 'QA-12' }))
    expect(card.get('[data-hindrance="deferred"]').text()).toContain(
      'Put off until QA-12 closes — After the release',
    )
    expect(hindrances(task()).find('[data-hindrance]').exists()).toBe(false)
  })

  it('confirms a step its former holder marked by ticking it again', async () => {
    const marked = {
      id: id(701),
      text: 'Tray icon',
      done: true,
      claimed_by: '',
      done_by: 'worker-a',
      by_previous_holder: true,
    }
    const overview = (writable: boolean) =>
      mount(InspectorOverview, {
        props: { item: { ...task(), checklist: [marked] }, writable },
        global: {
          plugins: [i18n()],
          stubs: { InspectorDescription: true, InspectorDiscussion: true, InspectorSummary: true },
        },
      })
    const wrapper = overview(true)
    const confirm = wrapper.get('.step-confirm')
    expect(confirm.text()).toBe('Confirm')
    expect(confirm.attributes('aria-label')).toBe('Confirm the step Tray icon')
    await confirm.trigger('click')
    expect(wrapper.emitted('tick')).toEqual([[marked.id, true]])
    expect(overview(false).find('.step-confirm').exists()).toBe(false)
  })
})
