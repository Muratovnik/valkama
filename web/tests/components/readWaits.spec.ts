/**
 * Every read wait outside the panel follows the panel's rule: a read that answers inside
 * the delay shows nothing, and one that outlasts it shows the panel's word for at least the
 * minimum, with what it read held back meanwhile. Each surface below said its own words
 * from the first frame and dropped them the moment its read answered.
 *
 * A view or a dialog announces its wait once, by writing the word into a status region
 * that stood empty before; a block inside a view (a section of a card) announces nothing
 * of its own and says its wait by its busy mark and its word on screen.
 */
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

import InspectorChain from '@/widgets/work-item-inspector/components/InspectorChain.vue'
import InspectorCommitPeek from '@/widgets/work-item-inspector/components/InspectorCommitPeek.vue'
import InspectorExecution from '@/widgets/work-item-inspector/components/InspectorExecution.vue'

import GlobalWorkFinder from '@/features/global-find/GlobalWorkFinder.vue'
import RequestList from '@/features/input-requests/components/RequestList.vue'

import { fetchCommit } from '@/shared/api/api.ts'
import type { InputRequestList } from '@/shared/api/inputRequestModel.ts'
import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { GlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { boardItem, boardWorkflow } from '../fixtures/board.ts'
import { largeGoalChain } from '../fixtures/chain.ts'
import { finderResponse } from '../support/globalFinder.ts'

vi.mock('@/shared/api/api.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/api.ts')>()),
  fetchCommit: vi.fn(),
}))
vi.mock('@/shared/api/planningGlobalSearchApi.ts', () => ({
  searchGlobalPlanningWorkItems: vi.fn(),
}))
vi.mock('@/pages/planning/utils/graphView.ts', () => {
  const component = defineComponent({ setup: () => () => h('div', { class: 'graph-double' }) })
  return {
    graphView: { component, ready: shallowRef(true), load: async () => component, prefetch() {} },
  }
})

const WORD = messages.en.platform.states.loading
const i18n = () => createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

/** A read the test answers when it chooses. */
function held<T>() {
  const answer: { settle: (value: T) => void } = { settle: () => {} }
  const promise = new Promise<T>((resolve) => {
    answer.settle = resolve
  })
  return { promise, answer }
}

/** What one surface is: how to start its wait, how its read answers, and what it shows. */
interface Surface {
  name: string
  /**
   * Where a view announces its wait; null for a block inside a view, which shows its wait
   * by `busy` instead and announces nothing of its own.
   */
  region: ((wrapper: VueWrapper) => Element | undefined) | null
  /** The read answers. */
  answer: () => Promise<void>
  /** The block that is busy while it reads, for a block inside a view. */
  busy?: (wrapper: VueWrapper) => Element | undefined
  /** Whether what the read found is on screen. */
  content: (wrapper: VueWrapper) => boolean
  /** Mount it with its read under way. */
  start: () => Promise<VueWrapper>
  /** The line its wait's word is shown in. */
  word: (wrapper: VueWrapper) => string
}

const chain = largeGoalChain()
/** The surface under test, and how its held read answers. */
let current: VueWrapper | undefined
let answerRead: () => void = () => {}

const text = (element: Element | undefined) => (element?.textContent ?? '').trim()
/** The element a selector finds, or nothing where there is none. */
const at = (wrapper: VueWrapper, selector: string) => wrapper.findAll(selector)[0]?.element

function workspace(props: Record<string, unknown>) {
  const model: PlanningReadModel = {
    interface_version: 'valkama-planning-read-model',
    planning_spaces: [],
    planning_space: null,
    workflow: boardWorkflow,
    work_items: [boardItem(10, 'backlog')],
    links: [],
    stale_claims: [],
  }
  return mount(PlanningWorkspace, {
    attachTo: document.body,
    props: {
      model,
      routeState: undefined,
      stale: false,
      stateBytes: 2048,
      version: 1,
      viewPlace: 'scope:MAIN',
      view: 'kanban' as const,
      writable: true,
      ...props,
    },
    global: { plugins: [i18n()] },
  })
}

const surfaces: Surface[] = [
  {
    name: 'the chain section of a card',
    start: async () =>
      mount(InspectorChain, {
        props: {
          chain: null,
          open: true,
          container_state: null,
          acceptance: null,
          started_at: null,
          waits_for: [],
          failed: false,
          loading: true,
          readable: true,
          scope: 'chain',
          space: '',
        },
        global: { plugins: [i18n()] },
      }),
    answer: async () => {
      await current?.setProps({ chain, loading: false })
    },
    region: null,
    busy: (wrapper) => at(wrapper, 'section.chain'),
    word: (wrapper) => text(at(wrapper, '.chain-quiet')),
    content: (wrapper) => wrapper.find('.chain-body').exists(),
  },
  {
    name: 'the attempts of a card',
    start: async () =>
      mount(InspectorExecution, {
        props: { busy: false, error: '', executions: [], loading: true, writable: false },
        global: { plugins: [i18n()] },
      }),
    answer: async () => {
      await current?.setProps({ loading: false })
    },
    region: null,
    busy: (wrapper) => at(wrapper, 'section.executions'),
    word: (wrapper) => text(at(wrapper, 'section.executions > p.quiet')),
    content: (wrapper) => wrapper.text().includes(messages.en.execution.none),
  },
  {
    name: 'an attached commit looked up from a card',
    start: async () => {
      const read = held<ResolvedRef>()
      vi.mocked(fetchCommit).mockReturnValueOnce(read.promise)
      answerRead = () =>
        read.answer.settle({ kind: 'commit', value: 'abc1234', resolved: true, detail: 'feat' })
      return mount(InspectorCommitPeek, {
        props: {
          commit: {
            repository: 'alpha',
            display_name: 'Alpha',
            hash: 'abc1234',
            subject: 'feat',
            committed_at: null,
            session: '',
            agent: '',
            attached_by: 'server',
            label: '',
          },
        },
        global: { plugins: [i18n()], stubs: { teleport: true } },
      })
    },
    answer: async () => {
      answerRead()
      await flushPromises()
    },
    region: (wrapper) => at(wrapper, '.peek-finding[role="status"]'),
    word: (wrapper) => text(at(wrapper, '.peek-finding')),
    content: (wrapper) => wrapper.find('.peek-detail').exists(),
  },
  {
    name: 'the search across every project',
    start: async () => {
      const read = held<GlobalPlanningSearch>()
      vi.mocked(searchGlobalPlanningWorkItems).mockReturnValueOnce(read.promise)
      answerRead = () => read.answer.settle(finderResponse('needle'))
      const wrapper = mount(GlobalWorkFinder, {
        props: { open: true },
        attachTo: document.body,
        global: { plugins: [i18n()], stubs: { teleport: true } },
      })
      // The wait counts from the keystroke, the pause before the request included.
      await wrapper.get('[role="combobox"]').setValue('needle')
      return wrapper
    },
    answer: async () => {
      answerRead()
      await flushPromises()
    },
    region: (wrapper) => at(wrapper, '.finder-feedback[role="status"]'),
    word: (wrapper) => text(at(wrapper, '.finder-feedback')),
    content: (wrapper) => wrapper.find('[role="option"]').exists(),
  },
  {
    name: 'the questions waiting on a person',
    start: async () =>
      mount(RequestList, {
        props: {
          answered: [],
          drafts: {},
          entries: [],
          failed: false,
          loading: true,
          partial: false,
          result: null,
          waiting: new Set<string>(),
        },
        global: { plugins: [i18n()] },
      }),
    answer: async () => {
      const result = {
        interface_version: 'valkama-input-requests',
        items: [],
        has_more: false,
        coverage: [],
      } as unknown as InputRequestList
      await current?.setProps({ loading: false, result })
    },
    region: (wrapper) => at(wrapper, '.request-status[role="status"]'),
    word: (wrapper) => text(at(wrapper, '.request-status')),
    content: (wrapper) => wrapper.text().includes(messages.en.requests.empty),
  },
  {
    name: 'a chain the board’s address names',
    start: async () => workspace({ chainPending: true }),
    answer: async () => {
      await current?.setProps({ chainPending: false })
    },
    region: (wrapper) => at(wrapper, '.workspace-stage > [role="status"]'),
    word: (wrapper) => text(at(wrapper, '.workspace-stage .platform-state-title')),
    content: (wrapper) => wrapper.find('.work-item-board').exists(),
  },
]

/** The surface waits, and says nothing of it yet. */
function expectWaitingQuietly(surface: Surface, wrapper: VueWrapper) {
  expect(surface.word(wrapper)).toBe('')
  if (surface.region) {
    // The region the wait would be announced in stands from the start, and empty.
    expect(surface.region(wrapper)).toBeDefined()
    expect(text(surface.region(wrapper))).toBe('')
    return
  }
  expect(surface.busy?.(wrapper)?.getAttribute('aria-busy')).toBe('true')
  expect(surface.busy?.(wrapper)?.querySelector('[role="status"]')).toBeNull()
}

describe.each(surfaces)('$name', (surface) => {
  it('shows nothing for a read that answers inside the delay, and goes straight to it', async () => {
    const wrapper = await surface.start()
    current = wrapper
    expectWaitingQuietly(surface, wrapper)
    expect(surface.content(wrapper)).toBe(false)
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS - 1)
    expectWaitingQuietly(surface, wrapper)
    await surface.answer()
    expect(surface.content(wrapper)).toBe(true)
    expect(wrapper.text()).not.toContain(WORD)
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS + LOADING_MIN_SHOWN_MS)
    expect(wrapper.text()).not.toContain(WORD)
    expect(surface.content(wrapper)).toBe(true)
    wrapper.unmount()
  })

  it('shows the panel’s word once the wait has lasted, and keeps it for the minimum', async () => {
    const wrapper = await surface.start()
    current = wrapper
    const region = surface.region?.(wrapper)
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS)
    expect(surface.word(wrapper)).toBe(WORD)
    if (surface.region) {
      // Written into the region that stood empty, so it is announced, and announced once.
      expect(surface.region(wrapper)).toBe(region)
      expect(text(region)).toBe(WORD)
    } else expect(surface.busy?.(wrapper)?.querySelector('[role="status"]')).toBeNull()
    await surface.answer()
    expect(surface.word(wrapper)).toBe(WORD)
    expect(surface.content(wrapper)).toBe(false)
    await vi.advanceTimersByTimeAsync(LOADING_MIN_SHOWN_MS - 1)
    expect(surface.word(wrapper)).toBe(WORD)
    expect(surface.content(wrapper)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.text()).not.toContain(WORD)
    expect(surface.content(wrapper)).toBe(true)
    wrapper.unmount()
  })
})

describe('a read the board starts again over what it drew', () => {
  it('is announced in the status region that stood beside the board before it', async () => {
    const wrapper = workspace({})
    const region = wrapper.get('.workspace-stage > [role="status"]').element
    expect(text(region)).toBe('')
    await wrapper.setProps({ reading: true })
    expect(wrapper.get('.workspace-stage > [role="status"]').element).toBe(region)
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS - 1)
    expect(text(region)).toBe('')
    await vi.advanceTimersByTimeAsync(1)
    expect(text(region)).toBe(WORD)
    await wrapper.setProps({ reading: false })
    await vi.advanceTimersByTimeAsync(LOADING_MIN_SHOWN_MS)
    expect(wrapper.get('.workspace-stage > [role="status"]').element).toBe(region)
    expect(text(region)).toBe('')
    expect(wrapper.find('.work-item-board').exists()).toBe(true)
    wrapper.unmount()
  })
})
