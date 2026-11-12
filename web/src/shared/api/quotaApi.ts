/**
 * The owner's quota settings, as the server keeps and checks them.
 *
 * The poll of the usage endpoint runs in the listener, so its switch lives on the
 * server, and a write starts or stops the poll there at once (connection contract,
 * "The poll of the usage endpoint").
 */

import { parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

const settingsSchema = strictObject({ poll: z.boolean() })

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
