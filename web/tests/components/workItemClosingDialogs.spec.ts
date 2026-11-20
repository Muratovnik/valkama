/**
 * The windows a card closes work or puts it off in: each sends nothing until what it needs is
 * said, sends what was chosen, and keeps itself open on a refusal.
 *
 * The goal's cancel is the server's list, confirmed by its token. Its window is where a list
 * that changed between reading and pressing must be shown again, the changed rows marked and the
 * count renamed, before anything closes.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CancelGoalDialog from '@/features/work-item-closing/CancelGoalDialog.vue'
import ConfirmCloseDialog from '@/features/work-item-closing/ConfirmCloseDialog.vue'
import DeferDialog from '@/features/work-item-closing/DeferDialog.vue'

import UntilChoice from '@/entities/work-item/components/UntilChoice.vue'

import type { CancelList } from '@/shared/api/inputRequestAction.ts'
import { CancelListError, request } from '@/shared/api/planningApi.ts'
import {
  cancelWorkItem,
  confirmWorkItemClose,
  deferWorkItem,
} from '@/shared/api/planningClosingApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'
import { withSecurityBootstrap } from '../support/request.ts'

vi.mock('@/shared/api/planningClosingApi.ts', () => ({
  cancelWorkItem: vi.fn(),
  confirmWorkItemClose: vi.fn(),
  deferWorkItem: vi.fn(),
}))
vi.mock('@/shared/api/planningGlobalSearchApi.ts', () => ({
  searchGlobalPlanningWorkItems: vi.fn(),
}))

const dialogStub = {
  props: ['error', 'open', 'title'],
  emits: ['submit', 'close'],
  template:
    '<form v-if="open" @submit.prevent="$emit(\'submit\')"><h2>{{ title }}</h2><slot/><p role="alert">{{ error }}</p><slot name="footer"/></form>',
}
const i18n = (locale = 'en') =>
  createI18n({ legacy: false, locale, messages, pluralRules, missingWarn: false })
const step = (n: number, done: boolean, previous = false): WorkItem['checklist'][number] => ({
  id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`,
  text: `Condition ${n}`,
  done,
  claimed_by: '',
  done_by: done ? 'worker-a' : '',
  by_previous_holder: previous,
})
const goal = (patch: Partial<WorkItem> = {}): WorkItem => ({
  ...workItemFixture('Release', 1),
  reference: 'QA-1',
  kind: 'goal',
  state: null,
  container_state: 'in_progress',
  ...patch,
})
const mountOf = <T>(component: T, props: Record<string, unknown>, locale = 'en') =>
  mount(component as never, {
    props: { open: true, ...props } as never,
    global: { plugins: [i18n(locale)], stubs: { DialogFrame: dialogStub } },
  })
const press = (wrapper: ReturnType<typeof mountOf>) => wrapper.get('form').trigger('submit')
const submitButton = (wrapper: ReturnType<typeof mountOf>) => wrapper.get('button[type="submit"]')

beforeEach(() => vi.resetAllMocks())

/** A refusal as the planning boundary throws it: the server's envelope, read by its client. */
async function refused(message: string): Promise<unknown> {
  const envelope = { error: { code: 'workflow_guard', message } }
  vi.stubGlobal(
    'fetch',
    withSecurityBootstrap(async () => new Response(JSON.stringify(envelope), { status: 409 })),
  )
  try {
    await request('/api/planning/work-item/apply', { method: 'POST' })
  } catch (error) {
    return error
  } finally {
    vi.unstubAllGlobals()
  }
  throw new Error('the double was not refused')
}

const defer = () =>
  mountOf(DeferDialog, {
    item: workItemFixture('Tray', 1),
    scope: { own: 'QA-320', space: undefined },
  })

describe('putting work off', () => {
  it('sends nothing until a day or a card and a reason are both said', async () => {
    const wrapper = defer()
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="date"]').setValue('2099-01-02')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Say why it waits')
    await press(wrapper)
    expect(deferWorkItem).not.toHaveBeenCalled()
  })

  it('puts it off until a day, with why it waits', async () => {
    vi.mocked(deferWorkItem).mockResolvedValue()
    const wrapper = defer()
    await wrapper.get('input[type="date"]').setValue('2099-01-02')
    await wrapper.get('.defer-reason textarea, .defer-reason input').setValue(' After the release ')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
    await press(wrapper)
    await flushPromises()
    expect(deferWorkItem).toHaveBeenCalledWith({
      id: 'QA-320',
      until: '2099-01-02',
      reason: 'After the release',
    })
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('puts it off until a card closes, and keeps the window on a refusal', async () => {
    vi.mocked(deferWorkItem).mockRejectedValue(await refused('QA-7 is closed'))
    const wrapper = defer()
    wrapper.getComponent(UntilChoice).vm.$emit('update:value', 'QA-7')
    await wrapper.get('.defer-reason textarea, .defer-reason input').setValue('Waits on the API')
    await press(wrapper)
    await flushPromises()
    expect(deferWorkItem).toHaveBeenCalledWith({
      id: 'QA-320',
      until: 'QA-7',
      reason: 'Waits on the API',
    })
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('QA-7 is closed')
  })
})

const row = (n: number, holder: string[] = [], state = 'Dev') => ({
  reference: `QA-${n}`,
  title: `Task ${n}`,
  kind: 'task',
  state: { key: state.toLowerCase(), name: state, category: 'active' },
  container_state: null,
  holder,
})
const listOf = (token: string, cancels: CancelList['cancels']): CancelList => ({
  cancels,
  dependents: [{ reference: 'QA-9', title: 'Docs', kind: 'task', waits_on: 'QA-2', how: 'blocks' }],
  list_token: token,
})

const cancelGoal = (locale = 'en') =>
  mountOf(CancelGoalDialog, { item: goal(), state: 'dropped' }, locale)

describe("a goal's cancel", () => {
  it('reads the list as it opens, closing nothing, and names the count on the press', async () => {
    vi.mocked(cancelWorkItem).mockRejectedValue(
      new CancelListError(listOf('t1', [row(2), row(3, ['worker-a'])])),
    )
    const wrapper = cancelGoal()
    await flushPromises()
    expect(cancelWorkItem).toHaveBeenCalledTimes(1)
    expect(vi.mocked(cancelWorkItem).mock.calls[0][0]).toMatchObject({
      id: 'QA-1',
      state: 'dropped',
      cancels: undefined,
    })
    expect(wrapper.findAll('.cancel-row[data-reference]').map((li) => li.text())).toEqual([
      expect.stringContaining('QA-2'),
      expect.stringContaining('QA-3'),
      expect.stringContaining('QA-9'),
    ])
    expect(wrapper.text()).toContain('waits on QA-2')
    expect(submitButton(wrapper).text()).toBe('Cancel 2 cards')
    expect(wrapper.find('.cancel-changed').exists()).toBe(false)
  })

  it('asks again with the new list marked when it changed, and closes only the one confirmed', async () => {
    vi.mocked(cancelWorkItem)
      .mockRejectedValueOnce(new CancelListError(listOf('t1', [row(2), row(3, ['worker-a'])])))
      .mockRejectedValueOnce(
        new CancelListError(listOf('t2', [row(2), row(3, ['worker-b']), row(4)])),
      )
      .mockResolvedValueOnce()
    const wrapper = cancelGoal()
    await flushPromises()

    // The press waits for the reason every card it closes keeps.
    await press(wrapper)
    expect(cancelWorkItem).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('Say why it is cancelled')

    await wrapper.get('.cancel-reason textarea').setValue('The plan changed')
    expect(wrapper.text()).not.toContain('Say why it is cancelled')
    await press(wrapper)
    await flushPromises()
    expect(vi.mocked(cancelWorkItem).mock.calls[1][0]).toEqual({
      id: 'QA-1',
      state: 'dropped',
      cancels: 't1',
      reason: 'The plan changed',
      summary: {
        done: 'Cancelled by the owner.',
        next: 'Nothing: it was cancelled.',
        why: 'The plan changed',
      },
    })
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.get('.cancel-changed').text()).toContain('The list changed')
    const marks = Object.fromEntries(
      wrapper
        .findAll('.cancel-row[data-reference^="QA-"]')
        .map((li) => [li.attributes('data-reference'), li.attributes('data-change') ?? null]),
    )
    expect(marks).toMatchObject({ 'QA-2': null, 'QA-3': 'changed', 'QA-4': 'new' })
    expect(submitButton(wrapper).text()).toBe('Cancel 3 cards')

    await press(wrapper)
    await flushPromises()
    expect(vi.mocked(cancelWorkItem).mock.calls[2][0]).toMatchObject({ cancels: 't2' })
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('names the count in each Russian form', async () => {
    vi.mocked(cancelWorkItem).mockRejectedValue(
      new CancelListError(listOf('t1', [row(2), row(3), row(4), row(5), row(6)])),
    )
    const wrapper = cancelGoal('ru')
    await flushPromises()
    expect(submitButton(wrapper).text()).toBe('Отменить 5 карточек')
  })
})

describe("confirming a goal's close", () => {
  it('waits for every condition, then ticks the open and marked ones with the summary', async () => {
    vi.mocked(confirmWorkItemClose).mockResolvedValue()
    const item = goal({
      container_state: 'awaiting_confirmation',
      checklist: [step(1, true), step(2, false), step(3, true, true)],
      confirmation: {
        since: null,
        steps: 3,
        cancelled: [{ reference: 'QA-5', reason: 'Not needed' }],
        moved_out: [{ reference: 'QA-6', reason: null }],
        asked: null,
        left_for_next_session: null,
      },
    })
    const wrapper = mountOf(ConfirmCloseDialog, { item, state: 'done' })
    expect(wrapper.get('[data-part="conditions"]').text()).toContain('Condition 2')
    expect(wrapper.findAll('.confirm-closed-row').map((li) => li.text())).toEqual([
      'QA-5Cancelled · Reason: Not needed',
      'QA-6Moved out',
    ])
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
    await press(wrapper)
    expect(confirmWorkItemClose).not.toHaveBeenCalled()

    await wrapper.findAll('[role="checkbox"]')[1].trigger('click')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
    await press(wrapper)
    await flushPromises()
    expect(confirmWorkItemClose).toHaveBeenCalledWith({
      id: 'QA-1',
      state: 'done',
      ticks: [step(2, false).id, step(3, true).id],
      summary: {
        done: 'Confirmed by the owner: all work under it is closed.',
        next: 'Nothing: the work under it is closed.',
      },
    })
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('checks one without conditions against its description, its summary kept', async () => {
    vi.mocked(confirmWorkItemClose).mockResolvedValue()
    const item = goal({
      container_state: 'awaiting_confirmation',
      description: 'Every channel delivers.',
      summary: { done: 'Shipped', next: 'Nothing' },
    })
    const wrapper = mountOf(ConfirmCloseDialog, { item, state: 'done' })
    expect(wrapper.find('[data-part="conditions"]').exists()).toBe(false)
    expect(wrapper.get('[data-part="description"]').text()).toContain('Every channel delivers.')
    expect(wrapper.text()).toContain('No conditions: it is checked against its description')
    await press(wrapper)
    await flushPromises()
    expect(confirmWorkItemClose).toHaveBeenCalledWith({
      id: 'QA-1',
      state: 'done',
      ticks: [],
      summary: undefined,
    })
  })

  it('keeps the window and the boxes on a refusal', async () => {
    vi.mocked(confirmWorkItemClose).mockRejectedValue(await refused('QA-8 is open under it'))
    const item = goal({ container_state: 'awaiting_confirmation', checklist: [step(2, false)] })
    const wrapper = mountOf(ConfirmCloseDialog, { item, state: 'done' })
    await wrapper.get('[role="checkbox"]').trigger('click')
    await press(wrapper)
    await flushPromises()
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('QA-8 is open under it')
    expect(wrapper.get('[role="checkbox"]').attributes('aria-checked')).toBe('true')
  })
})
