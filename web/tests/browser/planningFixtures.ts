/**
 * The space this suite pretends the server has: one project, one mapped space,
 * two work items, and the attached duplicate of the space.
 *
 * The fixtures are shared rather than per-test on purpose. Every assertion about
 * an exact identity — which data scope was read, which revision a write expected
 * — is an assertion about these constants, so a test that built its own item
 * would be proving something about its own literal instead.
 *
 * The duplicate matters more here than it looks: two stores may each hold a
 * space keyed `MAIN` whose items carry the same references, and the whole point
 * of the exact-binding endpoints is that neither the key nor the reference is
 * enough to answer.
 */
import type { WorkItem, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** A brief as an item's own record carries it, before the read adds its comment count. */
type BriefFields = Omit<WorkItemBrief, 'comment_count'>

export const projectId = 'example-project'
export const dataScopeId = '123e4567-e89b-42d3-a456-426614174000'
export const attachedDataScopeId = '123e4567-e89b-42d3-a456-426614174001'
export const spaceRef = { data_scope_id: dataScopeId, space_key: 'MAIN' }
export const attachedSpaceRef = {
  data_scope_id: attachedDataScopeId,
  space_key: spaceRef.space_key,
}
export const spaceScope = { kind: 'space' as const, space_ref: spaceRef }
export const globalScope = { kind: 'global' as const }
export const workItemRef = { space_ref: spaceRef, reference: 'MAIN-264' }
export const attachedWorkItemRef = { space_ref: attachedSpaceRef, reference: workItemRef.reference }
export const now = '2026-08-13T09:00:00Z'
export const identity = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`

const STATES = [
  { key: 'backlog', name: 'Backlog', category: 'triage', terminal: false },
  { key: 'dev', name: 'Dev', category: 'active', terminal: false },
  { key: 'done', name: 'Done', category: 'completed', terminal: true },
] as const

/** The space's own workflow. Three states are enough for a drag and a refusal. */
const workflow = {
  workflow_id: identity(700),
  name: 'Default',
  initial_state_id: identity(900),
  states: STATES.map((state, index) => ({
    state_id: identity(900 + index),
    key: state.key,
    name: state.name,
    category: state.category,
    is_terminal: state.terminal,
    position: index,
  })),
  transitions: [
    { from: identity(900), to: identity(901) },
    { from: identity(901), to: identity(902) },
  ],
}

// An item names its state without the workflow's ordering: `position` belongs to
// the workflow's declaration of the state, not to an item sitting in it.
const { position: _devPosition, ...DEV_STATE } = workflow.states[1]
const { position: _donePosition, ...doneState } = workflow.states[2]
export { DEV_STATE as devState, doneState }

export const planningSpace = {
  planning_space_id: identity(800),
  name: 'Main',
  key: spaceRef.space_key,
  provider_kind: 'local',
  launch_place: 'space',
  projects: [
    { project_id: projectId, display_name: 'Example Project', root: 'C:/example', default: true },
  ],
  default_project: projectId,
}

/** The item `MAIN-264` is blocked by. Opening it is what makes Back reachable. */
export const blockedWorkItem: BriefFields = {
  work_item_id: identity(265),
  planning_space_id: planningSpace.planning_space_id,
  reference: 'MAIN-265',
  number: 265,
  title: 'Wire contract freeze',
  kind: 'task',
  state: DEV_STATE,
  priority: 'medium',
  claim_ref: '',
  claim_state: null,
  parent_id: null,
  labels: [],
  projects: [],
  source: '',
  open: true,
  container_state: null,
  acceptance: null,
  started_at: null,
  waits_for: [],
  workable: false,
  withheld: ['not_ready'],
  lapsed_claim: null,
  checklist: [],
  revision: 1,
  created_at: now,
  updated_at: now,
}

const briefFields: BriefFields = {
  work_item_id: identity(264),
  planning_space_id: planningSpace.planning_space_id,
  reference: workItemRef.reference,
  number: 264,
  // Slash-joined state names, which a browser takes for one word: they overflowed
  // the tile in the live application and later broke inside a word at a phone's
  // width, so the overflow and line-break checks have something to catch.
  title: 'Valkama platform execution loading/empty/error/unavailable/permission-denied',
  kind: 'task',
  state: DEV_STATE,
  priority: 'high',
  claim_ref: 'codex',
  // Signed by an agent but proved by no session, which is how every claim
  // older than leases reads.
  claim_state: 'unconfirmed' as const,
  parent_id: null,
  labels: ['platform', 'phase-1'],
  projects: [],
  source: 'docs/plans/platform.md#kb:architecture',
  open: true,
  container_state: null,
  acceptance: null,
  started_at: null,
  waits_for: [],
  workable: false,
  withheld: ['not_ready'],
  lapsed_claim: null,
  checklist: [
    {
      id: identity(300),
      text: 'Frontend contract',
      done: false,
      claimed_by: 'codex',
      done_by: '',
      by_previous_holder: false,
    },
  ],
  revision: 3,
  created_at: now,
  updated_at: now,
}

// Rows of the read model: the brief record and the place in the queue, none for work at work.
const workItemBrief = { ...briefFields, comment_count: 0, queue_order: null }
const blockedBrief = { ...blockedWorkItem, comment_count: 0, queue_order: null }

/** The full record the inspector reads, links included. */
export const workItem: WorkItem = {
  ...briefFields,
  claim: {
    holder: 'codex',
    state: 'unconfirmed',
    session_id: null,
    agent_id: null,
    source: null,
    acquired_at: null,
    last_seen: null,
    expires_at: null,
  },
  description: 'Deliver the exact project vertical slice.',
  summary: null,
  summary_comment_id: null,
  links: [
    {
      kind: 'blocks',
      direction: 'incoming',
      work_item_id: blockedWorkItem.work_item_id,
      reference: blockedWorkItem.reference,
      title: blockedWorkItem.title,
    },
  ],
  refs: [],
  comments: [],
  events: [],
}

export const blockedFullWorkItem: WorkItem = {
  ...blockedWorkItem,
  claim: null,
  description: '',
  summary: null,
  summary_comment_id: null,
  links: [
    {
      kind: 'blocks',
      direction: 'outgoing',
      work_item_id: workItemBrief.work_item_id,
      reference: workItemBrief.reference,
      title: workItemBrief.title,
    },
  ],
  refs: [],
  comments: [],
  events: [],
}

/** Planning's own read model: one answer the three views take apart. */
export const planningReadModel = {
  interface_version: 'valkama-planning-read-model',
  planning_spaces: [
    { ...planningSpace, work_items: 2, open: 2, active: 2, completed: 0, updated_at: now },
  ],
  planning_space: planningSpace,
  workflow,
  work_items: [workItemBrief, blockedBrief],
  links: [
    {
      from: blockedWorkItem.work_item_id,
      to: workItemBrief.work_item_id,
      kind: 'blocks',
    },
  ],
  // The server sends this and the fixture used to leave it out, so the mock
  // agreed with the client rather than with the server and the whole space
  // failed to load against a real one.
  stale_claims: [
    {
      reference: workItemRef.reference,
      title: briefFields.title,
      claim_ref: 'codex',
      claim_state: 'unconfirmed',
      state: DEV_STATE.key,
      last_event: now,
      quiet_days: 14,
    },
  ],
}

/** The projects a fixture space lists: the example project, its default. */
const spaceProjects = [{ project_id: projectId, display_name: 'Example Project' }]

/** A space with nothing in it and no project bound, as a store may hold one. */
export const emptySpaceRef = { data_scope_id: dataScopeId, space_key: 'NEW' }

/**
 * A space as the shell's context lists it: the scope choice names it by key and name and
 * narrows it to its projects. The empty one binds none.
 */
export const shellSpaceFor = (space: { data_scope_id: string; space_key: string }) =>
  space.space_key === emptySpaceRef.space_key
    ? { ...space, name: 'New space', default_project: null, projects: [], other_space_projects: [] }
    : {
        ...space,
        name: planningSpace.name,
        default_project: projectId,
        projects: spaceProjects,
        other_space_projects: [],
      }

/** The directory «All spaces» reads: every space, its projects and how full it is. */
export const planningReadyFor = (exactSpaceRef = spaceRef, includeEmptySpace = false) => ({
  spaces: [
    {
      space_ref: exactSpaceRef,
      title: planningSpace.name,
      work_item_count: 2,
      default_project: projectId,
      projects: spaceProjects,
    },
    ...(includeEmptySpace
      ? [
          {
            space_ref: emptySpaceRef,
            title: 'New space',
            work_item_count: 0,
            default_project: null,
            projects: [],
          },
        ]
      : []),
  ],
  planning_spaces: [
    {
      space_ref: exactSpaceRef,
      title: planningSpace.name,
      work_items: [
        {
          work_item_ref: { space_ref: exactSpaceRef, reference: workItemRef.reference },
          title: workItemBrief.title,
          state_key: DEV_STATE.key,
          state_category: DEV_STATE.category,
          container_state: null,
          priority: workItemBrief.priority,
          labels: workItemBrief.labels,
          claim_ref: workItemBrief.claim_ref,
          revision: workItemBrief.revision,
          updated_at: now,
        },
      ],
    },
  ],
})
