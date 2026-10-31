/**
 * The chain every view is scoped to lives in the route: which keys name it, what
 * the module's manifest admits, and how the held answer follows the route.
 */
import assert from 'node:assert/strict'

import { effectScope, nextTick, ref } from 'vue'

import { afterEach, beforeEach, test, vi } from 'vitest'

import {
  chainTarget,
  groupingOf,
  usePlanningChainScope,
  withChain,
  withGrouping,
} from '@/pages/planning/composables/usePlanningChainScope.ts'
import type {
  ChainRefusal,
  ChainTarget,
} from '@/pages/planning/composables/usePlanningChainScope.ts'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import { validateManifestRouteState } from '@/shared/api/platformRoute.ts'

import { emptyChain } from './fixtures/chain.ts'

vi.mock('@/shared/api/planningChainApi.ts', () => ({ fetchWorkItemChain: vi.fn() }))
const fetchChain = vi.mocked(fetchWorkItemChain)

const planning = OFFLINE_MODULE_FALLBACK.find((manifest) => manifest.module_id === 'planning')

test('the planning manifest admits the chain and grouping keys and still refuses a key it never declared', () => {
  assert.ok(planning)
  const state = { view: 'kanban', chain: 'MAIN-12', chain_scope: 'epic', group: 'epic' }
  assert.deepEqual(validateManifestRouteState(planning, state), state)
  assert.throws(
    () => validateManifestRouteState(planning, { ...state, chain_closed: true }),
    /unknown module-local state key/u,
  )
})

test('a chain is read out of every view, with the endpoint default for its scope', () => {
  assert.deepEqual(chainTarget({ view: 'graph', chain: 'VAL-12', chain_scope: 'epic' }), {
    status: 'chain',
    reference: 'VAL-12',
    scope: 'epic',
  })
  assert.deepEqual(chainTarget({ view: 'graph', chain: 'VAL-12' }), {
    status: 'chain',
    reference: 'VAL-12',
    scope: 'chain',
  })
  // The board and the list are narrowed by the same keys; it used to be the graph alone.
  for (const view of ['kanban', 'list'])
    assert.deepEqual(chainTarget({ view, chain: 'MAIN-12' }), {
      status: 'chain',
      reference: 'MAIN-12',
      scope: 'chain',
    })
  assert.deepEqual(chainTarget({ view: 'graph' }), { status: 'none' })
  assert.deepEqual(chainTarget(undefined), { status: 'none' })
})

test('a value the endpoint could never answer is invalid rather than sent', () => {
  for (const state of [
    { view: 'graph', chain: 'not a reference' },
    { view: 'graph', chain: 'val-384' },
    { view: 'graph', chain: 384 },
    { view: 'graph', chain: 'VAL-12', chain_scope: 'space' },
    { view: 'graph', chain_scope: 'epic' },
  ])
    assert.equal(chainTarget(state).status, 'invalid', JSON.stringify(state))
})

test('the grouping key names only an epic grouping, and leaves the address without it otherwise', () => {
  assert.equal(groupingOf({ view: 'kanban', group: 'epic' }), 'epic')
  for (const state of [{ view: 'kanban' }, { group: 'parent' }, { group: true }, undefined])
    assert.equal(groupingOf(state), 'none', JSON.stringify(state))
  const grouped = withGrouping({ view: 'kanban', chain: 'MAIN-12' }, 'epic')
  assert.deepEqual(grouped, { view: 'kanban', chain: 'MAIN-12', group: 'epic' })
  assert.deepEqual(withGrouping(grouped, 'none'), { view: 'kanban', chain: 'MAIN-12' })
})

test('withChain writes both keys and removes both, leaving every other key alone', () => {
  const named = withChain({ view: 'graph', query: 'x' }, { reference: 'VAL-12', scope: 'chain' })
  assert.deepEqual(named, { view: 'graph', query: 'x', chain: 'VAL-12', chain_scope: 'chain' })
  assert.deepEqual(withChain(named, null), { view: 'graph', query: 'x' })
  assert.deepEqual(withChain(undefined, null), {})
})

/** The root id every chain here shares, which is what the space holds. */
const ROOT = emptyChain().root.work_item_id

function chainOf(reference: string, scope: 'chain' | 'epic' = 'chain'): WorkItemChain {
  return { ...emptyChain(reference), scope } as WorkItemChain
}

/**
 * The composable under a route the test moves, with every refusal recorded. The
 * space is the primary store unless `primary` says it is an attached one.
 */
function harness(initial: ChainTarget, items = [{ work_item_id: ROOT }], primary = true) {
  const target = ref<ChainTarget>(initial)
  const version = ref(0)
  const refusals: [string, ChainRefusal][] = []
  const scope = effectScope()
  const held = scope.run(() =>
    usePlanningChainScope({
      target: () => target.value,
      space: () => 'space-1',
      primary: () => primary,
      spaceItems: () => items,
      version: () => version.value,
      refused: (reference, cause) => refusals.push([reference, cause]),
    }),
  )
  assert.ok(held)
  return { held, refusals, scope, target, version }
}

async function settled() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

let active: { stop: () => void } | undefined
beforeEach(() => {
  fetchChain.mockReset()
})
afterEach(() => {
  active?.stop()
})

test('entering from the card holds its answer, so the route that follows costs no read', async () => {
  const run = harness({ status: 'none' })
  active = run.scope
  const chain = chainOf('VAL-12')
  run.held.enter(chain)
  run.target.value = { status: 'chain', reference: 'VAL-12', scope: 'chain' }
  await settled()
  assert.equal(fetchChain.mock.calls.length, 0)
  assert.equal(run.held.scoped.value, chain)
})

test('a route opened cold reads the chain it names, and leaving drops it', async () => {
  const chain = chainOf('VAL-12', 'epic')
  fetchChain.mockResolvedValue(chain)
  const run = harness({ status: 'chain', reference: 'VAL-12', scope: 'epic' })
  active = run.scope
  assert.equal(run.held.pending.value, true)
  await settled()
  assert.deepEqual(fetchChain.mock.calls[0].slice(0, 2), ['VAL-12', 'epic'])
  assert.equal(run.held.scoped.value, chain)
  assert.equal(run.held.pending.value, false)

  run.target.value = { status: 'none' }
  await settled()
  assert.equal(run.held.scoped.value, null)
  // Leaving let the answer go, so naming the same chain again reads it again
  // instead of drawing one nothing kept current while the route was elsewhere.
  run.target.value = { status: 'chain', reference: 'VAL-12', scope: 'epic' }
  await settled()
  assert.equal(fetchChain.mock.calls.length, 2)
  assert.equal(run.held.scoped.value, chain)
})

test('a first read that fails is refused with its cause and draws no chain', async () => {
  fetchChain.mockRejectedValue(new Error('no work item VAL-9999'))
  const run = harness({ status: 'chain', reference: 'VAL-9999', scope: 'chain' })
  active = run.scope
  await settled()
  assert.deepEqual(run.refusals, [
    ['VAL-9999', { kind: 'failed', message: 'no work item VAL-9999' }],
  ])
  assert.equal(run.held.scoped.value, null)
  assert.equal(run.held.pending.value, false)
})

test('a malformed link is refused without a request', async () => {
  const run = harness({ status: 'invalid', reference: 'nonsense' })
  active = run.scope
  await settled()
  assert.equal(fetchChain.mock.calls.length, 0)
  assert.deepEqual(run.refusals, [['nonsense', { kind: 'invalid' }]])
})

test('a re-read that fails keeps the chain drawn and refuses nothing', async () => {
  const chain = chainOf('VAL-12')
  fetchChain.mockResolvedValueOnce(chain).mockRejectedValueOnce(new Error('offline'))
  const run = harness({ status: 'chain', reference: 'VAL-12', scope: 'chain' })
  active = run.scope
  await settled()
  run.version.value += 1
  await settled()
  assert.equal(fetchChain.mock.calls.length, 2)
  assert.equal(run.held.scoped.value, chain)
  assert.deepEqual(run.refusals, [])
})

test('a different chain in the route replaces the held one rather than keeping it', async () => {
  const first = chainOf('VAL-12')
  const second = chainOf('VAL-500')
  const answers: ((chain: WorkItemChain) => void)[] = []
  fetchChain
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(new Promise((resolve) => answers.push(resolve)))
  const run = harness({ status: 'chain', reference: 'VAL-12', scope: 'chain' })
  active = run.scope
  await settled()
  assert.equal(run.held.scoped.value, first)
  run.target.value = { status: 'chain', reference: 'VAL-500', scope: 'chain' }
  await settled()
  // The old chain is not drawn while the new one is read.
  assert.equal(run.held.scoped.value, null)
  assert.equal(run.held.pending.value, true)
  answers[0](second)
  await settled()
  assert.equal(run.held.scoped.value, second)
})

test('a chain whose root is not in this space is refused rather than drawn empty', async () => {
  fetchChain.mockResolvedValue(chainOf('OTHER-7'))
  const run = harness({ status: 'chain', reference: 'OTHER-7', scope: 'chain' }, [
    { work_item_id: '00000000-0000-4000-8000-000000000001' },
  ])
  active = run.scope
  await settled()
  assert.deepEqual(run.refusals, [['OTHER-7', { kind: 'elsewhere' }]])
  assert.equal(run.held.scoped.value, null)
})

test('a held chain is not drawn once the route stops naming it', () => {
  const run = harness({ status: 'none' })
  active = run.scope
  run.held.enter(chainOf('VAL-12'))
  // Entered, but the route has not moved: the field is still the whole space.
  assert.equal(run.held.scoped.value, null)
})

test('a held chain is not drawn for another chain the route names, before the route is followed', () => {
  fetchChain.mockReturnValue(new Promise(() => {}))
  for (const next of [
    { status: 'chain', reference: 'VAL-500', scope: 'chain' },
    { status: 'chain', reference: 'VAL-12', scope: 'epic' },
  ] as const) {
    const run = harness({ status: 'none' })
    run.held.enter(chainOf('VAL-12'))
    run.target.value = next
    // Read in the same tick, before the watcher has dropped the held answer:
    // it answers VAL-12 as a chain, which is not what the route now names.
    assert.equal(run.held.scoped.value, null, JSON.stringify(next))
    run.scope.stop()
  }
})

test('a chain named in an attached store is refused as primary-only, with no request', async () => {
  const run = harness({ status: 'chain', reference: 'VAL-12', scope: 'chain' }, undefined, false)
  active = run.scope
  await settled()
  // The chain endpoint reads the primary store alone, as the card says.
  assert.equal(fetchChain.mock.calls.length, 0)
  assert.deepEqual(run.refusals, [['VAL-12', { kind: 'primary' }]])
  assert.equal(run.held.scoped.value, null)
  assert.equal(run.held.pending.value, false)
})
