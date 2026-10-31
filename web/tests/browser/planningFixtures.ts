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

export const projectId = 'example-project'
export const dataScopeId = '123e4567-e89b-42d3-a456-426614174000'
export const attachedDataScopeId = '123e4567-e89b-42d3-a456-426614174001'
export const spaceRef = { data_scope_id: dataScopeId, space_key: 'MAIN' }
export const attachedSpaceRef = {
  data_scope_id: attachedDataScopeId,
  space_key: spaceRef.space_key,
}
export const projectScope = { kind: 'project' as const, project_ref: { project_id: projectId } }
export const globalScope = { kind: 'global' as const }
export const workItemRef = { space_ref: spaceRef, reference: 'MAIN-264' }
export const attachedWorkItemRef = { space_ref: attachedSpaceRef, reference: workItemRef.reference }
export const now = '2026-08-13T09:00:00Z'
const identity = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`

const STATES = [
  { key: 'backlog', name: 'Backlog', category: 'backlog', terminal: false },
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

export const planningSpace = {
  planning_space_id: identity(800),
  project_id: projectId,
  name: 'Main',
  key: spaceRef.space_key,
  provider_kind: 'local',
}

/** The item `MAIN-264` is blocked by. Opening it is what makes Back reachable. */
export const blockedWorkItem = {
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
  source: '',
  container: false,
  ready: false,
  checklist: [],
  revision: 1,
  created_at: now,
  updated_at: now,
}

const briefFields = {
  work_item_id: identity(264),
  planning_space_id: planningSpace.planning_space_id,
  reference: workItemRef.reference,
  number: 264,
  // Unbreakable by design: slash-joined state names are what overflowed the tile
  // in the live application, so the overflow check has something to catch.
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
  source: 'docs/plans/platform.md#kb:arch-plan',
  container: false,
  ready: false,
  checklist: [
    {
      id: identity(300),
      text: 'Frontend contract',
      done: false,
      claimed_by: 'codex',
      done_by: '',
    },
  ],
  revision: 3,
  created_at: now,
  updated_at: now,
}

const workItemBrief = { ...briefFields, comment_count: 0 }
const blockedBrief = { ...blockedWorkItem, comment_count: 0 }

/** The full record the inspector reads, links included. */
export const workItem = {
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

export const blockedFullWorkItem = {
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

/** The Kernel's directory of projects and the spaces they bind. */
export const planningReadyFor = (exactSpaceRef = spaceRef, includeUnboundProject = false) => ({
  projects: [
    {
      project_id: projectId,
      title: 'Example Project',
      binding_state: 'mapped',
      planning_spaces: [
        { space_ref: exactSpaceRef, title: planningSpace.name, work_item_count: 2 },
      ],
    },
    ...(includeUnboundProject
      ? [
          {
            project_id: 'unbound-project',
            title: 'Unbound Project',
            binding_state: 'unbound',
            planning_spaces: [],
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
