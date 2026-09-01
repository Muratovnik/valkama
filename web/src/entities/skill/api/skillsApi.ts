import { secureFetch } from '@/shared/api/secureFetch.ts'
import type {
  SkillClient,
  SkillClientActivation,
  SkillDetail,
  SkillEntry,
  SkillProject,
  SkillRef,
  SkillRoot,
  SkillsPayload,
} from '@/shared/types/skills.ts'

const SKILLS_INTERFACE_VERSION = 'skills' as const
const SKILL_DETAIL_INTERFACE_VERSION = 'skill-detail' as const
const SKILLS_CONTRACT_ERROR_CODE = 'skills_contract_invalid' as const
const SKILLS_REQUEST_ERROR_CODE = 'skills_request_failed' as const

export class SkillsContractError extends Error {
  readonly code = SKILLS_CONTRACT_ERROR_CODE

  constructor() {
    super(SKILLS_CONTRACT_ERROR_CODE)
    this.name = 'SkillsContractError'
  }
}

export class SkillsRequestError extends Error {
  readonly code = SKILLS_REQUEST_ERROR_CODE
  /** The typed backend cause (for example skill_file_missing), when it is known. */
  readonly detail_code: string

  constructor(detailCode: string = SKILLS_REQUEST_ERROR_CODE) {
    super(detailCode)
    this.name = 'SkillsRequestError'
    this.detail_code = detailCode
  }
}

const BACKEND_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/u

async function requestErrorFrom(response: Response): Promise<SkillsRequestError> {
  const body = await response.json().catch(() => null)
  const code =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as { error?: { code?: unknown } }).error?.code
      : undefined
  return typeof code === 'string' && BACKEND_ERROR_CODE.test(code)
    ? new SkillsRequestError(code)
    : new SkillsRequestError()
}

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

function boundedShape(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

function stringOrNull(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function natural(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function logicalLocation(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('.agents/skills/') &&
    value.endsWith('/SKILL.md') &&
    !value.includes('\\') &&
    !value.includes('..') &&
    !/^[A-Za-z]:\//.test(value)
  )
}

function validRoot(value: unknown): value is SkillRoot {
  const item = record(value)
  if (
    !item ||
    !boundedShape(
      item,
      [
        'id',
        'scope',
        'source',
        'relative_root',
        'availability',
        'validation',
        'skill_count',
        'truncated',
      ],
      ['project_id', 'project_title', 'reason', 'manifest_source_hash'],
    )
  )
    return false
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    ['global', 'project'].includes(String(item.scope)) &&
    ['project-local', 'user-canonical'].includes(String(item.source)) &&
    (item.project_id === undefined || stringOrNull(item.project_id)) &&
    (item.project_title === undefined || stringOrNull(item.project_title)) &&
    item.relative_root === '.agents/skills' &&
    ['available', 'missing', 'partial', 'unavailable', 'unsafe'].includes(
      String(item.availability),
    ) &&
    ['invalid', 'partial', 'valid'].includes(String(item.validation)) &&
    natural(item.skill_count) &&
    typeof item.truncated === 'boolean' &&
    (item.reason === undefined || stringOrNull(item.reason)) &&
    (!item.truncated ||
      (item.availability === 'partial' &&
        item.validation === 'partial' &&
        ['skill_limit_and_validation_incomplete', 'skill_limit_reached'].includes(
          String(item.reason),
        ))) &&
    (item.availability === 'available' && item.validation === 'valid'
      ? item.truncated === false && (item.reason === undefined || item.reason === null)
      : typeof item.reason === 'string' && item.reason.length > 0) &&
    (item.manifest_source_hash === undefined ||
      item.manifest_source_hash === null ||
      (typeof item.manifest_source_hash === 'string' &&
        /^[0-9a-f]{64}$/i.test(item.manifest_source_hash)))
  )
}

function validProject(value: unknown): value is SkillProject {
  const item = record(value)
  return Boolean(
    item &&
    exact(item, ['id', 'project_title', 'skill_count', 'root_status']) &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.project_title === 'string' &&
    item.project_title.length > 0 &&
    natural(item.skill_count) &&
    ['available', 'missing', 'partial', 'unavailable', 'unsafe'].includes(String(item.root_status)),
  )
}

/**
 * The identity, checked against the entry that carries it.
 *
 * The ref is only worth having if it agrees with its own entry: a root or a
 * directory that disagrees means two answers to which skill this is, and the
 * whole point of an identity object is that there is one.
 */
function validSkillRef(value: unknown, rootId: unknown, directory: unknown): value is SkillRef {
  const item = record(value)
  return Boolean(
    item &&
    exact(item, ['provider_id', 'root_id', 'skill_id', 'content_hash']) &&
    typeof item.provider_id === 'string' &&
    item.provider_id.length > 0 &&
    item.root_id === rootId &&
    item.skill_id === directory &&
    (item.content_hash === null ||
      (typeof item.content_hash === 'string' && /^[0-9a-f]{64}$/i.test(item.content_hash))),
  )
}

function validClientActivation(value: unknown): value is SkillClientActivation {
  const item = record(value)
  if (!item || !exact(item, ['enabled', 'can_toggle', 'status', 'reason'])) return false
  return (
    (typeof item.enabled === 'boolean' || item.enabled === null) &&
    typeof item.can_toggle === 'boolean' &&
    ['disabled', 'enabled', 'unavailable', 'unknown'].includes(String(item.status)) &&
    stringOrNull(item.reason) &&
    (item.status === 'enabled' ? item.enabled === true : true) &&
    (item.status === 'disabled' ? item.enabled === false : true) &&
    (item.status === 'unavailable' || item.status === 'unknown' ? item.enabled === null : true) &&
    (item.can_toggle ? item.status === 'enabled' || item.status === 'disabled' : true)
  )
}

function validSkill(value: unknown, clientIds: readonly string[]): value is SkillEntry {
  const item = record(value)
  if (
    !item ||
    !exact(item, [
      'key',
      'directory_name',
      'name',
      'description',
      'scope',
      'source',
      'project_id',
      'project_title',
      'owner_project_id',
      'owner_project_title',
      'root_id',
      'skill_ref',
      'location',
      'availability',
      'duplicate',
      'clients',
      'validation',
      'capabilities',
      'metadata',
      'provenance',
    ])
  )
    return false
  const validation = record(item.validation)
  const clients = record(item.clients)
  const capabilities = record(item.capabilities)
  const metadata = record(item.metadata)
  const provenance = record(item.provenance)
  if (!validation || !clients || !capabilities || !metadata || !provenance) return false
  return (
    /^(?:global:[^:\s]+|project:[^:\s]+:[^:\s]+)$/.test(String(item.key)) &&
    typeof item.directory_name === 'string' &&
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    item.description.length <= 240 &&
    ['global', 'project'].includes(String(item.scope)) &&
    ['project-local', 'user-canonical'].includes(String(item.source)) &&
    stringOrNull(item.project_id) &&
    stringOrNull(item.project_title) &&
    stringOrNull(item.owner_project_id) &&
    stringOrNull(item.owner_project_title) &&
    typeof item.root_id === 'string' &&
    item.root_id.length > 0 &&
    validSkillRef(item.skill_ref, item.root_id, item.directory_name) &&
    logicalLocation(item.location) &&
    ['available', 'missing', 'unreadable', 'unsafe'].includes(String(item.availability)) &&
    typeof item.duplicate === 'boolean' &&
    exact(clients, clientIds) &&
    clientIds.every((client) => validClientActivation(clients[client])) &&
    exact(validation, ['schema', 'status', 'checks', 'code']) &&
    validation.schema === 'agentskills-v1' &&
    ['invalid', 'partial', 'valid'].includes(String(validation.status)) &&
    Array.isArray(validation.checks) &&
    validation.checks.every((check) => typeof check === 'string') &&
    stringOrNull(validation.code) &&
    exact(capabilities, [
      'scripts',
      'references',
      'assets',
      'script_entries',
      'reference_entries',
      'asset_entries',
      'script_entries_truncated',
      'reference_entries_truncated',
      'asset_entries_truncated',
    ]) &&
    ['scripts', 'references', 'assets'].every((key) => typeof capabilities[key] === 'boolean') &&
    ['script_entries', 'reference_entries', 'asset_entries'].every((key) =>
      natural(capabilities[key]),
    ) &&
    ['script_entries_truncated', 'reference_entries_truncated', 'asset_entries_truncated'].every(
      (key) => typeof capabilities[key] === 'boolean',
    ) &&
    exact(metadata, ['version', 'license', 'compatibility']) &&
    ['version', 'license', 'compatibility'].every((key) => stringOrNull(metadata[key])) &&
    exact(provenance, ['source', 'observed_at', 'content_hash', 'duplicate_of']) &&
    provenance.source === 'filesystem' &&
    typeof provenance.observed_at === 'string' &&
    (provenance.content_hash === null ||
      (typeof provenance.content_hash === 'string' &&
        /^[0-9a-f]{64}$/i.test(provenance.content_hash))) &&
    stringOrNull(provenance.duplicate_of)
  )
}

export function validateSkillsPayload(payload: unknown): SkillsPayload {
  const candidate = record(payload)
  const registry = record(candidate?.registry)
  const summary = record(candidate?.summary)
  const clients = Array.isArray(candidate?.clients)
    ? candidate.clients.map((entry) => record(entry))
    : []
  const clientIds = clients
    .map((client) => client?.id)
    .filter((id): id is string => typeof id === 'string')
  const validClients =
    clients.length > 0 &&
    clients.every((client) =>
      Boolean(
        client &&
        exact(client, ['id']) &&
        typeof client.id === 'string' &&
        /^[a-z][a-z0-9-]{0,63}$/.test(client.id),
      ),
    ) &&
    new Set(clientIds).size === clientIds.length
  const valid = Boolean(
    candidate &&
    exact(candidate, [
      'interface_version',
      'as_of',
      'clients',
      'registry',
      'roots',
      'projects',
      'skills',
      'summary',
    ]) &&
    candidate.interface_version === SKILLS_INTERFACE_VERSION &&
    typeof candidate.as_of === 'string' &&
    validClients &&
    registry &&
    exact(registry, [
      'status',
      'source',
      'project_count',
      'total_project_count',
      'truncated',
      'reason',
    ]) &&
    ['absent', 'available', 'malformed', 'unavailable'].includes(String(registry.status)) &&
    registry.source === 'host_runtime' &&
    natural(registry.project_count) &&
    natural(registry.total_project_count) &&
    typeof registry.truncated === 'boolean' &&
    stringOrNull(registry.reason) &&
    registry.project_count <= registry.total_project_count &&
    registry.truncated === registry.project_count < registry.total_project_count &&
    (!registry.truncated || registry.reason === 'project_limit_reached') &&
    (registry.status === 'available' && !registry.truncated
      ? registry.reason === null
      : typeof registry.reason === 'string' && registry.reason.length > 0) &&
    Array.isArray(candidate.roots) &&
    candidate.roots.every(validRoot) &&
    Array.isArray(candidate.projects) &&
    candidate.projects.every(validProject) &&
    Array.isArray(candidate.skills) &&
    candidate.skills.every((skill) => validSkill(skill, clientIds)) &&
    summary &&
    exact(summary, ['roots', 'projects', 'skills', 'valid', 'invalid', 'partial', 'duplicates']) &&
    Object.values(summary).every(natural),
  )
  if (!valid) throw new SkillsContractError()
  return payload as SkillsPayload
}

export function validateSkillDetail(payload: unknown): SkillDetail {
  const candidate = record(payload)
  const valid = Boolean(
    candidate &&
    exact(candidate, [
      'interface_version',
      'key',
      'name',
      'location',
      'content_hash',
      'markdown',
    ]) &&
    candidate.interface_version === SKILL_DETAIL_INTERFACE_VERSION &&
    /^(?:global:[^:\s]+|(?:project|source):[^:\s]+:[^:\s]+)$/.test(String(candidate.key)) &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    candidate.name.length <= 64 &&
    logicalLocation(candidate.location) &&
    typeof candidate.content_hash === 'string' &&
    /^[0-9a-f]{64}$/i.test(candidate.content_hash) &&
    typeof candidate.markdown === 'string' &&
    new TextEncoder().encode(candidate.markdown).byteLength <= 256 * 1024,
  )
  if (!valid) throw new SkillsContractError()
  return payload as SkillDetail
}

export async function fetchSkills(): Promise<SkillsPayload> {
  try {
    const response = await fetch('/api/modules/skills')
    if (!response.ok) throw new SkillsRequestError()
    return validateSkillsPayload(await response.json())
  } catch (error) {
    if (error instanceof SkillsContractError || error instanceof SkillsRequestError) throw error
    throw new SkillsRequestError()
  }
}

export async function fetchSkillDetail(key: string): Promise<SkillDetail> {
  try {
    const response = await fetch(`/api/modules/skills/detail?key=${encodeURIComponent(key)}`)
    if (!response.ok) throw await requestErrorFrom(response)
    const detail = validateSkillDetail(await response.json())
    if (detail.key !== key) throw new SkillsContractError()
    return detail
  } catch (error) {
    if (error instanceof SkillsContractError || error instanceof SkillsRequestError) throw error
    throw new SkillsRequestError()
  }
}

/**
 * One skill, one client, on or off — for the owner, or inside one project.
 *
 * `project` is omitted rather than nulled when the answer is the owner's own,
 * and a client that cannot hold a per-project answer refuses it rather than
 * writing the owner-wide value under a project's name.
 */
export async function updateSkillActivation(
  key: string,
  client: SkillClient,
  enabled: boolean,
  project?: string,
): Promise<SkillsPayload> {
  try {
    const response = await secureFetch('/api/modules/skills/activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project ? { key, client, enabled, project } : { key, client, enabled }),
    })
    if (!response.ok) throw new SkillsRequestError()
    return validateSkillsPayload(await response.json())
  } catch (error) {
    if (error instanceof SkillsContractError || error instanceof SkillsRequestError) throw error
    throw new SkillsRequestError()
  }
}
