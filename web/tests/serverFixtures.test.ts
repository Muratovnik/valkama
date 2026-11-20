/**
 * The real server's answers, read through the web's own strict validators. The
 * browser suite runs against mocked routes and cannot see the server drift; these
 * fixtures are what a temporary store answered through the real HTTP and MCP
 * layers (`tests/test_web_contract_fixtures.py` writes them and fails while they
 * are stale), so a key the server adds, drops or reshapes fails here.
 */

import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  pageDimensionOf,
  validateQuotaAnswer,
  validateUsageAnswer,
} from '@/shared/api/analyticsApi.ts'
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
import { validateParticipation, validateSpaceRecord } from '@/shared/api/participationApi.ts'
import { validateWorkItemChain } from '@/shared/api/planningChainApi.ts'
import { validateGlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import { validateReadModel, validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import {
  validateItemUsageAnswer,
  validateSessionUsageAnswer,
} from '@/shared/api/planningUsageApi.ts'
import {
  validatePlanningWorkItemBriefPayload,
  validatePlanningWorkItemPayload,
  validatePlatformPlanningPayload,
} from '@/shared/api/platformPlanningPayload.ts'
import { validateGoalVolumesAnswer, validateVolumesAnswer } from '@/shared/api/volumesApi.ts'
import { messages } from '@/shared/i18n/index.ts'

import { readServerFixture, SERVER_FIXTURES } from './support/serverFixtures.ts'

const STEP_KINDS = [
  'focus-folder',
  'open-link',
  'resume-in-terminal',
  'desktop-resume',
  'open-file',
  'copy',
  'explain',
] as const

const directory = SERVER_FIXTURES
const read = readServerFixture

/** Each fixture the web reads, with the validator of the call that reads it. */
const readers: Record<string, (value: unknown) => unknown> = {
  'analytics-quota.json': validateQuotaAnswer,
  'analytics-usage.json': validateUsageAnswer,
  'analytics-usage-seat.json': validateUsageAnswer,
  'card.json': (value) => validatePlanningWorkItemPayload(value),
  'card-brief.json': (value) => validatePlanningWorkItemBriefPayload(value),
  'card-in-goal-brief.json': (value) => validatePlanningWorkItemBriefPayload(value),
  'card-executors.json': (value) => validatePlanningWorkItemPayload(value),
  'card-goal.json': (value) => validatePlanningWorkItemPayload(value),
  'card-deferred.json': (value) => validatePlanningWorkItemPayload(value),
  'card-returned.json': (value) => validatePlanningWorkItemPayload(value),
  'card-converted.json': (value) => validatePlanningWorkItemPayload(value),
  'comment-reply.json': validateCommentWritten,
  'comment-resolved.json': validateCommentResolved,
  'description-told.json': (value) => validateWorkItemRecord(value),
  'documents-read.json': validateDocument,
  'documents-refused.json': validateRefusal,
  'documents-resolve-unbound.json': validateResolved,
  'documents-resolve.json': validateResolved,
  'documents-search.json': validateFound,
  'goal-volumes.json': validateGoalVolumesAnswer,
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
  'participation-shared.json': validateParticipation,
  'participation-space.json': validateParticipation,
  'participation-written.json': validateParticipation,
  'planning-chain-tree.json': (value) => validateWorkItemChain(value),
  'planning-portfolio.json': (value) => validatePlatformPlanningPayload(value),
  'planning-read-model.json': (value) => validateReadModel(value),
  'planning-search.json': validateGlobalPlanningSearch,
  'request-answered.json': validateInputRequestDetail,
  'request-pending.json': validateInputRequestDetail,
  'request-proposed-goal.json': validateInputRequestDetail,
  'request-session-gone.json': validateInputRequestDetail,
  'request-triage-group.json': validateInputRequestDetail,
  'requests-triage-due.json': validateInputRequestList,
  'requests.json': validateInputRequestList,
  'space-settings.json': validateSpaceRecord,
  'usage-item.json': validateItemUsageAnswer,
  'usage-session.json': validateSessionUsageAnswer,
  'volumes-filtered.json': validateVolumesAnswer,
  'volumes-project.json': validateVolumesAnswer,
  'volumes-space.json': validateVolumesAnswer,
}
/** What only an agent reads: the MCP answers, which no web schema describes. */
const agentOnly = new Set([
  // The server's closed lists, which the tests below hold the web's to.
  'open-vocabulary.json',
  'doctor-vocabulary.json',
  'mcp-get-work-item.json',
  'mcp-get-work-item-thread.json',
  'mcp-get-work-item-unresolved.json',
])

/** Where a record stands, in words a test can compare: in a state, or deriving one. */
const standing = (item: { container_state: string | null; state: { category?: string } | null }) =>
  item.state === null ? `derives ${item.container_state}` : `stands in ${item.state.category}`

/** The work item of a card fixture the card read answered. */
const cardItem = (name: string) => {
  const card = validatePlanningWorkItemPayload(read(name))
  if (card.state.status !== 'ready') throw new Error('the card read is not ready')
  return card.state.payload.work_item
}

/** A seat as the server writes it, but for its weekly reset: by its id, organization and UUID. */
const seat = (id: string | null, organization: string | null, uuid: string | null) => ({
  id,
  unknown: id === null,
  organization,
  account_uuid: uuid,
  shared: false,
})

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

  it('close the same lists of an open plan as the web does', () => {
    expect(read('open-vocabulary.json')).toEqual({
      places: [...OPEN_PLACES],
      reasons: [...PLAN_REASONS],
      path_refusals: [...PATH_REFUSALS],
      states: [...PLAN_STATES],
      steps: [...STEP_KINDS],
    })
  })

  it('give every quota and commit-hook code the doctor reports a title and a detail in each language', () => {
    // Read from the server's source, so a code the server adds fails here until it has words.
    const { commit, quota } = read('doctor-vocabulary.json') as {
      commit: string[]
      quota: string[]
    }
    expect(quota.length).toBeGreaterThan(0)
    expect(commit.length).toBeGreaterThan(0)
    const missing = (['en', 'ru'] as const).flatMap((locale) => {
      const findings: Record<string, { detail?: unknown; title?: unknown } | undefined> =
        messages[locale].health.finding
      return [...quota, ...commit]
        .filter((code) => {
          const words = findings[code]
          return typeof words?.title !== 'string' || typeof words.detail !== 'string'
        })
        .map((code) => `${locale}: ${code}`)
    })
    expect(missing).toEqual([])
  })

  it('name in both languages each count a commit-records code reports', () => {
    const counted: Record<string, string[]> = {
      'commit-records-current': ['{waiting}'],
      'commit-records-waiting': ['{count}', '{oldest}'],
      'commit-records-rejected': ['{rejected}', '{paths}'],
      'commit-records-waiting-rejected': ['{count}', '{oldest}', '{rejected}', '{paths}'],
    }
    const missing = (['en', 'ru'] as const).flatMap((locale) => {
      const findings: Record<string, { detail?: unknown } | undefined> =
        messages[locale].health.finding
      return Object.entries(counted).flatMap(([code, placeholders]) => {
        const detail = String(findings[code]?.detail)
        return placeholders
          .filter((placeholder) => !detail.includes(placeholder))
          .map((placeholder) => `${locale}: ${code} lacks ${placeholder}`)
      })
    })
    expect(missing).toEqual([])
  })

  it('name the executor at the claim, each step and each agent of a card', () => {
    const card = validatePlanningWorkItemPayload(read('card-executors.json'))
    if (card.state.status !== 'ready') throw new Error('the card read is not ready')
    const { work_item: item } = card.state.payload
    expect(item.claim?.executor?.state).toBe('live')
    expect(item.checklist.map((step) => step.executor?.state)).toEqual(['live', 'none', 'none'])
    expect(item.agents?.map((agent) => agent.executor?.state).toSorted()).toEqual(['ended', 'live'])
  })

  it('name the item over the one read by its reference, and none over a root', () => {
    const under = validatePlanningWorkItemBriefPayload(read('card-in-goal-brief.json'))
    const root = validatePlanningWorkItemBriefPayload(read('card-brief.json'))
    if (under.state.status !== 'ready' || root.state.status !== 'ready')
      throw new Error('the brief read is not ready')
    expect(under.state.payload.work_item.parent).toBe('MAIN-4')
    expect(root.state.payload.work_item.parent).toBeNull()
    expect(cardItem('card-goal.json').parent).toBeNull()
  })

  it('name who works on a goal: its creator following it, and a holder under it', () => {
    const card = validatePlanningWorkItemPayload(read('card-goal.json'))
    if (card.state.status !== 'ready') throw new Error('the card read is not ready')
    const people = card.state.payload.work_item.participants ?? []
    expect(people.map(({ holds, follows }) => ({ holds: holds.length, follows }))).toEqual([
      { holds: 0, follows: true },
      { holds: 1, follows: false },
    ])
  })

  it('say what put-off work waits on, and why work in triage came back', () => {
    const waiting = cardItem('card-deferred.json')
    expect([waiting.state?.category, waiting.deferred?.until, waiting.returned]).toEqual([
      'deferred',
      null,
      undefined,
    ])
    expect(waiting.deferred?.until_item).toMatch(/^MAIN-\d+$/u)
    const back = cardItem('card-returned.json')
    expect([back.state?.category, back.deferred, back.returned?.because]).toEqual([
      'triage',
      undefined,
      'deleted',
    ])
    expect(back.events.at(-1)?.action).toBe('returned')
  })

  it('read a task converted into a goal as the goal it became', () => {
    const goal = cardItem('card-converted.json')
    expect([goal.kind, goal.state, goal.container_state, goal.labels]).toEqual([
      'goal',
      null,
      'in_progress',
      ['bug'],
    ])
    expect(goal.checklist.map((step) => [step.text, step.done])).toEqual([
      ['Found', true],
      ['Fix', false],
    ])
    expect(goal.events.at(-1)?.detail).toMatch(/^bug -> goal; leftover MAIN-\d+: 0 steps$/u)
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

  it("give a card's sessions and its share of each account's week", () => {
    // Two sessions spent on the card and a third, which follows it, wrote to it. One stretch
    // of its work, $0.01 of $0.26, is half its seat's cost that week, which the poll put at
    // 40 %: the session's stretch the day before has no reading before it, so it takes the
    // seat of the session's next one.
    const usage = validateItemUsageAnswer(read('usage-item.json'))
    expect(usage.sessions).toBe(3)
    expect(
      usage.quota.weeks.map(({ account, seat, share, percent }) => ({
        account,
        seat,
        share,
        percent,
      })),
    ).toEqual([
      {
        account: { organization: 'org-fixture', account_uuid: 'acct-fixture' },
        seat: 'week:2026-11-16T09:00Z',
        share: 0.5,
        percent: 20,
      },
    ])
    // The rest, $0.25 of $0.26, is on no seat: the fixture's other rows name no organization.
    expect(usage.quota.unknown_share).toBeCloseTo(0.25 / 0.26, 4)
  })

  it('name the account of the work by its id, a dimension of the page', () => {
    const usage = validateUsageAnswer(read('analytics-usage-seat.json'))
    expect(usage.rows.map(({ group }) => group.seat)).toEqual([
      {
        ...seat('org-fixture/acct-fixture', 'org-fixture', 'acct-fixture'),
        weekly_reset: '1T09:00Z',
      },
      { ...seat('org-fixture/weekly:2T19:00Z', 'org-fixture', null), weekly_reset: '2T19:00Z' },
      { ...seat('org-unread/', 'org-unread', null), weekly_reset: null },
      { ...seat(null, null, null), weekly_reset: null },
    ])
    expect(pageDimensionOf(usage)).toBe('seat')
    expect(pageDimensionOf(validateUsageAnswer(read('analytics-usage.json')))).toBe('work_item')
  })

  it('carry goals and stages as the board, the chain and the finder read them', () => {
    const model = validateReadModel(read('planning-read-model.json'))
    const chain = validateWorkItemChain(read('planning-chain-tree.json'))
    const found = validateGlobalPlanningSearch(read('planning-search.json'))
    const tree = model.work_items.filter((item) => item.title.startsWith('Tree'))
    // An accepted open goal and its stages stand in no state and derive one; the rest stand in one.
    expect(
      Object.fromEntries(tree.map((item) => [item.title, `${item.kind} ${standing(item)}`])),
    ).toEqual({
      'Tree goal': 'goal derives in_progress',
      'Tree stage': 'stage derives not_started',
      'Tree nested stage': 'stage derives not_started',
      'Tree work in the nested stage': 'task stands in ready',
      'Tree work under the stage': 'task stands in ready',
      'Tree work finished under the goal': 'task stands in completed',
      'Tree goal not accepted yet': 'goal stands in triage',
      'Tree stage not accepted yet': 'stage stands in triage',
      'Tree work under the stage not accepted': 'task stands in triage',
    })
    expect(chain.scope).toBe('tree')
    expect(chain.root.title).toBe('Tree goal')
    expect(chain.members.map((member) => member.title).toSorted()).toEqual([
      'Tree nested stage',
      'Tree stage',
      'Tree work finished under the goal',
      'Tree work in the nested stage',
      'Tree work under the stage',
    ])
    const derived = chain.members.filter((member) => member.state === null)
    expect(derived.map((member) => member.container_state)).toEqual(['not_started', 'not_started'])
    const hits = found.items.map((hit) => hit.item)
    expect(hits.find((hit) => hit.title === 'Tree goal')).toMatchObject({
      state: null,
      open: true,
      container_state: 'in_progress',
    })
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
    const asked = validateInputRequestDetail(read('request-session-gone.json')).request
    expect([asked.addressee === null, asked.status, asked.expired_reason]).toEqual([
      false,
      'expired',
      'session_gone',
    ])
    // A goal an agent proposes: the question carries the write that waits for the owner.
    const proposed = validateInputRequestDetail(read('request-proposed-goal.json')).request
    expect([proposed.purpose, proposed.action?.point]).toEqual(['goal', 'proposed_goal'])
    // A group of findings: the question names the tasks, and the action what was proposed.
    const group = validateInputRequestDetail(read('request-triage-group.json')).request
    expect([group.purpose, group.action?.point, group.action?.proposed.answer]).toEqual([
      'triage',
      'finding',
      'later',
    ])
    expect(group.action?.proposed.items?.length).toBe(2)
  })
})
