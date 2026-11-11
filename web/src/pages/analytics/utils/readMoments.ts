/**
 * The moments the usage read writes, as the days they name. The read writes a period's moments
 * at the one offset it was asked at — `2030-03-29T00:00:00+02:00` — so a moment's date is the
 * date at that offset, whatever the browser's zone said that night.
 */

const OFFSET = /(?:Z|([+-])(\d{2}):(\d{2}))$/u

/**
 * A moment of the read as the date and time it names at its own offset, held in a date to be
 * read in UTC: `2030-03-29T00:00:00+02:00` is 29 March, whatever the browser's zone said that
 * night. A day across a change of daylight saving time keeps the date the read gave it. `shift`
 * moves it first, in ms.
 */
export function named(moment: string, shift = 0) {
  const [, sign, hours = '0', minutes = '0'] = OFFSET.exec(moment) ?? []
  const size = Number(hours) * 60 + Number(minutes)
  const offset = sign === '-' ? -size : size
  return new Date(Date.parse(moment) + shift + offset * 60_000)
}

/** The day a moment of the read falls on, as a custom period names it: `2030-03-29`. */
export const dayOf = (moment: string) => named(moment).toISOString().slice(0, 10)

/** The last day a period ending at `moment` holds: the day of the instant before it ends. */
export const lastDayBefore = (moment: string) => named(moment, -1).toISOString().slice(0, 10)
