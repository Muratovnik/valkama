/**
 * Which rows of a chain group name their own state. The heading of a group
 * names the state when every member shares it, so a row there would only say it
 * again; a group that mixes states is headed by its category, and then each row
 * is the only place its state is said.
 */
import { describe, expect, it } from 'vitest'

import { rowStateName, sharedStateName } from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import { largeEpicChain } from './fixtures/chain.ts'

type Member = ReturnType<typeof largeEpicChain>['members'][number]

function inState(member: Member, key: string, name: string): Member {
  return { ...member, state: { ...member.state, key, name } } as Member
}

describe('the state a chain row names', () => {
  const [first, second, third] = largeEpicChain().members.filter(
    (member) => member.state.key === 'backlog',
  )

  it('is nothing in a group whose members share one state', () => {
    const group = [first, second, third]
    expect(sharedStateName(group)).toBe('Backlog')
    expect(group.map((member) => rowStateName(group, member))).toEqual([null, null, null])
  })

  it('is each row’s own in a group that mixes states', () => {
    const group = [first, inState(second, 'icebox', 'Icebox'), third]
    expect(sharedStateName(group)).toBeNull()
    expect(group.map((member) => rowStateName(group, member))).toEqual([
      'Backlog',
      'Icebox',
      'Backlog',
    ])
  })
})
