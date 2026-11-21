/**
 * The Analytics sweep's misses, and their summary by class and owner: one group per class, rule
 * and owning component, with its count by width, by period, by section and by measure, so a fix
 * can take a whole group rather than the one spot a remark named.
 */

/** The state of the page a miss was found in. */
export interface StateName {
  /** The measure the view was opened with; empty for the one the page opens on. */
  measure: string
  panel: boolean
  period: string
  section: string
  /** `opening` for the views a section opens on, else `<chart>:<view>` or the panel's opener. */
  view: string
  width: number
}

/** One miss of one class in one state. */
export interface Miss {
  class: 'forbidden' | 'overflow' | 'reach'
  detail: Record<string, unknown>
  owner: string
  path: string
  /** The rule that missed: a reach or overflow rule, or the forbidden text. */
  rule: string
  state: StateName
}

/** A group of misses one fix could take. */
export interface Group {
  byMeasure: Record<string, number>
  byPeriod: Record<string, number>
  bySection: Record<string, number>
  byWidth: Record<string, number>
  class: Miss['class']
  count: number
  /** A few of its misses, to find the group's members on the page. */
  examples: { path: string; state: string }[]
  owner: string
  /** The distinct places it was found, by selector path. */
  paths: number
  rule: string
}

const tally = (counts: Record<string, number>, key: string | number) => {
  counts[String(key)] = (counts[String(key)] ?? 0) + 1
}

const stateText = (state: StateName) =>
  [state.width, state.section, state.period, state.measure, state.view].filter(Boolean).join(' ') +
  (state.panel ? ' (panel)' : '')

/** The misses grouped by class, rule and owner, the largest group first, and the totals by class. */
export function summarize(misses: readonly Miss[]) {
  const groups = new Map<string, Group & { seen: Set<string> }>()
  const byClass: Record<string, number> = {}
  for (const miss of misses) {
    tally(byClass, miss.class)
    const key = `${miss.class}|${miss.rule}|${miss.owner}`
    const group = groups.get(key) ?? {
      class: miss.class,
      rule: miss.rule,
      owner: miss.owner || '(no component named)',
      count: 0,
      paths: 0,
      byWidth: {},
      byPeriod: {},
      byMeasure: {},
      bySection: {},
      examples: [],
      seen: new Set<string>(),
    }
    group.count += 1
    tally(group.byWidth, miss.state.width)
    tally(group.byPeriod, miss.state.period)
    tally(group.bySection, miss.state.section)
    tally(group.byMeasure, miss.state.measure || 'opening')
    if (!group.seen.has(miss.path)) {
      group.seen.add(miss.path)
      group.paths += 1
      if (group.examples.length < 3)
        group.examples.push({ path: miss.path, state: stateText(miss.state) })
    }
    groups.set(key, group)
  }
  return {
    total: misses.length,
    byClass,
    groups: [...groups.values()]
      .map(({ seen: _seen, ...group }) => group)
      .sort((a, b) => b.count - a.count || a.class.localeCompare(b.class)),
  }
}
