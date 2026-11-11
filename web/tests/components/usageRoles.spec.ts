/**
 * Who did an item's work, on its Agents tab: the session's own agent, each subagent by the class it
 * was launched with, an adviser as a row of its own with the class of the run it advised in, each
 * with the effort it ran at and its time, tokens and cost, in the order the read ranks them. «None» and «unknown» are rows apart and say
 * which they are. The rows add up to the tab's own totals.
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'

import { NO_TOKENS, whoUsage } from '../fixtures/usage.ts'
import { mountSummary } from './usageSummaryHost.ts'

type Role = ItemUsage['roles'][number]

const value = (id: string | null, unknown = false) => ({ id, unknown })

function role(line: Partial<Role> & Pick<Role, 'role' | 'seconds'>): Role {
  return {
    launch_class: value(null),
    effort: value(null),
    tokens: { ...NO_TOKENS, input: 1000 },
    estimated_api_cost_usd: 1,
    unpriced_tokens: 0,
    ...line,
  }
}

/** A read whose totals are what its role rows add up to. */
function usageOf(roles: Role[]): ItemUsage {
  const seconds = roles.reduce((sum, line) => sum + line.seconds, 0)
  const cost = roles.reduce((sum, line) => sum + (line.estimated_api_cost_usd ?? 0), 0)
  const input = roles.reduce((sum, line) => sum + (line.tokens.input ?? 0), 0)
  return whoUsage({
    elapsed_seconds: seconds,
    agent_seconds: seconds,
    estimated_api_cost_usd: cost,
    tokens: { ...NO_TOKENS, input },
    models: [],
    account_stretches: [],
    accounts: [],
    roles,
  })
}

/** Each row of the roles' list as it is read: its name and its three figures. */
function rolesOf(wrapper: ReturnType<typeof mountSummary>) {
  return wrapper
    .findAll('[data-breakdown="roles"] .work-usage-row')
    .map((row) => [...row.findAll('.work-usage-name, .usage-fact')].map((part) => part.text()))
}

/** What the tab's head says a figure is, by its word. */
function headFigure(wrapper: ReturnType<typeof mountSummary>, label: string) {
  const figure = wrapper
    .findAll('.work-usage-figure')
    .find((one) => one.text().startsWith(`${label} `))
  return figure?.find('.work-usage-value').text()
}

describe('who did the work', () => {
  afterEach(() => document.body.replaceChildren())

  it('ranks the rows, keeps the adviser apart and tells none from unknown', () => {
    const wrapper = mountSummary(
      usageOf([
        role({
          role: 'subagent',
          launch_class: value('bero'),
          effort: value('high'),
          seconds: 7200,
          estimated_api_cost_usd: 30,
        }),
        role({ role: 'main', effort: value('high'), seconds: 3600, estimated_api_cost_usd: 12 }),
        role({
          role: 'subagent',
          launch_class: value(null, true),
          effort: value(null, true),
          seconds: 1800,
          estimated_api_cost_usd: 6,
        }),
        role({
          role: 'advisor',
          launch_class: value('bero'),
          effort: value('high'),
          seconds: 0,
          estimated_api_cost_usd: 3,
        }),
        role({ role: 'advisor', effort: value('high'), seconds: 0, estimated_api_cost_usd: 2 }),
      ]),
    )
    expect(rolesOf(wrapper)).toEqual([
      ['Subagent · bero · effort high', '2\u{A0}h', '1K tokens', '≈\u{A0}$30.00'],
      ['Main agent · no launch class · effort high', '1\u{A0}h', '1K tokens', '≈\u{A0}$12.00'],
      [
        'Subagent · launch class unknown · effort unknown',
        '30\u{A0}min',
        '1K tokens',
        '≈\u{A0}$6.00',
      ],
      ['Adviser · bero · effort high', 'on the side', '1K tokens', '≈\u{A0}$3.00'],
      ['Adviser · no launch class · effort high', 'on the side', '1K tokens', '≈\u{A0}$2.00'],
    ])
    expect(wrapper.get('[data-breakdown="roles"]').attributes('aria-label')).toBe(
      'By role, launch class and effort',
    )
  })

  it('adds up to the tab’s totals: the time of all agents, the cost and the tokens', () => {
    const usage = whoUsage()
    const wrapper = mountSummary(usage)
    expect(wrapper.findAll('[data-breakdown="roles"] .work-usage-row')).toHaveLength(3)
    const sum = (pick: (line: Role) => number) =>
      usage.roles.reduce((total, line) => total + pick(line), 0)
    expect(sum((line) => line.seconds)).toBe(usage.agent_seconds)
    expect(sum((line) => Math.round((line.estimated_api_cost_usd ?? 0) * 1e6))).toBe(
      Math.round((usage.estimated_api_cost_usd ?? 0) * 1e6),
    )
    for (const kind of Object.keys(usage.tokens) as (keyof Role['tokens'])[])
      expect(sum((line) => line.tokens[kind] ?? 0)).toBe(usage.tokens[kind] ?? 0)
    // The head says those totals: the rows' time is all agents', their cost the tab's cost.
    expect(headFigure(wrapper, 'All agents')).toBe('≈\u{A0}11\u{A0}h\u{A0}14\u{A0}min')
    expect(headFigure(wrapper, 'Cost')).toBe('≈\u{A0}$240.67')
    expect(rolesOf(wrapper).map((row) => row[0])).toEqual([
      'Subagent · bero · effort high',
      'Main agent · no launch class · effort unknown',
      'Adviser · no launch class · effort unknown',
    ])
  })
})
