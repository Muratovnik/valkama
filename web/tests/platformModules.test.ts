import assert from 'node:assert/strict'

import { ref } from 'vue'

import { test } from 'vitest'

import {
  resolveResourceSelection,
  selectableProjectResources,
  useModuleRouteAuthority,
} from '@/app/composables/useModuleRouteAuthority.ts'

import {
  MODULES_INTERFACE,
  validateModuleManifest,
  validateModulesPayload,
} from '@/shared/api/platformModuleContract.ts'
import type { ModuleId, ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import {
  resolveManifestRouteAuthority,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

import { moduleRegistrations, modulesPayload } from './support/moduleRegistrations.ts'

const EXPECTED_SECONDARY_CONTEXTS = {
  planning: {
    global: ['project', 'planning-space'],
    project: ['planning-space', 'work-item'],
  },
  sessions: { global: ['execution', 'session'], project: [] },
  analytics: { global: [], project: ['planning-space', 'work-item', 'artifact'] },
  improvements: { global: ['work-item', 'improvement-case'], project: [] },
  skills: { global: ['skill'], project: ['skill'] },
  memory: { global: ['memory-resource'], project: ['memory-resource', 'work-item'] },
  settings: { global: ['connection', 'registry'], project: ['connection', 'registry'] },
} as const

test('valkama-modules has exactly seven built-ins with both operating levels', () => {
  assert.equal(OFFLINE_MODULE_FALLBACK.length, 7)
  assert.deepEqual(
    OFFLINE_MODULE_FALLBACK.map((module) => module.module_id),
    ['planning', 'sessions', 'analytics', 'improvements', 'skills', 'memory', 'settings'],
  )
  for (const module of OFFLINE_MODULE_FALLBACK) {
    assert.equal(module.interface_version, MODULES_INTERFACE)
    assert.deepEqual(module.operating_levels, ['global', 'project'])
    assert.equal(module.route_namespace, module.module_id)
    assert.ok(module.semantics.global)
    assert.ok(module.semantics.project)
    assert.ok(module.states.global.supported.includes('loading'))
    if (module.module_id === 'improvements') {
      assert.deepEqual(module.states.project.supported, ['unavailable'])
      assert.equal(
        module.states.project.unsupported_reason,
        'improvements_project_scope_unsupported',
      )
    } else {
      assert.ok(module.states.project.supported.includes('permission-denied'))
    }
  }
})

test('offline secondary contexts exactly mirror the authoritative scoped contract', () => {
  for (const manifest of OFFLINE_MODULE_FALLBACK) {
    const expected = EXPECTED_SECONDARY_CONTEXTS[manifest.module_id]
    assert.deepEqual(manifest.secondary_context.global.kinds, expected.global)
    assert.deepEqual(manifest.secondary_context.project.kinds, expected.project)
    const supported = new Set(manifest.supported_entity_kinds)
    for (const scope of ['global', 'project'] as const) {
      const kinds = manifest.secondary_context[scope].kinds
      assert.equal(kinds.length, new Set(kinds).size)
      assert.ok(kinds.every((kind) => supported.has(kind)))
    }
  }
})

test('Skills route state keeps search, status, and view as one canonical shape', () => {
  const skills = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'skills')
  assert.ok(skills)
  const state = { query: 'review', status: 'issues', view: 'matrix' }
  assert.deepEqual(skills.state_schema.allowed_keys, ['query', 'status', 'view'])
  assert.deepEqual(validateManifestRouteState(skills, state), state)
  for (const stale of [{ source_scope: 'global' }, { activation: 'enabled' }]) {
    assert.throws(() => validateManifestRouteState(skills, stale), /unknown module-local state key/)
  }
})
test('valkama-modules payload validates and rejects additive fields', () => {
  const payload = modulesPayload()
  assert.equal(validateModulesPayload(payload).modules.length, 7)
  const additive = structuredClone(payload) as Record<string, unknown>
  additive.extra = true
  assert.throws(() => validateModulesPayload(additive), /unknown field/)
  const wrongVersion = structuredClone(payload) as { interface_version: string }
  wrongVersion.interface_version = 'platform-modules'
  assert.throws(() => validateModulesPayload(wrongVersion), /expected valkama-modules/)
})

test('module manifest rejects route injection and malformed levels', () => {
  const module = structuredClone(OFFLINE_MODULE_FALLBACK[0]) as Record<string, unknown>
  module.route_namespace = 'adapter.fake'
  assert.throws(() => validateModuleManifest(module), /route namespace/)
  const levels = structuredClone(OFFLINE_MODULE_FALLBACK[0]) as { operating_levels: string[] }
  levels.operating_levels = ['global']
  assert.throws(() => validateModuleManifest(levels), /operating_levels/)
})

test('module manifests require canonical semantic versions', () => {
  const module = structuredClone(OFFLINE_MODULE_FALLBACK[0]) as Record<string, unknown>
  for (const accepted of [
    '0.0.0',
    '1.2.3',
    '1.0.0-alpha',
    '1.0.0-alpha.1+build.5',
    '10.20.30-rc.1+sha-abc',
  ]) {
    module.version = accepted
    assert.equal(validateModuleManifest(module).version, accepted)
  }
  for (const rejected of [
    '1',
    '1.2',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.0.0-01',
    '1.0.0-',
    '1.0.0+',
  ]) {
    module.version = rejected
    assert.throws(() => validateModuleManifest(module), /version/)
  }
})

test('module action declarations share the ActionRef 192-character envelope', () => {
  const module = structuredClone(OFFLINE_MODULE_FALLBACK[0]) as Record<string, unknown> & {
    primary_actions: string[]
  }
  const longAction = `core.${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(59)}`
  assert.equal(longAction.length, 192)
  module.primary_actions = [longAction]
  assert.equal(validateModuleManifest(module).primary_actions[0], longAction)
  module.primary_actions = [`core.${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(60)}`]
  assert.throws(() => validateModuleManifest(module), /primary_actions|bounded/)
})

test('registration state is runtime validated and Settings is fail-closed', () => {
  const registrations = moduleRegistrations()
  registrations[0].state = 'disabled'
  assert.equal(
    validateModulesPayload({ interface_version: MODULES_INTERFACE, modules: registrations })
      .modules[0].state,
    'disabled',
  )
  const settings = registrations.at(-1)
  assert.ok(settings)
  settings.state = 'disabled'
  assert.throws(
    () => validateModulesPayload({ interface_version: MODULES_INTERFACE, modules: registrations }),
    /Settings must be immutable and enabled/,
  )
})

test('validated future registration remains authoritative with typed unsupported renderer', () => {
  const registrations = moduleRegistrations()
  const future = structuredClone(registrations[0])
  future.manifest.module_id = 'future-module'
  future.manifest.route_namespace = 'future-module'
  future.manifest.title_key = 'platform.modules.future-module'
  future.manifest.state_schema.schema_id = 'module.future-module.state'
  future.manifest.inspector_owner = 'module.future-module'
  registrations.push(future)
  const validated = validateModulesPayload({
    interface_version: MODULES_INTERFACE,
    modules: registrations,
  }).modules
  assert.equal(validated.at(-1)?.manifest.module_id, 'future-module')

  const authority = useModuleRouteAuthority({
    loadModules: async () => {},
    loadRegistry: async () => {},
    modules: ref(validated.map((registration) => registration.manifest)),
    modulesAuthoritative: ref(true),
    modulesSettled: ref(true),
    parsedUnavailable: ref(null),
    registrations: ref(validated),
    route: ref({ module_id: 'future-module', scope: { kind: 'global' } }),
    te: () => false,
    translate: (key) => key,
  })
  assert.equal(authority.activeManifest.value, undefined)
  assert.equal(authority.routeUnavailable.value?.reason, 'unsupported-view')
  assert.ok(authority.routeUnavailable.value?.recovery.available_modules.includes('future-module'))
})

test('authoritative manifests reject unsupported entity and scoped secondary context', () => {
  const planning = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'planning')
  const skills = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'skills')
  assert.ok(planning)
  assert.ok(skills)
  assert.deepEqual(
    resolveManifestRouteAuthority(planning, {
      module_id: 'planning',
      scope: { kind: 'project', project_ref: { project_id: 'project-alpha' } },
      entity: { kind: 'session', client_family: 'codex', session_id: 'session-1' },
    }),
    { status: 'unavailable', reason: 'incompatible-entity' },
  )
  assert.deepEqual(
    resolveManifestRouteAuthority(skills, {
      module_id: 'skills',
      scope: { kind: 'global' },
      entity: { kind: 'planning-space', resource_id: 'opaque-resource' },
    }),
    { status: 'unavailable', reason: 'incompatible-entity' },
  )

  const noSecondaryContext = structuredClone(planning)
  noSecondaryContext.secondary_context.project = { behavior: 'none', kinds: [] }
  assert.equal(
    resolveManifestRouteAuthority(noSecondaryContext, {
      module_id: 'planning',
      scope: { kind: 'project', project_ref: { project_id: 'project-alpha' } },
      entity: { kind: 'planning-space', resource_id: 'opaque-resource' },
    }).status,
    'unavailable',
  )
})

test('each module accepts only the entity routes its scoped UI owns', () => {
  const manifests = Object.fromEntries(
    OFFLINE_MODULE_FALLBACK.map((manifest) => [manifest.module_id, manifest]),
  ) as Record<ModuleId, ModuleManifest>
  const global = { kind: 'global' as const }
  const project = { kind: 'project' as const, project_ref: { project_id: 'project-alpha' } }
  const entities = {
    planningSpace: { kind: 'planning-space' as const, resource_id: 'planning-space-1' },
    workItem: { kind: 'work-item' as const, resource_id: 'work-item-1' },
    artifact: { kind: 'artifact' as const, resource_id: 'artifact-1' },
    execution: { kind: 'execution' as const, resource_id: 'execution-1' },
    session: { kind: 'session' as const, client_family: 'codex', session_id: 'session-1' },
    improvement: { kind: 'improvement-case' as const, resource_id: 'case-1' },
    globalSkill: { kind: 'skill' as const, skill_key: 'skill-1', source_scope: 'global' as const },
    projectSkill: {
      kind: 'skill' as const,
      skill_key: 'skill-1',
      source_scope: 'project' as const,
      project_id: 'project-alpha',
    },
    registry: { kind: 'registry' as const, registry_id: 'registry-1' },
    connection: {
      kind: 'connection' as const,
      adapter_lineage_id: 'adapter-1',
      connection_id: 'connection-1',
      service_ref: { owner_id: 'owner-1', service_id: 'service-1' },
    },
  }
  const accepts = (
    module_id: ModuleId,
    scope: typeof global | typeof project,
    entity: PlatformRoute['entity'],
  ) =>
    resolveManifestRouteAuthority(manifests[module_id], { module_id, scope, entity }).status ===
    'ready'

  assert.equal(accepts('skills', global, entities.globalSkill), true)
  assert.equal(accepts('skills', project, entities.projectSkill), true)
  assert.equal(accepts('settings', global, entities.registry), true)
  assert.equal(accepts('settings', project, entities.connection), true)
  assert.equal(accepts('planning', project, entities.planningSpace), true)
  assert.equal(accepts('planning', project, entities.workItem), true)
  assert.equal(accepts('analytics', project, entities.workItem), true)
  assert.equal(accepts('analytics', project, entities.planningSpace), true)
  assert.equal(accepts('analytics', project, entities.artifact), true)
  assert.equal(accepts('sessions', global, entities.session), true)
  assert.equal(accepts('sessions', global, entities.execution), true)
  assert.equal(accepts('improvements', global, entities.improvement), true)
  assert.equal(accepts('improvements', global, entities.workItem), true)

  assert.equal(accepts('planning', project, entities.session), false)
  assert.equal(accepts('sessions', project, entities.session), false)
  assert.equal(accepts('analytics', global, entities.artifact), false)
  assert.equal(accepts('improvements', project, entities.improvement), false)
  assert.equal(accepts('skills', global, entities.planningSpace), false)
})

test('App resource emissions are derived from and rechecked against the active manifest', () => {
  const manifests = Object.fromEntries(
    OFFLINE_MODULE_FALLBACK.map((manifest) => [manifest.module_id, manifest]),
  ) as Record<ModuleId, ModuleManifest>
  const resources = ['planning-space-1', 'planning-space-2'].map((resource_id) => ({
    resource_ref: { kind: 'planning-space' as const, resource_id },
    state: 'mapped' as const,
  }))
  const projectScope = {
    kind: 'project' as const,
    project_ref: { project_id: 'project-alpha' },
  }

  assert.deepEqual(selectableProjectResources(manifests.planning, resources), resources)
  assert.deepEqual(selectableProjectResources(manifests.analytics, resources), resources)
  for (const module_id of ['skills', 'sessions', 'improvements', 'settings'] as const)
    assert.deepEqual(selectableProjectResources(manifests[module_id], resources), [])

  assert.deepEqual(
    resolveResourceSelection(
      manifests.analytics,
      { module_id: 'analytics', scope: projectScope },
      resources[1],
    ),
    {
      module_id: 'analytics',
      scope: projectScope,
      entity: resources[1].resource_ref,
    },
  )
  assert.equal(
    resolveResourceSelection(
      manifests.analytics,
      { module_id: 'skills', scope: projectScope },
      resources[0],
    ),
    null,
    'a manifest from the previously active module cannot authorize a stale click',
  )
})

test('direct and history route changes are rechecked against manifest authority', () => {
  const registrations = moduleRegistrations()
  const route = ref<PlatformRoute>({
    module_id: 'planning' as const,
    scope: { kind: 'project' as const, project_ref: { project_id: 'project-alpha' } },
  })
  const authority = useModuleRouteAuthority({
    loadModules: async () => {},
    loadRegistry: async () => {},
    modules: ref(registrations.map((registration) => registration.manifest)),
    modulesAuthoritative: ref(true),
    modulesSettled: ref(true),
    parsedUnavailable: ref(null),
    registrations: ref(registrations),
    route,
    te: () => false,
    translate: (key) => key,
  })
  assert.equal(authority.routeUnavailable.value, null)
  route.value = {
    ...route.value,
    entity: { kind: 'session', client_family: 'codex', session_id: 'session-1' },
  }
  assert.equal(authority.routeUnavailable.value?.reason, 'incompatible-entity')
  route.value = {
    module_id: 'planning',
    scope: { kind: 'project', project_ref: { project_id: 'project-alpha' } },
  }
  assert.equal(authority.routeUnavailable.value, null)
})
