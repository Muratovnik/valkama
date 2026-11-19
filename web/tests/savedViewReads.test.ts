/**
 * A Work address state, or a saved view of one, read as this build reads it: a value one of
 * its readers does not read as written is left out, so the address can be written again
 * saying what the views show, and a saved view holding one is known to be unread. What the
 * readers tidy in a value they do read is no such value.
 */
import { describe, expect, it } from 'vitest'

import { readsSavedView, withoutUnreadValues } from '@/pages/planning/utils/savedViewReads.ts'

import type { ViewState } from '@/shared/lib/savedViews.ts'

describe('a Work state read as this build reads it', () => {
  it('leaves out a grouping it reads as none, and keeps every other key', () => {
    expect(withoutUnreadValues({ view: 'kanban', group: 'former', query: 'lanes' })).toEqual({
      view: 'kanban',
      query: 'lanes',
    })
  })

  it('leaves out an order it does not know, with its direction, and keeps one it does', () => {
    expect(withoutUnreadValues({ view: 'list', sort: 'former', desc: true })).toEqual({
      view: 'list',
    })
    expect(withoutUnreadValues({ view: 'list', sort: 'created', desc: true })).toBeNull()
    expect(readsSavedView({ group: 'project', sort: 'priority' })).toBe(true)
  })

  it('leaves out a view it reads as the board', () => {
    expect(withoutUnreadValues({ view: 'table', group: 'goal' })).toEqual({ group: 'goal' })
  })

  it('leaves out the filter values it does not know, and keeps those it does', () => {
    // `queued` and `backlog` are categories a build before this one wrote; `p0` no priority.
    expect(withoutUnreadValues({ cat: 'queued,ready,%-backlog', pri: 'p0', query: 'x' })).toEqual({
      cat: 'ready',
      query: 'x',
    })
    expect(withoutUnreadValues({ kind: 'former' })).toEqual({})
  })

  it('leaves out a chain whose scope it does not know, with the keys that go with a chain', () => {
    expect(
      withoutUnreadValues({ view: 'graph', chain: 'MAIN-1', chain_scope: 'former', closed: true }),
    ).toEqual({ view: 'graph' })
  })

  it('reads a state it reads as written as nothing to change, an untidy one included', () => {
    const read: ViewState[] = [
      { view: 'kanban', group: 'goal' },
      {
        view: 'list',
        kind: 'bug,bug,,stage',
        cat: 'triage,%-ready',
        query: '  padded ',
        ready: false,
      },
      { chain: 'MAIN-1', chain_scope: 'tree' },
      {},
    ]
    for (const state of read) {
      expect(withoutUnreadValues(state)).toBeNull()
      expect(readsSavedView(state)).toBe(true)
    }
    expect(withoutUnreadValues(undefined)).toBeNull()
  })

  it('knows a saved view with any value it leaves out as unread', () => {
    expect(readsSavedView({ group: 'former' })).toBe(false)
    expect(readsSavedView({ cat: 'queued' })).toBe(false)
    expect(readsSavedView({ chain: 'MAIN-1', chain_scope: 'former' })).toBe(false)
  })
})
