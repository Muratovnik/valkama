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

/**
 * Whether a period from `from` to `to` lies wholly in the day running at `now` (ms), that day
 * taken at the period's own offset, as its moments name their days.
 */
export function withinToday(from: string, to: string, now = Date.now()) {
  const today = named(from, now - Date.parse(from))
    .toISOString()
    .slice(0, 10)
  return dayOf(from) === today && lastDayBefore(to) === today
}

const pad = (number: number) => String(number).padStart(2, '0')

/**
 * An instant as a moment at an offset, by default the browser's own at that instant: a record
 * the store wrote in UTC, said at the offset the read and its time axis are at, so its clock
 * time is the one the axis reads. `offset` is in minutes east of UTC.
 */
export function momentAtOffset(at: number, offset = -new Date(at).getTimezoneOffset()) {
  const wall = new Date(at + offset * 60_000).toISOString().slice(0, 19)
  const size = Math.abs(offset)
  return `${wall}${offset < 0 ? '-' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
}
