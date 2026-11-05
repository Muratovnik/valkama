/**
 * The whole server, as one route table the page talks to instead of a process.
 *
 * Two things here are load-bearing beyond returning a payload. The exact-binding
 * endpoints answer 409 when the requested identity is not one this fixture
 * declares, so a projection reached with the wrong data scope fails as a refusal
 * rather than quietly reading the primary store. And the returned recorders are
 * what the tests assert against: what was written, what the legacy surface was
 * still asked for, and which identity each platform read carried.
 */
import assert from 'node:assert/strict'

import type { Page } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'

import { chainResponse, emptyChain } from '../fixtures/chain.ts'
import { requestList } from '../support/inputRequests.ts'
import { moduleRegistrations } from '../support/moduleRegistrations.ts'
import { ALERT_SETTINGS, ALERT_STATUS_READY, TRIAL_SHOWN } from './alertsFixtures.ts'
import { installBrowserDoubles } from './browserDoubles.ts'
import { doctorReport } from './doctorFixtures.ts'
import {
  executionCapabilities,
  executionHistory,
  monitorSessions,
  sessionContextFor,
} from './executionFixtures.ts'
import { memoryLinks, memoryProviders, memorySearch } from './memoryFixtures.ts'
import { projectDocument, resolvedPaths } from './planDocumentFixture.ts'
import {
  attachedDataScopeId,
  attachedSpaceRef,
  attachedWorkItemRef,
  blockedFullWorkItem,
  blockedWorkItem,
  dataScopeId,
  doneState,
  globalScope,
  now,
  planningReadyFor,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { improvementProfile, signalSummary } from './platformFixtures.ts'
import { skillMatrixPayload, skillsPayload } from './skillsFixtures.ts'

type BackendOptions = {
  activity?: 'bound' | 'unbound'
  /** The card's item stands in the terminal state, with this outcome. */
  closedWith?: string
  /** The discussion the card's item has. */
  comments?: unknown[]
  /** The history the card's read answers with. */
  events?: unknown[]
  includeAttachedDuplicate?: boolean
  includeUnboundPlanningProject?: boolean
  /**
   * A card's body long enough to read well past its head, which a fixture card's
   * own body is not.
   */
  longRead?: boolean
  /** The card's item points here instead of at the plan the fixture has. */
  source?: string
  /** The text of the card's first checklist step, where a test needs markdown in it. */
  stepText?: string
  uiPrefs?: unknown
  /** The agents the card's read answers with, read again at each read. */
  agents?: () => unknown[]
  /** What the card's read answers once everything above has had its say. */
  card?: (read: Record<string, unknown>) => object
  /** What `GET /api/open-plan` answers; an empty object by default, which no plan reads as. */
  openPlan?: (query: URLSearchParams) => object
  /** What the space's read answers, where a test needs its items otherwise. */
  space?: (model: Record<string, unknown>) => object
}

/** Paragraphs enough to scroll a drawer body well past any head. */
const LONG_READ = Array.from(
  { length: 40 },
  (_, index) => `Paragraph ${index + 1} of a description long enough to be read.`,
).join('\n\n')

const SESSION_TOKEN = 'playwright-session-token'.padEnd(64, 'x')

export async function installBackend(page: Page, options: BackendOptions = {}) {
  const legacyRequests: string[] = []
  const platformReads: string[] = []
  const prefsWrites: unknown[] = []
  const registrations = moduleRegistrations()
  /**
   * The activity feed, as a reference and a presentation.
   *
   * `unbound` names a space no mapped project answers to, which is the case the
   * shell must refuse rather than guess at: the row is readable and leads
   * nowhere.
   */
  const activityRows = () =>
    options.activity
      ? [
          {
            event_id: 1,
            work_item_id: workItem.work_item_id,
            reference: options.activity === 'bound' ? workItemRef.reference : 'OTHER-42',
            title: workItem.title,
            action: 'claimed',
            detail: '',
            state_category: null,
            author: 'codex',
            at: now,
          },
        ]
      : []
  await installBrowserDoubles(page)
  const attachCommands: { session_id: string; work_item: string }[] = []
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const scope = url.searchParams.get('scope_kind') === 'project' ? projectScope : globalScope
      const fulfill = (body: unknown, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

      if (path === '/api/security/bootstrap') {
        assert.equal(request.method(), 'GET')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Cache-Control': 'no-store' },
          body: JSON.stringify({ session_token: SESSION_TOKEN }),
        })
      }
      if (request.method() === 'POST' || request.method() === 'PUT')
        assert.equal(
          request.headers()['x-valkama-session'],
          SESSION_TOKEN,
          `${request.method()} ${path} must carry the browser session token`,
        )

      if (path === '/api/execution/attach' && request.method() === 'POST') {
        const body = request.postDataJSON() as { session_id: string; work_item: string }
        attachCommands.push(body)
        return fulfill({
          interface_version: 'valkama-execution-api',
          work_item: body.work_item,
          session_id: body.session_id,
          execution_id: 'exec-aaaabbbbccccddddeeeeffff00001111',
        })
      }

      // The removed surface is matched by pattern, not by name: what the test needs
      // to know is that something still called the Board domain, whichever
      // endpoint it was. Every one of these routes is gone from the server.
      if (/^\/api\/(?:board|boards|card|move|graph|comment|summary)$/u.test(path)) {
        legacyRequests.push(`${request.method()} ${path}${url.search}`)
        return fulfill({})
      }

      const routes: Record<string, () => Promise<void> | void> = {
        '/api/modules/planning/requests': () => fulfill({ ...requestList([]), coverage: [] }),
        '/api/modules': () =>
          fulfill({
            interface_version: 'valkama-modules',
            modules: structuredClone(registrations),
          }),
        // One read of the space; the board, the list and the graph all project it.
        '/api/planning': () => {
          platformReads.push(`${path}?${url.searchParams.toString()}`)
          const response = planningReadFor(url.searchParams, options.includeAttachedDuplicate)
          const answer = options.space?.(response.body) ?? response.body
          return fulfill(answer, response.status)
        },
        // Every card asks for its chain; these items head none.
        '/api/planning/work-item/chain': () =>
          fulfill(
            chainResponse(
              emptyChain(
                workItemRef.reference,
                url.searchParams.get('id') ?? workItem.work_item_id,
              ),
            ),
          ),
        '/api/planning/activity': () =>
          fulfill({ interface_version: 'valkama-planning-api', activity: activityRows() }),
        '/api/sessions': () => fulfill({ sessions: structuredClone(monitorSessions), inbox: [] }),
        '/api/session': () => fulfill(sessionContextFor(url.searchParams.get('id'))),
        '/api/open-plan': () => fulfill(options.openPlan?.(url.searchParams) ?? {}),
        '/api/open-places': () =>
          fulfill({
            places: {
              'vscode': true,
              'vscode-insiders': false,
              'cursor': false,
              'windsurf': false,
              'terminal': true,
              'claude-desktop': true,
              'codex-app': true,
            },
          }),
        '/api/execution/capabilities': () => fulfill(structuredClone(executionCapabilities)),
        '/api/memory/search': () => fulfill(structuredClone(memorySearch)),
        '/api/memory/providers': () => fulfill(structuredClone(memoryProviders)),
        '/api/memory/linked': () => fulfill(structuredClone(memoryLinks)),
        '/api/alerts/settings': () =>
          fulfill(request.method() === 'PUT' ? request.postDataJSON() : ALERT_SETTINGS),
        '/api/alerts/status': () => fulfill(ALERT_STATUS_READY),
        '/api/alerts/test': () => fulfill(TRIAL_SHOWN),
        '/api/alerts/presence': () => fulfill({ ok: true }),
        '/api/doctor': () => fulfill(structuredClone(doctorReport)),
        '/api/execution/history': () => {
          const requested = url.searchParams.get('work_item')
          return fulfill(
            requested === workItemRef.reference
              ? structuredClone(executionHistory)
              : { ...structuredClone(executionHistory), work_item: requested, executions: [] },
          )
        },
        '/api/modules/skills': () => fulfill(skillsPayload),
        '/api/modules/skills/matrix': () => fulfill(skillMatrixPayload),
        '/api/modules/improvements/profile': () => fulfill(improvementProfile),
        '/api/modules/improvements/cases': () =>
          fulfill({
            interface_version: 'improvements-api',
            scope: 'personal',
            cases: [],
            signal_summary: signalSummary,
          }),

        '/api/platform/context': () =>
          fulfill({
            interface_version: 'valkama-context',
            scope: globalScope,
            state: {
              interface_version: 'valkama-ui-state',
              status: 'ready',
              payload: {
                primary: { data_scope_id: dataScopeId, is_writable: true },
                projects: [
                  {
                    project_id: projectId,
                    title: 'Example Project',
                    binding_state: 'mapped',
                    resources: [
                      ...(options.includeAttachedDuplicate
                        ? [{ resource_ref: planningSpaceEntity(attachedSpaceRef), state: 'mapped' }]
                        : []),
                      { resource_ref: planningSpaceEntity(spaceRef), state: 'mapped' },
                    ],
                  },
                ],
                ui_prefs: options.uiPrefs ?? null,
              },
            },
          }),

        '/api/platform/ui-prefs': () => {
          const body = request.postDataJSON()
          prefsWrites.push(body)
          return fulfill({
            interface_version: 'valkama-ui-prefs',
            prefs: {
              module_id: body.module_id,
              scope: body.scope,
              ...(body.resource_ref === undefined ? {} : { resource_ref: body.resource_ref }),
            },
          })
        },

        '/api/platform/planning': () => {
          let exactSpaceRef = spaceRef
          if (scope.kind === 'project') {
            const requestedScopeId = url.searchParams.get('data_scope_id')
            const requestedKey = url.searchParams.get('space_key')
            if (
              requestedKey !== spaceRef.space_key ||
              ![
                dataScopeId,
                ...(options.includeAttachedDuplicate ? [attachedDataScopeId] : []),
              ].includes(requestedScopeId ?? '')
            ) {
              return fulfill(
                {
                  interface_version: 'valkama-ui-state',
                  status: 'unavailable',
                  reason: 'Exact mapped space binding is required.',
                },
                409,
              )
            }
            exactSpaceRef = requestedScopeId === attachedDataScopeId ? attachedSpaceRef : spaceRef
          }
          const payload = planningReadyFor(exactSpaceRef, options.includeUnboundPlanningProject)
          if (scope.kind === 'global' && url.searchParams.get('directory_only') === 'true')
            payload.planning_spaces = []
          platformReads.push(`${path}?${url.searchParams.toString()}`)
          return fulfill({
            interface_version: 'valkama-planning',
            scope,
            state: {
              interface_version: 'valkama-ui-state',
              status: 'ready',
              payload,
            },
          })
        },

        '/api/modules/planning/work-item': () => {
          const requestedScopeId = url.searchParams.get('data_scope_id')
          const requestedKey = url.searchParams.get('space_key')
          const requestedReference = url.searchParams.get('reference') ?? ''
          if (
            requestedKey !== spaceRef.space_key ||
            ![blockedWorkItem.reference, workItemRef.reference].includes(requestedReference) ||
            ![
              dataScopeId,
              ...(options.includeAttachedDuplicate ? [attachedDataScopeId] : []),
            ].includes(requestedScopeId ?? '')
          ) {
            return fulfill(
              {
                interface_version: 'valkama-ui-state',
                status: 'unavailable',
                reason: 'Exact work item binding is required.',
              },
              409,
            )
          }
          const exact = requestedScopeId === attachedDataScopeId ? attachedWorkItemRef : workItemRef
          const exactRef = { ...exact, reference: requestedReference }
          const card =
            requestedReference === blockedWorkItem.reference
              ? blockedFullWorkItem
              : { ...workItem, revision: 3 }
          const described = options.longRead ? { ...card, description: LONG_READ } : card
          const told = {
            ...described,
            ...(options.source === undefined ? {} : { source: options.source }),
            ...(options.agents ? { agents: options.agents() } : {}),
            ...(options.events ? { events: options.events } : {}),
            ...(options.comments ? { comments: options.comments } : {}),
          }
          const { closedWith, stepText } = options
          const read =
            closedWith === undefined
              ? told
              : { ...told, state: doneState, summary: { done: closedWith, next: '' } }
          const stepped =
            stepText === undefined
              ? read
              : {
                  ...read,
                  checklist: read.checklist.map((step, index) =>
                    index === 0 ? { ...step, text: stepText } : step,
                  ),
                }
          const answered = (options.card?.(stepped as Record<string, unknown>) ??
            stepped) as typeof stepped
          platformReads.push(`${path}?${url.searchParams.toString()}`)
          return fulfill({
            interface_version: 'valkama-planning-work-item',
            scope: projectScope,
            work_item_ref: exactRef,
            state: {
              interface_version: 'valkama-ui-state',
              status: 'ready',
              payload: {
                work_item:
                  requestedScopeId === attachedDataScopeId
                    ? { ...answered, title: `Attached: ${answered.title}` }
                    : answered,
              },
            },
          })
        },

        '/api/modules/skills/detail': () => {
          const key = url.searchParams.get('key')
          const selected = skillsPayload.skills.find((entry) => entry.key === key)
          // A key with no fixture is what the real server answers 404 to, and the
          // view has a path for that; asserting it away would hide a fixture drift.
          if (!selected) return fulfill({ detail_code: 'skill_not_found' }, 404)
          return fulfill({
            interface_version: 'skill-detail',
            key: selected.key,
            name: selected.name,
            location: selected.location,
            content_hash: selected.provenance.content_hash,
            markdown: `# ${selected.name}`,
          })
        },

        '/api/activity': () => fulfill({ activity: activityRows() }),

        '/api/documents/resolve': () =>
          fulfill({ paths: resolvedPaths(url.searchParams.getAll('path')) }),
        '/api/documents/read': () => {
          const found = projectDocument(url.searchParams.get('path') ?? '')
          return found ? fulfill(found) : fulfill({ error: { code: 'not_found' } }, 404)
        },
      }

      // An endpoint with no fixture answers an empty body rather than hanging: a
      // test that reaches one fails on what it was asserting, not on a timeout.
      const handler = routes[path] ?? (() => fulfill({}))
      return handler()
    },
  )
  return {
    attachCommands,
    legacyRequests,
    platformReads,
    prefsWrites,
  }
}
