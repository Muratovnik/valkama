/**
 * The words a row of the side panel's list says: the fields its hint is built from, and the
 * sentence its accessible name says, which keeps every fact the hint's lines hold.
 */
import { createI18n } from 'vue-i18n'

import { describe, expect, it } from 'vitest'

import type { ItemEntry, LiveEntry } from '@/widgets/app-nav/utils/liveList.ts'
import { rowHintParts, rowSentence } from '@/widgets/app-nav/utils/liveWords.ts'
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

/** An item of the frame, with the epic of its parent when it has one. */
function item(reference: string, epic: string | null, overrides = {}): ItemEntry {
  return {
    epic,
    kind: 'item',
    row: { ...liveRow(reference, overrides), fading: false } as ItemEntry['row'],
  }
}

describe('the fields a row’s hint is built from', () => {
  it('shows the title, then the epic, the state with how long and the agents, one line each', () => {
    const entry = item('MAIN-1', 'Structured answers', {
      state: 'working',
      since: ago(5 * MINUTE),
      agents: 1,
    })
    expect(rowHintParts(words, entry, NOW)).toEqual({
      title: 'Work MAIN-1',
      lines: 'Structured answers\nworking · 5\u{A0}min\n1 agent',
    })
  })

  it('leaves out a line it has no fact for: no epic, no agents, no time under a minute', () => {
    const entry = item('MAIN-2', null, { state: 'waiting', asks: true, since: ago(30_000) })
    expect(rowHintParts(words, entry, NOW)).toEqual({
      title: 'Work MAIN-2',
      lines: 'asking',
    })
  })

  it('says a row the frame dropped that its work ended, and no state or agents that no longer run', () => {
    const entry: ItemEntry = {
      epic: 'Structured answers',
      kind: 'item',
      row: {
        ...liveRow('MAIN-5', { state: 'working', since: ago(5 * MINUTE), agents: 2 }),
        fading: true,
      } as ItemEntry['row'],
    }
    expect(rowHintParts(words, entry, NOW)).toEqual({
      title: 'Work MAIN-5',
      lines: 'Structured answers\nwork ended',
    })
  })

  it('gives a session with no task its own title, and its folder as the line under it', () => {
    const entry: LiveEntry = {
      kind: 'session',
      session: liveSession('0101', {
        title: 'Compare two exports',
        folder: 'example-project',
        state: 'waiting',
        since: ago(2 * 60 * MINUTE),
      }),
    }
    expect(rowHintParts(words, entry, NOW)).toEqual({
      title: 'Compare two exports',
      lines: 'example-project\nwaiting · 2\u{A0}h',
    })
  })

  it('takes an untitled session’s folder as its title and gives no folder line', () => {
    const entry: LiveEntry = {
      kind: 'session',
      session: liveSession('0102', {
        title: null,
        folder: 'example-project',
        state: 'waiting',
        since: ago(2 * 60 * MINUTE),
      }),
    }
    expect(rowHintParts(words, entry, NOW)).toEqual({
      title: 'example-project',
      lines: 'waiting · 2\u{A0}h',
    })
  })
})

describe('the accessible name of a row', () => {
  it('keeps every fact the row says: its number, title, epic, state, how long and agents', () => {
    const entry = item('MAIN-1', 'Structured answers', {
      state: 'working',
      since: ago(5 * MINUTE),
      agents: 2,
    })
    const name = rowSentence(words, entry, NOW)
    expect(name).toBe(
      'MAIN-1 Work MAIN-1, part of Structured answers: working for 5\u{A0}min, 2 agents',
    )
    // Each line of the hint is in the name, as a fact, whatever its words are.
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
