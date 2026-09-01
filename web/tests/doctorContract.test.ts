import assert from 'node:assert/strict'

import { test } from 'vitest'

import { validateDoctorReport } from '@/shared/api/doctorApi.ts'

function report() {
  return {
    checked_at: '2026-08-24T08:30:00Z',
    interface_version: 'valkama-doctor',
    levels: [
      {
        checks: [
          {
            detail: 'schema 5',
            fix: '',
            id: 'store-schema',
            presentation: { code: 'store-schema-supported', parameters: { stored: 5 } },
            status: 'ok',
            title: 'Store schema',
          },
        ],
        id: 'installation',
        status: 'ok',
        title: 'Installation',
      },
    ],
    status: 'ok',
    summary: { fail: 0, ok: 1, unknown: 0, warn: 0 },
  }
}

test('doctor reports require localized presentation facts and honest counts', () => {
  assert.equal(
    validateDoctorReport(report()).levels[0]?.checks[0]?.presentation.code,
    'store-schema-supported',
  )

  const noTimestamp = { ...report(), checked_at: undefined }
  assert.throws(() => validateDoctorReport(noTimestamp), /doctor\.checked_at: missing field/)

  const wrongSummary = { ...report(), summary: { fail: 0, ok: 0, unknown: 0, warn: 0 } }
  assert.throws(
    () => validateDoctorReport(wrongSummary),
    /doctor\.summary: counts do not match checks/,
  )

  const duplicate = report()
  const firstCheck = duplicate.levels[0]?.checks[0]
  assert.ok(firstCheck)
  duplicate.levels[0]?.checks.push({ ...firstCheck })
  duplicate.summary.ok = 2
  assert.throws(() => validateDoctorReport(duplicate), /doctor\.levels: duplicate check id/)
})
