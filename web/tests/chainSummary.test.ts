/**
 * Which rows of a chain group name their own state. The heading of a group
 * names the state when every member shares it, so a row there would only say it
 * again; a group that mixes states is headed by its category, and then each row
 * is the only place its state is said.
 */
import { describe, expect, it } from 'vitest'

import {
  groupLabels,
  groupMembers,
  rowStateName,
} from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import { largeEpicChain } from './fixtures/chain.ts'

type Member = ReturnType<typeof largeEpicChain>['members'][number]

function inState(member: Member, key: string, name: string): Member {
  return { ...member, state: { ...member.state, key, name } } as Member
}

const word = (group: string) => `<${group}>`

describe('the word a chain section gives a group, and the state a row names', () => {
  const [first, second, third] = largeEpicChain().members.filter(
    (member) => member.state.key === 'backlog',
  )

  it('is the one state a group is in, and then its rows say nothing', () => {
    const group = [first, second, third]
    const labels = groupLabels(groupMembers(group), word)
    expect(labels.backlog).toEqual({ text: 'Backlog', state: true })
    expect(group.map((member) => rowStateName(labels.backlog, member))).toEqual([null, null, null])
  })

  it('is the group’s own word where it mixes states, and then each row names its own', () => {
    const group = [first, inState(second, 'icebox', 'Icebox'), third]
    const labels = groupLabels(groupMembers(group), word)
    expect(labels.backlog).toEqual({ text: '<backlog>', state: false })
    expect(group.map((member) => rowStateName(labels.backlog, member))).toEqual([
      'Backlog',
      'Icebox',
      'Backlog',
    ])
  })
})

describe('the order a chain group lists its members in', () => {
  const members = largeEpicChain().members

  it('is the order of work for open work, whatever the numbers say', () => {
    const queued = members.filter((member) => member.state.key === 'todo').slice(0, 3)
    // Placed in reverse: the newest item is the one that will be taken first.
    const placed = queued.map((member, index) => ({ ...member, rank: 100 - index }))
    expect(groupMembers(placed).queued.map((member) => member.reference)).toEqual(
      queued.map((member) => member.reference).reverse(),
    )
  })

  it('falls back to the number for members the order cannot tell apart', () => {
    const queued = members.filter((member) => member.state.key === 'todo').slice(0, 3)
    const tied = queued.map((member) => ({ ...member, rank: 7 }))
    expect(groupMembers([...tied].reverse()).queued.map((member) => member.reference)).toEqual(
      queued.map((member) => member.reference),
    )
  })

  it('stays most recently closed first for finished work', () => {
    const done = members.filter((member) => member.state.is_terminal).slice(0, 2)
    const closings = [
      { ...done[0], closed_at: '2026-10-01T10:00:00Z', rank: 1 },
      { ...done[1], closed_at: '2026-10-02T10:00:00Z', rank: 2 },
    ]
    expect(groupMembers(closings).done.map((member) => member.reference)).toEqual([
      done[1].reference,
      done[0].reference,
    ])
  })
})
