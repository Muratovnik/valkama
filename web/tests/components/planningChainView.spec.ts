/**
 * The Planning surface's half of a chain: what the operator is told when the
 * chain the address names cannot be read, and the card closing once «Show on
 * graph» has put that chain in the address.
 */
import { defineComponent, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePlanningChainView } from '@/pages/planning/composables/usePlanningChainView.ts'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { emptyChain } from '../fixtures/chain.ts'

vi.mock('@/shared/api/planningChainApi.ts', () => ({ fetchWorkItemChain: vi.fn() }))
const fetchChain = vi.mocked(fetchWorkItemChain)

type State = Record<string, string | number | boolean>

const renderNothing = () => h('div')

/** The composable in a component, with a route the test moves and the surface's writes recorded. */
function surface(initial: State, locale: 'en' | 'ru' = 'ru', open: string | null = null) {
  const state = ref<State>(initial)
  const written: State[] = []
  const notices: string[] = []
  const close = vi.fn()
  let view!: ReturnType<typeof usePlanningChainView>
  const Host = defineComponent({
    setup() {
      view = usePlanningChainView({
        state: () => state.value,
        open: () => open,
        close,
        space: () => 'space-1',
        primary: () => true,
        spaceItems: () => [{ work_item_id: emptyChain().root.work_item_id }],
        version: () => 0,
        notice: (message) => notices.push(message),
        write: (next) => written.push(next),
      })
      return {}
    },
    render: renderNothing,
  })
  const wrapper = mount(Host, {
    global: {
      plugins: [createI18n({ legacy: false, locale, fallbackLocale: 'en', messages, pluralRules })],
    },
  })
  return { close, notices, state, view: () => view, wrapper, written }
}

function refusal(code: string, status: number | null, message: string) {
  return Object.assign(new Error(message), { code, status })
}

beforeEach(() => {
  fetchChain.mockReset()
})

describe('a chain the address names that cannot be read', () => {
  it.each([
    [
      'no item answers to the reference',
      refusal('not_found', 404, 'no work item MAIN-9999'),
      'Не удалось открыть цепочку MAIN-9999: такой задачи нет. Показано всё пространство.',
      false,
    ],
    [
      // The code decides, not the words: a refusal that reads like a missing item is not one.
      'the request was refused for another reason',
      refusal('invalid_request', 400, 'no work item MAIN-9999'),
      'Не удалось открыть цепочку MAIN-9999: сервер ответил ошибкой. Показано всё пространство.',
      true,
    ],
    [
      'the server failed',
      refusal('request_failed', 500, 'HTTP 500'),
      'Не удалось открыть цепочку MAIN-9999: сервер ответил ошибкой. Показано всё пространство.',
      true,
    ],
    [
      'the server could not be reached',
      new TypeError('Failed to fetch'),
      'Не удалось открыть цепочку MAIN-9999: сервер не отвечает. Показано всё пространство.',
      true,
    ],
    [
      'the answer broke the contract',
      refusal('contract_invalid', null, 'planning.chain.total: expected number'),
      'Не удалось открыть цепочку MAIN-9999: сервер ответил ошибкой. Показано всё пространство.',
      true,
    ],
  ])('is said in Russian by its cause when %s', async (_cause, error, sentence, retryable) => {
    fetchChain.mockRejectedValue(error)
    const run = surface({ view: 'graph', chain: 'MAIN-9999', chain_scope: 'chain' })
    await flushPromises()
    expect(run.view().failure.value).toEqual({ message: sentence, retryable })
    // No server text in the sentence, nothing written over the address, no toast.
    expect(sentence.replace('MAIN-9999', '')).not.toMatch(/[A-Za-z]/u)
    expect(run.written).toEqual([])
    expect(run.notices).toEqual([])
    run.wrapper.unmount()
  })

  it('is read again on «Повторить», and drawn once the read succeeds', async () => {
    fetchChain
      .mockRejectedValueOnce(refusal('request_failed', 500, 'HTTP 500'))
      .mockResolvedValueOnce(emptyChain('MAIN-264') as WorkItemChain)
    const run = surface({ view: 'graph', chain: 'MAIN-264', chain_scope: 'chain' })
    await flushPromises()
    expect(run.view().failure.value?.retryable).toBe(true)
    run.view().retry()
    expect(run.view().pending.value).toBe(true)
    await flushPromises()
    expect(run.view().failure.value).toBeNull()
    expect(run.view().chain.value?.root.reference).toBe('MAIN-264')
    run.wrapper.unmount()
  })

  it('names a chain whose root is in another space in one sentence, and leaves it', async () => {
    fetchChain.mockResolvedValue({
      ...emptyChain('OTHER-7'),
      root: { ...emptyChain('OTHER-7').root, work_item_id: '00000000-0000-4000-8000-00000000ffff' },
    } as WorkItemChain)
    const run = surface({ view: 'graph', chain: 'OTHER-7', chain_scope: 'chain' }, 'en')
    await flushPromises()
    expect(run.notices).toEqual([
      'Work item OTHER-7 is not in this space. The whole space is shown.',
    ])
    expect(run.written).toEqual([{ view: 'graph' }])
    run.wrapper.unmount()
  })
})

describe('«Show on graph»', () => {
  it('names the chain beside the graph view, and closes the card once the address has it', async () => {
    const run = surface({ view: 'kanban', group: 'epic' }, 'ru', 'MAIN-264')
    const chain = emptyChain('MAIN-264') as WorkItemChain
    run.view().show(chain)
    const named = { view: 'graph', group: 'epic', chain: 'MAIN-264', chain_scope: 'chain' }
    expect(run.written).toEqual([named])
    // Not in the same tick: the route has not moved yet, and closing now would
    // write the old state back over the chain.
    expect(run.close).not.toHaveBeenCalled()
    run.state.value = named
    await nextTick()
    expect(run.close).toHaveBeenCalledTimes(1)
    // Only that once: a later move of the route leaves the card alone.
    run.state.value = { ...named, closed: true }
    await nextTick()
    expect(run.close).toHaveBeenCalledTimes(1)
    run.wrapper.unmount()
  })

  it('closes nothing when the next route is not that chain', async () => {
    const run = surface({ view: 'kanban' }, 'ru', 'MAIN-264')
    run.view().show(emptyChain('MAIN-264') as WorkItemChain)
    run.state.value = { view: 'list' }
    await nextTick()
    run.state.value = { view: 'graph', chain: 'MAIN-264', chain_scope: 'chain' }
    await nextTick()
    expect(run.close).not.toHaveBeenCalled()
    run.wrapper.unmount()
  })
})
