/**
 * An account's id, as the `seat` dimension and the quota answer give it
 * (`docs/connection-contract.md`): its organization, a slash, and its UUID, or `weekly:` and the
 * time of week its week resets, `<ISO weekday>T<HH:MM>Z` in UTC, where no reading of it names a
 * UUID. An organization's work no reading places on an account is `<organization>/`. An
 * organization id holds no slash, so the id alone says which it is.
 */

export type AccountId =
  | { kind: 'uuid'; organization: string; uuid: string }
  | { kind: 'weekly'; organization: string; weeklyReset: string }
  | { kind: 'unplaced'; organization: string }

const WEEKLY = 'weekly:'

/** A weekly reset: the ISO weekday, then the time to ten minutes in UTC, `5T09:00Z`. */
export const WEEKLY_RESET = /^[1-7]T(?:[01]\d|2[0-3]):[0-5]0Z$/u

/** What an id says, or null for one that is no account's. */
export function readAccountId(id: string): AccountId | null {
  const slash = id.indexOf('/')
  if (slash < 1) return null
  const organization = id.slice(0, slash)
  const tail = id.slice(slash + 1)
  if (tail === '') return { kind: 'unplaced', organization }
  if (tail.includes('/')) return null
  if (!tail.startsWith(WEEKLY)) return { kind: 'uuid', organization, uuid: tail }
  const weeklyReset = tail.slice(WEEKLY.length)
  return WEEKLY_RESET.test(weeklyReset) ? { kind: 'weekly', organization, weeklyReset } : null
}

/** The id of an organization's work no reading places on an account. */
export const unplacedId = (organization: string) => `${organization}/`

/** The id of an account known by its weekly reset. */
export const weeklyId = (organization: string, weeklyReset: string) =>
  `${organization}/${WEEKLY}${weeklyReset}`

/**
 * Why an account's fields do not fit its id, or null where they do: `org/` has neither a UUID nor
 * a weekly reset, `org/<uuid>` has that UUID, and `org/weekly:<reset>` has that reset and no UUID.
 */
export function accountIdIssue(
  id: string,
  fields: {
    account_uuid?: string | null
    organization?: string | null
    weekly_reset?: string | null
  },
): string | null {
  const read = readAccountId(id)
  if (!read) return 'not an account id'
  if (fields.organization != null && fields.organization !== read.organization)
    return 'an account id starts with its organization'
  const uuid = fields.account_uuid ?? null
  const reset = fields.weekly_reset ?? null
  if (read.kind === 'unplaced')
    return uuid === null && reset === null ? null : 'no UUID or weekly reset without an account'
  if (read.kind === 'uuid') return uuid === read.uuid ? null : 'an account id names its UUID'
  return uuid === null && reset === read.weeklyReset
    ? null
    : 'a weekly account has its weekly reset and no UUID'
}
