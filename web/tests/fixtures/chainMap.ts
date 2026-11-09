/**
 * Chains for the card's branch map, built rather than written out.
 *
 * `branchedChain` has the shape the map was designed against: 617 members, 132
 * of them open, in six lanes — 273 children of the root, 243 under an epic that
 * was itself discovered, 88 under no epic, 11 under a second discovered epic and
 * one each under two epics outside the chain. Discovery edges are dense and
 * `blocks` links sparse, as they are in a space that has run for months.
 *
 * `smallBranchedChain` is 40 members in two lanes, 22 open: few enough that
 * every member gets a visible segment of its own.
 *
 * `chainOf` assembles an answer from members and edges and counts it, so a test
 * can state a small case directly and the contract's sums still hold.
 */

type Group = 'active' | 'backlog' | 'blocked' | 'done' | 'queued' | 'review'

const STATES: Record<Group, { category: string; is_terminal: boolean; key: string; name: string }> =
  {
    done: { key: 'done', name: 'Done', category: 'completed', is_terminal: true },
    review: { key: 'review', name: 'Code review', category: 'review', is_terminal: false },
    active: { key: 'dev', name: 'Development', category: 'active', is_terminal: false },
    blocked: { key: 'blocked', name: 'Blocked', category: 'blocked', is_terminal: false },
    queued: { key: 'todo', name: 'Todo', category: 'queued', is_terminal: false },
    backlog: { key: 'backlog', name: 'Backlog', category: 'backlog', is_terminal: false },
  }

export function mapId(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
}

const START = Date.parse('2026-06-01T09:00:00Z')

function stamp(hours: number): string {
  return new Date(START + hours * 3_600_000).toISOString().replace('.000', '')
}

interface MapMemberOptions {
  /** Hours after the fixture's start a closed member was closed. */
  closed?: number
  /** Hours after the fixture's start the member was created. */
  created?: number
  holder?: string
  ready?: boolean
  title?: string
}

/** One member, identified by its reference; its id is derived from the number. */
export function mapMember(
  reference: string,
  group: Group,
  parent: string | null,
  options: MapMemberOptions = {},
) {
  const number = Number(reference.slice(reference.lastIndexOf('-') + 1))
  const created = options.created ?? number
  const state = STATES[group]
  return {
    work_item_id: mapId(number),
    reference,
    title: options.title ?? `Chain step ${number}`,
    state: { ...state },
    claim_ref: options.holder ?? '',
    claim_state: options.holder ? ('live' as const) : null,
    parent_reference: parent,
    created_at: stamp(created),
    closed_at: state.is_terminal ? stamp(options.closed ?? created + 24) : null,
    ready: options.ready ?? false,
  }
}

export type MapMember = ReturnType<typeof mapMember>
export interface MapEdge {
  from: string
  kind: 'blocks' | 'discovered-from'
  to: string
}

interface MapRoot {
  id: string
  reference: string
  title?: string
}

interface ChainExtras {
  edges?: MapEdge[]
  /** The last seven days as the server sums them; nothing moved unless given. */
  recent?: {
    closed: number
    created: number
    days: number
    trend: 'converging' | 'growing' | 'steady'
  }
  scope?: 'chain' | 'epic'
  /** Each parent epic's title, by reference. */
  titles?: Record<string, string>
  /** What each scope holds, where the chain's members alone do not say it. */
  totals?: { chain: number; epic: number }
}

function originsOf(root: MapRoot, members: MapMember[], titles: Record<string, string>) {
  const byParent = new Map<string | null, { count: number; open: number }>()
  for (const member of members) {
    const entry = byParent.get(member.parent_reference) ?? { count: 0, open: 0 }
    entry.count += 1
    if (!member.state.is_terminal) entry.open += 1
    byParent.set(member.parent_reference, entry)
  }
  const own = (parent: string | null) => Number(parent === root.reference)
  return [...byParent.entries()]
    .sort(([left, a], [right, b]) => own(right) - own(left) || b.count - a.count)
    .map(([parent, entry]) => ({
      parent_reference: parent,
      parent_title: parent === null ? null : (titles[parent] ?? root.title ?? 'Root'),
      ...entry,
    }))
}

/** Per day with any change, what was created and closed, and the totals so far. */
function seriesOf(members: MapMember[]) {
  const created = new Map<string, number>()
  const closed = new Map<string, number>()
  const bump = (days: Map<string, number>, stamp: string) =>
    days.set(stamp.slice(0, 10), (days.get(stamp.slice(0, 10)) ?? 0) + 1)
  for (const member of members) {
    bump(created, member.created_at)
    if (member.closed_at) bump(closed, member.closed_at)
  }
  let total = 0
  let closedTotal = 0
  return [...new Set([...created.keys(), ...closed.keys()])].sort().map((day) => {
    total += created.get(day) ?? 0
    closedTotal += closed.get(day) ?? 0
    return {
      day,
      created: created.get(day) ?? 0,
      closed: closed.get(day) ?? 0,
      total,
      closed_total: closedTotal,
    }
  })
}

/** The order of work by state category, as the server ranks a chain's members. */
const WORK_ORDER = ['active', 'review', 'queued', 'backlog', 'blocked', 'completed', 'cancelled']
const numberOf = (member: MapMember) => Number(member.reference.split('-').at(-1))

/**
 * Each member's place in the order of work: by category, then by number. These
 * fixtures name one state per category, so that is the server's order too.
 */
function ranked(members: MapMember[]) {
  const ordered = members.toSorted(
    (left, right) =>
      WORK_ORDER.indexOf(left.state.category) - WORK_ORDER.indexOf(right.state.category) ||
      numberOf(left) - numberOf(right),
  )
  const rank = new Map(ordered.map((member, index) => [member.work_item_id, index + 1]))
  return members.map((member) => ({ ...member, rank: rank.get(member.work_item_id) ?? 0 }))
}

/** A chain answer for these members and edges, its counts derived from them. */
export function chainOf(root: MapRoot, members: MapMember[], extras: ChainExtras = {}) {
  const closed = members.filter((member) => member.state.is_terminal).length
  const byCategory: Record<string, number> = {}
  for (const member of members)
    byCategory[member.state.category] = (byCategory[member.state.category] ?? 0) + 1
  return {
    root: {
      work_item_id: root.id,
      reference: root.reference,
      title: root.title ?? 'Root',
      kind: 'epic' as const,
      has_children: members.some((member) => member.parent_reference === root.reference),
      totals: extras.totals ?? {
        chain: members.length,
        epic: members.filter((member) => member.parent_reference === root.reference).length,
      },
    },
    scope: extras.scope ?? 'chain',
    total: members.length,
    closed,
    open: members.length - closed,
    ready: members.filter((member) => member.ready).length,
    by_category: byCategory,
    origins: originsOf(root, members, extras.titles ?? {}),
    series: seriesOf(members),
    recent: extras.recent ?? { days: 7, created: 0, closed: 0, trend: 'steady' as const },
    members: ranked(members),
    edges: extras.edges ?? [],
  }
}

/** What each day added and closed, keyed by how many days before `today` it was. */
export type DayChanges = Record<number, [created: number, closed: number]>

function trendOf(created: number, closed: number) {
  if (created > closed) return 'growing' as const
  return created < closed ? ('converging' as const) : ('steady' as const)
}

/**
 * A chain's series and seven-day window from per-day changes: the series in
 * day order with running totals, and the window — `today` and the six days
 * before it — summed as the server sums it.
 */
export function historyOf(today: string, changes: DayChanges) {
  const dayBefore = (ago: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - ago * 86_400_000).toISOString().slice(0, 10)
  let total = 0
  let closedTotal = 0
  const series = Object.entries(changes)
    .map(([ago, change]) => [Number(ago), change] as const)
    .sort(([left], [right]) => right - left)
    .map(([ago, [created, closed]]) => {
      total += created
      closedTotal += closed
      return { day: dayBefore(ago), created, closed, total, closed_total: closedTotal }
    })
  const window = series.filter((day) => day.day >= dayBefore(6))
  const created = window.reduce((sum, day) => sum + day.created, 0)
  const closed = window.reduce((sum, day) => sum + day.closed, 0)
  return { series, recent: { days: 7, created, closed, trend: trendOf(created, closed) } }
}

export function found(from: MapMember, to: { work_item_id: string }): MapEdge {
  return { from: from.work_item_id, to: to.work_item_id, kind: 'discovered-from' }
}

/** A builder for one lane: `count` members in one state, numbered from `first`. */
function laneOf(key: string, parent: string | null) {
  return (
    first: number,
    count: number,
    group: Group,
    options: (index: number) => MapMemberOptions = () => ({}),
  ) =>
    Array.from({ length: count }, (_, index) =>
      mapMember(`${key}-${first + index}`, group, parent, options(index)),
    )
}

const everyOtherDay = (index: number) => ({ created: index * 2, closed: index * 6 + 30 })
const daily = (index: number) => ({ created: index * 24, closed: index * 30 + 40 })

/**
 * The large chain. Numbers: the root's children from 2000, the discovered epic's
 * children from 3000, no-epic members from 4000 (the two epics among them first),
 * the second epic's from 5000, and the one member under each outside epic at
 * 6001 and 6002.
 */
export function branchedChain(root: MapRoot, key: string) {
  const epic = `${key}-4000`
  const second = `${key}-4001`
  const outside = [`${key}-7001`, `${key}-7002`]
  const own = laneOf(key, root.reference)
  const ownLane = [
    ...own(2000, 263, 'done', everyOtherDay),
    ...own(2263, 1, 'review', () => ({ created: 1200, holder: 'claude' })),
    ...own(2264, 2, 'active', () => ({ created: 1210, holder: 'codex' })),
    ...own(2266, 7, 'backlog', (index) => ({ created: 1300 + index, ready: true })),
  ]
  const under = laneOf(key, epic)
  const epicLane = [
    ...under(3000, 163, 'done', (index) => ({ created: 700 + index * 3, closed: 900 + index * 7 })),
    ...under(3163, 1, 'review', () => ({ created: 2000, holder: 'claude' })),
    ...under(3164, 8, 'active', (index) => ({
      created: 2010 + index,
      holder: index % 2 ? 'codex (session 1baa03d7)' : 'claude',
    })),
    ...under(3172, 1, 'blocked', () => ({ created: 2020 })),
    ...under(3173, 14, 'queued', (index) => ({ created: 2030 + index, ready: true })),
    ...under(3187, 56, 'backlog', (index) => ({ created: 2100 + index, ready: index < 40 })),
  ]
  const loose = laneOf(key, null)
  const noEpicLane = [
    mapMember(epic, 'active', null, { created: 690, title: 'Second wave' }),
    mapMember(second, 'backlog', null, { created: 1500, title: 'Follow-ups' }),
    ...loose(4002, 53, 'done', (index) => ({ created: 400 + index * 9, closed: 500 + index * 20 })),
    ...loose(4055, 5, 'queued', (index) => ({ created: 1800 + index, ready: true })),
    ...loose(4060, 28, 'backlog', (index) => ({ created: 1900 + index, ready: true })),
  ]
  const after = laneOf(key, second)
  const secondLane = [
    ...after(5000, 6, 'done', (index) => ({ created: 1510 + index, closed: 1600 + index * 5 })),
    ...after(5006, 5, 'backlog', (index) => ({ created: 1700 + index })),
  ]
  const outsideLanes = [
    mapMember(`${key}-6001`, 'backlog', outside[0], { created: 2400 }),
    mapMember(`${key}-6002`, 'queued', outside[1], { created: 2410, ready: true }),
  ]
  const [epicItem, secondItem] = noEpicLane
  const edges: MapEdge[] = [
    // The discovered epic was found while doing the 121st closed child of the root.
    found(epicItem, ownLane[120]),
    // The second epic came out of the discovered epic's 50th closed child.
    found(secondItem, epicLane[49]),
    // Each of the discovered epic's children came out of an earlier sibling, and
    // the first three out of the root's children.
    ...epicLane.map((member, index) =>
      found(member, index < 3 ? ownLane[121 + index] : epicLane[index - 3]),
    ),
    // No-epic work: the earliest from the root's 20th child, the rest from all over.
    ...noEpicLane
      .slice(2)
      .map((member, index) => found(member, index % 2 ? epicLane[index * 2] : ownLane[19 + index])),
    ...secondLane.map((member, index) =>
      found(member, index ? secondLane[index - 1] : epicLane[49]),
    ),
    found(outsideLanes[0], ownLane[268]),
    found(outsideLanes[1], epicLane[180]),
    // A second source for many: discovery is dense.
    ...epicLane.slice(10, 150).map((member, index) => found(member, ownLane[(index * 7) % 263])),
    ...noEpicLane.slice(30).map((member, index) => found(member, epicLane[(index * 5) % 163])),
    // Two blocking links between open items.
    { from: epicLane[171].work_item_id, to: epicLane[172].work_item_id, kind: 'blocks' },
    { from: noEpicLane[0].work_item_id, to: epicLane[180].work_item_id, kind: 'blocks' },
  ]
  return chainOf(root, [...ownLane, ...epicLane, ...noEpicLane, ...secondLane, ...outsideLanes], {
    edges,
    titles: {
      [epic]: 'Second wave',
      [second]: 'Follow-ups',
      [outside[0]]: 'Old tooling',
      [outside[1]]: 'Docs pass',
    },
  })
}

/** Forty members in two lanes, 22 of them open. */
export function smallBranchedChain(root: MapRoot, key: string) {
  const own = laneOf(key, root.reference)
  const ownLane = [
    ...own(1001, 12, 'done', daily),
    ...own(1013, 1, 'review', () => ({ created: 400, holder: 'claude' })),
    ...own(1014, 2, 'active', () => ({ created: 410, holder: 'codex' })),
    ...own(1016, 5, 'backlog', (index) => ({ created: 420 + index, ready: true })),
  ]
  const loose = laneOf(key, null)
  const noEpicLane = [
    ...loose(1101, 6, 'done', (index) => ({ created: 100 + index * 20, closed: 200 + index * 30 })),
    ...loose(1107, 2, 'active', () => ({ created: 430, holder: 'codex' })),
    ...loose(1109, 1, 'blocked', () => ({ created: 440 })),
    ...loose(1110, 3, 'queued', (index) => ({ created: 450 + index, ready: true })),
    ...loose(1113, 8, 'backlog', (index) => ({ created: 460 + index })),
  ]
  const edges: MapEdge[] = [
    ...noEpicLane.map((member, index) => found(member, ownLane[3 + (index % 9)])),
    { from: noEpicLane[6].work_item_id, to: noEpicLane[8].work_item_id, kind: 'blocks' },
  ]
  return chainOf(root, [...ownLane, ...noEpicLane], { edges })
}
