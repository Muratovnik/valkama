/**
 * «Не равно»: a facet's value the work must not carry. Which items it keeps out,
 * how a chip switches it, and how it rides the address inside its facet's own key
 * without changing how any older link reads.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  addToken,
  filterTokens,
  hasToken,
  matchesWorkFilter,
  negateToken,
  readWorkFilter,
  removeToken,
  ROUTE_STATE_VALUE_CHARS,
  toggleToken,
  WORK_FILTER_STATE_KEYS,
  writeWorkFilter,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import {
  parsePlatformRoute,
  serializePlatformRoute,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'

import { boardItem } from './fixtures/board.ts'

const items = [
  boardItem(1, 'backlog', { kind: 'bug', priority: 'high', labels: ['ui', 'board'] }),
  boardItem(2, 'todo', { kind: 'improvement', priority: 'urgent', labels: ['ui'] }),
  boardItem(3, 'dev', {
    kind: 'bug',
    priority: 'low',
    labels: ['board'],
    claim_ref: 'claude (session 5937aa01-1234)',
  }),
  boardItem(4, 'done', { kind: 'task', priority: 'high', claim_ref: 'codex' }),
]

const passing = (filter: WorkFilter) =>
  items.filter((item) => matchesWorkFilter(item, filter)).map((item) => item.number)

/** A state as it comes back from a real URL: serialized, then parsed. */
const route = (state: Record<string, string | number | boolean>) =>
  parsePlatformRoute(
    serializePlatformRoute({ module_id: 'planning', scope: { kind: 'global' }, state }),
  ).state

describe('which items a negated value keeps out', () => {
  test('a value negated keeps out every item that carries it, in each facet', () => {
    assert.deepEqual(passing({ text: '', not: { kind: ['bug'] } }), [2, 4])
    assert.deepEqual(passing({ text: '', not: { priority: ['high', 'low'] } }), [2])
    assert.deepEqual(passing({ text: '', not: { category: ['backlog'] } }), [2, 3, 4])
    // An item that carries one of the labels named is out.
    assert.deepEqual(passing({ text: '', not: { labels: ['ui'] } }), [3, 4])
  })

  test('work nobody holds is not held by the holder named', () => {
    assert.deepEqual(passing({ text: '', not: { holder: ['claude'] } }), [1, 2, 4])
  })

  test('beside values of its own facet and of others, every one has to hold', () => {
    // Board, and not ui: the item with both labels is out.
    assert.deepEqual(passing({ text: '', labels: ['board'], not: { labels: ['ui'] } }), [3])
    // Any of the labels, still never ui.
    assert.deepEqual(
      passing({ text: '', labels: ['board', 'ui'], labelsMatch: 'any', not: { labels: ['ui'] } }),
      [3],
    )
    assert.deepEqual(passing({ text: '', kind: ['bug'], not: { priority: ['low'] } }), [1])
  })
})

describe('switching a value between is and is not', () => {
  const ui = { facet: 'labels', value: 'ui' } as const
  const notUi = { ...ui, not: true } as const

  test('the chip’s switch moves the value to the other list, at its end, and back', () => {
    const picked: WorkFilter = { text: '', labels: ['ui', 'board'], kind: ['bug'] }
    const negated = negateToken(picked, ui)
    assert.deepEqual(negated, {
      text: '',
      labels: ['board'],
      kind: ['bug'],
      not: { labels: ['ui'] },
    })
    assert.equal(hasToken(negated, notUi), true)
    assert.equal(hasToken(negated, ui), false)
    // The chips read each facet's values before those negated.
    assert.deepEqual(filterTokens(negated), [
      { facet: 'kind', value: 'bug' },
      { facet: 'labels', value: 'board' },
      { facet: 'labels', value: 'ui', not: true },
    ])
    // Back again: an emptied `not` is gone rather than left as {}.
    assert.deepEqual(negateToken(negated, notUi), {
      text: '',
      labels: ['board', 'ui'],
      kind: ['bug'],
    })
  })

  test('a mark or a menu value pressed takes the value out whichever way it was in', () => {
    const negated: WorkFilter = { text: '', not: { labels: ['ui'] } }
    assert.deepEqual(toggleToken(negated, ui), { text: '' })
    assert.deepEqual(toggleToken({ text: '' }, ui), { text: '', labels: ['ui'] })
  })

  test('an item cannot both be and not be a value: adding one way drops the other', () => {
    assert.deepEqual(addToken({ text: '', labels: ['ui'] }, notUi), {
      text: '',
      not: { labels: ['ui'] },
    })
    assert.deepEqual(removeToken({ text: '', labels: ['ui'], not: { labels: ['ui'] } }, notUi), {
      text: '',
      labels: ['ui'],
    })
  })
})

describe('a negated value in the address', () => {
  const MAX = 2048

  test('rides its facet’s own key and reads back the same through a real route', () => {
    const filter: WorkFilter = {
      text: '',
      category: ['review'],
      labels: ['ui'],
      labelsMatch: 'any',
      not: { kind: ['epic'], labels: ['agent', '%-odd,one'], holder: ['codex'] },
    }
    const { complete, state } = writeWorkFilter({ view: 'kanban' }, filter, MAX)
    assert.equal(complete, true)
    assert.equal(state[WORK_FILTER_STATE_KEYS.kind], '%-epic')
    assert.equal(state[WORK_FILTER_STATE_KEYS.labels], '%any,ui,%-agent,%-%25-odd%2Cone')
    assert.deepEqual(readWorkFilter(route(state)), filter)
  })

  test('a link made before values could be negated reads as it always did', () => {
    // The old writer spelled a label that starts like the mark with its `%` escaped.
    assert.deepEqual(readWorkFilter({ labels: 'ui,%25-agent' }), {
      text: '',
      labels: ['ui', '%-agent'],
    })
    assert.deepEqual(readWorkFilter({ kind: 'bug', pri: 'high' }), {
      text: '',
      kind: ['bug'],
      priority: ['high'],
    })
  })

  test('a hand-edited negated value is checked as any value is', () => {
    assert.deepEqual(readWorkFilter({ kind: '%-spaceship,%-bug,%-', labels: 'ui,%-ui' }), {
      text: '',
      labels: ['ui'],
      not: { kind: ['bug'] },
    })
  })

  test('the mark counts towards a value’s 240 characters, and the last negated value goes first', () => {
    const not = Array.from({ length: 20 }, (_, index) => `label-${index}-${'x'.repeat(12)}`)
    const { complete, state } = writeWorkFilter(
      undefined,
      { text: '', labels: ['ui'], not: { labels: not } },
      4096,
    )
    assert.equal(complete, false)
    const written = String(state[WORK_FILTER_STATE_KEYS.labels])
    assert.ok(written.length <= ROUTE_STATE_VALUE_CHARS)
    const read = readWorkFilter(route(state))
    assert.deepEqual(read.labels, ['ui'])
    assert.deepEqual(read.not?.labels, not.slice(0, read.not?.labels?.length))

    // Over the manifest's bound the negated values go from the end, and the rest stays.
    const small = writeWorkFilter(undefined, { text: '', kind: ['bug'], not: { labels: not } }, 96)
    assert.equal(small.complete, false)
    assert.deepEqual(readWorkFilter(small.state).kind, ['bug'])
  })

  test('the manifest admits it: no key of its own', () => {
    const manifest = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'planning')
    assert.ok(manifest)
    const filter: WorkFilter = {
      text: '',
      not: {
        category: ['review'],
        kind: ['bug'],
        priority: ['low'],
        labels: ['ui'],
        holder: ['x'],
      },
    }
    const { state } = writeWorkFilter({ view: 'list' }, filter, manifest.state_schema.max_bytes)
    assert.doesNotThrow(() => validateManifestRouteState(manifest, state))
    assert.deepEqual(readWorkFilter(state), filter)
  })
})
