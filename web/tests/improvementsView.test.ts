import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createSSRApp } from 'vue'

import { renderToString } from '@vue/server-renderer'
import { createServer } from 'vite'
import { test } from 'vitest'

import {
  allowedActions,
  ANALYZER_EFFORTS,
  buildActionPayload,
  buildProfilePayload,
  canCancelImprovementJob,
  evidenceExcerpt,
  filterCases,
  IMPROVEMENT_EVIDENCE_SOURCES,
  improvementActivationState,
  IMPROVEMENTS_INTERFACE_VERSION,
  sortCases,
  validateAction,
  visibleImprovementJobs,
} from '@/entities/improvement/utils/improvementDerivations.ts'
import type {
  ImprovementJobState,
  ImprovementSeverity,
  ImprovementState,
} from '@/entities/improvement/utils/improvementDerivations.ts'

import { i18n } from '@/shared/i18n/index.ts'

import {
  improvementCaseSummary,
  improvementJob,
  improvementSignalSummary,
} from './support/improvements.ts'
import { compactCss } from './support/source.ts'

const base = (id: number, state: ImprovementState, severity: ImprovementSeverity = 'medium') =>
  improvementCaseSummary(id, { state, severity })
const job = (id: number, state: ImprovementJobState, scope = 'personal') =>
  improvementJob(id, scope, { state })
/** One source file, read as text. The owned source files are asserted against here. */
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const viewSource = source('../src/pages/improvements/components/ImprovementsView.vue')
const runtimeSource = source('../src/pages/improvements/composables/useImprovementsRuntime.ts')
const apiSource = source('../src/entities/improvement/api/improvementsApi.ts')
const jobsSource = source('../src/pages/improvements/components/ImprovementJobs.vue')
const readinessSource = source('../src/pages/improvements/components/ImprovementReadiness.vue')
const caseListSource = source('../src/widgets/improvement-case/components/ImprovementCaseList.vue')

test('filters and sorts cases deterministically', () => {
  const cases = [base(1, 'open', 'low'), base(2, 'watching', 'critical')]
  assert.deepEqual(
    filterCases(cases, 'open').map((item) => item.id),
    [1],
  )
  assert.deepEqual(
    sortCases(cases, 'severity').map((item) => item.id),
    [2, 1],
  )
})

test('the narrow case ledger gives labels and status rows their own readable measure', () => {
  assert.match(compactCss(caseListSource), /\.filters\{[^}]*grid-template-columns:1fr;/)
  assert.match(
    compactCss(caseListSource),
    /\.case-row\{[^}]*grid-template-columns:minmax\(0,1fr\);/,
  )
  assert.match(
    compactCss(caseListSource),
    /\.case-state\{[^}]*display:flex[^}]*justify-content:space-between/,
  )
})
test('allowed actions follow case state', () => {
  assert.ok(allowedActions('open').includes('approve'))
  assert.deepEqual(allowedActions('false_positive'), ['reopen'])
})
test('action validation enforces merge/split/false-positive/snooze requirements', () => {
  const revision = { expected_revision: 1 }
  assert.ok(validateAction(buildActionPayload('   ', 'watch', revision)).length)
  assert.ok(validateAction(buildActionPayload('personal', 'merge', revision)).length)
  assert.ok(validateAction(buildActionPayload('personal', 'split', revision)).length)
  assert.ok(validateAction(buildActionPayload('personal', 'false_positive', revision)).length)
  assert.ok(
    validateAction(buildActionPayload('personal', 'snooze', { ...revision, reason: 'later' }))
      .length,
  )
  assert.equal(
    validateAction(
      buildActionPayload('personal', 'snooze', {
        ...revision,
        reason: 'later',
        snooze_until: '2026-08-10T12:00:00Z',
      }),
    ).length,
    0,
  )
})
test('evidence is bounded to excerpt and pointer/hash metadata', () => {
  const item = {
    id: 1,
    pointer: 'session:s/event:e',
    at: '',
    client: 'codex',
    session_id: 's',
    event_type: 'tool_end',
    severity: 'low' as const,
    excerpt: 'x'.repeat(2000),
    source_hash: 'sha256',
    source_kind: 'session_event' as const,
  }
  assert.equal(evidenceExcerpt(item).length, 1200)
  assert.equal('transcript' in item, false)
})
test('the real Improvements view renders for the explicit primary scope', async () => {
  i18n.global.locale.value = 'en'
  const root = fileURLToPath(new URL('..', import.meta.url))
  const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true } })
  try {
    const module = await vite.ssrLoadModule(
      '/src/pages/improvements/components/ImprovementsView.vue',
    )
    const app = createSSRApp(module.default, { active: true, scope: 'personal' })
    app.use(i18n)
    const html = await renderToString(app)
    assert.match(html, /aria-label="Continuous improvements"/)
    // The context bar names the module. A page that prints the same words again
    // is the duplicate title the shell rule exists to prevent.
    assert.doesNotMatch(html, />Continuous improvements</)
    assert.doesNotMatch(html, /No jobs for this scope\./)
    assert.doesNotMatch(html, /No recurring cases detected\./)
    assert.doesNotMatch(html, /launch/i)
  } finally {
    await vite.close()
  }
})
test('only queued and running jobs expose cancellation', () => {
  assert.equal(canCancelImprovementJob(job(1, 'queued')), true)
  assert.equal(canCancelImprovementJob(job(2, 'running')), true)
  for (const state of ['succeeded', 'failed', 'cancelled'])
    assert.equal(canCancelImprovementJob(job(3, state)), false)
  assert.deepEqual(
    visibleImprovementJobs([job(1, 'succeeded'), job(2, 'running'), job(3, 'failed')], 1).map(
      (item) => item.id,
    ),
    [2, 3],
  )
  const cancelBlock = runtimeSource.slice(
    runtimeSource.indexOf('async function cancelJob'),
    runtimeSource.indexOf('async function retryLoad'),
  )
  assert.match(
    cancelBlock,
    /const scope = source\.scope\(\)[\s\S]*const generation = viewGeneration/,
  )
  assert.match(cancelBlock, /if \(!isCurrent\(scope, generation\)\) return/)
})

test('analysis profile persists model and reasoning effort instead of keeping presentation-only settings', () => {
  const payload = buildProfilePayload({
    scope: 'personal',
    expected_revision: 3,
    analyzer_client: 'codex',
    analyzer_model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
  })
  assert.equal(payload.analyzer_model, 'gpt-5.6-sol')
  assert.equal(payload.reasoning_effort, 'high')
  assert.deepEqual(ANALYZER_EFFORTS, ['', 'low', 'medium', 'high', 'xhigh', 'max'])
})

test('Improvements exposes one command toolbar and a protected settings dialog', () => {
  assert.match(viewSource, /class="[^"]*improvements-commands[^"]*"/)
  // The toolbar is two shared buttons now, so the settings control is named by
  // its accessible label rather than by a class only this screen knew.
  assert.match(viewSource, /:aria-label="t\('improvements\.settingsTitle'\)"/)
  assert.doesNotMatch(viewSource, /class="[^"]*analysis-settings-action[^"]*"/)
  assert.match(viewSource, /<ImprovementProfileDialog/)
  assert.doesNotMatch(viewSource, /<details[^>]+profile-panel/)
  // The two panels are their own components, so the page's part is handing each
  // the state it draws.
  assert.match(jobsSource, /class="[^"]*job-actions[^"]*"/)
  assert.match(viewSource, /<ImprovementJobs/)
  assert.match(readinessSource, /class="[^"]*readiness-panel[^"]*"/)
  assert.match(viewSource, /<ImprovementReadiness/)
  assert.match(runtimeSource, /payload\.cases\.find[\s\S]*payload\.cases\[0\]/)
  assert.match(viewSource, /<PlatformStatePanel/)
})
test('the runtime owns one keyed ResourceState without blanking a committed snapshot', () => {
  assert.match(runtimeSource, /ResourceState<Observed<ImprovementsReadModel>>/)
  assert.match(runtimeSource, /resourceUiState\(resource\.value/)
  assert.match(runtimeSource, /fetchImprovementsSnapshot/)
  assert.doesNotMatch(runtimeSource, /fetchImprovementProfile|fetchImprovementCases/)
  assert.doesNotMatch(
    runtimeSource,
    /catch \(error\)[\s\S]{0,500}(?:profile|cases|snapshot)\.value = (?:null|\[\])/,
  )
})

test('Improvements presents localized failure descriptors and never response prose', () => {
  assert.match(runtimeSource, /failureMessage\(operationFailure\.value\)/)
  assert.match(runtimeSource, /failureReason: \(\) => 'improvements\.loadError'/)
  assert.doesNotMatch(apiSource, /response\.text\(|error\.message|String\(error\)/)
  assert.doesNotMatch(viewSource, /errorMessage|retryLabel/)
})

test('activation is explicit: disabled profiles must be enabled, supplied evidence must be recorded, then analysis can run', () => {
  const disabled = improvementActivationState(
    { enabled: false, capabilities: { can_analyze: false } },
    improvementSignalSummary(),
    0,
  )
  assert.equal(IMPROVEMENTS_INTERFACE_VERSION, 'improvements-api')
  assert.equal(disabled.status, 'disabled')
  assert.deepEqual(disabled.next, ['enable', 'record', 'analyze'])
  assert.deepEqual(
    IMPROVEMENT_EVIDENCE_SOURCES.map((source) => source.kind),
    ['session_event', 'execution_result', 'agentmemory_lesson', 'user_feedback'],
  )

  const ready = improvementActivationState(
    { enabled: true, capabilities: { can_analyze: true } },
    improvementSignalSummary({
      total: 2,
      source_counts: {
        session_event: 1,
        execution_result: 0,
        agentmemory_lesson: 1,
        user_feedback: 0,
      },
      session_count: 1,
      last_recorded_at: '2026-08-09T10:00:00Z',
    }),
    1,
  )
  assert.equal(ready.status, 'ready')
  assert.deepEqual(ready.next, ['analyze'])
})
