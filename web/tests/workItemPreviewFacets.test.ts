/**
 * What the hover card of a reference prints, facet by facet, against the table
 * the card was specified with. Each expectation is a row of that table written
 * out by hand rather than read back from the registry's rules.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { facetMarks, surfaceMarks } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardItem } from './fixtures/board.ts'

const item = (
  overrides: Partial<WorkItemBrief> = {},
  state: 'backlog' | 'todo' | 'dev' | 'done' = 'dev',
) => boardItem(12, state, overrides)

const step = (done: boolean, index: number) => ({
  id: `00000000-0000-4000-8000-00000000060${index}`,
  text: `Step ${index}`,
  done,
  claimed_by: '',
  done_by: '',
})

const values = (facet: Parameters<typeof facetMarks>[0], subject: WorkItemBrief, context = {}) =>
  facetMarks(facet, 'preview', subject, context).map((mark) => mark.value)

describe('the preview card', () => {
  test('names a kind only when it is not a plain task, glyph and word', () => {
    assert.deepEqual(values('kind', item({ kind: 'task' })), [])
    for (const kind of ['bug', 'epic', 'improvement'] as const) {
      const [mark] = facetMarks('kind', 'preview', item({ kind }))
      assert.equal(mark?.form, 'glyph-word', kind)
      assert.deepEqual(mark?.text, { key: `workItem.kind.${kind}` })
    }
  })

  test('names a priority only when it is news: high or urgent', () => {
    for (const priority of ['low', 'medium'] as const)
      assert.deepEqual(values('priority', item({ priority })), [], priority)
    for (const priority of ['high', 'urgent'] as const) {
      const [mark] = facetMarks('priority', 'preview', item({ priority }))
      assert.equal(mark?.form, 'glyph-word', priority)
      assert.equal(mark?.value, priority)
    }
  })

  test('always says the state, which the screen names', () => {
    for (const state of ['backlog', 'todo', 'dev', 'done'] as const) {
      const [mark] = facetMarks('state', 'preview', item({}, state))
      assert.equal(mark?.form, 'glyph-word', state)
      assert.deepEqual(mark?.text, { state: item({}, state).state })
    }
  })

  test('says what an open item waits on, and nothing for a workable or finished one', () => {
    const [waiting] = facetMarks('readiness', 'preview', item({}, 'todo'), {
      waitingOn: 'MAIN-7',
    })
    assert.equal(waiting?.form, 'glyph-word')
    assert.deepEqual(waiting?.text, {
      key: 'workItem.facet.waiting',
      params: { reference: 'MAIN-7' },
    })
    assert.equal(waiting?.short, undefined, 'the whole words, not a short form with a hover')
    assert.deepEqual(values('readiness', item({ ready: true }, 'todo')), [])
    assert.deepEqual(values('readiness', item({}, 'done'), { waitingOn: 'MAIN-7' }), [])
  })

  test('names the holder as the board does, and nobody as nothing', () => {
    const held = item({ claim_ref: 'claude (session f5f838f4-74fc-4a1b-9c2d-0123456789ab)' })
    const [mark] = facetMarks('holder', 'preview', held)
    assert.equal(mark?.form, 'glyph-word')
    assert.deepEqual(mark?.text, { literal: 'claude · f5f838f4-74fc' })
    assert.deepEqual(values('holder', item()), [])
  })

  test('gives a stale claim the lease’s tone, and a finished item its former holder', () => {
    const [stale] = facetMarks(
      'holder',
      'preview',
      item({ claim_ref: 'codex', claim_state: 'stale' }),
    )
    assert.deepEqual(stale?.tone, { dimension: 'claim-lease', state: 'stale' })
    const [former] = facetMarks(
      'holder',
      'preview',
      item({ claim_ref: '', last_claim_ref: 'claude' }, 'done'),
    )
    assert.deepEqual(former?.text, {
      key: 'workItem.previousHolder',
      params: { holder: 'claude' },
    })
  })

  test('counts the steps of open work that has them', () => {
    const steps = [step(true, 1), step(false, 2), step(false, 3)]
    const [mark] = facetMarks('steps', 'preview', item({ checklist: steps }))
    assert.equal(mark?.form, 'glyph-word')
    assert.equal(mark?.value, '1/3')
    assert.deepEqual(values('steps', item()), [])
    assert.deepEqual(values('steps', item({ checklist: steps }, 'done')), [])
  })

  test('prints no labels and no parent, and never a glyph alone', () => {
    const full = item({
      kind: 'bug',
      priority: 'urgent',
      labels: ['ui'],
      parent_id: boardItem(1, 'dev').work_item_id,
      claim_ref: 'codex',
      checklist: [step(true, 1)],
    })
    const marks = surfaceMarks('preview', full, { parentReference: 'MAIN-1', waitingOn: 'MAIN-2' })
    assert.deepEqual(
      marks.map((mark) => mark.facet),
      ['kind', 'priority', 'state', 'readiness', 'holder', 'steps'],
    )
    assert.ok(marks.every((mark) => mark.form === 'glyph-word'))
  })
})
