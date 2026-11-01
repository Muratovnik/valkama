/**
 * The facet registry against the specification's table of what each surface
 * prints. Each expectation is a cell of that table written out by hand, not
 * read back from `FACET_RULES`, so a rule that drifts from the table fails.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  facetMarks,
  leadMarks,
  printsFacet,
  readinessMarks,
  readinessOf,
  surfaceMarks,
} from '@/entities/work-item/utils/facets.ts'
import type { FacetSurface } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'

import { boardItem } from './fixtures/board.ts'

const SURFACES: readonly FacetSurface[] = ['tile', 'list', 'graph', 'card', 'finder']
const KINDS = ['task', 'bug', 'epic', 'improvement'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const item = (
  overrides: Partial<WorkItemBrief> = {},
  state: 'backlog' | 'todo' | 'dev' | 'done' = 'backlog',
) => boardItem(12, state, overrides)

/** Where a facet prints, surface by surface, for one item. */
const printedOn = (
  facet: Parameters<typeof printsFacet>[0],
  subject: WorkItemBrief,
  context = {},
) => SURFACES.filter((surface) => printsFacet(facet, surface, subject, context))

const only = (marks: ReturnType<typeof facetMarks>) => {
  assert.equal(marks.length, 1, `expected one mark, got ${marks.length}`)
  return marks[0]
}

describe('kind', () => {
  test('a plain task is the norm: only the card names it, in words and without a glyph', () => {
    assert.deepEqual(printedOn('kind', item({ kind: 'task' })), ['card'])
    const card = only(facetMarks('kind', 'card', item({ kind: 'task' })))
    assert.equal(card.glyph, null)
    assert.equal(card.form, 'glyph-word')
    assert.deepEqual(card.text, { key: 'workItem.kind.task' })
  })

  test('any other kind is a glyph before the reference on every surface but the card', () => {
    for (const kind of ['bug', 'epic', 'improvement'] as const) {
      assert.deepEqual(printedOn('kind', item({ kind })), SURFACES, kind)
      for (const surface of ['tile', 'list', 'graph', 'finder'] as const) {
        const mark = only(facetMarks('kind', surface, item({ kind })))
        assert.equal(mark.form, 'glyph', `${kind} on ${surface}`)
        assert.equal(mark.glyph, `kind-${kind}`)
      }
      // The card says it in words as well.
      assert.equal(only(facetMarks('kind', 'card', item({ kind }))).form, 'glyph-word')
    }
  })

  test('kind carries no colour and a click on it filters by it', () => {
    for (const kind of KINDS) {
      const mark = only(facetMarks('kind', 'card', item({ kind })))
      assert.equal(semanticStatePresentation(mark.tone).tone, 'neutral', kind)
      assert.deepEqual(mark.filter, { facet: 'kind', value: kind })
    }
  })
})

describe('priority', () => {
  test('a tile marks every priority but the default', () => {
    for (const priority of PRIORITIES) {
      assert.equal(
        printsFacet('priority', 'tile', item({ priority })),
        priority !== 'medium',
        priority,
      )
    }
    assert.equal(
      only(facetMarks('priority', 'tile', item({ priority: 'low' }))).glyph,
      'priority-low',
    )
  })

  test('the graph and the finder mark only what asks for attention', () => {
    for (const surface of ['graph', 'finder'] as const) {
      const marked = PRIORITIES.filter((priority) =>
        printsFacet('priority', surface, item({ priority })),
      )
      assert.deepEqual(marked, ['high', 'urgent'], surface)
    }
  })

  test('the list column says every priority, the default as a quiet word with no glyph', () => {
    for (const priority of PRIORITIES)
      assert.ok(printsFacet('priority', 'list', item({ priority })))
    const medium = only(facetMarks('priority', 'list', item({ priority: 'medium' })))
    assert.equal(medium.glyph, null)
    assert.equal(medium.quiet, true)
    assert.deepEqual(medium.text, { key: 'priority.medium' })
    const high = only(facetMarks('priority', 'list', item({ priority: 'high' })))
    assert.equal(high.form, 'glyph-word')
    assert.equal(high.glyph, 'priority-high')
    assert.equal(high.quiet, false)
  })

  test('the card always says it, glyph and word', () => {
    for (const priority of PRIORITIES) {
      assert.equal(only(facetMarks('priority', 'card', item({ priority }))).form, 'glyph-word')
    }
  })

  test('urgent and high carry the state owner’s tones; low and medium none', () => {
    const tone = (priority: (typeof PRIORITIES)[number]) =>
      semanticStatePresentation(only(facetMarks('priority', 'card', item({ priority }))).tone).tone
    assert.equal(tone('urgent'), 'danger')
    assert.equal(tone('high'), 'warning')
    assert.equal(tone('medium'), 'neutral')
    assert.equal(tone('low'), 'neutral')
    assert.deepEqual(only(facetMarks('priority', 'card', item({ priority: 'urgent' }))).filter, {
      facet: 'priority',
      value: 'urgent',
    })
  })
})

describe('state', () => {
  test('the board never prints it, because the column says it; everyone else does', () => {
    const dev = item({ ready: false }, 'dev')
    assert.deepEqual(printedOn('state', dev), ['list', 'graph', 'card', 'finder'])
    const mark = only(facetMarks('state', 'list', dev))
    assert.deepEqual(mark.text, { literal: 'Dev' })
    assert.equal(semanticStatePresentation(mark.tone).tone, 'info')
    // The card's state is its transition menu, so a click on it is not a filter.
    assert.equal(mark.filter, null)
  })

  test('cancelled draws its own glyph instead of a dot', () => {
    const cancelled = item({
      state: {
        state_id: 'x',
        key: 'cancelled',
        name: 'Cancelled',
        category: 'cancelled',
        is_terminal: true,
      },
    })
    assert.equal(only(facetMarks('state', 'card', cancelled)).glyph, 'state-cancelled')
  })
})

describe('readiness', () => {
  const workable = item({ ready: true })
  const waiting = item({ ready: false })
  const blocker = { waitingOn: 'MAIN-7' }

  test('it is workable, waiting on an open blocker, or neither — and never on finished work', () => {
    assert.equal(readinessOf(workable), 'ready')
    assert.equal(readinessOf(waiting, blocker), 'waiting')
    assert.equal(readinessOf(item({ ready: false }, 'dev')), null)
    assert.equal(readinessOf(item({}, 'done'), blocker), null)
  })

  test('the tile and the list print only the exception, naming what it waits on', () => {
    for (const surface of ['tile', 'list'] as const) {
      assert.equal(printsFacet('readiness', surface, workable), false, surface)
      const mark = only(facetMarks('readiness', surface, waiting, blocker))
      assert.equal(mark.glyph, 'waiting')
      assert.deepEqual(mark.text, {
        key: 'workItem.facet.waiting',
        params: { reference: 'MAIN-7' },
      })
      assert.equal(semanticStatePresentation(mark.tone).tone, 'danger')
    }
  })

  test('the tile draws the reference it waits on and keeps the sentence as the name', () => {
    // «Ждёт MAIN-12» beside two glyphs and a reference did not fit a tile's
    // first line and folded to the bare glyph, so the reference was hover-only.
    const tile = only(facetMarks('readiness', 'tile', waiting, blocker))
    assert.deepEqual(tile.short, { literal: 'MAIN-7' })
    assert.deepEqual(tile.text, { key: 'workItem.facet.waiting', params: { reference: 'MAIN-7' } })
    // Every other surface draws its marks' whole words, as before.
    const subject = item({ ready: false, kind: 'bug', priority: 'urgent', labels: ['a'] })
    for (const surface of SURFACES.filter((name) => name !== 'tile')) {
      const shortened = surfaceMarks(surface, subject, { ...blocker, width: 900 }).filter(
        (mark) => mark.short !== undefined,
      )
      assert.deepEqual(shortened, [], surface)
    }
  })

  test('the graph says workable quietly, in place of the state word', () => {
    const mark = only(facetMarks('readiness', 'graph', workable))
    assert.deepEqual(mark.text, { key: 'workItem.facet.ready' })
    assert.equal(mark.quiet, true)
    assert.equal(semanticStatePresentation(mark.tone).tone, 'neutral')
    assert.equal(printsFacet('state', 'graph', workable), false)
    assert.equal(printsFacet('state', 'graph', waiting, blocker), false)
    // Work that is neither keeps its state word.
    assert.equal(printsFacet('state', 'graph', item({ ready: false }, 'dev')), true)
  })

  test('the card says it through its primary action, not a mark; the finder never', () => {
    assert.deepEqual(facetMarks('readiness', 'card', workable), [])
    assert.deepEqual(facetMarks('readiness', 'card', waiting, blocker), [])
    assert.equal(printsFacet('readiness', 'finder', waiting, blocker), false)
  })

  test('a chain member prints only the exception: what it waits on, and nothing when workable', () => {
    assert.deepEqual(readinessMarks(workable, 'chain', {}), [])
    const mark = only(readinessMarks(waiting, 'chain', blocker))
    assert.equal(mark.value, 'waiting')
    assert.deepEqual(mark.text, { key: 'workItem.facet.waiting', params: { reference: 'MAIN-7' } })
    assert.equal(semanticStatePresentation(mark.tone).tone, 'danger')
    // Finished work says nothing about readiness, whatever blocks it.
    assert.deepEqual(readinessMarks(item({}, 'done'), 'chain', blocker), [])
  })

  test('a chain member prints no other facet, so its row has no state word or priority', () => {
    for (const facet of ['kind', 'priority', 'state', 'labels', 'holder', 'steps'] as const) {
      assert.equal(printsFacet(facet, 'chain', waiting, blocker), false, facet)
    }
  })
})

describe('labels', () => {
  const labelled = item({ labels: ['a', 'b', 'c', 'd', 'e'] })
  const values = (surface: FacetSurface, context = {}) =>
    facetMarks('labels', surface, labelled, context).map((mark) => mark.value)

  test('a tile shows three chips and folds the rest into one quiet count', () => {
    assert.deepEqual(values('tile'), ['a', 'b', 'c', '+2'])
    const more = facetMarks('labels', 'tile', labelled).at(-1)
    assert.equal(more?.form, 'word')
    assert.equal(more?.filter, null)
    assert.deepEqual(more?.text, { key: 'workItem.facet.moreLabels', params: { count: 2 } })
    assert.deepEqual(values('tile').length, 4)
    assert.deepEqual(
      facetMarks('labels', 'tile', item({ labels: ['a', 'b', 'c'] })).map((mark) => mark.value),
      ['a', 'b', 'c'],
    )
  })

  test('a list row shows two chips from 900px of row, and none below', () => {
    assert.deepEqual(values('list', { width: 900 }), ['a', 'b', '+3'])
    assert.deepEqual(values('list', { width: 899 }), [])
  })

  test('the card shows every label; the graph and the finder none', () => {
    assert.deepEqual(values('card'), ['a', 'b', 'c', 'd', 'e'])
    assert.deepEqual(values('graph'), [])
    assert.deepEqual(values('finder'), [])
  })

  test('a chip filters by its label', () => {
    const chip = facetMarks('labels', 'card', labelled)[0]
    assert.equal(chip.form, 'chips')
    assert.deepEqual(chip.filter, { facet: 'labels', value: 'a' })
  })
})

describe('holder', () => {
  const held = item(
    { claim_ref: 'claude (session 5937aa01-1234-4c00)', claim_state: 'live' },
    'dev',
  )

  test('the tile names the holder of open work, the list always, the finder never', () => {
    assert.deepEqual(printedOn('holder', held), ['tile', 'list', 'graph', 'card'])
    assert.deepEqual(printedOn('holder', { ...held, state: boardItem(1, 'done').state }), [
      'list',
      'graph',
      'card',
    ])
    assert.deepEqual(printedOn('holder', item()), ['list', 'card'])
  })

  test('nobody is a dash in the list column and a sentence in the card', () => {
    assert.deepEqual(only(facetMarks('holder', 'list', item())).text, { literal: '—' })
    assert.deepEqual(only(facetMarks('holder', 'card', item())).text, { key: 'workItem.noClaim' })
  })

  test('whoever held finished work is said to have held it before, not to hold it', () => {
    const done = { ...held, state: boardItem(1, 'done').state }
    for (const surface of ['list', 'card'] as const)
      assert.deepEqual(only(facetMarks('holder', surface, done)).text, {
        key: 'workItem.previousHolder',
        params: { holder: 'claude · 5937aa01-1234' },
      })
    assert.deepEqual(only(facetMarks('holder', 'list', held)).text, {
      literal: 'claude · 5937aa01-1234',
    })
  })

  test('a holder is its short name, and only a stale claim has a tone', () => {
    const mark = only(facetMarks('holder', 'tile', held))
    assert.deepEqual(mark.text, { literal: 'claude · 5937aa01-1234' })
    assert.equal(semanticStatePresentation(mark.tone).tone, 'neutral')
    const stale = only(facetMarks('holder', 'tile', { ...held, claim_state: 'stale' }))
    assert.equal(semanticStatePresentation(stale.tone).tone, 'warning')
  })
})

describe('parent and steps', () => {
  const child = item({ parent_id: boardItem(3).work_item_id })
  const context = { parentReference: 'MAIN-3' }

  test('the parent prints on the flat board, the graph and the card, never in the list or the finder', () => {
    assert.deepEqual(printedOn('parent', child, context), ['tile', 'graph', 'card'])
    assert.deepEqual(printedOn('parent', child, { ...context, grouped: true }), ['graph', 'card'])
    assert.deepEqual(printedOn('parent', item(), context), [])
  })

  test('steps print as done/total on the tile only when there are some, and always in the list', () => {
    const steps = [true, true, false].map((done, index) => ({
      id: `00000000-0000-4000-8000-00000000030${index}`,
      text: `Step ${index}`,
      done,
      claimed_by: '',
      done_by: '',
    }))
    const withSteps = item({ checklist: steps })
    assert.deepEqual(printedOn('steps', withSteps), ['tile', 'list', 'card'])
    assert.deepEqual(only(facetMarks('steps', 'tile', withSteps)).text, {
      key: 'workItem.facet.steps',
      params: { done: 2, total: 3 },
    })
    assert.deepEqual(printedOn('steps', item()), ['list'])
    assert.deepEqual(only(facetMarks('steps', 'list', item())).text, { literal: '—' })
  })
})

const lead = (surface: FacetSurface, subject: WorkItemBrief) =>
  (['priority', 'kind'] as const).flatMap((facet) => leadMarks(facet, surface, subject))

describe('the glyphs that lead a reference', () => {
  test('the list leads with every priority but the default, as well as saying it in its column', () => {
    for (const priority of PRIORITIES) {
      const marks = lead('list', item({ priority }))
      assert.deepEqual(
        marks.map((mark) => [mark.form, mark.glyph]),
        priority === 'medium' ? [] : [['glyph', `priority-${priority}`]],
        priority,
      )
      // The column still says it, the default included.
      assert.equal(printsFacet('priority', 'list', item({ priority })), true)
      assert.equal(only(facetMarks('priority', 'list', item({ priority }))).form, 'glyph-word')
    }
  })

  test('the list leads with the kind of anything but a plain task, and filters by both', () => {
    const marks = lead('list', item({ kind: 'improvement', priority: 'urgent' }))
    assert.deepEqual(
      marks.map((mark) => [mark.facet, mark.glyph, mark.filter]),
      [
        ['priority', 'priority-urgent', { facet: 'priority', value: 'urgent' }],
        ['kind', 'kind-improvement', { facet: 'kind', value: 'improvement' }],
      ],
    )
    assert.deepEqual(lead('list', item({ kind: 'task' })), [])
  })

  test('a surface that prints a facet as a glyph leads with exactly that glyph; the card with none', () => {
    const subject = item({ kind: 'bug', priority: 'high' })
    for (const surface of ['tile', 'graph', 'finder'] as const)
      assert.deepEqual(
        lead(surface, subject),
        surfaceMarks(surface, subject, {}, ['priority', 'kind']),
        surface,
      )
    assert.deepEqual(lead('card', subject), [])
  })
})

test('a subject that knows only its kind, priority and state prints those and nothing it lacks', () => {
  // A search result: no labels, steps, holder or readiness to read.
  const found = {
    kind: 'bug' as const,
    priority: 'urgent' as const,
    state: { name: 'Review', category: 'review' as const },
  }
  assert.deepEqual(
    surfaceMarks('finder', found).map((mark) => [mark.facet, mark.value]),
    [
      ['priority', 'urgent'],
      ['kind', 'bug'],
      ['state', 'review'],
    ],
  )
  // Nothing it does not carry is guessed: no labels, no steps, no readiness.
  assert.deepEqual(
    surfaceMarks('tile', found).map((mark) => mark.facet),
    ['priority', 'kind'],
  )
})

test('a surface reads its marks out in one order, the lead marks first', () => {
  const subject = item({ kind: 'bug', priority: 'urgent', labels: ['x'] })
  assert.deepEqual(
    surfaceMarks('tile', subject, { waitingOn: 'MAIN-7' }).map((mark) => mark.facet),
    ['priority', 'kind', 'readiness', 'labels'],
  )
  assert.deepEqual(
    surfaceMarks('tile', subject, {}, ['kind', 'priority']).map((mark) => mark.facet),
    ['kind', 'priority'],
  )
})

test('only kind, priority and labels filter, as the owner decided', () => {
  const subject = item(
    {
      kind: 'bug',
      priority: 'high',
      labels: ['x'],
      claim_ref: 'codex',
      parent_id: boardItem(3).work_item_id,
    },
    'dev',
  )
  const filtering = surfaceMarks('card', subject, { parentReference: 'MAIN-3' })
    .filter((mark) => mark.filter !== null)
    .map((mark) => mark.facet)
  assert.deepEqual(filtering, ['priority', 'kind', 'labels'])
})
