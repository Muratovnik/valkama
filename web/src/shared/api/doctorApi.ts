/**
 * The installation's own health, as the server diagnoses it.
 *
 * The browser never repeats a check. It validates the report, then presents the
 * server's stable semantic code in the active locale. Raw CLI prose remains
 * available as technical evidence without becoming the primary interface.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  plainObject,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { enumField, ID, ISO } from '@/shared/api/platformApiGuards.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'unknown'

class DoctorContractError extends Error {
  readonly code = 'doctor_contract_invalid' as const

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'DoctorContractError'
  }
}

function invalid(path: string, detail: string): never {
  throw new DoctorContractError(path, detail)
}

const statusSchema = enumField(['ok', 'warn', 'fail', 'unknown'] as const)
const parameterValueSchema = z.union([z.string().max(2048), z.number().safe(), z.boolean()])
const parametersSchema = plainObject
  .pipe(z.record(z.string().min(1).max(64), parameterValueSchema))
  .refine((value) => Object.keys(value).length <= 24, { message: 'too many parameters' })
const presentationSchema = strictObject({
  code: boundedText(ID),
  parameters: parametersSchema,
})
const checkSchema = strictObject({
  detail: z.string().min(1).max(4096),
  fix: z.string().max(4096),
  id: boundedText(ID),
  presentation: presentationSchema,
  status: statusSchema,
  title: z.string().min(1).max(160),
})
const levelSchema = strictObject({
  checks: boundedList(checkSchema, 128),
  id: boundedText(ID),
  status: statusSchema,
  title: z.string().min(1).max(160),
})
const reportSchema = strictObject({
  checked_at: boundedText(ISO, 96),
  interface_version: z.literal('valkama-doctor', { message: 'expected valkama-doctor' }),
  levels: boundedList(levelSchema, 16),
  status: statusSchema,
  summary: strictObject({
    fail: positiveInt(true),
    ok: positiveInt(true),
    unknown: positiveInt(true),
    warn: positiveInt(true),
  }),
})

export type DoctorCheck = z.infer<typeof checkSchema>
export type DoctorLevel = z.infer<typeof levelSchema>
export type DoctorReport = z.infer<typeof reportSchema>

export function validateDoctorReport(value: unknown, path = 'doctor'): DoctorReport {
  const report = parseContract(reportSchema, value, path, invalid)
  const checks = report.levels.flatMap((level) => level.checks)
  if (new Set(checks.map((check) => check.id)).size !== checks.length)
    invalid(`${path}.levels`, 'duplicate check id')
  const counted = Object.values(report.summary).reduce((total, count) => total + count, 0)
  if (counted !== checks.length) invalid(`${path}.summary`, 'counts do not match checks')
  for (const status of ['ok', 'warn', 'fail', 'unknown'] as const) {
    if (report.summary[status] !== checks.filter((check) => check.status === status).length)
      invalid(`${path}.summary.${status}`, 'count does not match checks')
  }
  return report
}

export async function fetchDoctorReport(): Promise<DoctorReport> {
  const response = await secureFetch('/api/doctor')
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  const payload: unknown = await response.json()
  return validateDoctorReport(payload)
}
