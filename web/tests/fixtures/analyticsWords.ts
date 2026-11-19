/**
 * The inventory of the Analytics page's words: every message of `analytics.*`, in both languages,
 * by what it does on the page. `analyticsWords.test.ts` holds it to the catalog, so a message
 * added or removed without its kind fails there, and the page's acceptance reads its caveats.
 *
 * - `label` names something: a heading, a control, a column, a value's name, a hint's detail.
 * - `value` says what the read holds: a figure with its short label, a change, a state of a read
 *   (none, failed, not yet), a fact a hint adds about one mark.
 * - `caveat` qualifies a whole section and is said once, in the «ⓘ» of its heading.
 * - `instruction` tells the reader what to do to get somewhere.
 *
 * An entry names a message or a whole branch of the catalog; the longest that holds a message
 * says its kind.
 */
export type WordKind = 'caveat' | 'instruction' | 'label' | 'value'

export const ANALYTICS_WORDS: Record<string, WordKind> = {
  'analytics.title': 'label',
  'analytics.failed': 'value',
  'analytics.unread': 'value',
  'analytics.rail': 'value',
  'analytics.rail.rest': 'label',
  'analytics.empty.title': 'value',
  'analytics.empty.description': 'instruction',
  'analytics.empty.unfiltered': 'instruction',
  'analytics.period': 'label',
  'analytics.period.reversed': 'value',
  'analytics.period.incomplete': 'instruction',
  'analytics.period.choose': 'instruction',
  'analytics.scope': 'label',
  'analytics.scope.aboutProject': 'value',
  'analytics.scope.aboutAll': 'value',
  'analytics.dimensions': 'label',
  'analytics.roles': 'label',
  'analytics.values': 'label',
  'analytics.chart': 'label',
  'analytics.byDimension': 'label',
  'analytics.bars.empty': 'value',
  'analytics.days': 'value',
  'analytics.days.title': 'label',
  'analytics.days.note': 'label',
  'analytics.days.total': 'label',
  'analytics.days.other': 'label',
  'analytics.marks.share': 'value',
  'analytics.about.label': 'label',
  'analytics.shown': 'label',
  'analytics.measures': 'label',
  'analytics.figures': 'value',
  'analytics.figures.costNote': 'caveat',
  'analytics.figures.timeNote': 'caveat',
  'analytics.figures.perHour.costDetail': 'label',
  'analytics.figures.perHour.tokensDetail': 'label',
  'analytics.change': 'value',
  'analytics.table': 'value',
  'analytics.table.title': 'label',
  'analytics.table.change': 'label',
  'analytics.table.download': 'label',
  'analytics.detail': 'label',
  'analytics.detail.full': 'value',
  'analytics.detail.failed': 'value',
  'analytics.detail.empty': 'value',
  'analytics.detail.shareOf': 'value',
  'analytics.detail.window.missing': 'value',
  'analytics.drill': 'label',
  'analytics.drill.full': 'instruction',
  'analytics.filters': 'label',
  'analytics.filters.failed': 'value',
  'analytics.filters.noMatches': 'value',
  'analytics.filters.full': 'value',
  'analytics.frame': 'label',
  'analytics.frame.fresh': 'value',
  'analytics.frame.freshNone': 'value',
  'analytics.frame.refreshFailed': 'value',
  'analytics.kinds': 'label',
  'analytics.kinds.count': 'value',
  'analytics.overview': 'value',
  'analytics.overview.before.word': 'label',
  'analytics.overview.changes.title': 'label',
  'analytics.overview.changes.label': 'label',
  'analytics.overview.changes.up': 'label',
  'analytics.overview.changes.down': 'label',
  'analytics.overview.cards': 'label',
  'analytics.overview.cards.failed': 'value',
  'analytics.overview.cards.empty': 'value',
  'analytics.panel.bars.all': 'label',
  'analytics.panel.multiples': 'label',
  'analytics.panel.split': 'label',
  'analytics.panel.table': 'label',
  'analytics.panel.table.counts': 'value',
  'analytics.panel.table.sorted': 'value',
  'analytics.panel.table.direction': 'value',
  'analytics.panel.table.failed': 'value',
  'analytics.panel.table.kinds.note': 'caveat',
  'analytics.quota': 'value',
  'analytics.quota.sections': 'label',
  'analytics.quota.windows': 'label',
  'analytics.quota.tile.detail': 'label',
  'analytics.quota.panel.heading': 'label',
  'analytics.quota.panel.intro': 'caveat',
  'analytics.quota.panel.account': 'caveat',
  'analytics.quota.table': 'label',
  'analytics.quota.table.empty': 'value',
  'analytics.quota.spent.title': 'label',
  'analytics.quota.spent.by': 'label',
  'analytics.quota.spent.breakdowns': 'label',
  'analytics.quota.spent.basis': 'caveat',
  'analytics.quota.spent.label': 'label',
  'analytics.quota.spent.value': 'label',
  'analytics.quota.readings.caption': 'label',
  'analytics.quota.readings.time': 'label',
  'analytics.quota.readings.value': 'label',
  'analytics.quota.readings.note': 'label',
  'analytics.quota.readings.line': 'label',
  'analytics.quota.readings.even': 'label',
  'analytics.time': 'value',
  'analytics.time.steps': 'label',
  'analytics.time.estimate': 'caveat',
}

/** A section of the page, as the «ⓘ» of its heading speaks for it. */
export type CaveatSection = 'kinds' | 'quota' | 'spending'

/**
 * Where each caveat is said: the sections whose «ⓘ» holds it — `spending` is the overview and a
 * dimension's section, which show the same figures — and whether it holds only for a period read
 * by the minute.
 */
export const CAVEATS: Record<string, { sections: readonly CaveatSection[]; minutes?: boolean }> = {
  'analytics.figures.costNote': { sections: ['spending'] },
  'analytics.figures.timeNote': { sections: ['spending'] },
  'analytics.panel.table.kinds.note': { sections: ['spending', 'kinds'] },
  'analytics.time.estimate': { sections: ['spending', 'kinds'], minutes: true },
  'analytics.quota.panel.intro': { sections: ['quota'] },
  'analytics.quota.panel.account': { sections: ['quota'] },
  'analytics.quota.spent.basis': { sections: ['quota'] },
}

/** Every message under a part of the catalog, by its key. */
export function flatten(node: unknown, prefix: string): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, child]) => flatten(child, `${prefix}.${key}`))
}

/** The entry that says a message's kind: the longest that is the key or a branch over it. */
export function entryOf(key: string): string | undefined {
  return Object.keys(ANALYTICS_WORDS)
    .filter((entry) => key === entry || key.startsWith(`${entry}.`))
    .sort((left, right) => right.length - left.length)[0]
}

/** A caveat's words in one language, as its key holds them. */
export function caveatText(catalog: unknown, key: string): string {
  const found = flatten(catalog, 'analytics').find(([one]) => one === key)
  if (!found) throw new Error(`no caveat ${key}`)
  return found[1]
}
