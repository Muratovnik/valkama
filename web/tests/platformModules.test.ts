import assert from 'node:assert/strict'

import { ref } from 'vue'

import { test } from 'vitest'

import { cardInPlace, useModuleRouteAuthority } from '@/app/composables/useModuleRouteAuthority.ts'

import {
  MODULES_INTERFACE,
  validateModuleManifest,
  validateModulesPayload,
} from '@/shared/api/platformModuleContract.ts'
import type { ModuleId, ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { resolveManifestRouteAuthority } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute, PlatformRouteUnavailable } from '@/shared/api/platformRoute.ts'

import { moduleRegistrations, modulesPayload } from './support/moduleRegistrations.ts'

/** The entity kinds a module's secondary context admits, at each operating level, by module id. */
type SecondaryKinds = Readonly<
  Record<string, { global: readonly string[]; space: readonly string[] }>
>

const SPACE = {
  kind: 'space' as const,
  space_ref: { data_scope_id: '123e4567-e89b-42d3-a456-426614174000', space_key: 'MAIN' },
}

const EXPECTED_SECONDARY_CONTEXTS: SecondaryKinds = {
  planning: {
    global: ['project', 'planning-space'],
    space: ['planning-space', 'work-item'],
  },
  analytics: { global: ['work-item'], space: ['work-item'] },
  decisions: { global: ['work-item'], space: ['work-item'] },
  memory: { global: ['memory-resource'], space: ['memory-resource', 'work-item'] },
  settings: { global: ['work-item'], space: ['work-item'] },
} as const

test('valkama-modules has exactly five registrations with both operating levels', () => {
  assert.equal(OFFLINE_MODULE_FALLBACK.length, 5)
  assert.deepEqual(
    OFFLINE_MODULE_FALLBACK.map((module) => module.module_id),
    ['planning', 'analytics', 'decisions', 'memory', 'settings'],
  )
  for (const module of OFFLINE_MODULE_FALLBACK) {
    assert.equal(module.interface_version, MODULES_INTERFACE)
    assert.deepEqual(module.operating_levels, ['global', 'space'])
    assert.equal(module.route_namespace, module.module_id)
    assert.ok(module.semantics.global)
    assert.ok(module.semantics.space)
    assert.ok(module.states.global.supported.includes('loading'))
    assert.ok(module.states.space.supported.includes('permission-denied'))
  }
})

test('offline secondary contexts exactly mirror the authoritative scoped contract', () => {
  for (const manifest of OFFLINE_MODULE_FALLBACK) {
    const expected = EXPECTED_SECONDARY_CONTEXTS[manifest.module_id]
    assert.deepEqual(manifest.secondary_context.global.kinds, expected.global)
    assert.deepEqual(manifest.secondary_context.space.kinds, expected.space)
    const supported = new Set(manifest.supported_entity_kinds)
    for (const scope of ['global', 'space'] as const) {
      const kinds = manifest.secondary_context[scope].kinds
      assert.equal(kinds.length, new Set(kinds).size)
      assert.ok(kinds.every((kind) => supported.has(kind)))
    }
  }
})

test('valkama-modules payload validates and rejects additive fields', () => {
  const payload = modulesPayload()
  assert.equal(validateModulesPayload(payload).modules.length, 5)
  const additive = structuredClone(payload) as Record<string, unknown>
  additive.extra = true
  assert.throws(() => validateModulesPayload(additive), /unknown field/)
  const wrongVersion = structuredClone(payload) as { interface_version: string }
  wrongVersion.interface_version = 'platform-modules'
  assert.throws(() => validateModulesPayload(wrongVersion), /expected valkama-modules/)
  // The shell has nothing to route without a module, so an empty list is a
  // broken answer rather than a quiet installation.
  const empty = { ...payload, modules: [] }
  assert.throws(() => validateModulesPayload(empty), /non-empty module registry/)
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

test('every registration is enabled and fixed, and anything else is refused', () => {
  // The module list is the build's. A registration that claims to be off or
  // changeable is not something this build's server can say.
  assert.equal(
    validateModulesPayload({ interface_version: MODULES_INTERFACE, modules: moduleRegistrations() })
      .modules.length,
    5,
  )
  for (const [field, value, message] of [
    ['state', 'disabled', /state: expected enabled/],
    ['mutable', true, /mutable: expected false/],
  ] as const) {
    const registrations: unknown[] = moduleRegistrations()
    registrations[0] = { ...(registrations[0] as object), [field]: value }
    assert.throws(
      () =>
        validateModulesPayload({ interface_version: MODULES_INTERFACE, modules: registrations }),
      message,
    )
  }
  const withoutSettings = moduleRegistrations().filter(
    (registration) => registration.manifest.module_id !== 'settings',
  )
  assert.throws(
    () =>
      validateModulesPayload({ interface_version: MODULES_INTERFACE, modules: withoutSettings }),
    /Settings registration is required/,
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
  assert.ok(
    authority.routeUnavailable.value?.recovery.kind === 'choose-module' &&
      authority.routeUnavailable.value.recovery.available_modules.includes('future-module'),
  )
})

test('authoritative manifests reject unsupported entity and scoped secondary context', () => {
  const planning = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'planning')
  assert.ok(planning)
  assert.deepEqual(
    resolveManifestRouteAuthority(planning, {
      module_id: 'planning',
      scope: SPACE,
      entity: { kind: 'session', client_family: 'codex', session_id: 'session-1' },
    }),
    { status: 'unavailable', reason: 'incompatible-entity' },
  )
  const noSecondaryContext = structuredClone(planning)
  noSecondaryContext.secondary_context.space = { behavior: 'none', kinds: [] }
  assert.equal(
    resolveManifestRouteAuthority(noSecondaryContext, {
      module_id: 'planning',
      scope: SPACE,
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
  const project = { ...SPACE, project_ref: { project_id: 'project-alpha' } }
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
  }
  const accepts = (
    module_id: ModuleId,
    scope: typeof global | typeof SPACE,
    entity: PlatformRoute['entity'],
  ) =>
    resolveManifestRouteAuthority(manifests[module_id], { module_id, scope, entity }).status ===
    'ready'

  // Settings names no secondary resource since the registry screens left it.
  assert.equal(accepts('settings', global, undefined), true)
  assert.equal(accepts('settings', project, entities.planningSpace), false)
  assert.equal(accepts('planning', project, entities.planningSpace), true)
  assert.equal(accepts('planning', project, entities.workItem), true)

  assert.equal(accepts('planning', project, entities.session), false)
})

test('a task pressed in Analytics or Settings is named in the page’s own route; Planning leaves it to the board', () => {
  const manifests = Object.fromEntries(
    OFFLINE_MODULE_FALLBACK.map((manifest) => [manifest.module_id, manifest]),
  ) as Record<ModuleId, ModuleManifest>
  const target = {
    space_ref: { data_scope_id: '123e4567-e89b-42d3-a456-426614174000', space_key: 'MAIN' },
    reference: 'MAIN-7',
    writable: true,
  }
  const card = planningWorkItemEntity({ space_ref: target.space_ref, reference: target.reference })
  const views: [ModuleId, Record<string, string>][] = [
    ['analytics', { by: 'work_item', period: 'week' }],
    ['settings', { section: 'diagnostics' }],
  ]
  for (const [module_id, state] of views)
    for (const scope of [
      { kind: 'global' as const },
      { ...SPACE, project_ref: { project_id: 'project-beta' } },
    ]) {
      const page: PlatformRoute = { module_id, scope, state }
      // The module, its scope and its view stay; only the card is named.
      assert.deepEqual(cardInPlace(manifests[module_id], page, target), { ...page, entity: card })
      // A card already open gives way to the one pressed.
      const other = planningWorkItemEntity({ space_ref: target.space_ref, reference: 'MAIN-8' })
      assert.deepEqual(cardInPlace(manifests[module_id], { ...page, entity: other }, target), {
        ...page,
        entity: card,
      })
    }
  const global = { kind: 'global' as const }
  // The board opens its card in the task's own space, as it did.
  assert.equal(
    cardInPlace(manifests.planning, { module_id: 'planning', scope: global }, target),
    null,
  )
  // A route whose manifest does not admit a card there leaves the press to the board.
  assert.equal(cardInPlace(manifests.memory, { module_id: 'memory', scope: global }, target), null)
  // A manifest that is not the route's own decides nothing.
  assert.equal(
    cardInPlace(manifests.analytics, { module_id: 'settings', scope: global }, target),
    null,
  )
  assert.equal(cardInPlace(undefined, { module_id: 'analytics', scope: global }, target), null)
})

test('a retired address keeps the choice of a space as its way out', () => {
  const registrations = moduleRegistrations()
  const retired = {
    status: 'unavailable' as const,
    reason: 'retired-scope' as const,
    input_module_id: 'planning',
    input_scope: { kind: 'global' as const },
    recovery: { kind: 'choose-space' as const },
  }
  const authority = (parsedUnavailable: PlatformRouteUnavailable | null) =>
    useModuleRouteAuthority({
      modules: ref(registrations.map((registration) => registration.manifest)),
      modulesAuthoritative: ref(true),
      modulesSettled: ref(true),
      parsedUnavailable: ref(parsedUnavailable),
      registrations: ref(registrations),
      route: ref<PlatformRoute>({ module_id: 'planning', scope: { kind: 'global' } }),
      te: () => false,
      translate: (key) => key,
    }).routeUnavailable.value
  assert.deepEqual(authority(retired), retired)
  // Any other address the grammar cannot place offers the modules this build has.
  assert.deepEqual(
    authority({
      ...retired,
      reason: 'unknown-module',
      recovery: { kind: 'choose-module', available_modules: [] },
    })?.recovery,
    {
      kind: 'choose-module',
      available_modules: registrations.map((registration) => registration.manifest.module_id),
    },
  )
})

test('direct and history route changes are rechecked against manifest authority', () => {
  const registrations = moduleRegistrations()
  const route = ref<PlatformRoute>({
    module_id: 'planning' as const,
    scope: { ...SPACE, project_ref: { project_id: 'project-alpha' } },
  })
  const authority = useModuleRouteAuthority({
    modules: ref(registrations.map((registration) => registration.manifest)),
    modulesAuthoritative: ref(true),
    modulesSettled: ref(true),
    parsedUnavailable: ref(null),
    registrations: ref(registrations),
    route,
    te: () => false,
    translate: (key) => key,
  })
  // Read afresh after each route change: an assertion on the ref itself would
  // narrow it for the compiler, which cannot see the route write recompute it.
  const unavailable = () => authority.routeUnavailable.value
  assert.equal(unavailable(), null)
  route.value = {
    ...route.value,
    entity: { kind: 'session', client_family: 'codex', session_id: 'session-1' },
  }
  assert.equal(unavailable()?.reason, 'incompatible-entity')
  route.value = { module_id: 'planning', scope: SPACE }
  assert.equal(unavailable(), null)
})
