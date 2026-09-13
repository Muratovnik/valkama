import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  analyzeImprovements,
  approveImprovement,
  cancelImprovementJob,
  fetchImprovementsSnapshot,
  runImprovementAction,
  saveImprovementProfile,
  startEvaluation,
  subscribeImprovements,
  validateImprovementActionCase,
  validateImprovementCase,
  validateImprovementJob,
  validateImprovementProfile,
  validateImprovementsSnapshot,
} from '@/entities/improvement/api/improvementsApi.ts'
import {
  buildAnalyzePayload,
  buildProfilePayload,
} from '@/entities/improvement/utils/improvementDerivations.ts'

import {
  improvementCase,
  improvementCaseDetail,
  improvementCaseSummary,
  improvementEvalRun,
  improvementJob,
  improvementProfile,
  improvementsSnapshot,
} from './support/improvements.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

test('read models reject wrong interface version, scope, and unknown fields', () => {
  const valid = improvementsSnapshot('personal')
  assert.throws(() =>
    validateImprovementsSnapshot({ ...valid, interface_version: 'wrong' }, 'personal'),
  )
  assert.throws(() => validateImprovementsSnapshot({ ...valid, scope: 'other' }, 'personal'))
  assert.throws(() => validateImprovementsSnapshot({ ...valid, compatibility: true }, 'personal'))
  assert.doesNotThrow(() => validateImprovementsSnapshot(valid, 'personal'))
})

test('the canonical snapshot endpoint is strict and has no compatibility fields', async () => {
  const valid = improvementsSnapshot('personal', {
    cases: [improvementCaseSummary(1, { state: 'open' })],
  })
  assert.deepEqual(validateImprovementsSnapshot(valid, 'personal'), valid)
  assert.throws(
    () =>
      validateImprovementsSnapshot(
        {
          ...valid,
          cases: [{ ...improvementCaseSummary(1, { state: 'open' }), planning_card_id: null }],
        },
        'personal',
      ),
    /planning_card_id|unknown field/,
  )

  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = withSecurityBootstrap(async (input) => {
    calls.push(requestUrl(input))
    return new Response(JSON.stringify(valid), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  try {
    assert.deepEqual(await fetchImprovementsSnapshot('personal'), valid)
    assert.deepEqual(calls, ['/api/modules/improvements?scope=personal'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('case, profile, and job validators match the exact server mutation shapes', () => {
  const actionCase = improvementCaseDetail(1, {
    eval_runs: [improvementEvalRun(9, { job_id: 7 })],
  })
  assert.deepEqual(validateImprovementActionCase(actionCase, 1), actionCase)
  assert.throws(() =>
    validateImprovementActionCase(
      {
        ...actionCase,
        eval_runs: [{ ...actionCase.eval_runs[0], job_id: '7' }],
      },
      1,
    ),
  )
  assert.throws(() =>
    validateImprovementActionCase(
      { ...actionCase, eval_runs: [{ ...actionCase.eval_runs[0], state: 'succeeded' }] },
      1,
    ),
  )
  assert.throws(() =>
    validateImprovementActionCase(
      {
        ...actionCase,
        monitoring: {
          baseline_rate: 0,
          case_id: 1,
          comparable_sessions: 0,
          days: 3,
          high_critical_count: 0,
          recurrence_count: 0,
          started_at: '2026-01-01T10:00:00Z',
          updated_at: '2026-01-04T10:00:00Z',
        },
      },
      1,
    ),
  )

  const detail = improvementCase('personal', 1, { eval_runs: actionCase.eval_runs })
  assert.deepEqual(validateImprovementCase(detail, 'personal'), detail)
  assert.deepEqual(
    validateImprovementProfile(improvementProfile(), 'personal'),
    improvementProfile(),
  )
  assert.deepEqual(
    validateImprovementJob(improvementJob(), { kind: 'analysis', scope: 'personal' }),
    improvementJob(),
  )
  assert.throws(() =>
    validateImprovementJob(
      { ...improvementJob(), result_summary: null },
      { kind: 'analysis', scope: 'personal' },
    ),
  )
})

test('profile, analysis, and evaluation APIs send exact requests and validate every response', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  globalThis.fetch = withSecurityBootstrap(async (input, init) => {
    const url = requestUrl(input)
    calls.push({ input: url, init })
    let payload: unknown = improvementJob(6, 'personal', { kind: 'eval', state: 'running' })
    if (url.endsWith('/profile')) payload = improvementProfile('personal', { revision: 1 })
    else if (url.endsWith('/analyze')) payload = improvementJob(5, 'personal', { state: 'running' })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  try {
    await saveImprovementProfile({ ...improvementProfile(), expected_revision: 0 })
    await analyzeImprovements({ scope: 'personal', trigger: 'manual' })
    await startEvaluation({
      scope: 'personal',
      case_id: 1,
      phase: 'candidate',
      repo: 'C:\\repo',
      git_ref: 'HEAD',
    })

    assert.deepEqual(
      JSON.parse(requestBody(calls[0].init?.body)),
      buildProfilePayload({ ...improvementProfile(), expected_revision: 0 }),
    )
    assert.deepEqual(JSON.parse(requestBody(calls[1].init?.body)), {
      scope: 'personal',
      trigger: 'manual',
    })
    assert.deepEqual(JSON.parse(requestBody(calls[2].init?.body)), {
      scope: 'personal',
      case_id: 1,
      phase: 'candidate',
      repo: 'C:\\repo',
      git_ref: 'HEAD',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('every mutation rejects response fields outside its exact wire contract', async () => {
  const originalFetch = globalThis.fetch
  const invalidResponses: unknown[] = [
    { ...improvementProfile(), unexpected: true },
    { ...improvementJob(2), unexpected: true },
    { ...improvementJob(3, 'personal', { kind: 'eval' }), unexpected: true },
    { ...improvementCaseDetail(), unexpected: true },
    {
      interface_version: 'improvements-api',
      case: improvementCaseDetail(1, { state: 'approved' }),
      created: true,
      epic_work_item: 'QA-1',
      work_item: 'QA-2',
      launched: false,
      unexpected: true,
    },
    { ...improvementJob(4, 'personal', { state: 'cancelled' }), unexpected: true },
  ]
  globalThis.fetch = withSecurityBootstrap(
    async () =>
      new Response(JSON.stringify(invalidResponses.shift()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  const contractFailure = { code: 'improvements_contract_invalid' }
  try {
    await assert.rejects(
      () => saveImprovementProfile({ ...improvementProfile(), expected_revision: 0 }),
      contractFailure,
    )
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
      () => runImprovementAction('personal', 1, 'watch', { expected_revision: 1 }),
      contractFailure,
    )
    await assert.rejects(() => approveImprovement('personal', 1, 1), contractFailure)
    await assert.rejects(() => cancelImprovementJob('personal', 4), contractFailure)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('invalid Improvements SSE payloads are surfaced through the error callback', () => {
  const originalEventSource = globalThis.EventSource
  const sources: FakeEventSource[] = []
  class FakeEventSource {
    listeners = new Map<string, Array<(event: Event) => void>>()
    constructor() {
      sources.push(this)
    }
    addEventListener(type: string, handler: (event: Event) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
    }
    emit(type: string, event: Event) {
      for (const handler of this.listeners.get(type) ?? []) handler(event)
    }
    close() {}
  }
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  try {
    const errors: unknown[] = []
    subscribeImprovements(
      'personal',
      () => {},
      (error) => errors.push(error),
    )
    sources[0].emit(
      'message',
      new MessageEvent('message', {
        data: JSON.stringify({ interface_version: 'improvements-api-obsolete', scope: 'personal' }),
      }),
    )
    assert.equal(errors.length, 1)
    assert.equal((errors[0] as { code?: unknown }).code, 'improvements_contract_invalid')
  } finally {
    globalThis.EventSource = originalEventSource
  }
})

test('analysis/evaluation payload guards require scope and immutable eval inputs', async () => {
  assert.deepEqual(buildAnalyzePayload('personal'), { scope: 'personal', trigger: 'manual' })
  assert.throws(() => buildAnalyzePayload(''))
  await assert.rejects(() => runImprovementAction('   ', 1, 'watch', { expected_revision: 1 }))
  await assert.rejects(() =>
    startEvaluation({ scope: 'personal', case_id: 1, phase: 'baseline', repo: ' ', git_ref: '' }),
  )
  await assert.rejects(() =>
    startEvaluation({ scope: '   ', case_id: 1, phase: 'baseline', repo: '.', git_ref: 'HEAD' }),
  )
})

test('cancel posts the exact scoped job endpoint and rejects stale scope responses', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  globalThis.fetch = withSecurityBootstrap(async (input, init) => {
    calls.push({ input: requestUrl(input), init })
    return new Response(JSON.stringify(improvementJob(17, 'product', { state: 'cancelled' })), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  try {
    const cancelled = await cancelImprovementJob('product', 17)
    assert.equal(cancelled.state, 'cancelled')
    assert.equal(calls[0].input, '/api/modules/improvements/jobs/17/cancel')
    assert.equal(calls[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(requestBody(calls[0].init?.body)), { scope: 'product' })
    await assert.rejects(() => cancelImprovementJob('personal', 17), /unexpected scope/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('approval uses only case actions endpoint and preserves launched:false', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  globalThis.fetch = withSecurityBootstrap(async (input, init) => {
    calls.push({ input: requestUrl(input), init })
    return new Response(
      JSON.stringify({
        interface_version: 'improvements-api',
        case: improvementCaseDetail(1, { state: 'approved' }),
        created: true,
        epic_work_item: 'QA-1',
        work_item: 'QA-2',
        launched: false,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  })
  try {
    const result = await approveImprovement('personal', 1, 3)
    assert.equal(result.launched, false)
    assert.equal(calls.length, 1)
    assert.match(calls[0].input, /\/api\/modules\/improvements\/cases\/1\/actions$/)
    assert.doesNotMatch(calls[0].input, /launch/)
    assert.deepEqual(JSON.parse(requestBody(calls[0].init?.body)), {
      scope: 'personal',
      action: 'approve',
      reason: '',
      target_case_id: null,
      signal_ids: [],
      snooze_until: null,
      expected_revision: 3,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('non-approval actions validate the raw case-detail response and exact revision payload', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  globalThis.fetch = withSecurityBootstrap(async (input, init) => {
    calls.push({ input: requestUrl(input), init })
    return new Response(JSON.stringify(improvementCaseDetail(1, { state: 'watching' })), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  try {
    const result = await runImprovementAction('personal', 1, 'watch', { expected_revision: 4 })
    assert.equal('state' in result ? result.state : '', 'watching')
    assert.deepEqual(JSON.parse(requestBody(calls[0].init?.body)), {
      scope: 'personal',
      action: 'watch',
      reason: '',
      target_case_id: null,
      signal_ids: [],
      snooze_until: null,
      expected_revision: 4,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Improvements stream closes locally and ignores frames after close', () => {
  const originalEventSource = globalThis.EventSource
  const sources: FakeEventSource[] = []
  class FakeEventSource {
    listeners = new Map<string, Array<(event: Event) => void>>()
    closed = false
    constructor() {
      sources.push(this)
    }
    addEventListener(type: string, handler: (event: Event) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
    }
    emit(type: string, event: Event) {
      for (const handler of this.listeners.get(type) ?? []) handler(event)
    }
    close() {
      this.closed = true
    }
  }
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  try {
    const received: unknown[] = []
    const first = subscribeImprovements('personal', (payload) => received.push(payload))
    const second = subscribeImprovements('personal', (payload) => received.push(payload))
    const payload = JSON.stringify(improvementsSnapshot())
    first.close()
    sources[0].emit('message', new MessageEvent('message', { data: payload }))
    sources[1].emit('message', new MessageEvent('message', { data: payload }))
    assert.equal(received.length, 1)
    second.close()
    assert.equal(sources[0].closed, true)
    assert.equal(sources[1].closed, true)
  } finally {
    globalThis.EventSource = originalEventSource
  }
})
