/**
 * The inspector mounted for its own writes, with only `fetch` as a double.
 *
 * Shared by the specs that drive the inspector's writes and its drafts. Each
 * spec still declares its own `vi.mock` of the planning and execution clients,
 * because vitest hoists a mock per test file; this module only uses them.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, vi } from 'vitest'

import WorkItemInspector from '@/widgets/work-item-inspector/components/WorkItemInspector.vue'
import type { InspectorReturn } from '@/widgets/work-item-inspector/utils/inspectorReturn.ts'

import { fetchExecutionHistory } from '@/shared/api/executionApi.ts'
import { fetchWorkItem } from '@/shared/api/planningApi.ts'
import type { PlanningWorkflow, WorkItem } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { inspectorResourceRef as resourceRef } from '../fixtures/workItem.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from './request.ts'

export const DONE = {
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
export function serveWrites(answers: Record<string, (body: Record<string, unknown>) => Response>) {
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

export const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const choiceStub = {
  name: 'ChoiceSelect',
  props: ['modelValue', 'options', 'disabled', 'label', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<span class="state-choice-stub">{{ modelValue }}</span>',
}
export const drawerFrameStub = {
  name: 'DrawerFrame',
  emits: ['close'],
  template:
    '<div><slot name="identity" /><slot name="controls" /><slot name="facts" /><slot name="notices" /><slot name="tabs" /><slot /></div>',
  methods: {
    holdFocus() {},
    position: () => 0,
    restore() {},
    scrollToContent() {},
  },
}

export function mountInspector(
  item: WorkItem,
  overrides: { returnTo?: InspectorReturn; writable?: boolean } = {},
) {
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
      ...overrides,
    },
    global: {
      plugins: [
        createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages, pluralRules }),
      ],
      stubs: {
        ChoiceSelect: choiceStub,
        DrawerFrame: drawerFrameStub,
        InspectorExecution: true,
        InspectorMemory: true,
        LaunchDialog: true,
        ResizableInspector: { template: '<div><slot /></div>' },
        VIcon: true,
      },
    },
  })
}

export async function choose(wrapper: VueWrapper, stateKey: string) {
  wrapper.getComponent(choiceStub).vm.$emit('update:modelValue', stateKey)
  await flushPromises()
}

/** Fresh client doubles before each test, and no page or global left after it. */
export function useInspectorHarness() {
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
}
