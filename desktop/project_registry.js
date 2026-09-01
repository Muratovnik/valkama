'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { TextDecoder } = require('node:util')

const STATUSES = new Set(['mapped', 'missing', 'ambiguous', 'malformed', 'unavailable'])
const REGISTRY_STATUSES = new Set(['available', 'absent', 'malformed', 'unavailable'])
const DOCUMENT_KEYS = new Set(['schema_version', 'projects'])
const ENTRY_KEYS = new Set(['project_id', 'display_name', 'canonical_root', 'planning_binding'])
const BINDING_KEYS = new Set(['kind', 'resource_id'])
const PROJECT_ID = /^[a-z][a-z0-9-]{0,159}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SPACE_KEY = /^[A-Z][A-Z0-9]{1,7}$/
// Preserve a BOM as input so JSON.parse rejects it, matching Python and Host Runtime.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

class RegistryError extends Error {}

function registryPath() {
  const local =
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
  return path.join(local, 'Valkama', 'projects.json')
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactRecord(value, keys, label) {
  if (!isRecord(value)) throw new RegistryError(`${label} must be an object`)
  const actual = new Set(Object.keys(value))
  const missing = [...keys].filter((key) => !actual.has(key)).sort()
  const unknown = [...actual].filter((key) => !keys.has(key)).sort()
  if (missing.length || unknown.length) {
    const details = []
    if (missing.length) details.push(`missing ${missing.join(', ')}`)
    if (unknown.length) details.push(`unknown ${unknown.join(', ')}`)
    throw new RegistryError(`${label} has ${details.join('; ')}`)
  }
  return value
}

function boundedText(value, label, maximum) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.length > maximum
  ) {
    throw new RegistryError(`${label} must be bounded trimmed text`)
  }
  return value
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new RegistryError(`duplicate ${label} in registry`)
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function validateSpaceRef(value, label) {
  const space = exactRecord(value, new Set(['data_scope_id', 'space_key']), label)
  if (typeof space.data_scope_id !== 'string' || !UUID.test(space.data_scope_id)) {
    throw new RegistryError(`${label}.data_scope_id must be a canonical UUID`)
  }
  if (typeof space.space_key !== 'string' || !SPACE_KEY.test(space.space_key)) {
    throw new RegistryError(`${label}.space_key is invalid`)
  }
  return space
}

function validatePlanningResource(resourceId, label) {
  if (!/^[A-Za-z0-9_-]+$/.test(resourceId)) {
    throw new RegistryError(`${label} must be canonical base64url`)
  }
  try {
    const bytes = Buffer.from(resourceId, 'base64url')
    if (bytes.toString('base64url') !== resourceId) throw new RegistryError('non-canonical')
    const decoded = JSON.parse(UTF8.decode(bytes))
    if (Buffer.from(canonicalJson(decoded), 'utf8').toString('base64url') !== resourceId) {
      throw new RegistryError('non-canonical')
    }
    validateSpaceRef(decoded, label)
  } catch {
    throw new RegistryError(`${label} must contain canonical Planning JSON`)
  }
}

function validateIncomingResourceRef(value, label) {
  const resource = exactRecord(value, BINDING_KEYS, label)
  if (resource.kind !== 'planning-space') {
    throw new RegistryError(`${label}.kind must be planning-space`)
  }
  const resourceId = boundedText(resource.resource_id, `${label}.resource_id`, 512)
  validatePlanningResource(resourceId, `${label}.resource_id`)
  return { kind: 'planning-space', resource_id: resourceId }
}

function validateBinding(value, label) {
  if (value === null) return null
  const binding = exactRecord(value, BINDING_KEYS, label)
  if (binding.kind !== 'planning-space') {
    throw new RegistryError(`${label}.kind must be planning-space`)
  }
  return {
    kind: 'planning-space',
    resource_id: boundedText(binding.resource_id, `${label}.resource_id`, 512),
  }
}

function validateProject(value, index) {
  const label = `registry.projects[${index}]`
  const entry = exactRecord(value, ENTRY_KEYS, label)
  const projectId = boundedText(entry.project_id, `${label}.project_id`, 160)
  if (!PROJECT_ID.test(projectId)) throw new RegistryError(`${label}.project_id is invalid`)
  const canonicalRoot = boundedText(entry.canonical_root, `${label}.canonical_root`, 32767)
  if (!path.isAbsolute(canonicalRoot)) {
    throw new RegistryError(`${label}.canonical_root must be absolute`)
  }
  return {
    project_id: projectId,
    display_name: boundedText(entry.display_name, `${label}.display_name`, 200),
    canonical_root: canonicalRoot,
    planning_binding: validateBinding(entry.planning_binding, `${label}.planning_binding`),
  }
}

function registryResult(status, { projects = [], reason = '' } = {}) {
  return { status, source: 'host_runtime', projects, reason }
}

function parseRegistry(raw) {
  if (raw === null || raw === undefined) {
    return registryResult('absent', { reason: 'Host Runtime project registry is absent' })
  }
  if (!(raw instanceof Uint8Array)) {
    return registryResult('malformed', { reason: 'project registry reader must return bytes' })
  }
  try {
    const document = exactRecord(JSON.parse(UTF8.decode(raw)), DOCUMENT_KEYS, 'registry')
    if (document.schema_version !== 3) {
      throw new RegistryError('registry.schema_version must be 3')
    }
    if (!Array.isArray(document.projects)) {
      throw new RegistryError('registry.projects must be an array')
    }
    const projects = document.projects.map(validateProject)
    requireUnique(
      projects.map((project) => project.project_id),
      'project_id',
    )
    requireUnique(
      projects.map((project) => path.normalize(project.canonical_root).toLocaleLowerCase()),
      'canonical_root',
    )
    requireUnique(
      projects
        .filter((project) => project.planning_binding !== null)
        .map((project) => project.planning_binding.resource_id),
      'planning_binding resource_id',
    )
    projects.sort(
      (left, right) =>
        left.project_id.localeCompare(right.project_id) ||
        left.canonical_root.localeCompare(right.canonical_root),
    )
    return registryResult('available', { projects })
  } catch (error) {
    return registryResult('malformed', {
      reason: `Host Runtime project registry is malformed: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

function readRegistry({ readBytes } = {}) {
  const read = typeof readBytes === 'function' ? readBytes : () => fs.readFileSync(registryPath())
  try {
    return parseRegistry(read())
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return registryResult('absent', { reason: 'Host Runtime project registry is absent' })
    }
    return registryResult('unavailable', {
      reason: `Host Runtime project registry cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

function result(resourceRef, status, reason, root = null) {
  return {
    resource_ref: resourceRef,
    status,
    canonical_root: root,
    reason,
    source: 'host_runtime',
  }
}

function resolveResourceRoot(resourceRef, options = {}) {
  const exists =
    options.directoryExists ||
    ((directory) => {
      try {
        return fs.statSync(directory).isDirectory()
      } catch {
        return false
      }
    })
  if (resourceRef === null || resourceRef === undefined) {
    return result(null, 'missing', 'planning space binding is absent')
  }
  let canonical
  try {
    canonical = validateIncomingResourceRef(resourceRef, 'resource_ref')
  } catch (error) {
    return result(
      null,
      'malformed',
      `planning space resource_ref is malformed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const registry = readRegistry({ readBytes: options.readBytes })
  if (registry.status !== 'available') {
    return result(
      canonical,
      registry.status === 'malformed' ? 'malformed' : 'unavailable',
      registry.reason,
    )
  }
  const matches = registry.projects.filter(
    (project) =>
      project.planning_binding?.kind === canonical.kind &&
      project.planning_binding?.resource_id === canonical.resource_id,
  )
  if (matches.length === 0) return result(canonical, 'missing', 'no exact Planning binding exists')
  if (matches.length > 1) {
    return result(canonical, 'ambiguous', `${matches.length} exact bindings exist`)
  }
  const root = matches[0].canonical_root
  if (!exists(root)) {
    return result(canonical, 'unavailable', 'mapped canonical_root is not an existing directory', root)
  }
  return { ...result(canonical, 'mapped', '', root), validated: true }
}

function trustedTarget(request, options = {}) {
  const sessionCwd = typeof request?.session_cwd === 'string' ? request.session_cwd.trim() : ''
  const mapping = resolveResourceRoot(request?.resource_ref, options)
  if (mapping.status === 'mapped') {
    return {
      ...mapping,
      effective_cwd: mapping.canonical_root,
      session_cwd: sessionCwd,
      fallback: false,
    }
  }
  return { ...mapping, effective_cwd: '', session_cwd: sessionCwd, fallback: false }
}

module.exports = {
  REGISTRY_STATUSES,
  STATUSES,
  parseRegistry,
  readRegistry,
  registryPath,
  resolveResourceRoot,
  trustedTarget,
}
