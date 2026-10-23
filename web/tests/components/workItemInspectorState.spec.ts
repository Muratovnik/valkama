import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorRelations from '@/widgets/work-item-inspector/components/InspectorRelations.vue'
import InspectorSummary from '@/widgets/work-item-inspector/components/InspectorSummary.vue'
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
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

const now = '2026-08-27T18:00:00Z'
const resourceRef = {
  kind: 'planning-space' as const,
  resource_id:
    'eyJkYXRhX3Njb3BlX2lkIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwic3BhY2Vfa2V5IjoiTUFJTiJ9',
}

function record(title: string, revision: number): WorkItem {
  return {
    work_item_id: '00000000-0000-4000-8000-000000000320',
    planning_space_id: '00000000-0000-4000-8000-000000000001',
    reference: 'QA-320',
    number: 320,
    title,
    kind: 'task',
    priority: 'high',
    state: {
      state_id: '00000000-0000-4000-8000-000000000002',
      key: 'dev',
      name: 'Development',
      category: 'active',
      is_terminal: false,
    },
    claim_ref: '',
    parent_id: null,
    labels: [],
    source: '',
    checklist: [],
    revision,
    created_at: now,
    updated_at: now,
    container: false,
    ready: false,
    comment_count: 0,
    description: '',
    summary: null,
    links: [],
    refs: [],
    comments: [],
    events: [],
  }
}

const passThrough = { template: '<div><slot /></div>' }
const drawerFrame = {
  template: '<div><slot name="meta" /><slot name="actions" /><slot name="tabs" /><slot /></div>',
}
const overview = {
  props: ['item', 'resourceRef'],
  template: '<div class="overview-probe">{{ item.title }}:{{ resourceRef.resource_id }}</div>',
}

function mountInspector() {
  return mount(WorkItemInspector, {
    props: {
      canGoBack: false,
      kernel: null,
      projectId: 'sample',
      reference: 'QA-320',
      refreshToken: 0,
      resourceRef,
      workflow: null,
      writable: false,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      stubs: {
        ChoiceSelect: true,
        DrawerFrame: drawerFrame,
        InspectorActivity: true,
        InspectorExecution: true,
        InspectorMemory: true,
        InspectorOverview: overview,
        InspectorRelations: true,
        InspectorUsage: true,
        KernelRelationsPanel: true,
        LaunchDialog: true,
        ResizableInspector: passThrough,
        SegmentedControl: true,
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
})

describe('InspectorSummary draft reconciliation', () => {
  it('preserves an unsaved Russian draft when the same item receives a changed remote summary', async () => {
    const item = record('Длинное описание работ и связанных решений', 1)
    const wrapper = mount(InspectorSummary, {
      props: { item, writable: true },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages })] },
    })
    const doneField = wrapper.get('textarea[aria-label="Что сделано"]')
    const nextField = wrapper.get('textarea[aria-label="Что дальше"]')
    await doneField.setValue('Локальное описание результата, которое ещё не сохранено')
    await nextField.setValue('Проверить все связанные задачи и сохранить изменения')
    await wrapper.setProps({
      item: {
        ...item,
        revision: 2,
        summary: {
          done: 'Изменено другим участником',
          next: 'Другая следующая задача',
          why: '',
        },
      },
    })
    expect((doneField.element as HTMLTextAreaElement).value).toBe(
      'Локальное описание результата, которое ещё не сохранено',
    )
    expect((nextField.element as HTMLTextAreaElement).value).toBe(
      'Проверить все связанные задачи и сохранить изменения',
    )
    wrapper.unmount()
  })

  it('refreshes pristine fields and reseeds when the item identity changes', async () => {
    const item = record('First', 1)
    const wrapper = mount(InspectorSummary, {
      props: { item, writable: true },
      global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
    })
    await wrapper.setProps({
      item: {
        ...item,
        summary: {
          done: 'Remote result',
          next: 'Remote next',
          why: '',
        },
      },
    })
    expect(
      wrapper.findAll('textarea').map((field) => (field.element as HTMLTextAreaElement).value),
    ).toEqual(['Remote result', 'Remote next', ''])
    await wrapper.get('textarea').setValue('Local draft')
    await wrapper.setProps({ item: { ...record('Second', 1), work_item_id: 'second' } })
    expect(
      wrapper.findAll('textarea').map((field) => (field.element as HTMLTextAreaElement).value),
    ).toEqual(['', '', ''])
    wrapper.unmount()
  })
})

describe('inspector relations hierarchy', () => {
  it('names work and evidence independently and validates a link before emitting', async () => {
    const wrapper = mount(InspectorRelations, {
      props: { item: record('Связанная работа', 1), writable: true },
      global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages })] },
    })
    expect(wrapper.findAll('h3').map((heading) => heading.text())).toEqual([
      'Связанная работа',
      'Свидетельства',
    ])
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input').setValue('qa-321')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('link')).toEqual([[{ kind: 'blocks', other: 'QA-321' }]])
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
