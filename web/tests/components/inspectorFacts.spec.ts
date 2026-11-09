/**
 * The card's facts line: the state as its own menu, the registry's marks, and
 * one action — or the reason there is none — decided by who holds the item.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorFacts from '@/widgets/work-item-inspector/components/InspectorFacts.vue'

import type { FacetChoiceOption } from '@/entities/work-item/composables/useFacetChoices.ts'

import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

type Link = WorkItem['links'][number]

const QUEUED = {
  state_id: '00000000-0000-4000-8000-000000000004',
  key: 'todo',
  name: 'To do',
  category: 'queued' as const,
  is_terminal: false,
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return { ...workItemFixture('Facts', 1), state: QUEUED, priority: 'medium', ...overrides }
}

function blockedBy(reference: string, terminal: boolean): Link {
  return {
    kind: 'blocks',
    direction: 'incoming',
    work_item_id: '00000000-0000-4000-8000-000000000012',
    reference,
    title: 'The work before',
    state_name: terminal ? 'Done' : 'Development',
    state_category: terminal ? 'completed' : 'active',
    is_terminal: terminal,
    state_unavailable: null,
  }
}

const workflow: PlanningWorkflow = {
  workflow_id: 'workflow',
  name: 'Task workflow',
  initial_state_id: QUEUED.state_id,
  states: [
    { ...QUEUED, position: 0 },
    {
      state_id: '00000000-0000-4000-8000-000000000005',
      key: 'dev',
      name: 'Development',
      category: 'active',
      is_terminal: false,
      position: 1,
    },
  ],
  transitions: [{ from: QUEUED.state_id, to: '00000000-0000-4000-8000-000000000005' }],
}

const choiceStub = {
  name: 'ChoiceSelect',
  props: ['modelValue', 'options', 'label'],
  emits: ['update:modelValue'],
  template: '<span class="choice-stub"><slot name="value" /></span>',
}

function facts(record: WorkItem, props: { busy?: boolean; writable?: boolean } = {}) {
  return mount(InspectorFacts, {
    props: { item: record, workflow, busy: false, writable: true, ...props },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { ChoiceSelect: choiceStub, VIcon: true },
    },
  })
}

const actionText = (wrapper: ReturnType<typeof facts>) =>
  wrapper.find('.write-actions').exists() ? wrapper.get('.write-actions').text() : null

describe('the one action a card offers', () => {
  it.each([
    { case: 'nobody holds it', record: item(), says: 'Claim' },
    {
      case: 'it waits on an open blocker',
      record: item({ links: [blockedBy('MAIN-12', false)] }),
      says: 'Waiting on MAIN-12',
    },
    {
      case: 'its only blocker has finished',
      record: item({ links: [blockedBy('MAIN-12', true)] }),
      says: 'Claim',
    },
    {
      case: 'it is an epic',
      record: item({ container: true }),
      says: 'Epic — take a task from it',
    },
    {
      case: 'another holds the epic',
      record: item({ container: true, claim_ref: 'claude' }),
      says: 'Take over',
    },
    { case: 'this client holds it', record: item({ claim_ref: 'user' }), says: 'Release' },
    {
      case: 'it is finished',
      record: item({ state: { ...QUEUED, category: 'completed', is_terminal: true } }),
      says: null,
    },
  ])('says $says when $case', ({ record, says }) => {
    const wrapper = facts(record)
    expect(actionText(wrapper)).toBe(says)
    // A reason is not a button: nothing to press where the facts argue against it.
    const pressable = wrapper.findAll('.write-actions button').map((button) => button.text())
    expect(pressable).toEqual(says && !/Waiting|Epic/u.test(says) ? [says] : [])
  })

  it('offers no action where the card cannot write', () => {
    expect(facts(item(), { writable: false }).find('.write-actions').exists()).toBe(false)
  })
})

describe('the action at rest', () => {
  it.each([
    { case: 'a claim', record: item(), claims: true },
    { case: 'a takeover', record: item({ claim_ref: 'codex' }), claims: false },
    { case: 'a release', record: item({ claim_ref: 'user' }), claims: false },
  ])(
    'is a bare text action on $case, and only a claim reads in the text ink',
    ({ record, claims }) => {
      const button = facts(record).get('.write-actions button')
      expect(button.classes()).toContain('variant-text')
      expect(button.classes()).not.toContain('variant-primary')
      expect(button.classes()).not.toContain('variant-secondary')
      expect(button.classes().includes('write-action-claim')).toBe(claims)
    },
  )
})

describe('the state as the menu that moves it', () => {
  it('names where the item is, unchoosable, above where it may go', () => {
    const chip = facts(item()).getComponent(choiceStub)
    expect(chip.props('modelValue')).toBe('todo')
    expect(chip.props('label')).toBe('State: To do. Move to another state')
    const options = chip.props('options') as FacetChoiceOption[]
    expect(options.map((option) => ({ ...option, mark: undefined }))).toEqual([
      { value: 'todo', label: 'To do', disabled: true },
      { value: 'dev', label: 'Development' },
    ])
    // Each is drawn as the chip draws the state: its dot in its category's tone.
    expect(options.map(({ mark }) => mark.tone.dimension)).toEqual([
      'work-item-state',
      'work-item-state',
    ])
    expect(chip.text()).toBe('To do')
  })

  it('asks for a move to another state, and not while a write is in flight', async () => {
    const idle = facts(item())
    idle.getComponent(choiceStub).vm.$emit('update:modelValue', 'dev')
    idle.getComponent(choiceStub).vm.$emit('update:modelValue', 'todo')
    expect(idle.emitted('fact')).toEqual([[{ state: 'dev' }]])

    const busy = facts(item(), { busy: true })
    busy.getComponent(choiceStub).vm.$emit('update:modelValue', 'dev')
    expect(busy.emitted('fact')).toBeUndefined()
  })

  it('is a plain state where nothing can move it', () => {
    const wrapper = facts(item(), { writable: false })
    expect(wrapper.findComponent(choiceStub).exists()).toBe(false)
    expect(wrapper.get('.card-state').attributes('data-dimension')).toBe('work-item-state')
  })
})

/** The second menu of the head: the state's is the first. */
const priorityMenu = (wrapper: ReturnType<typeof facts>) => wrapper.findAllComponents(choiceStub)[1]

/** What the head's rows are called, top to bottom. */
const rowLabels = (wrapper: ReturnType<typeof facts>) =>
  wrapper.findAll('.card-row-label').map((label) => label.text())

describe('the priority as the menu that changes it', () => {
  it('offers the four priorities, most pressing first, each with what it means', () => {
    const menu = priorityMenu(facts(item()))
    expect(menu.props('modelValue')).toBe('medium')
    expect(menu.props('label')).toBe('Priority: Medium. Change it')
    const options = menu.props('options') as FacetChoiceOption[]
    // Each is drawn as the chosen priority is: its glyph, none for medium.
    expect(options.map(({ mark }) => mark.glyph)).toEqual([
      'priority-urgent',
      'priority-high',
      null,
      'priority-low',
    ])
    expect(options.map((option) => ({ ...option, mark: undefined }))).toEqual([
      { value: 'urgent', label: 'Urgent', description: 'blocks work or loses data' },
      { value: 'high', label: 'High', description: 'serious; could block work' },
      {
        value: 'medium',
        label: 'Medium',
        description: 'noticeably affects work, with a workaround',
      },
      { value: 'low', label: 'Low', description: 'minor' },
    ])
  })

  it('asks for another priority, not for the one it has, and not while a write is in flight', () => {
    const idle = facts(item())
    priorityMenu(idle).vm.$emit('update:modelValue', 'medium')
    priorityMenu(idle).vm.$emit('update:modelValue', 'urgent')
    expect(idle.emitted('fact')).toEqual([[{ priority: 'urgent' }]])

    const busy = facts(item(), { busy: true })
    priorityMenu(busy).vm.$emit('update:modelValue', 'urgent')
    expect(busy.emitted('fact')).toBeUndefined()
  })

  it('is the plain mark where the card cannot write', () => {
    const wrapper = facts(item({ priority: 'high' }), { writable: false })
    expect(wrapper.findComponent(choiceStub).exists()).toBe(false)
    expect(wrapper.get('[data-facet="priority"]').text()).toBe('High')
  })
})

describe('each fact in a row that says what it is', () => {
  it('labels the state, the priority, the epic, the holder and the labels', () => {
    const record = item({ labels: ['platform'], parent_id: '00000000-0000-4000-8000-000000000099' })
    const wrapper = mount(InspectorFacts, {
      props: { item: record, workflow, busy: false, writable: true, parentReference: 'MAIN-9' },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages })],
        stubs: { ChoiceSelect: choiceStub, VIcon: true },
      },
    })
    expect(rowLabels(wrapper)).toEqual(['State', 'Priority', 'Epic', 'Held by', 'Labels'])
  })

  it('has no labels row where there are none and none can be attached', () => {
    expect(rowLabels(facts(item()))).toContain('Labels')
    expect(rowLabels(facts(item(), { writable: false }))).not.toContain('Labels')
  })
})

describe('the marks beside the state', () => {
  it('colours an urgent priority and keeps the default one quiet', () => {
    const urgent = facts(item({ priority: 'urgent' })).get('[data-facet="priority"]')
    expect(urgent.attributes('data-tone')).toBe('danger')
    expect(urgent.text()).toBe('Urgent')
    const medium = facts(item()).get('[data-facet="priority"]')
    expect(medium.attributes('data-tone')).toBe('neutral')
    expect(medium.classes()).toContain('quiet')
  })

  it('names the epic where the host knows its reference', () => {
    const record = item({ parent_id: '00000000-0000-4000-8000-000000000099' })
    expect(facts(record).find('[data-facet="parent"]').exists()).toBe(false)
    const wrapper = mount(InspectorFacts, {
      props: { item: record, workflow, busy: false, writable: true, parentReference: 'MAIN-9' },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages })],
        stubs: { ChoiceSelect: choiceStub, VIcon: true },
      },
    })
    expect(wrapper.get('[data-facet="parent"]').text()).toBe('MAIN-9')
  })

  it('adds a pressed label to the filter', async () => {
    const wrapper = facts(item({ labels: ['platform', 'phase-1'] }))
    const chips = wrapper.findAll('.card-labels .label-chip')
    expect(chips.map((chip) => chip.attributes('aria-label'))).toEqual([
      'Filter: label platform',
      'Filter: label phase-1',
    ])
    expect(chips.every((chip) => chip.attributes('tabindex') === undefined)).toBe(true)
    await chips[1].trigger('click')
    expect(wrapper.emitted('filter')).toEqual([[{ facet: 'labels', value: 'phase-1' }]])
  })

  it('takes a label off with the × in its chip, and offers none where it cannot write', async () => {
    const wrapper = facts(item({ labels: ['platform', 'phase-1'] }))
    const remove = wrapper.findAll('.card-labels .label-chip-remove')
    expect(remove.map((button) => button.attributes('aria-label'))).toEqual([
      'Remove label platform',
      'Remove label phase-1',
    ])
    await remove[0].trigger('click')
    expect(wrapper.emitted('fact')).toEqual([[{ labels: ['phase-1'] }]])
    expect(wrapper.emitted('filter')).toBeUndefined()

    const read = facts(item({ labels: ['platform'] }), { writable: false })
    expect(read.find('.label-chip-remove').exists()).toBe(false)
    expect(read.find('.card-labels button[aria-label="Add a label"]').exists()).toBe(false)
  })
})
