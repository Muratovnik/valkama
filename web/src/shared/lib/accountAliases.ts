/**
 * The owner's names for the accounts agent work was billed to. The usage rows hold only an
 * account's organization id, and nothing on the machine names most accounts, so the owner names
 * them in Settings and the Analytics page says that name, with the id in its hint. They are kept
 * with the other settings on this device (`settings.ts`): a browser and the desktop app each
 * remember their own.
 */

/** A name by the account's id; an account with no name is not in it. */
export type AccountAliases = Readonly<Record<string, string>>

export const MAX_ACCOUNT_ALIAS_LENGTH = 80

/** An id as the usage read gives one (`analyticsApi.ts`): 1 to 512 characters, no NUL. */
const ACCOUNT_ID = /^[^\u{0}]{1,512}$/u

/** A name as it is said: one line with its spaces collapsed, at most the bound; empty for none. */
function cleanAlias(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(' ').slice(0, MAX_ACCOUNT_ALIAS_LENGTH)
}

/** What a build stored, as names: anything that is no id or no name goes. */
export function readAccountAliases(raw: unknown): AccountAliases {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw).flatMap(([id, value]) => {
      const alias = typeof value === 'string' ? cleanAlias(value) : ''
      return ACCOUNT_ID.test(id) && alias ? [[id, alias]] : []
    }),
  )
}

/** The account's name, or null where the owner gave it none. */
export function aliasOf(aliases: AccountAliases, id: string): string | null {
  return Object.hasOwn(aliases, id) ? (aliases[id] ?? null) : null
}

/** The names with this account's set to `alias`; an empty one takes the account's name away. */
export function withAlias(aliases: AccountAliases, id: string, alias: string): AccountAliases {
  const said = cleanAlias(alias)
  const rest = Object.entries(aliases).filter(([named]) => named !== id)
  return Object.fromEntries(said ? [...rest, [id, said]] : rest)
}
