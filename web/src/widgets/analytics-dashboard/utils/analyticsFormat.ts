/**
 * How this dashboard says a number, and how it says it does not have one.
 *
 * "Not recorded" is not zero, and the distinction is the whole point: a board with
 * no cycle-time observations and a board with a cycle time of zero are different
 * facts, and printing 0 for the first one invents data. Every formatter here
 * returns the phrase rather than a placeholder digit.
 */

/** The five formatters, bound to a catalogue. */
export function analyticsFormatters(
  translate: (key: string, named?: Record<string, unknown>) => string,
) {
  const notRecorded = () => translate('dashboard.notRecorded')

  return {
    /** A count, grouped for the reader's locale. */
    value(input: number | null | undefined): string {
      return input === null || input === undefined
        ? notRecorded()
        : new Intl.NumberFormat().format(input)
    },

    /**
     * A duration at the coarsest unit that still says something.
     *
     * Seconds up to a minute, minutes up to an hour, then one decimal of hours and
     * of days — a cycle time of "31h" reads as a fact and "111600s" does not.
     */
    duration(input: number | null | undefined): string {
      if (input === null || input === undefined) return notRecorded()
      if (input < 60) return `${Math.round(input)}s`
      if (input < 3600) return `${Math.round(input / 60)}m`
      if (input < 86_400) return `${(input / 3600).toFixed(1)}h`
      return `${(input / 86_400).toFixed(1)}d`
    },

    /** A name the server left empty is a name it does not have. */
    nameLabel(name: string): string {
      return name || notRecorded()
    },

    /**
     * One day's tokens, or nothing.
     *
     * A partial record is not a total: if any component is missing or not finite
     * the day has no figure, because summing what is present would understate it
     * and look like a real measurement.
     */
    tokenCount(tokens: Record<string, number> | null): number | null {
      if (!tokens) return null
      const values = Object.values(tokens)
      return values.length && values.every((value) => Number.isFinite(value))
        ? values.reduce((sum, item) => sum + item, 0)
        : null
    },

    /** Where a day's figure came from, as the server described it. */
    tokenProvenance(quality: string, reason?: string | null, shared = false): string {
      return [quality, reason, shared ? translate('dashboard.shared') : '']
        .filter(Boolean)
        .join(' · ')
    },
  }
}
