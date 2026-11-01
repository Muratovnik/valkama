/**
 * The Work filter: which items it lets through, how a click changes it, and
 * how it survives the trip through the route's `state`.
 */
import assert from 'node:assert/strict'

import { fc, test } from '@fast-check/vitest'
import { describe } from 'vitest'

import {
  addToken,
  filterTokens,
  hasToken,
  isWorkFilterEmpty,
  matchesWorkFilter,
  presetActive,
  readWorkFilter,
  removeToken,
  ROUTE_STATE_VALUE_CHARS,
  togglePreset,
  toggleToken,
  WORK_FILTER_PRESETS,
  WORK_FILTER_STATE_KEYS,
  writeWorkFilter,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterPreset } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import {
  parsePlatformRoute,
  serializePlatformRoute,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'

import { boardItem } from './fixtures/board.ts'

fc.configureGlobal({ seed: 0x46_49_4c_54 })

const passing = (items: readonly WorkItemBrief[], filter: WorkFilter) =>
  items.filter((item) => matchesWorkFilter(item, filter)).map((item) => item.number)

describe('which items pass', () => {
  const items = [
    boardItem(1, 'backlog', {
      kind: 'bug',
      priority: 'high',
      labels: ['ui', 'board'],
      title: 'Tile head',
    }),
    boardItem(2, 'todo', { kind: 'improvement', priority: 'urgent', labels: ['ui'] }),
    boardItem(3, 'dev', {
      kind: 'bug',
      priority: 'low',
      labels: ['board'],
      claim_ref: 'claude (session 5937aa01-1234)',
      ready: false,
    }),
    boardItem(4, 'done', { kind: 'task', priority: 'high', claim_ref: 'codex', ready: false }),
  ]

  test('an empty filter lets everything through', () => {
    assert.deepEqual(passing(items, { text: '' }), [1, 2, 3, 4])
    assert.equal(isWorkFilterEmpty({ text: '  ' }), true)
    assert.equal(isWorkFilterEmpty({ text: '', kind: ['bug'] }), false)
  })

  test('any value of one facet will do', () => {
    assert.deepEqual(passing(items, { text: '', kind: ['bug', 'improvement'] }), [1, 2, 3])
    assert.deepEqual(passing(items, { text: '', priority: ['urgent', 'low'] }), [2, 3])
    assert.deepEqual(passing(items, { text: '', category: ['active', 'completed'] }), [3, 4])
  })

  test('every facet present must hold', () => {
    assert.deepEqual(passing(items, { text: '', kind: ['bug'], priority: ['high'] }), [1])
    assert.deepEqual(passing(items, { text: '', kind: ['bug'], category: ['active'] }), [3])
  })

  test('each label picked narrows further', () => {
    assert.deepEqual(passing(items, { text: '', labels: ['ui'] }), [1, 2])
    assert.deepEqual(passing(items, { text: '', labels: ['ui', 'board'] }), [1])
  })

  test('the text matches the reference or the title, in any case', () => {
    assert.deepEqual(passing(items, { text: ' main-2 ' }), [2])
    assert.deepEqual(passing(items, { text: 'TILE' }), [1])
  })

  test('workable is the server’s answer; held means held and still open', () => {
    assert.deepEqual(passing(items, { text: '', ready: true }), [1, 2])
    assert.deepEqual(passing(items, { text: '', held: true }), [3])
  })

  test('a holder is the client’s name, whichever session of it holds the item', () => {
    assert.deepEqual(passing(items, { text: '', holder: ['claude'] }), [3])
    assert.deepEqual(passing(items, { text: '', holder: ['claude', 'codex'] }), [3, 4])
  })
})

describe('changing the filter', () => {
  test('a click adds a token and a second click takes it out again', () => {
    const label = { facet: 'labels', value: 'ui' } as const
    const once = toggleToken({ text: 'x' }, label)
    assert.deepEqual(once, { text: 'x', labels: ['ui'] })
    assert.equal(hasToken(once, label), true)
    // An emptied facet goes away rather than staying as [], which would read as
    // "no label passes".
    assert.deepEqual(toggleToken(once, label), { text: 'x' })
  })

  test('the filter is never changed in place', () => {
    const before: WorkFilter = { text: '', kind: ['bug'] }
    addToken(before, { facet: 'kind', value: 'epic' })
    removeToken(before, { facet: 'kind', value: 'bug' })
    assert.deepEqual(before, { text: '', kind: ['bug'] })
  })

  test('tokens read out flags first, then each facet in a stable order', () => {
    const filter: WorkFilter = { text: 'q', labels: ['b'], ready: true, kind: ['bug'] }
    assert.deepEqual(filterTokens(filter), [
      { facet: 'ready' },
      { facet: 'kind', value: 'bug' },
      { facet: 'labels', value: 'b' },
    ])
  })

  test('the presets are the two queues no view shows by itself', () => {
    assert.deepEqual(
      WORK_FILTER_PRESETS.map((preset) => preset.id),
      ['ready', 'held'],
    )
    const [ready] = WORK_FILTER_PRESETS
    const on = togglePreset({ text: '' }, ready)
    assert.deepEqual(on, { text: '', ready: true })
    assert.equal(presetActive(on, ready), true)
    assert.deepEqual(togglePreset(on, ready), { text: '' })
  })

  test('offering blocked and review as presets as well is a change of data, not of the model', () => {
    const five: WorkFilterPreset[] = [
      ...WORK_FILTER_PRESETS,
      {
        id: 'blocked',
        label: 'workItem.category.blocked',
        tokens: [{ facet: 'category', value: 'blocked' }],
      },
      {
        id: 'review',
        label: 'workItem.category.review',
        tokens: [{ facet: 'category', value: 'review' }],
      },
    ]
    const both = togglePreset(togglePreset({ text: '' }, five[2]), five[3])
    assert.deepEqual(both, { text: '', category: ['blocked', 'review'] })
    assert.equal(presetActive(both, five[3]), true)
  })
})

/** A state as it comes back from a real URL: serialized, then parsed. */
const route = (state: Record<string, string | number | boolean>) =>
  parsePlatformRoute(
    serializePlatformRoute({ module_id: 'planning', scope: { kind: 'global' }, state }),
  ).state

/** Eight values of 28 characters, 26 of them three bytes wide. */
const wide = (prefix: string) =>
  Array.from({ length: 8 }, (_, index) => `${prefix}${index}${'看'.repeat(26)}`)

describe('the route state', () => {
  const MAX = 2048

  test('a filter written into the state reads back the same through a real route', () => {
    const filter: WorkFilter = {
      text: 'tile head',
      ready: true,
      held: true,
      category: ['review', 'blocked'],
      kind: ['bug'],
      priority: ['urgent', 'high'],
      labels: ['ui', 'agent-packets'],
      holder: ['claude'],
    }
    const { complete, state } = writeWorkFilter({ view: 'kanban', chain: 'MAIN-3' }, filter, MAX)
    assert.equal(complete, true)
    const read = route(state)
    assert.deepEqual(readWorkFilter(read), filter)
    // The other keys of the state are the view's and stay as they were.
    assert.equal(read?.view, 'kanban')
    assert.equal(read?.chain, 'MAIN-3')
  })

  test('an absent key is no filter, and an empty filter writes no key at all', () => {
    assert.deepEqual(readWorkFilter(undefined), { text: '' })
    const { state } = writeWorkFilter(
      { view: 'list', [WORK_FILTER_STATE_KEYS.labels]: 'stale' },
      { text: '' },
      MAX,
    )
    assert.deepEqual(state, { view: 'list' })
  })

  test('a label holding a comma or a percent sign stays one label', () => {
    const filter: WorkFilter = { text: '', labels: ['a,b', '100%', '%2C'] }
    const { state } = writeWorkFilter(undefined, filter, MAX)
    assert.deepEqual(readWorkFilter(route(state)).labels, ['a,b', '100%', '%2C'])
  })

  test.prop([
    fc.uniqueArray(fc.string({ minLength: 1, maxLength: 64 }), { maxLength: 6 }),
    fc.string({ maxLength: 40 }),
  ])('any labels and text the state can hold come back as they went in', (labels, text) => {
    const filter: WorkFilter = { text, ...(labels.length ? { labels } : {}) }
    const { complete, state } = writeWorkFilter(undefined, filter, 4096)
    if (!complete) return
    const read = readWorkFilter(route(state))
    assert.deepEqual(read.labels ?? [], labels)
    assert.equal(read.text, text.trim() ? text : '')
  })

  test('a value stays within 240 characters by keeping whole labels, and says it is not whole', () => {
    const labels = Array.from(
      { length: 20 },
      (_, index) => `label-${String(index).padStart(2, '0')}-xxxx`,
    )
    const { complete, state } = writeWorkFilter(undefined, { text: '', labels }, 4096)
    assert.equal(complete, false)
    const value = String(state[WORK_FILTER_STATE_KEYS.labels])
    assert.ok(value.length <= ROUTE_STATE_VALUE_CHARS, `${value.length} characters`)
    const read = readWorkFilter(route(state)).labels ?? []
    // Whole labels, from the start, as many as fit.
    assert.deepEqual(read, labels.slice(0, read.length))
    assert.equal(read.length, Math.floor((ROUTE_STATE_VALUE_CHARS + 1) / (labels[0].length + 1)))
  })

  test('text longer than a value can hold is cut, never refused by the route', () => {
    const { complete, state } = writeWorkFilter(undefined, { text: 'я'.repeat(300) }, 4096)
    assert.equal(complete, false)
    assert.equal(
      String(route(state)?.[WORK_FILTER_STATE_KEYS.text]).length,
      ROUTE_STATE_VALUE_CHARS,
    )
  })

  test('the whole state stays within the manifest’s bound, dropping the last labels first', () => {
    const planning = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'planning')
    assert.ok(planning)
    // The manifest must admit the filter's keys before the route carries them.
    const manifest = {
      ...planning,
      state_schema: {
        ...planning.state_schema,
        allowed_keys: [
          ...planning.state_schema.allowed_keys,
          ...Object.values(WORK_FILTER_STATE_KEYS),
        ],
      },
    }
    // Three-byte characters, so three values at their 240-character bound
    // outweigh the manifest's 2048 bytes together, which Latin text cannot.
    const filter: WorkFilter = {
      text: '看'.repeat(240),
      labels: wide('a'),
      holder: wide('h'),
      kind: ['bug', 'epic'],
    }
    const { complete, state } = writeWorkFilter(
      { view: 'kanban' },
      filter,
      manifest.state_schema.max_bytes,
    )
    assert.equal(complete, false)
    assert.doesNotThrow(() => validateManifestRouteState(manifest, state))
    const read = readWorkFilter(route(state))
    assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength <= 2048)
    // Each value fit on its own; together they did not, so whole labels went.
    assert.ok((read.labels?.length ?? 0) + (read.holder?.length ?? 0) < 16)
    // What was kept is a prefix of each list, and the short facets survive.
    assert.deepEqual(read.kind, ['bug', 'epic'])
    assert.deepEqual(read.labels, filter.labels?.slice(0, read.labels?.length ?? 0))
    assert.deepEqual(read.holder, filter.holder?.slice(0, read.holder?.length ?? 0))
    assert.equal(read.text, filter.text)
    // And the same filter always writes the same state.
    assert.deepEqual(
      writeWorkFilter({ view: 'kanban' }, filter, manifest.state_schema.max_bytes).state,
      state,
    )
  })

  test('a hand-edited state is read as no filter on that facet, not as a broken route', () => {
    const read = readWorkFilter({
      [WORK_FILTER_STATE_KEYS.kind]: 'bug,spaceship',
      [WORK_FILTER_STATE_KEYS.priority]: 7,
      [WORK_FILTER_STATE_KEYS.ready]: 'yes',
      [WORK_FILTER_STATE_KEYS.category]: ',,',
    })
    assert.deepEqual(read, { text: '', kind: ['bug'] })
  })
})
