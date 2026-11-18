/**
 * The owner's names for the accounts agent work was billed to and their organizations. Nothing on
 * the machine names most accounts, so the owner names them in Settings and the Analytics page says
 * that name (`accountLabel.ts`). Valkama keeps them in its store by the account's id or the
 * organization's (`accountIds.ts`, `quotaApi.ts`), so every device and the quota alerts say one
 * name; the server holds a write to the same rule this module writes a name by. Names a build
 * before that kept on this device, by the organization's id, wait in the device's settings
 * (`settings.ts`) until they move there once (`accountNamesStore.ts`).
 */

/** A name by the account's id; an account with no name is not in it. */
export type AccountAliases = Readonly<Record<string, string>>

export const MAX_ACCOUNT_ALIAS_LENGTH = 80

/** An id as the usage read gives one (`analyticsApi.ts`): 1 to 512 characters, no NUL. */
const ACCOUNT_ID = /^[^\u{0}]{1,512}$/u

/**
 * A name as it is said: one line with its spaces collapsed, at most the bound; empty for none.
 * The bound counts characters as the server does, so a cut never splits one in two.
 */
export function cleanAlias(value: string): string {
  const said = value.split(/\s+/u).filter(Boolean).join(' ')
  return Array.from(said).slice(0, MAX_ACCOUNT_ALIAS_LENGTH).join('')
}

/** What a build stored or the server answered, as names: anything that is no id or no name goes. */
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
