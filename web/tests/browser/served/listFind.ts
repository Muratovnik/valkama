/**
 * The rows the list's own find and window are read from: rows that stand where
 * their index says, a short list dressed with what a row carries beyond a title,
 * and lists long enough to draw only their window.
 */
import { brief, identity, longRead, stateOf } from '../longSpace.ts'
import { SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

const START = Date.UTC(2026, 9, 1, 12)

/** Row `index` of a list sorted by Updated, newest first, stands at `index`. */
export const row = (index: number, extra: object = {}) =>
  brief(1000 + index, stateOf(index), {
    updated_at: new Date(START - index * 3_600_000).toISOString(),
    ...extra,
  })
export const reference = (index: number) => `MAIN-${1000 + index}`

/** A cancelled state, which the long space's workflow is given after its own six. */
export const CANCELLED = {
  category: 'cancelled',
  is_terminal: true,
  key: 'cancelled',
  name: 'Cancelled',
  state_id: identity(950),
}
/** The workflow states the short list adds to the long space's own. */
export const SHORT_STATES = [{ ...CANCELLED, position: 6 }]

/**
 * What the rows the words are read from carry beyond a title: labels past the
 * two a row shows, folding into «+2»; a holder; steps done of all; a blocker;
 * and a cancelled state with the holder it had.
 */
const DRESSED: Record<number, object> = {
  0: {
    checklist: ['Draft', 'Review', 'Ship'].map((text, at) => ({
      claimed_by: '',
      done: at === 0,
      done_by: at === 0 ? 'codex' : '',
      by_previous_holder: false,
      id: identity(960 + at),
      text,
    })),
    claim_ref: 'codex (session 7f3a)',
    labels: ['frontend', 'keyboard', 'search', 'quarterly'],
  },
  1: { claim_ref: '', last_claim_ref: 'claude (session 9c1d)', state: CANCELLED, open: false },
}
/** The row that waits on an open one. */
export const WAITS = { blocked: 3, on: 5 }

/** A list short enough to draw every row: «quartz» in three, every seventh row urgent. */
export const short = (): object[] =>
  Array.from({ length: 120 }, (_, index) =>
    row(index, {
      ...(index % 7 === 3 ? { priority: 'high' } : {}),
      ...([5, 60, 110].includes(index) ? { title: `Quartz sample ${index}` } : {}),
      ...DRESSED[index],
    }),
  )
export const shortLinks = () => [
  { from: identity(1000 + WAITS.on), kind: 'blocks', to: identity(1000 + WAITS.blocked) },
]
/** The short list where the last twenty rows but the one with «quartz» have no «l» in their title. */
export const shortWithoutL = () =>
  short().map((item, index) =>
    index >= 100 && index !== 110 ? { ...item, title: 'Other one' } : item,
  )

/** A thousand rows, «quartz» in four far down the list and twice in one of them. */
const QUARTZ: Record<number, string> = {
  120: 'Quartz sample to look for',
  400: 'Quartz sample, and quartz again',
  650: 'Quartz sample in the middle',
  980: 'Quartz sample near the end',
}
export const thousand = () =>
  Array.from({ length: 1000 }, (_, index) =>
    row(index, QUARTZ[index] ? { title: QUARTZ[index] } : {}),
  )

/** `count` rows of the long space, each in the state its index gives. */
export const windowRows = (count: number) =>
  Array.from({ length: count }, (_, index) => brief(1000 + index, stateOf(index)))

/** Six hundred rows, and everything that makes a column wider in one far below the fold. */
export function widestFarDown() {
  const updated_at = new Date().toISOString()
  const rows = Array.from({ length: 600 }, (_, index) =>
    brief(1000 + index, stateOf(0), { updated_at }),
  )
  rows[580] = brief(9580, stateOf(2), {
    reference: 'MAIN-99580',
    claim_ref: 'a holder with a long name',
    priority: 'urgent',
    checklist: Array.from({ length: 12 }, (_, at) => ({
      id: identity(3000 + at),
      text: 'Step',
      done: false,
      claimed_by: '',
      done_by: '',
      by_previous_holder: false,
    })),
    updated_at: '2020-08-28T20:08:00Z',
  })
  return rows
}

const read = (name: string, items: object[], links: object[] = [], states: object[] = []) => ({
  name: `served/listFind.ts ${name}`,
  url: SPACE_READ,
  body: spaceModelWith(longRead(items, links, states)),
})

export const served: Served[] = [
  read('short()', short(), shortLinks(), SHORT_STATES),
  read('shortWithoutL()', shortWithoutL(), shortLinks(), SHORT_STATES),
  read('thousand()', thousand()),
  read('windowRows(1000)', windowRows(1000)),
  read('widestFarDown()', widestFarDown()),
]
