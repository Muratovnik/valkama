/**
 * How comments become threads and where a thread stands: the rule that a reply raises its
 * thread at the next opening and moves nothing while the card is open.
 */
import { describe, expect, it } from 'vitest'

import {
  hasNewReply,
  isUnresolved,
  keepThreadPlaces,
  threadCounts,
  threadGroups,
  threadRows,
} from '@/widgets/work-item-inspector/utils/threadRows.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'

import { requestEntry } from './support/inputRequests.ts'
import { asRoot } from './support/threads.ts'

type Row = WorkItem['comments'][number]

const MARK = { at: '2026-01-09T00:00:00Z', by: 'user', by_person: true, text: '' }
const at = (day: number) => `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`
const root = (id: number, day: number, change: Record<string, unknown> = {}) =>
  ({
    id,
    author: 'kolo',
    at: at(day),
    kind: 'comment',
    ...asRoot,
    report: null,
    body: `root ${id}`,
    ...change,
  }) as Row
const reply = (id: number, parent: number, day: number, change: Record<string, unknown> = {}) =>
  root(id, day, { reply_to: parent, body: `reply ${id}`, ...change })

const asked = (id: string, day: number, status: 'pending' | 'answered' = 'answered') => {
  const entry = requestEntry()
  entry.request = { ...entry.request, request_id: id, created_at: at(day), status }
  return entry
}
const keys = (rows: { key: string }[]) => rows.map((row) => row.key)

describe('threadGroups', () => {
  it('hangs every reply under its parent, oldest first, and never stands one as a root', () => {
    const rows = threadGroups(
      [root(1, 1), reply(4, 1, 4), reply(2, 1, 2), reply(3, 9, 3)],
      [asked('q', 1)],
    )
    expect(keys(rows)).toEqual(['comment-1', 'question-q', 'comment-9'])
    expect(rows[0]?.replies.map((row) => row.id)).toEqual([2, 4])
  })

  it('hangs a reply on a question under that question', () => {
    const under = reply(5, 0, 2, { reply_to: null, reply_to_request: 'q' })
    const [row] = threadGroups([under], [asked('q', 1)])
    expect(row?.kind).toBe('question')
    expect(row?.replies).toEqual([under])
  })

  it('keeps a reply whose question this card could not read, standing on its own', () => {
    const under = reply(5, 0, 2, { reply_to: null, reply_to_request: 'unread' })
    const [row] = threadGroups([under], [])
    expect(row).toEqual({ key: 'question-unread', kind: 'detached', replies: [under] })
  })
})

describe('where a thread stands', () => {
  const opened = [root(1, 1), root(2, 2), root(3, 3), reply(4, 1, 9)]
  const first = threadGroups(opened, [])
  const places = keepThreadPlaces(first, new Map())

  it('opens by its freshest activity, so a reply lifts an old thread over newer roots', () => {
    expect(keys(threadRows(first, new Set(), places))).toEqual([
      'comment-1',
      'comment-3',
      'comment-2',
    ])
  })

  it('stays put while a reply arrives, and says so', () => {
    const later = threadGroups([...opened, reply(5, 2, 20)], [])
    const kept = keepThreadPlaces(later, places)
    const rows = threadRows(later, new Set(), kept)
    expect(keys(rows)).toEqual(['comment-1', 'comment-3', 'comment-2'])
    const raised = rows.find((row) => row.key === 'comment-2')
    expect(raised && hasNewReply(raised, kept.get('comment-2'))).toBe(true)
  })

  it('moves the replied thread up at the next opening', () => {
    const later = threadGroups([...opened, reply(5, 2, 20)], [])
    expect(keys(threadRows(later, new Set(), keepThreadPlaces(later, new Map())))).toEqual([
      'comment-2',
      'comment-1',
      'comment-3',
    ])
  })

  it('stands a new thread on top while the card is open', () => {
    const later = threadGroups([...opened, root(6, 10)], [])
    expect(keys(threadRows(later, new Set(), keepThreadPlaces(later, places)))[0]).toBe('comment-6')
  })

  it('places a closed question read late by its own time, not on top', () => {
    const later = threadGroups(opened, [asked('late', 2)])
    expect(keys(threadRows(later, new Set(), keepThreadPlaces(later, places)))).toEqual([
      'comment-1',
      'comment-3',
      'comment-2',
      'question-late',
    ])
  })

  it('does not call what the reader has just sent news', () => {
    const later = threadGroups([...opened, reply(5, 2, 20, { by_person: true })], [])
    const raised = later.find((row) => row.key === 'comment-2')
    expect(raised && hasNewReply(raised, places.get('comment-2'))).toBe(false)
  })

  it('treats a reply nobody could attribute as news', () => {
    const later = threadGroups([...opened, reply(5, 2, 20, { by_person: null })], [])
    const raised = later.find((row) => row.key === 'comment-2')
    expect(raised && hasNewReply(raised, places.get('comment-2'))).toBe(true)
  })
})

describe('the unresolved view', () => {
  it('counts comment and report roots with no mark, and neither replies nor questions', () => {
    const report = root(3, 3, { kind: 'report', body: '', report: { done: 'd', next: 'n' } })
    expect(
      threadCounts([root(1, 1), root(2, 2, { resolution: MARK }), report, reply(4, 1, 4)]),
    ).toEqual({ threads: 3, unresolved: 2 })
  })

  it('keeps open threads, waiting questions and replies with nothing to read them under', () => {
    const open = (row: ReturnType<typeof threadGroups>[number]) => isUnresolved(row, new Set())
    const [plain, marked, waiting, closed, detached] = threadGroups(
      [
        root(1, 1),
        root(2, 2, { resolution: MARK }),
        reply(3, 0, 3, { reply_to: null, reply_to_request: 'unread' }),
      ],
      [asked('waits', 1, 'pending'), asked('closed', 1)],
    )
    expect(plain && open(plain)).toBe(true)
    expect(marked && open(marked)).toBe(false)
    expect(waiting && open(waiting)).toBe(true)
    expect(closed && open(closed)).toBe(false)
    expect(detached && open(detached)).toBe(true)
  })

  it('keeps a question answered while the card was open where the reader left it', () => {
    const [row] = threadGroups([], [asked('kept', 1)])
    expect(row && isUnresolved(row, new Set(['kept']))).toBe(true)
  })
})
