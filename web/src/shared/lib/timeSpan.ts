/**
 * How long something took or how long ago it was, in the one way the app says it: the
 * two largest units, each counted whole — `2 d 23 h`, `1 h 5 min`, `29 min`. A unit is
 * never rounded up, so a span never reads longer than it was, and the second unit keeps
 * what the first leaves out to under one of its own: 2.97 days is `2 d 23 h`, not
 * «2 days» and not «3 days».
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The catalog's words for a span, handed in so this stays pure. */
export interface SpanWords {
  /** Instead of «ago» for a span under a minute. */
  justNow: string
  /** A span under a minute. */
  lessThanMinute: string
  /** `{time} ago`, around a span. */
  ago: (time: string) => string
  days: (count: number) => string
  hours: (count: number) => string
  minutes: (count: number) => string
}

/** The dictionary's span words (`time.*`) through a component's own `t`. */
export function spanWordsOf(
  t: (key: string, values?: Record<string, unknown>) => string,
): SpanWords {
  return {
    ago: (time) => t('time.ago', { time }),
    days: (count) => t('time.days', { count }),
    hours: (count) => t('time.hours', { count }),
    justNow: t('time.justNow'),
    lessThanMinute: t('time.lessThanMinute'),
    minutes: (count) => t('time.minutes', { count }),
  }
}

/**
 * What stands between two units: a space no line breaks at, as the catalog's own words
 * keep a number with its unit, so «2 дн.» never ends a line that «23 ч» starts.
 */
const BETWEEN_UNITS = '\u{A0}'

/** The larger unit, and the smaller one where it counts anything. */
const units = (larger: string, smaller: string) =>
  [larger, smaller].filter(Boolean).join(BETWEEN_UNITS)

/** A span in its two largest units: `2 h 5 min`, `3 d 1 h`, `29 min`. */
export function spanWords(milliseconds: number, words: SpanWords): string {
  if (milliseconds < MINUTE) return words.lessThanMinute
  const days = Math.floor(milliseconds / DAY)
  const hours = Math.floor((milliseconds % DAY) / HOUR)
  const minutes = Math.floor((milliseconds % HOUR) / MINUTE)
  if (days > 0) return units(words.days(days), hours > 0 ? words.hours(hours) : '')
  if (hours > 0) return units(words.hours(hours), minutes > 0 ? words.minutes(minutes) : '')
  return words.minutes(minutes)
}

/** How long ago a moment was, from `now`; under a minute is «just now». */
export function agoWords(at: number, now: number, words: SpanWords): string {
  const span = now - at
  return span < MINUTE ? words.justNow : words.ago(spanWords(span, words))
}
