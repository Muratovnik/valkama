/**
 * The real server's answers, read through the web's own strict validators. The
 * browser suite runs against mocked routes and cannot see the server drift; these
 * fixtures are what a temporary store answered through the real HTTP and MCP
 * layers (`tests/test_web_contract_fixtures.py` writes them and fails while they
 * are stale), so a key the server adds, drops or reshapes fails here.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { validateCommentResolved, validateCommentWritten } from '@/shared/api/commentWriteModel.ts'
import {
  validateDocument,
  validateFound,
  validateRefusal,
  validateResolved,
} from '@/shared/api/documentApi.ts'
import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { validateLiveFrame } from '@/shared/api/liveFrameModel.ts'
import {
  OPEN_PLACES,
  PATH_REFUSALS,
  PLAN_REASONS,
  PLAN_STATES,
  validateOpenPlaces,
  validateOpenPlan,
} from '@/shared/api/openPlanModel.ts'
import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import {
  validateItemUsageAnswer,
  validateSessionUsageAnswer,
} from '@/shared/api/planningUsageApi.ts'
import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
} from '@/shared/api/platformPlanningPayload.ts'

const STEP_KINDS = [
  'focus-folder',
  'open-link',
  'resume-in-terminal',
  'desktop-resume',
  'open-file',
  'copy',
  'explain',
] as const

const directory = fileURLToPath(new URL('./fixtures/server/', import.meta.url))
const read = (name: string): unknown => JSON.parse(readFileSync(`${directory}${name}`, 'utf8'))

/** Each fixture the web reads, with the validator of the call that reads it. */
const readers: Record<string, (value: unknown) => unknown> = {
  'card.json': (value) => validatePlanningWorkItemPayload(value),
  'card-brief.json': (value) => validatePlanningWorkItemBriefPayload(value),
  'card-executors.json': (value) => validatePlanningWorkItemPayload(value),
  'comment-reply.json': validateCommentWritten,
  'comment-resolved.json': validateCommentResolved,
  'description-told.json': (value) => validateWorkItemRecord(value),
  'documents-read.json': validateDocument,
  'documents-refused.json': validateRefusal,
  'documents-resolve-unbound.json': validateResolved,
  'documents-resolve.json': validateResolved,
  'documents-search.json': validateFound,
  'live-frame.json': validateLiveFrame,
  'open-places.json': validateOpenPlaces,
  'open-plan-copy.json': validateOpenPlan,
  'open-plan-file-desktop.json': validateOpenPlan,
  'open-plan-file.json': validateOpenPlan,
  'open-plan-folder.json': validateOpenPlan,
  'open-plan-no-session.json': validateOpenPlan,
  'open-plan-refused.json': validateOpenPlan,
  'open-plan-session-desktop.json': validateOpenPlan,
  'open-plan-silent-desktop.json': validateOpenPlan,
  'open-plan-silent.json': validateOpenPlan,
  'open-plan-session.json': validateOpenPlan,
  'request-answered.json': validateInputRequestDetail,
  'request-pending.json': validateInputRequestDetail,
  'requests.json': validateInputRequestList,
  'usage-item.json': validateItemUsageAnswer,
  'usage-session.json': validateSessionUsageAnswer,
}
/** What only an agent reads: the MCP answers, which no web schema describes. */
const agentOnly = new Set([
  // The server's closed lists, which the test below holds the web's to.
  'open-vocabulary.json',
  'mcp-get-work-item.json',
  'mcp-get-work-item-thread.json',
  'mcp-get-work-item-unresolved.json',
])

/**
 * Answers a page will read once it exists: their schema comes with that page, and
 * `tests/test_web_contract_fixtures.py` holds their shape until then.
 */
const awaitingPage = new Set(['analytics-usage.json'])

describe('the server fixtures', () => {
  it('are each read by the web, named as an agent read or awaiting their page', () => {
    const files = readdirSync(directory).filter((name) => name.endsWith('.json'))
    expect(files.toSorted()).toEqual(
      [...Object.keys(readers), ...agentOnly, ...awaitingPage].toSorted(),
    )
  })

  it.each(Object.entries(readers))(
    '%s passes the strict schema the web reads it with',
    (name, validate) => {
      expect(() => validate(read(name))).not.toThrow()
    },
  )

  it('close the same lists of an open plan as the web does', () => {
    expect(read('open-vocabulary.json')).toEqual({
      places: [...OPEN_PLACES],
      reasons: [...PLAN_REASONS],
      path_refusals: [...PATH_REFUSALS],
      states: [...PLAN_STATES],
      steps: [...STEP_KINDS],
    })
  })

  it('name the executor at the claim, each step and each agent of a card', () => {
    const card = validatePlanningWorkItemPayload(read('card-executors.json'))
    if (card.state.status !== 'ready') throw new Error('the card read is not ready')
    const { work_item: item } = card.state.payload
    expect(item.claim?.executor?.state).toBe('live')
    expect(item.checklist.map((step) => step.executor?.state)).toEqual(['live', 'none', 'none'])
    expect(item.agents?.map((agent) => agent.executor?.state).toSorted()).toEqual(['ended', 'live'])
  })

  it('carry what a path in a text can come to', () => {
    const { paths } = validateResolved(read('documents-resolve.json'))
    expect(paths.map((answer) => answer.status)).toEqual([
      'file',
      'file',
      'directory',
      'missing',
      'refused',
      'refused',
    ])
    expect(validateResolved(read('documents-resolve-unbound.json')).paths[0]?.status).toBe(
      'space_unbound',
    )
    expect(validateRefusal(read('documents-refused.json')).code).toBe('project_unknown')
    expect(validateFound(read('documents-search.json')).documents).toEqual([
      { path: 'docs/plan.md', line: 0, text: '' },
    ])
  })

  it('say beside each cost how many tokens it leaves out', () => {
    // The fixture's model with no price spent 50 input and 7 output tokens on the item.
    const usage = validateItemUsageAnswer(read('usage-item.json'))
    expect(usage.unpriced_models).toEqual(['claude-unknown-9'])
    expect(usage.unpriced_tokens).toBe(57)
    expect(usage.by_item.map((line) => line.unpriced_tokens)).toEqual([57])
    expect(
      validateSessionUsageAnswer(read('usage-session.json')).by_item.at(-1)?.unpriced_tokens,
    ).toBe(0)
  })

  it('carry every 2.5 form the card and the question view draw', () => {
    const card = validatePlanningWorkItemPayload(read('card.json'))
    if (card.state.status !== 'ready') throw new Error('the card read is not ready')
    const { comments } = card.state.payload.work_item
    expect(comments.some((comment) => comment.reply_to !== null)).toBe(true)
    expect(comments.some((comment) => comment.reply_to_request !== null)).toBe(true)
    expect(comments.some((comment) => comment.resolution !== null)).toBe(true)
    const { request } = validateInputRequestDetail(read('request-answered.json'))
    expect([request.answer_version, request.history.length]).toEqual([2, 1])
    expect(validateInputRequestDetail(read('request-pending.json')).request.status).toBe('pending')
  })
})
