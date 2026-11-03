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

import { validateDocument, validateRefusal, validateResolved } from '@/shared/api/documentApi.ts'
import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'
import { validateCommentResolved, validateCommentWritten } from '@/shared/api/planningModel.ts'
import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
} from '@/shared/api/platformPlanningPayload.ts'

const directory = fileURLToPath(new URL('./fixtures/server/', import.meta.url))
const read = (name: string): unknown => JSON.parse(readFileSync(`${directory}${name}`, 'utf8'))

/** Each fixture the web reads, with the validator of the call that reads it. */
const readers: Record<string, (value: unknown) => unknown> = {
  'card.json': (value) => validatePlanningWorkItemPayload(value),
  'card-brief.json': (value) => validatePlanningWorkItemBriefPayload(value),
  'card-executors.json': (value) => validatePlanningWorkItemPayload(value),
  'comment-reply.json': validateCommentWritten,
  'comment-resolved.json': validateCommentResolved,
  'documents-read.json': validateDocument,
  'documents-refused.json': validateRefusal,
  'documents-resolve-unbound.json': validateResolved,
  'documents-resolve.json': validateResolved,
  'request-answered.json': validateInputRequestDetail,
  'request-pending.json': validateInputRequestDetail,
  'requests.json': validateInputRequestList,
}
/** What only an agent reads: the MCP answers, which no web schema describes. */
const agentOnly = new Set([
  'mcp-get-work-item.json',
  'mcp-get-work-item-thread.json',
  'mcp-get-work-item-unresolved.json',
])

describe('the server fixtures', () => {
  it('are each read by the web or named as an agent read', () => {
    const files = readdirSync(directory).filter((name) => name.endsWith('.json'))
    expect(files.toSorted()).toEqual([...Object.keys(readers), ...agentOnly].toSorted())
  })

  it.each(Object.entries(readers))(
    '%s passes the strict schema the web reads it with',
    (name, validate) => {
      expect(() => validate(read(name))).not.toThrow()
    },
  )

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
