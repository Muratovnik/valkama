/**
 * Points of a list in the discussion made steps of the item, through the one checklist write.
 *
 * The oracle is the plan for the action: the icon stands on an entry with a list on an open
 * card that can be written; the form ticks every point that can be a step; a point the item
 * has already, or one past the length of a step, is shown with its reason and never sent; the
 * checklist is held to 100 steps; the write sends the item's steps by id with the chosen after
 * them and the revision it read, and a refused one keeps the ticks for after a fresh read.
 */
import { defineComponent, h, nextTick } from 'vue'
import type { PropType } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'
import { provideCardSteps } from '@/widgets/work-item-inspector/utils/entrySteps.ts'

import { setWorkItemChecklist } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

import { getButton } from '../fixtures/workItem.ts'
import {
  card,
  inThread,
  key,
  plugins,
  reply,
  root,
  thread,
  track,
  unmountAll,
} from '../support/threadCard.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  setWorkItemChecklist: vi.fn(),
}))

const ACTION = 'Make steps'
const step = (id: number, text: string) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  text,
  done: false,
  claimed_by: '',
  done_by: '',
})
const withSteps = (item: WorkItem, ...texts: string[]): WorkItem => ({
  ...item,
  checklist: texts.map((text, index) => step(index + 1, text)),
})

const refreshed = vi.fn()
const revealed = vi.fn()

/** The discussion under what Overview hands its entries: the card, a fresh read, the checklist. */
const Host = defineComponent({
  props: {
    item: { type: Object as PropType<WorkItem>, required: true },
    writable: { type: Boolean, default: true },
  },
  setup(props) {
    provideCardSteps({ item: () => props.item, refresh: refreshed, reveal: revealed })
    return () => h(InspectorDiscussion, { item: props.item, writable: props.writable })
  },
})

function open(item: WorkItem, writable = true) {
  const wrapper = mount(Host, {
    attachTo: document.body,
    props: { item, writable },
    global: { plugins },
  })
  track(wrapper)
  return wrapper
}

const form = (wrapper: VueWrapper) => wrapper.get('.steps-form')
const boxes = (wrapper: VueWrapper) =>
  form(wrapper).findAll<HTMLInputElement>('input[type="checkbox"]')
/** Each row as its words, whether its box is ticked and can be, and the reason when it cannot. */
const rows = (wrapper: VueWrapper) =>
  form(wrapper)
    .findAll('.steps-point')
    .map((row) => {
      const box = row.get<HTMLInputElement>('input').element
      const reason = box.getAttribute('aria-describedby')
      return {
        words: row.get('.steps-words').text(),
        ticked: box.checked,
        free: !box.disabled,
        reason: reason ? (document.querySelector(`#${reason}`)?.textContent ?? '?') : '',
      }
    })
const count = (wrapper: VueWrapper) => form(wrapper).get('.steps-count').text()
const addButton = (wrapper: VueWrapper) => form(wrapper).get('button[type="submit"]')

beforeEach(() => {
  vi.mocked(setWorkItemChecklist).mockReset()
  refreshed.mockReset()
  revealed.mockReset()
})
afterEach(unmountAll)

describe('choosing the points', () => {
  it('ticks every point, nested ones too, and sends the steps by id with the chosen after them', async () => {
    const item = withSteps(card([root(1, { body: 'Left:\n1. One\n2. Two\n   - Three' })]), 'Zero')
    const wrapper = open(item)
    const press = inThread(wrapper, 1, ACTION)
    expect(press.attributes('aria-expanded')).toBe('false')
    await press.trigger('click')
    await nextTick()
    expect(press.attributes('aria-expanded')).toBe('true')
    expect(form(wrapper).get('legend').text()).toBe('Which points become steps of the task')
    expect(document.activeElement).toBe(boxes(wrapper)[0]?.element)
    expect(rows(wrapper)).toEqual([
      { words: 'One', ticked: true, free: true, reason: '' },
      { words: 'Two', ticked: true, free: true, reason: '' },
      { words: 'Three', ticked: true, free: true, reason: '' },
    ])
    expect(form(wrapper).get('[data-depth="1"]').text()).toBe('Three')
    expect(count(wrapper)).toBe('Will be 4 steps of 100')
    expect(addButton(wrapper).text()).toBe('Add 3 steps')

    await boxes(wrapper)[1]?.setValue(false)
    expect(count(wrapper)).toBe('Will be 3 steps of 100')
    expect(addButton(wrapper).text()).toBe('Add 2 steps')

    vi.mocked(setWorkItemChecklist).mockResolvedValueOnce(item)
    await form(wrapper).trigger('submit')
    await flushPromises()
    expect(setWorkItemChecklist).toHaveBeenCalledWith({
      id: item.work_item_id,
      items: [{ id: item.checklist[0]?.id, text: 'Zero' }, 'One', 'Three'],
      expected_revision: 3,
    })
    expect(wrapper.find('.steps-form').exists()).toBe(false)
    expect(thread(wrapper, 1).get('.entry-steps-added').text()).toContain('Added 2 steps')
    expect(document.activeElement).toBe(inThread(wrapper, 1, ACTION).element)
    await getButton(wrapper, 'Show checklist').trigger('click')
    expect(revealed).toHaveBeenCalledOnce()
  })

  it('offers a report what it says was done and what comes next, and a reply its own list', async () => {
    const report = {
      ...root(1, { body: '' }),
      kind: 'report',
      report: { done: 'Done:\n- shipped', next: '- review it' },
    } as WorkItem['comments'][number]
    const wrapper = open(card([report, root(2), reply(3, 2, { body: '- from a reply' })]))
    await inThread(wrapper, 1, ACTION).trigger('click')
    expect(rows(wrapper).map((row) => row.words)).toEqual(['shipped', 'review it'])
    const replyAction = thread(wrapper, 2).get(`.reply button[aria-label="${ACTION}"]`)
    await replyAction.trigger('click')
    await nextTick()
    expect(wrapper.findAll('.steps-form')).toHaveLength(1)
    expect(thread(wrapper, 2).get('.reply .steps-form').text()).toContain('from a reply')
  })

  it('closes on Escape, and on its icon, with focus back on the icon', async () => {
    const wrapper = open(card([root(1, { body: '- One' })]))
    const press = inThread(wrapper, 1, ACTION)
    await press.trigger('click')
    key(form(wrapper), 'Escape')
    await flushPromises()
    expect(wrapper.find('.steps-form').exists()).toBe(false)
    expect(document.activeElement).toBe(press.element)
    await press.trigger('click')
    await press.trigger('click')
    await flushPromises()
    expect(wrapper.find('.steps-form').exists()).toBe(false)
    expect(press.attributes('aria-expanded')).toBe('false')
  })
})

describe('what cannot be a step', () => {
  it('shows a point the item has as one it has, its box off, and never sends it', async () => {
    const item = withSteps(card([root(1, { body: '- One\n- Two\n- three' })]), '  Two ', 'Three')
    const wrapper = open(item)
    await inThread(wrapper, 1, ACTION).trigger('click')
    expect(rows(wrapper)).toEqual([
      { words: 'One', ticked: true, free: true, reason: '' },
      { words: 'Two', ticked: false, free: false, reason: 'already a step' },
      // The case is part of the words: a step that says it otherwise is another step.
      { words: 'three', ticked: true, free: true, reason: '' },
    ])
    expect(count(wrapper)).toBe('Will be 4 steps of 100')
    vi.mocked(setWorkItemChecklist).mockResolvedValueOnce(item)
    await form(wrapper).trigger('submit')
    await flushPromises()
    expect(vi.mocked(setWorkItemChecklist).mock.calls[0]?.[0].items.slice(2)).toEqual([
      'One',
      'three',
    ])
  })

  it('says a point repeats one above it, and sends the first of them once', async () => {
    const wrapper = open(card([root(1, { body: '- One\n- One' })]))
    await inThread(wrapper, 1, ACTION).trigger('click')
    expect(rows(wrapper).map((row) => row.reason)).toEqual(['', 'repeats a point above'])
    expect(addButton(wrapper).text()).toBe('Add 1 step')
  })

  it('holds a point longer than a step can be, and lets one at the limit through', async () => {
    const at = 'a'.repeat(1000)
    const wrapper = open(card([root(1, { body: `- ${at}\n- ${at}b` })]))
    await inThread(wrapper, 1, ACTION).trigger('click')
    expect(rows(wrapper).map(({ free, reason }) => [free, reason])).toEqual([
      [true, ''],
      [false, 'longer than 1000 characters'],
    ])
  })

  it('keeps the checklist to 100 steps, saying how many to clear', async () => {
    const texts = Array.from({ length: 98 }, (_, index) => `Step ${index}`)
    const wrapper = open(withSteps(card([root(1, { body: '- A\n- B\n- C' })]), ...texts))
    await inThread(wrapper, 1, ACTION).trigger('click')
    expect(count(wrapper)).toBe('Will be 101 steps of 100: clear 1')
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
    expect(addButton(wrapper).attributes('aria-describedby')).toBe(
      form(wrapper).get('.steps-count').attributes('id'),
    )
    await form(wrapper).trigger('submit')
    expect(setWorkItemChecklist).not.toHaveBeenCalled()
    await boxes(wrapper)[2]?.setValue(false)
    expect(count(wrapper)).toBe('Will be 100 steps of 100')
    expect(addButton(wrapper).attributes('disabled')).toBeUndefined()
  })
})

describe('a write refused for a newer revision', () => {
  it('says so, keeps the ticks through a fresh read, and sends the new revision', async () => {
    const item = card([root(1, { body: '- One\n- Two\n- Three' })])
    const wrapper = open(item)
    await inThread(wrapper, 1, ACTION).trigger('click')
    await boxes(wrapper)[2]?.setValue(false)
    vi.mocked(setWorkItemChecklist).mockRejectedValueOnce(
      Object.assign(new Error('HTTP 409'), { status: 409 }),
    )
    await form(wrapper).trigger('submit')
    await flushPromises()
    expect(form(wrapper).get('[role="alert"]').text()).toContain('The task changed.')
    await getButton(wrapper, 'Refresh task').trigger('click')
    expect(refreshed).toHaveBeenCalledOnce()

    // The fresh read: someone made One a step in between.
    const newer = { ...withSteps(item, 'One'), revision: 4 }
    await wrapper.setProps({ item: newer })
    expect(rows(wrapper).map(({ ticked, reason }) => [ticked, reason])).toEqual([
      [false, 'already a step'],
      [true, ''],
      [false, ''],
    ])
    vi.mocked(setWorkItemChecklist).mockResolvedValueOnce(newer)
    await form(wrapper).trigger('submit')
    await flushPromises()
    expect(setWorkItemChecklist).toHaveBeenLastCalledWith({
      id: item.work_item_id,
      items: [{ id: newer.checklist[0]?.id, text: 'One' }, 'Two'],
      expected_revision: 4,
    })
  })
})

const action = (wrapper: VueWrapper) => wrapper.findAll(`button[aria-label="${ACTION}"]`)

describe('where the icon is not', () => {
  it('stands on no entry without a list', () => {
    expect(action(open(card([root(1, { body: 'No list, 1. just words' })])))).toHaveLength(0)
  })

  it('stands on no entry of a closed item, and its form goes when the item closes', async () => {
    const item = card([root(1, { body: '- One' })])
    const closed: WorkItem = {
      ...item,
      state: { ...item.state, category: 'completed', is_terminal: true },
    }
    expect(action(open(closed))).toHaveLength(0)

    const wrapper = open(item)
    await inThread(wrapper, 1, ACTION).trigger('click')
    await wrapper.setProps({ item: closed })
    expect(wrapper.find('.steps-form').exists()).toBe(false)
    expect(action(wrapper)).toHaveLength(0)
  })

  it('stands on no entry of a card that cannot be written', () => {
    expect(action(open(card([root(1, { body: '- One' })]), false))).toHaveLength(0)
  })

  it('stands on no entry of a discussion with no card to take the steps', () => {
    const wrapper = mount(InspectorDiscussion, {
      attachTo: document.body,
      props: { item: card([root(1, { body: '- One' })]), writable: true },
      global: { plugins },
    })
    track(wrapper)
    expect(action(wrapper)).toHaveLength(0)
  })
})
