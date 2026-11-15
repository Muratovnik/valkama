/**
 * The words a row of the side panel's list says: the fields its hint is built from, and the
 * sentence its accessible name says, which keeps every fact the hint's lines hold.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import type { ItemEntry, LiveEntry } from '@/widgets/app-nav/utils/liveList.ts'
import { rowHidden, rowSentence } from '@/widgets/app-nav/utils/liveWords.ts'
import type { Words } from '@/widgets/app-nav/utils/liveWords.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { liveRow, liveSession } from './support/liveFrame.ts'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const MINUTE = 60_000
const ago = (milliseconds: number) => new Date(NOW - milliseconds).toISOString()

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages,
  pluralRules,
})
const words: Words = {
  d: (value, format) => i18n.global.d(value, format),
  stateName: (row) => row.state_name,
  t: (key, values, plural) =>
    plural === undefined
      ? i18n.global.t(key, values ?? {})
      : i18n.global.t(key, values ?? {}, plural),
}

/** An item of the frame, with the goal of its parent when it has one. */
function item(reference: string, goal: string | null, overrides = {}): ItemEntry {
  return {
    goal,
    kind: 'item',
    row: { ...liveRow(reference, overrides), fading: false } as ItemEntry['row'],
  }
}

describe('the hint a row adds to what it draws', () => {
  it('says a one-line row’s state with how long, and not its goal, which the row draws', () => {
    const entry = item('MAIN-1', 'Structured answers', {
      state: 'working',
      since: ago(5 * MINUTE),
      agents: 1,
    })
    expect(rowHidden(words, entry, NOW, 1)).toBe('working · 5\u{A0}min')
  })

  it('says nothing for a two-line row, which draws its state and its goal on its second line', () => {
    const entry = item('MAIN-1', 'Structured answers', {
      state: 'working',
      since: ago(5 * MINUTE),
      agents: 1,
    })
    expect(rowHidden(words, entry, NOW, 2)).toBe('')
  })

  it('says a state with no time as the state alone, and nothing under a minute', () => {
    const entry = item('MAIN-2', null, { state: 'waiting', asks: true, since: ago(30_000) })
    expect(rowHidden(words, entry, NOW, 1)).toBe('asking')
  })

  it('says that a row the frame dropped ended its work, since its row draws no state', () => {
    const entry: ItemEntry = {
      goal: 'Structured answers',
      kind: 'item',
      row: {
        ...liveRow('MAIN-5', { state: 'working', since: ago(5 * MINUTE), agents: 2 }),
        fading: true,
      } as ItemEntry['row'],
    }
    expect(rowHidden(words, entry, NOW, 1)).toBe('work ended')
  })

  it('says a closed item nothing, since its meta already names its state', () => {
    const entry = item('MAIN-7', null, { is_terminal: true, state: null, pinned: true })
    expect(rowHidden(words, entry, NOW, 1)).toBe('')
  })

  it('says an idle pinned item its state, which its row does not draw', () => {
    const entry = item('MAIN-20', null, { pinned: true, state_name: 'Backlog' })
    expect(rowHidden(words, entry, NOW, 1)).toBe('Pinned · no work now · Backlog')
  })

  it('says a one-line session its folder and state, and a two-line one nothing', () => {
    const entry: LiveEntry = {
      kind: 'session',
      session: liveSession('0101', {
        title: 'Compare two exports',
        folder: 'example-project',
        state: 'waiting',
        since: ago(2 * 60 * MINUTE),
      }),
    }
    expect(rowHidden(words, entry, NOW, 1)).toBe('example-project\nwaiting · 2\u{A0}h')
    expect(rowHidden(words, entry, NOW, 2)).toBe('')
  })

  it('leaves an untitled session’s folder out, since its title is that folder', () => {
    const entry: LiveEntry = {
      kind: 'session',
      session: liveSession('0102', {
        title: null,
        folder: 'example-project',
        state: 'waiting',
        since: ago(2 * 60 * MINUTE),
      }),
    }
    expect(rowHidden(words, entry, NOW, 1)).toBe('waiting · 2\u{A0}h')
  })
})

describe('the accessible name of a row', () => {
  it('keeps every fact the row says: its number, title, goal, state, how long and agents', () => {
    const entry = item('MAIN-1', 'Structured answers', {
      state: 'working',
      since: ago(5 * MINUTE),
      agents: 2,
    })
    const name = rowSentence(words, entry, NOW)
    expect(name).toBe(
      'MAIN-1 Work MAIN-1, part of Structured answers: working for 5\u{A0}min, 2 agents',
    )
    // Every fact the row shows or its hint says is in the name, whatever the hint's words are.
    for (const fact of ['Structured answers', '5\u{A0}min', '2 agents', 'Work MAIN-1'])
      expect(name).toContain(fact)
  })

  it('names a session by its title and folder, with its state in a sentence', () => {
    const entry: LiveEntry = {
      kind: 'session',
      session: liveSession('0101', {
        title: 'Compare two exports',
        folder: 'example-project',
        state: 'waiting',
        since: ago(2 * 60 * MINUTE),
      }),
    }
    expect(rowSentence(words, entry, NOW)).toBe(
      'Session “Compare two exports” in example-project: waiting for 2\u{A0}h — the session’s turn is over',
    )
  })
})
