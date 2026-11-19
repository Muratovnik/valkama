/**
 * Dividing work from its card: what the «…» menu offers for the item's place, the window that
 * splits a part off a task, the questions asked in place before converting it or moving it out
 * of its goal, and where the conditions that left it went.
 *
 * What the menu offers follows the server's rules for each action (a part is split off an open
 * task outside review; a task converts into the word its place gives; only a goal or a stage
 * with nothing under it converts back; only work under a goal moves out), so nothing it offers is
 * refused for what the card already knows. Only `fetch` is a double for the writes, so each
 * leaves as the server receives it.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspectorMovedConditions from '@/widgets/work-item-inspector/components/InspectorMovedConditions.vue'
import { dividingActions } from '@/widgets/work-item-inspector/utils/dividingActions.ts'

import DividingStrip from '@/features/work-item-dividing/DividingStrip.vue'
import SplitDialog from '@/features/work-item-dividing/SplitDialog.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { emptyChain } from '../fixtures/chain.ts'
import { getButton, stateOf, workItemFixture } from '../fixtures/workItem.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from '../support/request.ts'

const i18n = (locale = 'en') =>
  createI18n({ legacy: false, locale, messages, pluralRules, missingWarn: false })
const dialogStub = {
  props: ['error', 'open', 'title'],
  emits: ['submit', 'close'],
  template:
    '<form v-if="open" @submit.prevent="$emit(\'submit\')"><h2>{{ title }}</h2><slot/><p role="alert">{{ error }}</p><slot name="footer"/></form>',
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
const refused = (message: string) => json({ error: { code: 'invalid_request', message } }, 400)

/** Every write the window or the question sends, answered by `answer`. */
function serve(answer: () => Response) {
  const sent: { body: Record<string, unknown>; path: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      withSecurityBootstrap(async (input, init) => {
        const path = new URL(requestUrl(input), 'http://localhost').pathname
        sent.push({ path, body: JSON.parse(requestBody(init?.body)) as Record<string, unknown> })
        return answer()
      }),
    ),
  )
  return sent
}
afterEach(() => vi.unstubAllGlobals())

const GOAL_ID = '00000000-0000-4000-8000-000000000301'
const step = (n: number, done: boolean, claimedBy = ''): WorkItem['checklist'][number] => ({
  id: `00000000-0000-4000-8000-0000000008${String(n).padStart(2, '0')}`,
  text: `Condition ${n}`,
  done,
  claimed_by: claimedBy,
  done_by: done ? 'worker-a' : '',
  by_previous_holder: false,
})
/** The card's task under the goal QA-301, with a condition done and two open. */
const task = (patch: Partial<WorkItem> = {}): WorkItem => ({
  ...workItemFixture('Delivery switches', 1),
  parent_id: GOAL_ID,
  parent: 'QA-301',
  checklist: [step(1, true), step(2, false), step(3, false)],
  ...patch,
})
const container = (kind: 'goal' | 'stage', patch: Partial<WorkItem> = {}): WorkItem => ({
  ...task({ kind, state: null, container_state: 'not_started', checklist: [], ...patch }),
})
/** The card's read of the work under the item: nothing, or one task. */
const under = (item: WorkItem, any: boolean): WorkItemChain => {
  const chain = emptyChain(item.reference, item.work_item_id)
  return { ...chain, root: { ...chain.root, has_children: any } } as WorkItemChain
}
const offered = (item: WorkItem, chain: WorkItemChain | null = null) =>
  dividingActions(item, chain).map(({ action, label }) => [action, label.split('.').at(-1)])

describe('what the «…» menu offers to divide', () => {
  it('offers a task under a goal a split, a stage and a move out', () => {
    expect(offered(task())).toEqual([
      ['split', 'split'],
      ['convert', 'toStage'],
      ['move-out', 'moveOut'],
    ])
  })

  it('offers a task at the top level a goal, and nothing to move out of', () => {
    expect(offered(task({ parent_id: null, parent: null }))).toEqual([
      ['split', 'split'],
      ['convert', 'toGoal'],
    ])
  })

  it('offers no split where no condition is left open, and neither in review', () => {
    const done = task({ checklist: [step(1, true)] })
    expect(offered(done)).toEqual([
      ['convert', 'toStage'],
      ['move-out', 'moveOut'],
    ])
    const review = task({ state: { ...stateOf(task()), key: 'review', category: 'review' } })
    expect(offered(review)).toEqual([['move-out', 'moveOut']])
  })

  it('offers a goal or a stage the way back to a task only once its read finds nothing under it', () => {
    const goal = container('goal', { parent_id: null, parent: null })
    expect(offered(goal)).toEqual([])
    expect(offered(goal, under(goal, true))).toEqual([])
    expect(offered(goal, under(goal, false))).toEqual([['to-task', 'toTask']])
    // Another item's read says nothing about this one.
    expect(offered(goal, emptyChain('QA-399', GOAL_ID) as WorkItemChain)).toEqual([])
    const stage = container('stage')
    expect(offered(stage, under(stage, false))).toEqual([
      ['to-task', 'toTask'],
      ['move-out', 'moveOut'],
    ])
  })

  it('offers nothing for closed work', () => {
    expect(offered(task({ open: false }))).toEqual([])
  })
})

const splitDialog = (item = task()) =>
  mount(SplitDialog, {
    props: { open: true, item },
    global: { plugins: [i18n()], stubs: { DialogFrame: dialogStub } },
  })
const submit = (wrapper: ReturnType<typeof splitDialog>) => wrapper.get('button[type="submit"]')

describe('splitting a part off', () => {
  it('lists only the open conditions, and creates nothing until it is named and takes one', async () => {
    const sent = serve(() => json({}))
    const wrapper = splitDialog()
    expect(wrapper.findAll('[data-step]').map((row) => row.text())).toEqual([
      'Condition 2',
      'Condition 3',
    ])
    expect(submit(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Name the new card.')

    await wrapper.get('input').setValue('Switches: saving')
    expect(wrapper.text()).toContain('Choose a condition: a part takes at least one.')
    await wrapper.get('form').trigger('submit')
    expect(sent).toEqual([])

    await wrapper.findAll('[role="checkbox"]')[1].trigger('click')
    expect(submit(wrapper).attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(sent).toEqual([
      {
        path: '/api/planning/work-items',
        body: {
          author: 'user',
          split_from: 'QA-320',
          title: 'Switches: saving',
          steps: [step(3, false).id],
        },
      },
    ])
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('keeps the window and what was chosen when the server refuses', async () => {
    serve(() => refused('[split] QA-320 is in review, where the owner checks its steps'))
    const wrapper = splitDialog()
    await wrapper.get('input').setValue('Switches: saving')
    await wrapper.findAll('[role="checkbox"]')[0].trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      '[split] QA-320 is in review, where the owner checks its steps',
    )
    expect(wrapper.findAll('[role="checkbox"]')[0].attributes('aria-checked')).toBe('true')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Switches: saving')
  })
})

const TRIAGE = { key: 'triage', name: 'Triage', category: 'triage' }
const strip = (action: 'convert' | 'move-out' | 'to-task', item: WorkItem, locale = 'en') =>
  mount(DividingStrip, {
    props: { action, item, triage: TRIAGE },
    global: { plugins: [i18n(locale)] },
    attachTo: document.body,
  })
const go = (wrapper: ReturnType<typeof strip>, label: string) =>
  getButton(wrapper, label).trigger('click')

describe('converting asked in place', () => {
  it('converts a task under a goal into a stage, saying what stays and that its projects go', async () => {
    const sent = serve(() => json({}))
    const wrapper = strip(
      'convert',
      task({ projects: [{ project_id: 'alpha', display_name: 'Alpha', source: 'named' }] }),
    )
    expect(wrapper.get('[data-dividing="convert"]').text()).toContain(
      'Turn QA-320 into a stage? Its number, title, description, discussion, history, links, references and conditions with their ticks stay. Its projects are dropped: the tasks inside carry projects.',
    )
    await go(wrapper, 'Turn into a stage')
    await flushPromises()
    expect(sent).toEqual([
      {
        path: '/api/planning/work-item/convert',
        body: { author: 'user', id: 'QA-320', to: 'stage' },
      },
    ])
    expect(wrapper.emitted('done')).toHaveLength(1)
    wrapper.unmount()
  })

  it('converts a held task at the top level into a goal, saying its claims end', async () => {
    const sent = serve(() => json({}))
    const wrapper = strip(
      'convert',
      task({ parent_id: null, parent: null, checklist: [step(2, false, 'worker-a')] }),
    )
    expect(wrapper.text()).toContain('Turn QA-320 into a goal?')
    expect(wrapper.text()).toContain(
      'Its claims end, and the work they hold becomes a new task inside it.',
    )
    await go(wrapper, 'Turn into a goal')
    await flushPromises()
    expect(sent[0].body).toMatchObject({ to: 'goal' })
    wrapper.unmount()
  })

  it('converts a stage with nothing under it back into a task, and keeps the question on a refusal', async () => {
    const sent = serve(() =>
      refused('[convert] QA-320 has 1 item(s) under it, and a task holds none'),
    )
    const wrapper = strip('to-task', container('stage'), 'ru')
    expect(wrapper.text()).toContain(
      'Вернуть этап QA-320 в задачу? Внутри ничего нет; цель и место в ней останутся.',
    )
    await go(wrapper, 'Вернуть в задачу')
    await flushPromises()
    expect(sent[0].body).toMatchObject({ id: 'QA-320', to: 'task' })
    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('has 1 item(s) under it')
    wrapper.unmount()
  })
})

describe('moving out of the goal asked in place', () => {
  it('names where it goes, sends nothing without a reason, and sends the reason given', async () => {
    const sent = serve(() => json({}))
    const wrapper = strip('move-out', task())
    expect(wrapper.text()).toContain(
      'Move QA-320 out of QA-301? The card goes to the top level, to «Triage».',
    )
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
    await go(wrapper, 'Move out')
    expect(sent).toEqual([])
    expect(wrapper.get('[role="alert"]').text()).toBe('Say why it leaves: QA-301 keeps the reason.')

    await wrapper.get('textarea').setValue('  After the release  ')
    await go(wrapper, 'Move out')
    await flushPromises()
    expect(sent).toEqual([
      {
        path: '/api/planning/work-item/move-out',
        body: { author: 'user', id: 'QA-320', reason: 'After the release' },
      },
    ])
    expect(wrapper.emitted('done')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps the work where it was on Escape', async () => {
    const sent = serve(() => json({}))
    const wrapper = strip('move-out', task())
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(sent).toEqual([])
    wrapper.unmount()
  })
})

describe('where the conditions that left a task went', () => {
  it('lists each card that took some, with how many, and opens it', async () => {
    const item = task({
      conditions_changed: {
        removed: [],
        moved: [
          { to: 'QA-330', count: 2 },
          { to: 'QA-331', count: 1 },
        ],
      },
    })
    const wrapper = mount(InspectorMovedConditions, {
      props: { item },
      global: { plugins: [i18n('ru')] },
    })
    expect(wrapper.text()).toContain('Условия ушли в')
    const rows = wrapper.findAll('[data-moved]')
    expect(rows.map((row) => row.findAll('span').map((part) => part.text()))).toEqual([
      ['QA-330', '2 условия'],
      ['QA-331', '1 условие'],
    ])
    await rows[0].get('button').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['QA-330']])
  })

  it('stands empty for a task none left', () => {
    const wrapper = mount(InspectorMovedConditions, {
      props: { item: task() },
      global: { plugins: [i18n()] },
    })
    expect(wrapper.find('[data-moved]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })
})
