import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  analyzeImprovements,
  approveImprovement,
  cancelImprovementJob,
  runImprovementAction,
  startEvaluation,
} from '@/entities/improvement/api/improvementsApi.ts'

import { improvementCaseDetail, improvementJob } from './support/improvements.ts'
import { withSecurityBootstrap } from './support/request.ts'

test('mutation responses preserve the requested operation kind, scope, and identity', async () => {
  const originalFetch = globalThis.fetch
  const responses: unknown[] = [
    improvementJob(1, 'personal', { kind: 'eval' }),
    improvementJob(2, 'personal', { kind: 'analysis' }),
    improvementJob(3, 'other', { kind: 'analysis' }),
    improvementJob(99, 'personal', { state: 'cancelled' }),
    improvementCaseDetail(99, { state: 'watching' }),
    {
      interface_version: 'improvements-api',
      case: improvementCaseDetail(99, { state: 'approved' }),
      created: true,
      epic_work_item: 'QA-1',
      work_item: 'QA-2',
      launched: false,
    },
  ]
  globalThis.fetch = withSecurityBootstrap(
    async () =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  const contractFailure = { code: 'improvements_contract_invalid' }

  try {
    await assert.rejects(
      () => analyzeImprovements({ scope: 'personal', trigger: 'manual' }),
      contractFailure,
    )
    await assert.rejects(
      () =>
        startEvaluation({
          scope: 'personal',
          case_id: 1,
          phase: 'candidate',
          repo: 'C:\\repo',
          git_ref: 'HEAD',
        }),
      contractFailure,
    )
    await assert.rejects(
      () => analyzeImprovements({ scope: 'personal', trigger: 'manual' }),
      contractFailure,
    )
    await assert.rejects(() => cancelImprovementJob('personal', 4), contractFailure)
    await assert.rejects(
      () => runImprovementAction('personal', 1, 'watch', { expected_revision: 1 }),
      contractFailure,
    )
    await assert.rejects(() => approveImprovement('personal', 1, 1), contractFailure)
    assert.equal(responses.length, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
