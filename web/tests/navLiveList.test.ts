/**
 * How the side panel lists a space's rows: only the work going on now, freshest first; the
 * quiet work folded apart; the pinned items in a group of their own, by number; and an item
 * that is in the frame only as a parent said before its rows rather than as a row.
 */
import { describe, expect, it } from 'vitest'

import { liveList } from '@/widgets/app-nav/utils/liveList.ts'

import type { ShownRow } from '@/shared/lib/liveWorkRows.ts'

import { liveRow } from './support/liveFrame.ts'

const shown = (reference: string, overrides: Partial<ShownRow> = {}): ShownRow =>
  ({ ...liveRow(reference), fading: false, ...overrides }) as ShownRow

const references = (entries: { row: ShownRow }[]) => entries.map((entry) => entry.row.reference)

describe('the work going on now', () => {
  it('lists only working and waiting items, the one changed last first', () => {
    const list = liveList([
      shown('MAIN-3', { state: 'working', updated_at: '2026-11-09T08:00:00Z' }),
      shown('MAIN-12', { state: 'waiting', updated_at: '2026-11-09T10:30:00Z' }),
      shown('MAIN-7', { state: 'working', updated_at: '2026-11-09T09:15:00Z' }),
      shown('MAIN-8', { state: 'held', updated_at: '2026-11-09T11:00:00Z' }),
      shown('MAIN-9', {
        state: 'quiet',
        quiet_since: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-09T12:00:00Z',
      }),
    ])
    expect(references(list.live)).toEqual(['MAIN-12', 'MAIN-7', 'MAIN-3'])
  })

  it('puts two items changed in the same second by number, not by text', () => {
    const at = { state: 'working', updated_at: '2026-11-09T10:00:00Z' } as const
    const list = liveList([shown('MAIN-100', at), shown('MAIN-9', at), shown('MAIN-20', at)])
    expect(references(list.live)).toEqual(['MAIN-9', 'MAIN-20', 'MAIN-100'])
  })

  it('keeps a row that left the frame where its last state put it while it fades', () => {
    const list = liveList([
      shown('MAIN-4', { state: 'working', updated_at: '2026-11-09T09:00:00Z', fading: true }),
      shown('MAIN-5', { state: 'working', updated_at: '2026-11-09T08:00:00Z' }),
    ])
    expect(references(list.live)).toEqual(['MAIN-4', 'MAIN-5'])
  })
})

describe('the quiet work', () => {
  it('folds held and silent items apart, freshest first, and leaves them out of the list', () => {
    const list = liveList([
      shown('MAIN-2', {
        state: 'quiet',
        quiet_since: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
      }),
      shown('MAIN-5', { state: 'held', updated_at: '2026-11-08T00:00:00Z' }),
      shown('MAIN-6', { state: 'working', updated_at: '2026-11-07T00:00:00Z' }),
    ])
    expect(references(list.quiet)).toEqual(['MAIN-5', 'MAIN-2'])
    expect(references(list.live)).toEqual(['MAIN-6'])
    expect(list.pinned).toEqual([])
  })
})

describe('the pinned items', () => {
  it('stand apart by number whatever their state, unless a session is working or waiting on one', () => {
    const list = liveList([
      shown('MAIN-30', { pinned: true, updated_at: '2026-11-09T00:00:00Z' }),
      shown('MAIN-7', { pinned: true, is_terminal: true, state_name: 'Done' }),
      shown('MAIN-12', { pinned: true, state: 'held' }),
      shown('MAIN-40', { pinned: true, state: 'working' }),
    ])
    expect(references(list.pinned)).toEqual(['MAIN-7', 'MAIN-12', 'MAIN-30'])
    // Pinned and at work, it is followed with the rest of the work and listed once.
    expect(references(list.live)).toEqual(['MAIN-40'])
    expect(list.quiet).toEqual([])
  })
})

describe('an epic', () => {
  it('is said before its items’ rows, muted, and is no row while it is only their parent', () => {
    const list = liveList([
      shown('MAIN-4', { kind: 'epic', title: 'Structured answers' }),
      shown('MAIN-12', { parent: 'MAIN-4', state: 'working' }),
      shown('MAIN-13', { parent: 'MAIN-4', state: 'held' }),
      shown('MAIN-20', { parent: 'MAIN-4', pinned: true }),
    ])
    const all = [...list.live, ...list.quiet, ...list.pinned]
    expect(references(all)).toEqual(['MAIN-12', 'MAIN-13', 'MAIN-20'])
    expect(all.map((entry) => entry.epic)).toEqual([
      'Structured answers',
      'Structured answers',
      'Structured answers',
    ])
  })

  it('is a row of its own when it is at work itself, and its own row has no prefix', () => {
    const list = liveList([
      shown('MAIN-4', {
        kind: 'epic',
        title: 'Epic',
        state: 'working',
        updated_at: '2026-11-09T01:00:00Z',
      }),
      shown('MAIN-12', { parent: 'MAIN-4', state: 'working', updated_at: '2026-11-09T02:00:00Z' }),
    ])
    expect(list.live.map((entry) => [entry.row.reference, entry.epic])).toEqual([
      ['MAIN-12', 'Epic'],
      ['MAIN-4', null],
    ])
  })
})
