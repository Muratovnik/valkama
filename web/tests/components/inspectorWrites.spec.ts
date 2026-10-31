/**
 * The inspector's own writes against the server's answers to them.
 *
 * The planning client runs for real here and only `fetch` is a double, so a
 * refusal reaches the inspector the way the server words it — a status and a
 * `{ error: { code, message } }` body — rather than as an object a test built
 * to look like one.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'

import { fetchExecutionHistory } from '@/shared/api/executionApi.ts'
import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import {
  getButton,
  inspectorResourceRef as resourceRef,
  workItemFixture,
} from '../fixtures/workItem.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from '../support/request.ts'

vi.mock('@/shared/api/executionApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/executionApi.ts')>()),
  fetchExecutionHistory: vi.fn(),
}))

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchWorkItem: vi.fn(),
}))

const SUMMARY_REFUSAL =
  '[summary] QA-320 has no closing summary; record what was done and what comes next before closing it'

const DONE = {
  state_id: '00000000-0000-4000-8000-000000000003',
  key: 'done',
  name: 'Done',
  category: 'completed' as const,
  is_terminal: true,
}

function workflowFor(item: WorkItem): PlanningWorkflow {
  return {
    workflow_id: 'workflow',
    name: 'Task workflow',
    initial_state_id: item.state.state_id,
    states: [
      { ...item.state, position: 0 },
      { ...DONE, position: 1 },
    ],
    transitions: [{ from: item.state.state_id, to: DONE.state_id }],
  }
}

/** What the page sent, and an answer per write path that a test can replace. */
function serveWrites(answers: Record<string, (body: Record<string, unknown>) => Response>) {
  const writes: { body: Record<string, unknown>; path: string }[] = []
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    withSecurityBootstrap(async (input, init) => {
      const path = new URL(requestUrl(input), 'http://localhost').pathname
      const body = JSON.parse(requestBody(init?.body)) as Record<string, unknown>
      writes.push({ path, body })
      const answer = answers[path]
      if (!answer) throw new Error(`unexpected write ${path}`)
      return answer(body)
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return writes
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const choiceStub = {
  name: 'ChoiceSelect',
  props: ['modelValue', 'options', 'disabled', 'label', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<span class="state-choice-stub">{{ modelValue }}</span>',
}
const drawerFrameStub = {
  name: 'DrawerFrame',
  emits: ['close'],
  template: '<div><slot name="meta" /><slot name="actions" /><slot name="tabs" /><slot /></div>',
  methods: { scrollToTop() {} },
}

function mountInspector(item: WorkItem) {
  vi.mocked(fetchWorkItem).mockResolvedValue(item)
  return mount(WorkItemInspector, {
    attachTo: document.body,
    props: {
      canGoBack: true,
      projectId: 'sample',
      reference: item.reference,
      refreshToken: 0,
      resourceRef,
      workflow: workflowFor(item),
      writable: true,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      stubs: {
        ChoiceSelect: choiceStub,
        DrawerFrame: drawerFrameStub,
        InspectorExecution: true,
        InspectorMemory: true,
        ItemInputRequests: true,
        LaunchDialog: true,
        ResizableInspector: { template: '<div><slot /></div>' },
        VIcon: true,
      },
    },
  })
}

async function choose(wrapper: VueWrapper, stateKey: string) {
  wrapper.getComponent(choiceStub).vm.$emit('update:modelValue', stateKey)
  await flushPromises()
}

const transitions = (writes: { path: string }[]) =>
  writes.filter((write) => write.path === '/api/planning/work-item/transition')

describe('inspector writes and their refusals', () => {
  beforeEach(() => {
    vi.mocked(fetchWorkItem).mockReset()
    vi.mocked(fetchExecutionHistory).mockReset().mockResolvedValue({
      interface_version: 'valkama-execution-api',
      work_item: 'QA-320',
      executions: [],
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('shows a refused move in the server’s words, with its next step and a confirmed override', async () => {
    const item = workItemFixture('Close me', 4)
    const writes = serveWrites({
      '/api/planning/work-item/transition': (body) =>
        body.force === true
          ? json({ ...item, state: DONE, revision: 5 })
          : json({ error: { code: 'workflow_guard', message: SUMMARY_REFUSAL } }, 409),
    })
    const wrapper = mountInspector(item)
    await flushPromises()

    await choose(wrapper, 'done')
    const notice = wrapper.get('.refusal')
    expect(notice.text()).toContain('Moving to “Done” was refused')
    expect(notice.text()).toContain('has no closing summary; record what was done')
    expect(notice.text()).toContain('There is no closing summary')
    expect(wrapper.text()).not.toContain('technical code')

    // The same choice again is a second request, not a no-op on a stale selection.
    await choose(wrapper, 'done')
    expect(transitions(writes)).toHaveLength(2)
    expect(transitions(writes).every((write) => write.body.force === undefined)).toBe(true)

    // Overriding is asked first, and only the second answer sends it.
    await getButton(wrapper, 'Move anyway').trigger('click')
    expect(wrapper.get('.confirm-strip').text()).toContain('against the workflow rules')
    expect(transitions(writes)).toHaveLength(2)
    await wrapper.get('.confirm-strip .confirm-go').trigger('click')
    await flushPromises()
    expect(transitions(writes).at(-1)?.body).toEqual({
      author: 'user',
      id: 'QA-320',
      state: 'done',
      force: true,
    })
    expect(wrapper.find('.refusal').exists()).toBe(false)
    wrapper.unmount()
  })

  it('takes the guard’s next step where the inspector can: the outcome report composer', async () => {
    const item = workItemFixture('Close me', 4)
    serveWrites({
      '/api/planning/work-item/transition': () =>
        json({ error: { code: 'workflow_guard', message: SUMMARY_REFUSAL } }, 409),
    })
    const wrapper = mountInspector(item)
    await flushPromises()
    await choose(wrapper, 'done')
    await getButton(wrapper, 'Write the outcome').trigger('click')
    await flushPromises()
    expect(wrapper.find('.refusal').exists()).toBe(false)
    expect(wrapper.find('textarea[aria-label="What was done"]').exists()).toBe(true)
    const outcome = wrapper.findAll('.discussion-option input').at(-1)?.element as
      HTMLInputElement | undefined
    expect(outcome?.checked).toBe(true)
    wrapper.unmount()
  })

  it('offers release only on its own claim and a confirmed takeover on anyone else’s', async () => {
    const item = { ...workItemFixture('Held elsewhere', 2), claim_ref: 'claude' }
    const writes = serveWrites({
      '/api/planning/work-item/claim': (body) =>
        json({ ...item, claim_ref: body.release === true ? '' : 'user', revision: 3 }),
    })
    const wrapper = mountInspector(item)
    await flushPromises()

    expect(wrapper.findAll('.head-actions button').map((button) => button.text())).toEqual([
      'Take over',
    ])
    await getButton(wrapper, 'Take over').trigger('click')
    expect(wrapper.get('.confirm-strip').text()).toContain('claude holds this work')
    expect(writes).toHaveLength(0)

    vi.mocked(fetchWorkItem).mockResolvedValue({ ...item, claim_ref: 'user', revision: 3 })
    await wrapper.get('.confirm-strip .confirm-go').trigger('click')
    await flushPromises()
    expect(writes.at(-1)?.body).toEqual({ author: 'user', id: 'QA-320', force: true })
    expect(wrapper.findAll('.head-actions button').map((button) => button.text())).toEqual([
      'Release',
    ])

    vi.mocked(fetchWorkItem).mockResolvedValue({ ...item, claim_ref: '', revision: 4 })
    await getButton(wrapper, 'Release').trigger('click')
    await flushPromises()
    expect(writes.at(-1)?.body).toEqual({ author: 'user', id: 'QA-320', release: true })
    expect(wrapper.findAll('.head-actions button').map((button) => button.text())).toEqual([
      'Claim',
    ])
    wrapper.unmount()
  })

  it('asks before a close or a step back would drop an unsent comment or description', async () => {
    const item = workItemFixture('Drafts', 1)
    serveWrites({})
    const wrapper = mountInspector(item)
    await flushPromises()
    const frame = wrapper.getComponent(drawerFrameStub)

    // Nothing typed, nothing to lose: close goes straight through.
    frame.vm.$emit('close')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('textarea[aria-label="Comment"]').setValue('Half a thought')
    frame.vm.$emit('close')
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.get('.confirm-strip').text()).toContain('Unsaved changes will be lost: comment')

    await getButton(wrapper, 'Keep editing').trigger('click')
    expect(wrapper.find('.confirm-strip').exists()).toBe(false)
    expect(
      (wrapper.get('textarea[aria-label="Comment"]').element as HTMLTextAreaElement).value,
    ).toBe('Half a thought')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('.description-heading button').trigger('click')
    await wrapper.get('textarea[aria-label="Description"]').setValue('A new goal')
    await getButton(wrapper, 'Back').trigger('click')
    expect(wrapper.emitted('back')).toBeUndefined()
    expect(wrapper.get('.confirm-strip').text()).toContain('description, comment')
    await getButton(wrapper, 'Discard').trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
    wrapper.unmount()
  })
})
