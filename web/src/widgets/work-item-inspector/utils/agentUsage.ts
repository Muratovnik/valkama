import { agentsByParent } from '@/widgets/work-item-inspector/utils/agentFacts.ts'

import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import type { UsageAgent } from '@/shared/api/planningUsageApi.ts'
import { sessionStart } from '@/shared/lib/actor.ts'

/**
 * The agents a card's record names and the runs its usage read counts are two lists of the same
 * people. The record names who stood on the item, by a claim as well as by a write; the read
 * counts who spent time on it, and that includes the session's own run, which the record never
 * names. On an epic the read is of the epic's own runs, so its children's runs are not in it. This
 * joins them into one list per parent session.
 */

interface AgentRow {
  /** What the record says of it; null for a run only the read counts. */
  agent: WorkItemAgent | null
  key: string
  /** What the read says it spent; null for an agent that spent nothing here. */
  spent: UsageAgent | null
}

/** A run's key; the session's own run has no agent, and `join` writes nothing for it. */
const rowKey = (session: string, agent: string | null) => [session, agent].join(':')

/** How many agents the tab lists: each once, whichever list names it. */
export function agentCount(agents: readonly WorkItemAgent[], spent: readonly UsageAgent[]): number {
  return new Set([
    ...agents.map((agent) => rowKey(agent.session_id, agent.agent_id)),
    ...spent.map((run) => rowKey(run.session_id, run.agent_id)),
  ]).size
}

/**
 * The rows under their parents. A group's rows that spent something come first, most time first,
 * as the read gives them, and then the rest as the record gives them, newest first: what the tab
 * is opened for stands at its head however many agents only stood by. A parent's own session is
 * the one the usage read knows it by. A session the record names nobody under stands after those
 * it does.
 */
export function agentRowGroups(agents: readonly WorkItemAgent[], spent: readonly UsageAgent[]) {
  const named = new Map(agents.map((agent) => [rowKey(agent.session_id, agent.agent_id), agent]))
  const groups = agentsByParent(agents).map((group) => ({
    ...group,
    /** The session as the usage reads name it. */
    usageSession: group.agents[0]?.session_id ?? group.session,
    rows: [] as AgentRow[],
  }))
  const bySession = new Map(groups.map((group) => [group.usageSession, group]))
  const counted = new Set<string>()
  for (const run of spent) {
    const key = rowKey(run.session_id, run.agent_id)
    let group = bySession.get(run.session_id)
    if (!group) {
      group = {
        agents: [],
        executor: null,
        session: run.session_id,
        shortSession: sessionStart(run.session_id),
        usageSession: run.session_id,
        rows: [],
      }
      groups.push(group)
      bySession.set(run.session_id, group)
    }
    group.rows.push({ agent: named.get(key) ?? null, key, spent: run })
    counted.add(key)
  }
  for (const group of groups) {
    for (const agent of group.agents) {
      const key = rowKey(agent.session_id, agent.agent_id)
      if (!counted.has(key)) group.rows.push({ agent, key, spent: null })
    }
  }
  return groups
}
