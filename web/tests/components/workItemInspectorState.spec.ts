import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import KernelRelationsPanel from '@/widgets/work-item-inspector/components/KernelRelationsPanel.vue'
import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'

import { fetchExecutionHistory } from '@/shared/api/executionApi.ts'
import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

vi.mock('@/shared/api/executionApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/executionApi.ts')>()),
  fetchExecutionHistory: vi.fn(),
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
  template: '<div><slot name="meta" /><slot name="actions" /><slot name="tabs" /><slot /></div>',
}
const overview = {
  props: ['item', 'resourceRef'],
  template: '<div class="overview-probe">{{ item.title }}:{{ resourceRef.resource_id }}</div>',
}

function mountInspector(realOverview = false) {
  return mount(WorkItemInspector, {
    props: {
      canGoBack: false,
      kernel: null,
      projectId: 'sample',
      reference: 'QA-320',
      refreshToken: 0,
      resourceRef,
      workflow: null,
      writable: realOverview,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      stubs: {
        ChoiceSelect: true,
        DrawerFrame: drawerFrame,
        InspectorActivity: true,
        InspectorExecution: true,
        InspectorMemory: true,
        InspectorOverview: realOverview ? false : overview,
        InspectorRelations: true,
        InspectorUsage: true,
        KernelRelationsPanel: true,
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
    expect(wrapper.get('.overview-probe').text()).toBe(
      `Recovered work item:${resourceRef.resource_id}`,
    )
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
    expect(wrapper.get('.overview-probe').text()).toBe(
      `Updated work item:${resourceRef.resource_id}`,
    )
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

  it.each([
    { terminal: true, writable: true, claimed: true },
    { terminal: true, writable: true, claimed: false },
    { terminal: true, writable: false, claimed: true },
    { terminal: false, writable: true, claimed: true },
    { terminal: false, writable: true, claimed: false },
    { terminal: false, writable: false, claimed: true },
  ])(
    'keeps ownership actions truthful for $terminal/$writable/$claimed',
    async ({ terminal, writable, claimed }) => {
      const item = record('Ownership task', 1)
      item.state.is_terminal = terminal
      item.claim_ref = claimed ? 'claude' : ''
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

      const ownerFact = wrapper
        .findAll('.fact')
        .find(
          (fact) =>
            fact.find('dt').text() === (terminal ? 'Previously responsible' : 'Responsible'),
        )
      expect(ownerFact?.find('dd').text()).toBe(claimed ? 'claude' : 'No active claim')
      if (claimed) {
        expect(wrapper.get('.head-claim').text()).toBe(
          terminal ? 'Previously responsible: claude' : 'Responsible: claude',
        )
      }
      const actions = wrapper.findAll('.head-actions button').map((button) => button.text())
      expect(actions).toEqual(writable && !terminal ? [claimed ? 'Release' : 'Claim'] : [])
      expect(wrapper.findComponent({ name: 'ChoiceSelect' }).exists()).toBe(writable)
      if (writable) {
        expect(wrapper.getComponent({ name: 'ChoiceSelect' }).props()).toMatchObject({
          disabled: false,
          options: [{ value: 'queued', label: 'Queued' }],
        })
      }
      expect(item.claim_ref).toBe(claimed ? 'claude' : '')
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
      'Связанная работа 0',
      'Свидетельства',
    ])
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.get('header button').trigger('click')
    expect(wrapper.findComponent({ name: 'RelatedWorkPicker' }).props()).toMatchObject({
      open: true,
      initialKind: 'relates-to',
      initialDirection: 'outgoing',
    })
    wrapper.unmount()
  })

  it('explains recovery when no external attach provider is available', () => {
    const wrapper = mount(KernelRelationsPanel, {
      props: {
        invocationScope: { kind: 'global' },
        viewScope: { kind: 'global' },
        registry: null,
        relations: [],
        revision: 1,
        workItemRef: {
          reference: 'QA-320',
          space_ref: {
            data_scope_id: '22222222-2222-4222-8222-222222222222',
            space_key: 'QA',
          },
        },
      },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages })] },
    })
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual(['Внешние ресурсы'])
    expect(wrapper.text()).toContain('настройках проекта → Интеграции')
    expect(
      wrapper.findAll('button').filter((button) => button.text() === 'Прикрепить'),
    ).toHaveLength(0)
    wrapper.unmount()
  })
})
