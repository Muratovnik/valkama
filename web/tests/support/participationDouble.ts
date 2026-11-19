/**
 * The server's participation setting as a test double: the shared values, a space's own ones
 * and the labels' rules, read and written through the forms the HTTP contract names.
 *
 * Its sets, defaults and bounds are the owner's table of the setting, written out here rather
 * than taken from the web's own code, so a test that reads the screen against it checks the
 * screen against the contract. A write can be refused by `refuse`, which answers with the
 * server's refusal shape and changes nothing, as the server does.
 */

type Values = Record<string, string | number>
type Rule = { description: string | null; ready: boolean | null }

const D = { agent: 'agent', human: 'human' } as const
const POINTS = [
  'finding',
  'proposed_goal',
  'task_in_goal',
  'decision',
  'cancel_outside',
  'cancel_shared',
  'condition',
  'goal_close',
  'goal_defer',
]
/** Every key, in the order the server reads them out. */
const KEYS = [
  'queue',
  ...POINTS,
  'triage_reminder',
  'triage_age_days',
  'triage_count',
  'lease_quiet_days',
  'recent_close_minutes',
]
const NUMBERS: Record<string, number> = {
  triage_age_days: 10,
  triage_count: 100,
  lease_quiet_days: 3,
  recent_close_minutes: 30,
}
const BOUNDS: Record<string, [number, number]> = {
  triage_age_days: [1, 365],
  triage_count: [1, 10_000],
  lease_quiet_days: [1, 60],
  recent_close_minutes: [1, 1440],
}

/** The four sets, column by column: minimal, default, maximal, manual. */
function sets(): Record<string, Values> {
  const table: Record<string, string[]> = {
    queue: ['on', 'on', 'on', 'off'],
    finding: [D.agent, D.human, D.human, D.human],
    proposed_goal: [D.agent, D.human, D.human, D.human],
    task_in_goal: [D.agent, D.agent, D.agent, D.human],
    decision: [D.agent, D.human, D.human, D.human],
    cancel_outside: [D.agent, D.agent, D.human, D.human],
    cancel_shared: [D.agent, D.human, D.human, D.human],
    condition: [D.agent, D.human, D.human, D.human],
    goal_close: [D.agent, D.agent, D.human, D.human],
    goal_defer: [D.agent, D.agent, D.human, D.human],
    triage_reminder: ['on', 'on', 'on', 'off'],
  }
  const names = ['minimal', 'default', 'maximal', 'manual']
  return Object.fromEntries(
    names.map((name, column) => [
      name,
      Object.fromEntries(Object.entries(table).map(([key, row]) => [key, row[column]])),
    ]),
  )
}

const SETS = sets()

export type ParticipationDoubleState = {
  /** Each scope's own label rules, by space key; '' is the shared scope. */
  labels?: Record<string, Record<string, Rule>>
  /** Each scope's own values, by space key; '' is the shared scope. */
  own?: Record<string, Values>
}

export type Write = Record<string, unknown> & { space: string | null }

export function participationDouble(
  state: ParticipationDoubleState = {},
  refuse: (write: Write) => string | null = () => null,
) {
  const own: Record<string, Values> = structuredClone(state.own ?? {})
  const labels: Record<string, Record<string, Rule>> = structuredClone(state.labels ?? {})

  const ownOf = (scope: string, key: string) => own[scope]?.[key]
  const inherited = (scope: string, key: string) =>
    (scope ? ownOf('', key) : undefined) ?? NUMBERS[key] ?? SETS.default[key]
  const value = (scope: string, key: string) => ownOf(scope, key) ?? inherited(scope, key)
  const ruleAbove = (
    scope: string,
    label: string,
  ): { description: string | null; ready: boolean } =>
    scope ? ruleIn('', label) : { ready: false, description: null }
  function ruleIn(scope: string, label: string) {
    const above = ruleAbove(scope, label)
    const mine = labels[scope]?.[label]
    return {
      ready: mine?.ready ?? above.ready,
      description: mine?.description ?? above.description,
    }
  }

  function read(space: string | null) {
    const scope = space ?? ''
    const chosen = Object.fromEntries(
      Object.keys(SETS.default).map((key) => [key, value(scope, key)]),
    )
    const set =
      Object.entries(SETS).find(([, values]) =>
        Object.entries(values).every(([key, wanted]) => chosen[key] === wanted),
      )?.[0] ?? 'custom'
    const named = new Set([...Object.keys(labels[''] ?? {}), ...Object.keys(labels[scope] ?? {})])
    return {
      scope: space,
      set,
      sets: structuredClone(SETS),
      values: KEYS.map((key) => ({
        key,
        value: value(scope, key),
        own: ownOf(scope, key) !== undefined,
        inherited: inherited(scope, key),
      })),
      labels: [...named].sort().map((label) => ({
        label,
        ...ruleIn(scope, label),
        own: labels[scope]?.[label] !== undefined,
        inherited: ruleAbove(scope, label),
      })),
    }
  }

  function put(scope: string, key: string, next: string | number | null) {
    own[scope] = { ...own[scope] }
    if (next === null) Reflect.deleteProperty(own[scope], key)
    else own[scope][key] = next
  }

  /** The server's answer to one write: the scope's read, or a refusal. */
  function write(body: Write): { body: unknown; status: number } {
    const refused = refuse(body)
    if (refused !== null)
      return { status: 400, body: { error: { code: 'invalid', message: refused } } }
    const scope = body.space ?? ''
    if ('key' in body) {
      const key = String(body.key)
      const bound = BOUNDS[key]
      const given = body.value as string | number | null
      if (bound && typeof given === 'number' && (given < bound[0] || given > bound[1]))
        return {
          status: 400,
          body: {
            error: {
              code: 'invalid',
              message: `${key} is a whole number from ${bound[0]} to ${bound[1]}`,
            },
          },
        }
      put(scope, key, given)
    } else if ('set' in body) {
      const chosen = body.set === null ? null : SETS[body.set as string]
      for (const key of Object.keys(SETS.default)) put(scope, key, chosen?.[key] ?? null)
    } else {
      const label = String(body.label)
      const rule = {
        ready: body.ready as boolean | null,
        description: body.description as string | null,
      }
      labels[scope] = { ...labels[scope] }
      if (rule.ready === null && rule.description === null)
        Reflect.deleteProperty(labels[scope], label)
      else labels[scope][label] = rule
    }
    return { status: 200, body: read(body.space) }
  }

  return { read, write }
}
