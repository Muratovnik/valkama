/**
 * What the app calls an account by its id (`accountIds.ts`): the one rule the Analytics page and
 * Settings say an account by. The owner's name for the account comes first, and for an account
 * known by its UUID the name its weekly reset was given before the UUID was known; else its
 * organization's name, or the start of the organization's id, with what tells the account apart:
 * the start of its UUID, when its week resets in the reader's own time, or that the account is not
 * known. Work of no organization is no account, and an id that is no account's is said by its start.
 */
import { readAccountId, weeklyId } from '@/shared/api/accountIds.ts'
import { aliasOf } from '@/shared/lib/accountAliases.ts'
import type { AccountAliases } from '@/shared/lib/accountAliases.ts'

/** How much of an id an unnamed account or organization is said by, as an item's card says one. */
const ID_START = 8

/** The start of an id, as the app says an unnamed one. */
export const idStart = (id: string) => id.slice(0, ID_START)

/** The catalog's words an account with no name of its own is said by. */
export interface AccountWords {
  /** The reader's locale, for the weekday and the time a week resets. */
  locale: string
  /** An organization's work no reading places on an account: «Lab · account not known». */
  unplaced: (organization: string) => string
  /** An account known by its weekly reset: «Lab · resets Thu 12:00». */
  weekly: (organization: string, reset: string) => string
}

/** What the quota's answer named an account and its organization, until the names are read. */
export interface AnsweredNames {
  name: string | null
  organization: string | null
}

/** The local weekday and time a weekly reset falls on, `5T09:00Z` as «Fri 12:00» at +03:00. */
export function resetWords(weeklyReset: string, locale: string) {
  const [day, hours, minutes] = [
    weeklyReset.slice(0, 1),
    weeklyReset.slice(2, 4),
    weeklyReset.slice(5, 7),
  ]
  // 1 January 2024 was a Monday, so its week holds every ISO weekday in order.
  const moment = new Date(Date.UTC(2024, 0, Number(day), Number(hours), Number(minutes)))
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(moment)
}

/**
 * The name an account has of its own: the owner's for its id, else, for one known by its UUID, the
 * one its weekly reset was given; null where it has neither.
 */
export function ownAccountName(names: AccountAliases, id: string, weeklyReset: string | null) {
  const read = readAccountId(id)
  const inherited =
    read?.kind === 'uuid' && weeklyReset
      ? aliasOf(names, weeklyId(read.organization, weeklyReset))
      : null
  return aliasOf(names, id) ?? inherited
}

/** An account by its id and the time of week its week resets, as the rule above says it. */
export function accountLabel(
  names: AccountAliases,
  { id, weeklyReset }: { id: string; weeklyReset: string | null },
  words: AccountWords,
  answered: AnsweredNames | null = null,
) {
  const read = readAccountId(id)
  if (!read) return idStart(id)
  const named = aliasOf(names, read.organization) ?? answered?.organization ?? null
  const organization = named ?? idStart(read.organization)
  if (read.kind === 'unplaced') return words.unplaced(organization)
  const own = ownAccountName(names, id, weeklyReset) ?? answered?.name ?? null
  if (own) return own
  if (read.kind === 'weekly')
    return words.weekly(organization, resetWords(read.weeklyReset, words.locale))
  return named ? `${named} · ${idStart(read.uuid)}` : idStart(read.uuid)
}
