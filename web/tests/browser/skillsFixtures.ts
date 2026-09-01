/**
 * The skills catalogue and the activation matrix, as the harness serves them.
 *
 * Their own file for the reason the execution, memory and analytics fixtures
 * got theirs: a fixture belongs to the module whose payload it is, and
 * `platformFixtures.ts` had grown past the file ceiling holding two modules.
 */

import { now, planningSpace, projectId } from './planningFixtures.ts'

const skill = (scope: 'global' | 'project') => ({
  key: scope === 'global' ? 'global:review' : `project:${projectId}:review`,
  directory_name: 'review',
  name: `${scope}-review`,
  description: 'Review bounded work.',
  scope,
  source: scope === 'global' ? 'user-canonical' : 'project-local',
  project_id: scope === 'project' ? projectId : null,
  // The contract stopped publishing `board` as a project's title when the
  // cutover renamed it: the registry file's own key stays `board` because the
  // owner wrote it, but what Valkama publishes names the project.
  project_title: scope === 'project' ? planningSpace.name : null,
  owner_project_id: null,
  owner_project_title: null,
  root_id: `${scope}-root`,
  // SKL-002's identity, and the reason this fixture went stale unnoticed: the
  // contract gained a required field and nothing in the browser suite looked
  // at the Skills module closely enough to fail. The clipping sweep visits it,
  // and an error alert clips nothing.
  skill_ref: {
    provider_id: 'filesystem-catalogue',
    root_id: `${scope}-root`,
    skill_id: 'review',
    content_hash: (scope === 'global' ? 'a' : 'b').repeat(64),
  },
  location: '.agents/skills/review/SKILL.md',
  availability: 'available',
  duplicate: false,
  validation: { schema: 'agentskills-v1', status: 'valid', checks: ['frontmatter'], code: null },
  capabilities: {
    scripts: false,
    references: false,
    assets: false,
    script_entries: 0,
    reference_entries: 0,
    asset_entries: 0,
    script_entries_truncated: false,
    reference_entries_truncated: false,
    asset_entries_truncated: false,
  },
  metadata: { version: '1.0.0', license: 'MIT', compatibility: null },
  provenance: {
    source: 'filesystem',
    observed_at: now,
    content_hash: (scope === 'global' ? 'a' : 'b').repeat(64),
    duplicate_of: null,
  },
  clients: {
    codex: { enabled: true, can_toggle: true, status: 'enabled', reason: null },
    claude: { enabled: false, can_toggle: true, status: 'disabled', reason: null },
  },
})

export const skillsPayload = {
  interface_version: 'skills',
  as_of: now,
  clients: [{ id: 'codex' }, { id: 'claude' }],
  registry: {
    status: 'available',
    source: 'host_runtime',
    project_count: 1,
    total_project_count: 1,
    truncated: false,
    reason: null,
  },
  roots: [
    {
      id: 'global-root',
      scope: 'global',
      source: 'user-canonical',
      project_id: null,
      project_title: null,
      relative_root: '.agents/skills',
      availability: 'available',
      validation: 'valid',
      skill_count: 1,
      reason: null,
      manifest_source_hash: null,
      truncated: false,
    },
    {
      id: 'project-root',
      scope: 'project',
      source: 'project-local',
      project_id: projectId,
      project_title: planningSpace.name,
      relative_root: '.agents/skills',
      availability: 'available',
      validation: 'valid',
      skill_count: 1,
      reason: null,
      manifest_source_hash: 'c'.repeat(64),
      truncated: false,
    },
  ],
  projects: [
    {
      id: projectId,
      project_title: planningSpace.name,
      skill_count: 1,
      root_status: 'available',
    },
  ],
  skills: [skill('global'), skill('project')],
  summary: { roots: 2, projects: 1, skills: 2, valid: 2, invalid: 0, partial: 0, duplicates: 0 },
}

/**
 * Skill x Project x Client, with the two clients deliberately unalike.
 *
 * Claude holds a per-project answer and Codex does not, which is the only
 * thing this screen can get badly wrong: a switch in the Codex column would
 * look like it changes one project and would change every one.
 */
const matrixProjects = [
  { project_id: projectId, project_title: planningSpace.name },
  {
    project_id: 'long-title-project',
    project_title: 'Example Project With A Long Shared Registry Title',
  },
  { project_id: 'sample-project', project_title: 'Alpha Workspace' },
  { project_id: 'simstow', project_title: 'SimStow' },
]

const matrixSkill = (index: number) => ({
  key: `global:review-${index}`,
  name: index === 1 ? 'review' : `skill-${String(index).padStart(2, '0')}`,
  scope: 'global',
  owner_project_id: null,
  skill_ref: {
    provider_id: 'filesystem-catalogue',
    root_id: 'global-agent-skills',
    skill_id: `review-${index}`,
    content_hash: null,
  },
  cells: matrixProjects.map((project) => ({
    project_id: project.project_id,
    clients: {
      claude: {
        enabled: false,
        can_toggle: true,
        status: 'disabled',
        reason: null,
        project_scope: true,
      },
      codex: {
        enabled: true,
        can_toggle: false,
        status: 'enabled',
        reason: 'codex_activation_is_not_project_scoped',
        project_scope: false,
      },
    },
  })),
})

export const skillMatrixPayload = {
  interface_version: 'skills',
  as_of: now,
  clients: [
    { id: 'codex', project_scope: false },
    { id: 'claude', project_scope: true },
  ],
  projects: matrixProjects,
  skills: Array.from({ length: 18 }, (_, index) => matrixSkill(index + 1)),
  truncated: false,
}
