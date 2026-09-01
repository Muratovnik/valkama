/**
 * Skill × Project × Client, read on its own.
 *
 * A file of its own rather than a section of the catalogue client: this read
 * costs a settings chain per cell, and a page that only lists skills should not
 * pay for it or import its types.
 */

import { SkillsRequestError } from '@/entities/skill/api/skillsApi.ts'

import type { SkillClient, SkillRef } from '@/shared/types/skills.ts'

/** Whether a client can hold a different answer per project. Declared, not guessed. */
interface SkillMatrixClient {
  id: SkillClient
  project_scope: boolean
}

export interface SkillMatrixCellState {
  can_toggle: boolean
  enabled: boolean | null
  project_scope: boolean
  reason: string | null
  status: string
}

export interface SkillMatrixRow {
  cells: Array<{ clients: Record<SkillClient, SkillMatrixCellState>; project_id: string }>
  key: string
  name: string
  owner_project_id: string | null
  scope: 'global' | 'project'
  skill_ref: SkillRef
}

export interface SkillMatrix {
  as_of: string
  clients: SkillMatrixClient[]
  interface_version: 'skills'
  projects: Array<{ project_id: string; project_title: string }>
  skills: SkillMatrixRow[]
  truncated: boolean
}

/**
 * Skill x Project x Client.
 *
 * A read of its own rather than a field on the catalogue: it costs a settings
 * chain per cell, and a page that only lists skills should not pay for it.
 */
export async function fetchSkillMatrix(): Promise<SkillMatrix> {
  try {
    const response = await fetch('/api/modules/skills/matrix')
    if (!response.ok) throw new SkillsRequestError()
    return validateSkillMatrix(await response.json())
  } catch (error) {
    if (error instanceof SkillsRequestError) throw error
    throw new SkillsRequestError()
  }
}

/**
 * The shape a grid can be drawn from, checked before anything draws it.
 *
 * A payload that is JSON and not this one used to reach the render and throw
 * inside a `v-for`, which surfaces as a blank module rather than as the failed
 * read it is. Checked here so the view shows its own error state instead.
 */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function stringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function validSkillRef(value: unknown): value is SkillRef {
  const item = record(value)
  return Boolean(
    item &&
    exact(item, ['provider_id', 'root_id', 'skill_id', 'content_hash']) &&
    typeof item.provider_id === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(item.provider_id) &&
    typeof item.root_id === 'string' &&
    item.root_id.length > 0 &&
    item.root_id.length <= 160 &&
    typeof item.skill_id === 'string' &&
    item.skill_id.length > 0 &&
    item.skill_id.length <= 96 &&
    (item.content_hash === null ||
      (typeof item.content_hash === 'string' && /^[0-9a-f]{64}$/iu.test(item.content_hash))),
  )
}

function cellState(value: unknown, projectScope: boolean): value is SkillMatrixCellState {
  const state = record(value)
  if (!state || !exact(state, ['enabled', 'can_toggle', 'status', 'reason', 'project_scope']))
    return false
  const status = String(state.status)
  return (
    (typeof state.enabled === 'boolean' || state.enabled === null) &&
    typeof state.can_toggle === 'boolean' &&
    ['disabled', 'enabled', 'unavailable', 'unknown'].includes(status) &&
    stringOrNull(state.reason) &&
    state.project_scope === projectScope &&
    (status === 'enabled' ? state.enabled === true : true) &&
    (status === 'disabled' ? state.enabled === false : true) &&
    (status === 'unavailable' || status === 'unknown' ? state.enabled === null : true) &&
    (state.can_toggle ? projectScope && (status === 'enabled' || status === 'disabled') : true) &&
    (projectScope ? true : state.can_toggle === false)
  )
}

export function validateSkillMatrix(payload: unknown): SkillMatrix {
  const candidate = record(payload)
  const clients = Array.isArray(candidate?.clients)
    ? candidate.clients.map((client) => record(client))
    : []
  const clientIds = clients
    .map((client) => client?.id)
    .filter((id): id is string => typeof id === 'string')
  const clientScopes = new Map(
    clients
      .filter((client): client is Record<string, unknown> => client !== null)
      .map((client) => [String(client.id), client.project_scope === true]),
  )
  const projects = Array.isArray(candidate?.projects)
    ? candidate.projects.map((project) => record(project))
    : []
  const projectIds = projects
    .map((project) => project?.project_id)
    .filter((id): id is string => typeof id === 'string')
  if (
    !candidate ||
    !exact(candidate, [
      'interface_version',
      'as_of',
      'clients',
      'projects',
      'skills',
      'truncated',
    ]) ||
    candidate.interface_version !== 'skills' ||
    typeof candidate.as_of !== 'string' ||
    typeof candidate.truncated !== 'boolean' ||
    clients.length === 0 ||
    !clients.every(
      (client) =>
        client !== null &&
        exact(client, ['id', 'project_scope']) &&
        typeof client.id === 'string' &&
        /^[a-z][a-z0-9-]{0,63}$/u.test(client.id) &&
        typeof client.project_scope === 'boolean',
    ) ||
    new Set(clientIds).size !== clientIds.length ||
    !projects.every(
      (project) =>
        project !== null &&
        exact(project, ['project_id', 'project_title']) &&
        typeof project.project_id === 'string' &&
        /^[a-z][a-z0-9-]{0,159}$/u.test(project.project_id) &&
        typeof project.project_title === 'string',
    ) ||
    new Set(projectIds).size !== projectIds.length ||
    !Array.isArray(candidate.skills) ||
    !candidate.skills.every((value) => {
      const row = record(value)
      if (
        !row ||
        !exact(row, ['key', 'name', 'scope', 'owner_project_id', 'skill_ref', 'cells']) ||
        typeof row.key !== 'string' ||
        !/^(?:global:[^:\s]+|(?:project|source):[^:\s]+:[^:\s]+)$/u.test(row.key) ||
        typeof row.name !== 'string' ||
        row.name.length === 0 ||
        row.name.length > 64 ||
        (row.scope !== 'global' && row.scope !== 'project') ||
        !stringOrNull(row.owner_project_id) ||
        (row.scope === 'global' && row.owner_project_id !== null) ||
        !validSkillRef(row.skill_ref) ||
        !Array.isArray(row.cells) ||
        row.cells.length !== projectIds.length
      )
        return false
      const seenProjects = new Set<string>()
      return row.cells.every((value) => {
        const cell = record(value)
        const cellClients = record(cell?.clients)
        if (
          !cell ||
          !exact(cell, ['project_id', 'clients']) ||
          typeof cell.project_id !== 'string' ||
          !projectIds.includes(cell.project_id) ||
          seenProjects.has(cell.project_id) ||
          cellClients === null ||
          !exact(cellClients, clientIds)
        )
          return false
        seenProjects.add(cell.project_id)
        return clientIds.every((client) => {
          const projectScope = clientScopes.get(client)
          return typeof projectScope === 'boolean' && cellState(cellClients[client], projectScope)
        })
      })
    }) ||
    new Set(candidate.skills.map((row) => record(row)?.key)).size !== candidate.skills.length
  ) {
    throw new SkillsRequestError()
  }
  return payload as SkillMatrix
}
