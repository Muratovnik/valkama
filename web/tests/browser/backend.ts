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

import { moduleRegistrations } from '../support/moduleRegistrations.ts'
import { portfolioPayload } from './analyticsFixtures.ts'
import type { AssignmentSelectionInput } from './assignmentFixture.ts'
import { applyAssignmentSelection } from './assignmentFixture.ts'
import { installBrowserDoubles } from './browserDoubles.ts'
import { doctorReport } from './doctorFixtures.ts'
import {
  executionCapabilities,
  executionHistory,
  executionUsage,
  monitorSessions,
} from './executionFixtures.ts'
import { memoryLinks, memoryProviders, memorySearch } from './memoryFixtures.ts'
import {
  attachedDataScopeId,
  attachedSpaceRef,
  attachedWorkItemRef,
  blockedFullWorkItem,
  blockedWorkItem,
  dashboardPayload,
  dataScopeId,
  existingRelation,
  globalScope,
  now,
  planningReadModel,
  planningReadyFor,
  projectId,
  projectScope,
  relationsWithStates,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'
import {
  globalRegistry,
  improvementProfile,
  projectRegistry,
  rebuildRegistryCapabilities,
  signalSummary,
} from './platformFixtures.ts'
import { skillMatrixPayload, skillsPayload } from './skillsFixtures.ts'

type BackendOptions = {
  activity?: 'bound' | 'unbound'
  includeAttachedDuplicate?: boolean
  includeUnboundPlanningProject?: boolean
  moduleConflictOnce?: string
  relationStates?: Array<'missing' | 'ambiguous' | 'malformed'>
  telemetryUnavailable?: boolean
  uiPrefs?: unknown
}

const SESSION_TOKEN = 'playwright-session-token'.padEnd(64, 'x')

export async function installBackend(page: Page, options: BackendOptions = {}) {
  const relationCommands: unknown[] = []
  const actionCommands: unknown[] = []
  const legacyRequests: string[] = []
  const platformReads: string[] = []
  const prefsWrites: unknown[] = []
  const assignmentSelectionCommands: unknown[] = []
  const registrations = moduleRegistrations()
  const projectRegistryState = structuredClone(projectRegistry)
  const globalRegistryState = structuredClone(globalRegistry)
  if (options.telemetryUnavailable) {
    projectRegistryState.assignments = projectRegistryState.assignments.filter(
      (assignment) => assignment.capability_id !== 'telemetry.query',
    )
    globalRegistryState.assignments = globalRegistryState.assignments.filter(
      (assignment) => assignment.capability_id !== 'telemetry.query',
    )
    rebuildRegistryCapabilities(projectRegistryState, true)
    rebuildRegistryCapabilities(globalRegistryState, false)
  }
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
  let moduleConflict = options.moduleConflictOnce
  await installBrowserDoubles(page)
  let relations = relationsWithStates(options.relationStates)
  const attachCommands: { session_id: string; work_item: string }[] = []
  await page.route('**/api/**', async (route) => {
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

    if (path === '/api/modules/state' && request.method() === 'POST') {
      const body = request.postDataJSON() as {
        expected_revision: number
        module_id: string
        state: 'enabled' | 'disabled'
      }
      const registration = registrations.find((item) => item.manifest.module_id === body.module_id)
      if (registration && moduleConflict === body.module_id) {
        moduleConflict = undefined
        registration.revision += 1
        registration.updated_at = new Date().toISOString()
        return fulfill({ status: 'unavailable', reason: 'Module revision changed' }, 409)
      }
      if (!registration || registration.revision !== body.expected_revision)
        return fulfill({ status: 'unavailable', reason: 'Module revision changed' }, 409)
      registration.state = body.state
      registration.revision += 1
      registration.updated_at = new Date().toISOString()
      return fulfill({ interface_version: 'valkama-modules', module: registration })
    }

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

    if (path === '/api/platform/assignments/selection' && request.method() === 'POST') {
      const body = request.postDataJSON() as AssignmentSelectionInput
      assignmentSelectionCommands.push(body)
      const result = applyAssignmentSelection(body, projectRegistryState)
      return fulfill(result.body, result.status)
    }

    // The removed surface is matched by pattern, not by name: what the test needs
    // to know is that something still called the Board domain, whichever
    // endpoint it was. Every one of these routes is gone from the server.
    if (/^\/api\/(?:board|boards|card|move|graph|comment|summary)$/u.test(path)) {
      legacyRequests.push(`${request.method()} ${path}${url.search}`)
      return fulfill({})
    }

    const routes: Record<string, () => Promise<void> | void> = {
      '/api/dashboard': () => fulfill(structuredClone(dashboardPayload)),
      '/api/dashboard/portfolio': () => fulfill(structuredClone(portfolioPayload)),
      '/api/modules': () =>
        fulfill({
          interface_version: 'valkama-modules',
          modules: structuredClone(registrations),
        }),
      // One read of the space; the board, the list and the graph all project it.
      '/api/planning': () => fulfill(structuredClone(planningReadModel)),
      '/api/planning/work-item': () => {
        const requested = url.searchParams.get('id')
        const record =
          requested === blockedWorkItem.reference
            ? blockedFullWorkItem
            : { ...workItem, revision: 3 + relationCommands.length }
        if (requested !== blockedWorkItem.reference && requested !== workItemRef.reference) {
          return fulfill(
            { error: { code: 'not_found', message: `no work item ${requested}` } },
            404,
          )
        }
        return fulfill({ interface_version: 'valkama-planning-api', work_item: record })
      },
      '/api/planning/activity': () =>
        fulfill({ interface_version: 'valkama-planning-api', activity: activityRows() }),
      '/api/sessions': () => fulfill({ sessions: structuredClone(monitorSessions), inbox: [] }),
      '/api/session': () => fulfill({ session: url.searchParams.get('id'), events: [] }),
      // The execution half of the inspector. Answered by the fixture rather
      // than left to 404 because a section that fails to load looks the same
      // as a section with nothing in it, and only one of those is a defect.
      '/api/execution/capabilities': () => fulfill(structuredClone(executionCapabilities)),
      '/api/execution/usage': () => fulfill(structuredClone(executionUsage)),
      '/api/memory/search': () => fulfill(structuredClone(memorySearch)),
      '/api/memory/providers': () => fulfill(structuredClone(memoryProviders)),
      '/api/memory/linked': () => fulfill(structuredClone(memoryLinks)),
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
                  source_hash: 'd'.repeat(64),
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

      '/api/platform/registry': () =>
        fulfill({
          interface_version: 'valkama-registry',
          scope,
          state: {
            interface_version: 'valkama-ui-state',
            status: 'ready',
            payload: {
              ...(scope.kind === 'project' ? projectRegistryState : globalRegistryState),
              modules: structuredClone(registrations),
            },
          },
        }),

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
        platformReads.push(`${path}?${url.searchParams.toString()}`)
        return fulfill({
          interface_version: 'valkama-planning',
          scope,
          state: {
            interface_version: 'valkama-ui-state',
            status: 'ready',
            payload: planningReadyFor(exactSpaceRef, options.includeUnboundPlanningProject),
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
        const answered =
          requestedReference === blockedWorkItem.reference
            ? blockedFullWorkItem
            : { ...workItem, revision: 3 + relationCommands.length }
        platformReads.push(`${path}?${url.searchParams.toString()}`)
        return fulfill({
          interface_version: 'valkama-planning-work-item',
          scope: projectScope,
          work_item_ref: { ...exact, reference: requestedReference },
          state: {
            interface_version: 'valkama-ui-state',
            status: 'ready',
            payload: {
              work_item: answered,
              relations: { interface_version: 'valkama-relations', relations },
            },
          },
        })
      },

      '/api/platform/relations': () => {
        const body = request.postDataJSON()
        relationCommands.push(body)
        const attached = {
          ...structuredClone(existingRelation),
          relation_id: `relation-${relations.length + 1}`,
          target: body.resource_ref,
          presentation: {
            label: body.fallback_label ?? body.resource_ref.external_id,
            secondary_text: body.resource_ref.external_id,
            icon_key: 'external-link',
          },
        }
        relations =
          body.operation === 'attach'
            ? [...relations, attached]
            : relations.filter((entry) => entry.relation_id !== body.resource_ref.external_id)
        return fulfill({
          interface_version: 'valkama-relation-result',
          operation: body.operation,
          entity_ref: body.entity_ref,
          card_revision: 3 + relationCommands.length,
          ...(body.operation === 'attach' ? { relation: attached } : { removed: true }),
        })
      },

      '/api/platform/actions/invoke': () => {
        const body = request.postDataJSON()
        actionCommands.push(body)
        return fulfill({
          interface_version: 'valkama-action-result',
          action_ref: body.action_ref,
          entity_ref: body.input.entity_ref,
          target: { target_kind: 'external-resource', uri: 'resource-link://entry/N-264' },
          presentation: { label: 'Open resource' },
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
    }

    // An endpoint with no fixture answers an empty body rather than hanging: a
    // test that reaches one fails on what it was asserting, not on a timeout.
    const handler = routes[path] ?? (() => fulfill({}))
    return handler()
  })
  return {
    attachCommands,
    relationCommands,
    actionCommands,
    assignmentSelectionCommands,
    legacyRequests,
    platformReads,
    prefsWrites,
  }
}
