/**
 * How the side panel lists a space's rows and sessions: only the work to follow now, items
 * and sessions in one run, a row that asks first and then the freshest; the rest under three
 * folds, held, waiting long (a row that asks first there too) and quiet; the pinned items in a group of their own, by number;
 * and an item that is in the frame only as a parent said with its rows rather than as a row.
 */
import { describe, expect, it } from 'vitest'

import { liveList } from '@/widgets/app-nav/utils/liveList.ts'
import type { LiveEntry } from '@/widgets/app-nav/utils/liveList.ts'

import type { ShownRow } from '@/shared/lib/liveWorkRows.ts'

import { liveRow, liveSession } from './support/liveFrame.ts'

const shown = (reference: string, overrides: Partial<ShownRow> = {}): ShownRow =>
  ({ ...liveRow(reference), fading: false, ...overrides }) as ShownRow

/** Each entry by its reference, or a session by its id's last four figures. */
const names = (entries: LiveEntry[]) =>
  entries.map((entry) =>
    entry.kind === 'item' ? entry.row.reference : `s${entry.session.session.slice(-4)}`,
  )

const SESSION = (tail: string) => `00000000-0000-4000-8000-00000000${tail}`
const silent = { state: 'quiet', quiet_since: '2026-11-01T00:00:00Z' } as const

describe('the work to follow now', () => {
  it('holds working items and items waiting under four hours, the one changed last first', () => {
    const list = liveList([
      shown('MAIN-3', { state: 'working', updated_at: '2026-11-09T08:00:00Z' }),
      shown('MAIN-12', { state: 'waiting', updated_at: '2026-11-09T10:30:00Z' }),
      shown('MAIN-7', { state: 'working', updated_at: '2026-11-09T09:15:00Z' }),
      shown('MAIN-8', { state: 'held', updated_at: '2026-11-09T11:00:00Z' }),
      shown('MAIN-10', { state: 'waiting', long: true, updated_at: '2026-11-09T11:30:00Z' }),
      shown('MAIN-9', { ...silent, updated_at: '2026-11-09T12:00:00Z' }),
    ])
    expect(names(list.live)).toEqual(['MAIN-12', 'MAIN-7', 'MAIN-3'])
  })

  it('puts a row that asks first, however long ago it changed, the freshest asking first', () => {
    const list = liveList(
      [
        shown('MAIN-1', { state: 'working', updated_at: '2026-11-09T12:00:00Z' }),
        shown('MAIN-2', { state: 'waiting', asks: true, updated_at: '2026-11-09T07:00:00Z' }),
        shown('MAIN-3', { state: 'waiting', updated_at: '2026-11-09T11:00:00Z' }),
      ],
      [
        liveSession(SESSION('0001'), { asks: true, since: '2026-11-09T08:00:00Z' }),
        liveSession(SESSION('0002'), { state: 'working', since: '2026-11-09T13:00:00Z' }),
      ],
    )
    expect(names(list.live)).toEqual(['s0001', 'MAIN-2', 's0002', 'MAIN-1', 'MAIN-3'])
  })

  it('mixes the sessions on no item with the items, a session by when it began what it does', () => {
    const list = liveList(
      [
        shown('MAIN-4', { state: 'working', updated_at: '2026-11-09T09:00:00Z' }),
        shown('MAIN-5', { state: 'waiting', updated_at: '2026-11-09T07:00:00Z' }),
      ],
      [
        liveSession(SESSION('0001'), { state: 'working', since: '2026-11-09T08:00:00Z' }),
        liveSession(SESSION('0002'), { since: '2026-11-09T10:00:00Z' }),
      ],
    )
    expect(names(list.live)).toEqual(['s0002', 'MAIN-4', 's0001', 'MAIN-5'])
  })

  it('stands two of one second items first by number, then sessions as the frame sent them', () => {
    const at = '2026-11-09T10:00:00Z'
    const list = liveList(
      [
        shown('MAIN-100', { state: 'working', updated_at: at }),
        shown('MAIN-9', { state: 'working', updated_at: at }),
      ],
      [liveSession(SESSION('0009'), { since: at }), liveSession(SESSION('0001'), { since: at })],
    )
    expect(names(list.live)).toEqual(['MAIN-9', 'MAIN-100', 's0009', 's0001'])
  })

  it('keeps a row that left the frame where its last state put it while it fades', () => {
    const list = liveList([
      shown('MAIN-4', { state: 'working', updated_at: '2026-11-09T09:00:00Z', fading: true }),
      shown('MAIN-5', { state: 'working', updated_at: '2026-11-09T08:00:00Z' }),
    ])
    expect(names(list.live)).toEqual(['MAIN-4', 'MAIN-5'])
  })
})

describe('the folds', () => {
  it('folds held, long-waiting and quiet work apart, each freshest first', () => {
    const list = liveList(
      [
        shown('MAIN-2', { ...silent, updated_at: '2026-11-01T00:00:00Z' }),
        shown('MAIN-3', { ...silent, updated_at: '2026-11-03T00:00:00Z' }),
        shown('MAIN-5', { state: 'held', updated_at: '2026-11-08T00:00:00Z' }),
        shown('MAIN-6', { state: 'held', updated_at: '2026-11-09T00:00:00Z' }),
        shown('MAIN-7', { state: 'waiting', long: true, updated_at: '2026-11-05T00:00:00Z' }),
        shown('MAIN-8', { state: 'working', updated_at: '2026-11-07T00:00:00Z' }),
      ],
      [
        liveSession(SESSION('0001'), { long: true, since: '2026-11-06T00:00:00Z' }),
        liveSession(SESSION('0002'), { long: true, since: '2026-11-04T00:00:00Z' }),
      ],
    )
    expect(names(list.live)).toEqual(['MAIN-8'])
    expect(names(list.held)).toEqual(['MAIN-6', 'MAIN-5'])
    expect(names(list.long)).toEqual(['s0001', 'MAIN-7', 's0002'])
    expect(names(list.quiet)).toEqual(['MAIN-3', 'MAIN-2'])
    expect(list.pinned).toEqual([])
  })

  it('folds a session that asks once it has waited for over four hours', () => {
    const list = liveList([], [liveSession(SESSION('0001'), { asks: true, long: true })])
    expect([names(list.live), names(list.long)]).toEqual([[], ['s0001']])
  })

  it('stands the rows that ask first inside the long fold, the rest freshest first', () => {
    const long = { state: 'waiting', long: true } as const
    const list = liveList(
      [
        shown('MAIN-1', { ...long, updated_at: '2026-11-09T12:00:00Z' }),
        shown('MAIN-2', { ...long, asks: true, updated_at: '2026-11-01T00:00:00Z' }),
        shown('MAIN-3', { ...long, updated_at: '2026-11-08T00:00:00Z' }),
      ],
      [
        liveSession(SESSION('0001'), { long: true, since: '2026-11-09T13:00:00Z' }),
        liveSession(SESSION('0002'), { long: true, asks: true, since: '2026-11-02T00:00:00Z' }),
      ],
    )
    expect(names(list.long)).toEqual(['s0002', 'MAIN-2', 's0001', 'MAIN-1', 'MAIN-3'])
    // The same in the long fold of the sessions under no space.
    const outside = liveList(
      [],
      [
        liveSession(SESSION('0003'), { long: true, since: '2026-11-09T13:00:00Z' }),
        liveSession(SESSION('0004'), { long: true, asks: true, since: '2026-11-01T00:00:00Z' }),
      ],
    )
    expect(names(outside.long)).toEqual(['s0004', 's0003'])
  })
})

describe('the pinned items', () => {
  it('stand apart by number when not on view, held, waiting long or quiet among them', () => {
    const list = liveList([
      shown('MAIN-30', { pinned: true, updated_at: '2026-11-09T00:00:00Z' }),
      shown('MAIN-7', { pinned: true, is_terminal: true, state_name: 'Done' }),
      shown('MAIN-12', { pinned: true, state: 'held' }),
      shown('MAIN-14', { pinned: true, state: 'waiting', long: true }),
      shown('MAIN-15', { pinned: true, ...silent }),
      shown('MAIN-40', { pinned: true, state: 'working' }),
      shown('MAIN-41', { pinned: true, state: 'waiting' }),
    ])
    expect(names(list.pinned)).toEqual(['MAIN-7', 'MAIN-12', 'MAIN-14', 'MAIN-15', 'MAIN-30'])
    // Pinned and on view, it is followed with the rest of the work and listed once.
    expect(names(list.live)).toEqual(['MAIN-40', 'MAIN-41'])
    expect([list.held, list.long, list.quiet]).toEqual([[], [], []])
  })
})

describe('an epic', () => {
  it('is said with its items’ rows and is no row while it is only their parent', () => {
    const list = liveList([
      shown('MAIN-4', { kind: 'epic', title: 'Structured answers' }),
      shown('MAIN-12', { parent: 'MAIN-4', state: 'working' }),
      shown('MAIN-13', { parent: 'MAIN-4', state: 'held' }),
      shown('MAIN-20', { parent: 'MAIN-4', pinned: true }),
    ])
    const all = [...list.live, ...list.held, ...list.pinned]
    expect(names(all)).toEqual(['MAIN-12', 'MAIN-13', 'MAIN-20'])
    expect(all.map((entry) => entry.kind === 'item' && entry.epic)).toEqual([
      'Structured answers',
      'Structured answers',
      'Structured answers',
    ])
  })

  it('is a row of its own when it is at work itself, and its own row has no epic', () => {
    const list = liveList([
      shown('MAIN-4', {
        kind: 'epic',
        title: 'Epic',
        state: 'working',
        updated_at: '2026-11-09T01:00:00Z',
      }),
      shown('MAIN-12', { parent: 'MAIN-4', state: 'working', updated_at: '2026-11-09T02:00:00Z' }),
    ])
    expect(
      list.live.map((entry) => entry.kind === 'item' && [entry.row.reference, entry.epic]),
    ).toEqual([
      ['MAIN-12', 'Epic'],
      ['MAIN-4', null],
    ])
  })
})
