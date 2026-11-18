/**
 * The rows of the Settings group that names accounts, in the order they stand: each organization
 * the year's work or the quota saw (`useSeenAccounts.ts`), the most agent time first, with its
 * accounts under it, the most first; then each key the owner named that neither saw, under its
 * organization where it is an account's (`accountIds.ts`), so that name can still be taken away.
 * A key that is no account's is an organization's.
 */
import type { SeenOrganization } from '@/pages/settings/composables/useSeenAccounts.ts'

import { readAccountId } from '@/shared/api/accountIds.ts'

export type AccountRow =
  | { id: string; kind: 'organization'; share: number | null }
  | {
      id: string
      kind: 'account'
      organization: string
      share: number | null
      shared: boolean
      /** Its UUID, or null for an account known by its weekly reset alone. */
      uuid: string | null
      weeklyReset: string | null
    }

export function seenAccountRows(
  organizations: readonly SeenOrganization[],
  named: readonly string[],
): AccountRow[] {
  const listed = new Map(
    organizations.map((organization) => [
      organization.id,
      { ...organization, accounts: [...organization.accounts] },
    ]),
  )
  const seen = new Set(
    organizations.flatMap((organization) => [
      organization.id,
      ...organization.accounts.map((account) => account.id),
    ]),
  )
  for (const key of [...named].sort()) {
    if (seen.has(key)) continue
    const read = readAccountId(key)
    const kept = read && read.kind !== 'unplaced'
    const organization = kept ? read.organization : key
    const holder = listed.get(organization) ?? { id: organization, share: null, accounts: [] }
    listed.set(organization, holder)
    if (kept)
      holder.accounts.push({
        id: key,
        weeklyReset: read.kind === 'weekly' ? read.weeklyReset : null,
        shared: false,
        share: null,
      })
  }
  return [...listed.values()].flatMap((organization) => [
    { kind: 'organization' as const, id: organization.id, share: organization.share },
    ...organization.accounts.map((account) => {
      const read = readAccountId(account.id)
      return {
        kind: 'account' as const,
        ...account,
        organization: organization.id,
        uuid: read?.kind === 'uuid' ? read.uuid : null,
      }
    }),
  ])
}
