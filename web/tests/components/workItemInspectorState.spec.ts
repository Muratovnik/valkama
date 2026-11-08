import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'

import { fetchExecutionHistory } from '@/shared/api/executionApi.ts'
import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'

// The card asks for its chain on every open; this spec is about something else.
vi.mock('@/shared/api/planningChainApi.ts', async () => {
  const { noChainModule } = await import('../support/noChain.ts')
  return noChainModule()
})

vi.mock('@/shared/api/executionApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/executionApi.ts')>()),
  fetchExecutionHistory: vi.fn(),
}))

// The usage read holds the head for a moment; these cases are about the record alone.
vi.mock('@/shared/api/planningUsageApi.ts', () => ({ fetchItemUsage: vi.fn() }))

// The card looks up its project's memory on every open; no project here has any.
vi.mock('@/shared/api/memoryApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/memoryApi.ts')>()),
  fetchMemoryProviders: vi.fn(() => Promise.resolve({ providers: [] })),
}))

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchWorkItem: vi.fn(),
  commentWorkItem: vi.fn(),
  publishWorkItemReport: vi.fn(),
  selectWorkItemSummary: vi.fn(),
  updateWorkItemDescription: vi.fn(),
}))

import {
  deferred,
  getButton,
  workItemFixture as record,
  inspectorResourceRef as resourceRef,
  value,
} from '../fixtures/workItem.ts'

const passThrough = { template: '<div><slot /></div>' }
const drawerFrame = {
  // The frame's head apart from its content.
  template:
    '<div><div class="frame-head"><slot name="identity" /><slot name="title" /><slot name="controls" /><slot name="facts" /><slot name="notices" /><slot name="tabs" /></div><slot /></div>',
  methods: {
    holdFocus() {},
    position: () => 0,
    restore() {},
    scrollToContent() {},
  },
}
const overview = {
  props: ['item'],
  template: '<div class="overview-probe">{{ item.title }}</div>',
}

function mountInspector(realOverview = false) {
  return mount(WorkItemInspector, {
    props: {
      canGoBack: false,
      projectId: 'sample',
      reference: 'QA-320',
      refreshToken: 0,
      resourceRef,
      workflow: null,
      writable: realOverview,
    },
    global: {
      plugins: [
        createPinia(),
        createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
      ],
      stubs: {
        ChoiceSelect: true,
        DrawerFrame: drawerFrame,
        InspectorActivity: true,
        InspectorExecution: true,
        InspectorMemory: true,
        InspectorOverview: realOverview ? false : overview,
        InspectorRelations: true,
        InspectorUsage: true,
        LaunchDialog: true,
        ResizableInspector: passThrough,
        SegmentedControl: realOverview ? false : true,
        VIcon: true,
      },
    },
  })
}

describe('WorkItemInspector resource state', () => {
  beforeEach(() => {
    localStorage.setItem('valkama-settings', JSON.stringify({ executionTab: true }))
    vi.mocked(fetchWorkItem).mockReset()
    vi.mocked(fetchExecutionHistory).mockReset().mockResolvedValue({
      interface_version: 'valkama-execution-api',
      work_item: 'QA-320',
      executions: [],
    })
  })

  it('renders a localized cold failure and executes its retry', async () => {
    const initial = deferred<WorkItem>()
    vi.mocked(fetchWorkItem).mockReturnValueOnce(initial.promise)
    const wrapper = mountInspector()
    expect(wrapper.find('.platform-state-panel[data-tone="info"][aria-busy="true"]').exists()).toBe(
      true,
    )

    initial.reject(
      Object.assign(new Error('private planning response'), {
        code: 'work_item_request_failed',
        retryable: true,
        status: 503,
      }),
    )
    await flushPromises()

    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('The work item could not be loaded.')
    expect(wrapper.text()).not.toContain('private planning response')

    vi.mocked(fetchWorkItem).mockResolvedValueOnce(record('Recovered work item', 2))
    await wrapper.get('.platform-state-retry').trigger('click')
    await flushPromises()

    expect(fetchWorkItem).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.overview-probe').text()).toBe('Recovered work item')
  })

  it('says a reference that names nothing is not there, once, with no section and no retry', async () => {
    vi.mocked(fetchWorkItem).mockRejectedValueOnce({
      code: 'not_found',
      retryable: false,
      status: 404,
    })
    const wrapper = mountInspector(true)
    await flushPromises()

    const head = wrapper.get('.frame-head')
    // The title is the reference, and nothing over or under it says it again.
    expect(head.text()).toBe('QA-320')
    expect(wrapper.text().match(/QA-320/gu)).toHaveLength(1)
    expect(head.find('.inspector-tabs').exists()).toBe(false)
    // An absence, not a broken view: the sentence and nothing to retry.
    expect(wrapper.get('.data-empty').text()).toBe(
      'There is no such record: it was deleted, or the address points elsewhere.',
    )
    expect(wrapper.find('.platform-state-panel').exists()).toBe(false)
    expect(wrapper.find('.card-facts-block').exists()).toBe(false)
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([])
    // The execution module is never asked about a record that does not exist.
    expect(fetchExecutionHistory).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reads the attempts once for an item it found, after the item', async () => {
    vi.mocked(fetchWorkItem).mockResolvedValueOnce(record('Found', 1))
    const wrapper = mountInspector(true)
    await flushPromises()
    expect(fetchExecutionHistory).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('with the tab off it never asks about attempts and has no launch form, until turned on', async () => {
    localStorage.clear()
    vi.mocked(fetchWorkItem).mockResolvedValue(record('Found', 1))
    const wrapper = mountInspector(true)
    await flushPromises()
    expect(wrapper.find('launch-dialog-stub').exists()).toBe(false)
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    expect(fetchExecutionHistory).not.toHaveBeenCalled()

    useSettingsStore().settings.executionTab = true
    await flushPromises()
    expect(wrapper.find('launch-dialog-stub').exists()).toBe(true)
    expect(fetchExecutionHistory).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('reads the record again when an agent changed, and nothing else', async () => {
    vi.mocked(fetchWorkItem)
      .mockResolvedValueOnce(record('Found', 1))
      .mockResolvedValueOnce(record('Read again', 1))
    const wrapper = mountInspector(true)
    await flushPromises()
    expect(fetchWorkItem).toHaveBeenCalledTimes(1)
    expect(fetchExecutionHistory).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ agentsToken: 1 })
    await flushPromises()
    expect(fetchWorkItem).toHaveBeenCalledTimes(2)
    expect(fetchExecutionHistory).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('drops the card of an item deleted while it is open, rather than keep a stale one', async () => {
    vi.mocked(fetchWorkItem).mockResolvedValueOnce(record('Soon gone', 1))
    const wrapper = mountInspector()
    await flushPromises()
    expect(wrapper.find('.overview-probe').exists()).toBe(true)

    vi.mocked(fetchWorkItem).mockRejectedValueOnce({
      code: 'not_found',
      retryable: false,
      status: 404,
    })
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()

    expect(wrapper.find('.overview-probe').exists()).toBe(false)
    expect(wrapper.find('.platform-state-banner').exists()).toBe(false)
    expect(wrapper.get('.data-empty').text()).toContain('There is no such record')
    expect(wrapper.find('.inspector-tabs').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps a reference in the title whole, and the title as it was written', async () => {
    vi.mocked(fetchWorkItem).mockResolvedValueOnce(
      record('Findings after the review (follow-up to MAIN-384)', 1),
    )
    const wrapper = mountInspector()
    await flushPromises()
    const head = wrapper.get('.frame-head')
    // The reference is one run the head keeps from breaking at its hyphen.
    expect(head.findAll('.head-title-reference').map((run) => run.text())).toEqual(['MAIN-384'])
    expect(head.text()).toContain('Findings after the review (follow-up to MAIN-384)')
    wrapper.unmount()
  })

  it('keeps the exact inspector subtree through refresh and degraded retry', async () => {
    vi.mocked(fetchWorkItem).mockResolvedValueOnce(record('Accepted work item', 1))
    const wrapper = mountInspector()
    await flushPromises()
    const accepted = wrapper.get('.overview-probe').element

    const refresh = deferred<WorkItem>()
    vi.mocked(fetchWorkItem).mockReturnValueOnce(refresh.promise)
    await wrapper.setProps({ refreshToken: 1 })

    expect(wrapper.get('.overview-probe').element).toBe(accepted)
    expect(wrapper.find('.platform-state-banner').exists()).toBe(false)

    refresh.reject({ code: 'work_item_request_failed', retryable: true, status: 503 })
    await flushPromises()

    expect(wrapper.get('.overview-probe').element).toBe(accepted)
    expect(wrapper.get('.platform-state-banner').text()).toContain(
      'The work item could not be loaded.',
    )

    vi.mocked(fetchWorkItem).mockResolvedValueOnce(record('Updated work item', 2))
    await wrapper.get('.inspector-read-recovery button').trigger('click')
    await flushPromises()

    expect(fetchWorkItem).toHaveBeenCalledTimes(3)
    expect(wrapper.get('.overview-probe').text()).toBe('Updated work item')
  })
  it('retains description and comment drafts across tabs and a background refresh', async () => {
    const item = record('Task', 1)
    vi.mocked(fetchWorkItem).mockResolvedValue(item)
    const wrapper = mountInspector(true)
    await flushPromises()
    await wrapper.get('.description-heading button').trigger('click')
    await wrapper.get('textarea[aria-label="Description"]').setValue('Description draft')
    await wrapper.get('textarea[aria-label="Comment"]').setValue('Comment draft')
    await getButton(wrapper, 'System events').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.overview').attributes('style')).toContain('display: none')
    vi.mocked(fetchWorkItem).mockResolvedValue({
      ...item,
      revision: 2,
      description: 'Remote change',
    })
    await wrapper.setProps({ refreshToken: 1 })
    await flushPromises()
    await getButton(wrapper, 'Overview').trigger('click')
    await wrapper.vm.$nextTick()
    expect(value(wrapper, 'Description')).toBe('Description draft')
    expect(value(wrapper, 'Comment')).toBe('Comment draft')
    wrapper.unmount()
  })

  // `user` is the author this client writes as: its own claim may be released,
  // and anyone else's is offered as a takeover, because the server refuses a
  // release of a claim the caller does not hold.
  it.each([
    { terminal: true, writable: true, holder: 'claude', action: [] },
    { terminal: true, writable: true, holder: '', action: [] },
    { terminal: true, writable: false, holder: 'claude', action: [] },
    { terminal: false, writable: true, holder: 'claude', action: ['Take over'] },
    { terminal: false, writable: true, holder: 'user', action: ['Release'] },
    { terminal: false, writable: true, holder: '', action: ['Claim'] },
    { terminal: false, writable: false, holder: 'claude', action: [] },
  ])(
    'keeps ownership actions truthful for $terminal/$writable/$holder',
    async ({ terminal, writable, holder, action }) => {
      const claimed = Boolean(holder)
      const item = record('Ownership task', 1)
      item.state.is_terminal = terminal
      item.claim_ref = holder
      vi.mocked(fetchWorkItem).mockResolvedValue(item)
      const wrapper = mountInspector(true)
      const nextState = { ...item.state, state_id: 'next-state', key: 'queued', name: 'Queued' }
      await wrapper.setProps({
        writable,
        workflow: {
          workflow_id: 'workflow',
          name: 'Task workflow',
          initial_state_id: item.state.state_id,
          states: [
            { ...item.state, position: 0 },
            { ...nextState, position: 1 },
          ],
          transitions: [{ from: item.state.state_id, to: nextState.state_id }],
        },
      })
      await flushPromises()

      // The holder is named once, among the facts in the head that stays in
      // view, as responsible while the item is open and as history once it is done.
      const head = wrapper.get('.frame-head')
      const holderFact = head.get('.card-holder')
      expect(holderFact.text()).toContain(claimed ? holder : 'No active claim')
      // The label stands on the screen, so nothing hidden says it a second time. Every row
      // of the head is named, finished work that nobody held among them.
      expect(holderFact.find('.visually-hidden').exists()).toBe(false)
      const label = holderFact.get('.card-holder-label')
      expect(label.text()).toBe(terminal ? 'Previously responsible' : 'Held by')
      expect(wrapper.text().split(claimed ? holder : 'No active claim')).toHaveLength(2)
      const actions = head.findAll('.write-actions button').map((button) => button.text())
      expect(actions).toEqual(action)
      // The state is the menu that moves it, wherever the card can write.
      expect(wrapper.findComponent({ name: 'ChoiceSelect' }).exists()).toBe(writable)
      if (writable) {
        expect(wrapper.getComponent({ name: 'ChoiceSelect' }).props()).toMatchObject({
          disabled: false,
          modelValue: 'dev',
          options: [
            { value: 'dev', label: 'Development', disabled: true },
            { value: 'queued', label: 'Queued' },
          ],
        })
      }
      expect(item.claim_ref).toBe(holder)
      wrapper.unmount()
    },
  )
})

describe('inspector relations hierarchy', () => {
  it('names related work and evidence independently and opens the related-task picker', async () => {
    const wrapper = mount(InspectorRelations, {
      props: { item: record('Связанная работа', 1), writable: true },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'ru', messages })],
        stubs: { RelatedWorkPicker: true },
      },
    })
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      'Связанная работа',
      'Свидетельства',
    ])
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.get('.section-header-actions button').trigger('click')
    expect(wrapper.findComponent({ name: 'RelatedWorkPicker' }).props()).toMatchObject({
      open: true,
      initialKind: 'relates-to',
      initialDirection: 'outgoing',
    })
    wrapper.unmount()
  })
})
