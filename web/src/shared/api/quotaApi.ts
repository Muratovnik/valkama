/**
 * The owner's quota settings and names for accounts, as the server keeps and checks them.
 *
 * The poll of the usage endpoint runs in the listener, so its switch lives on the
 * server, and a write starts or stops the poll there at once (connection contract,
 * "The poll of the usage endpoint"). A name is kept in the store by the account's id or its
 * organization's (`accountIds.ts`), so every device and the quota alerts say the same one
 * (connection contract, "The owner's names for accounts").
 */

import { parseContract, plainObject, strictObject, z } from '@/shared/api/contract.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import { readAccountAliases } from '@/shared/lib/accountAliases.ts'
import type { AccountAliases } from '@/shared/lib/accountAliases.ts'

export const settingsSchema = strictObject({ poll: z.boolean() })

export type QuotaSettings = z.infer<typeof settingsSchema>

function refused(path: string, detail: string): never {
  throw Object.assign(new Error(`${path}: ${detail}`), { code: 'quota_contract_invalid' })
}

async function settingsRequest(init?: RequestInit): Promise<QuotaSettings> {
  const { response, payload } = await readJsonResponse('/api/quota/settings', init)
  if (!response.ok)
    throw Object.assign(new Error(`${response.status} /api/quota/settings`), {
      code: 'request_failed',
      status: response.status,
    })
  return parseContract(settingsSchema, payload, 'quota.settings', refused)
}

export function fetchQuotaSettings(): Promise<QuotaSettings> {
  return settingsRequest()
}

/** The whole record goes every time: a key left out would be reset to its default. */
export function saveQuotaSettings(settings: QuotaSettings): Promise<QuotaSettings> {
  return settingsRequest({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

const NAMES_PATH = '/api/quota/account-names'
export const namesSchema = strictObject({ names: plainObject })

/** The server's own words for a refusal of a write, where it gave any. */
function refusalOf(payload: unknown): string | null {
  const error = (payload as { error?: { message?: unknown } } | null)?.error
  return typeof error?.message === 'string' ? error.message : null
}

async function namesRequest(init?: RequestInit): Promise<AccountAliases> {
  const { response, payload } = await readJsonResponse(NAMES_PATH, init)
  if (!response.ok)
    throw Object.assign(new Error(`${response.status} ${NAMES_PATH}`), {
      code: 'request_failed',
      status: response.status,
      detail: refusalOf(payload),
    })
  return readAccountAliases(parseContract(namesSchema, payload, 'quota.names', refused).names)
}

/** Every name the owner gave an account or an organization, by its id. */
export function fetchAccountNames(): Promise<AccountAliases> {
  return namesRequest()
}

/**
 * Name accounts, or with an empty name take an account's name away; the answer is every
 * name the store then holds. With `replace` false a name is kept only where the account has
 * none, which is how a device moves the names it kept without overwriting one given since.
 */
export function saveAccountNames(names: AccountAliases, replace = true): Promise<AccountAliases> {
  return namesRequest({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(replace ? { names } : { names, replace }),
  })
}

/** The server's words for a refused write of names, or null where the failure is ours to word. */
function accountNamesRefusal(error: unknown): string | null {
  const detail = (error as { detail?: unknown } | null)?.detail
  return typeof detail === 'string' ? detail : null
}

/**
 * Why a write of names failed, in words: the server's own for a refused name, or the failure's as
 * the app says any other. Settings and the quota's accounts both say it so.
 */
export function accountNamesFailure(
  error: unknown,
  t: (key: string, params: Record<string, unknown>) => string,
): string {
  const refusal = accountNamesRefusal(error)
  if (refusal !== null) return refusal
  const message = failureMessage(typedFailure(error))
  return t(message.key, message.params ?? {})
}
