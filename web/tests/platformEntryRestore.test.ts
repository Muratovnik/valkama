import assert from 'node:assert/strict'

import { nextTick, ref } from 'vue'

import { test } from 'vitest'

import {
  resolvedPreferredRoute,
  usePlatformEntryRestore,
} from '@/app/composables/usePlatformEntryRestore.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

import { moduleRegistrations } from './support/moduleRegistrations.ts'

type EntryInputs = Parameters<typeof usePlatformEntryRestore>[0]
type ContextReady = NonNullable<EntryInputs['contextReady']['value']>

const preferred = {
  ui_prefs: { module_id: 'skills', scope: { kind: 'global' } },
  projects: [],
} as unknown as ContextReady

async function restoreInOrder(first: 'context' | 'modules'): Promise<PlatformRoute[]> {
  const contextReady: EntryInputs['contextReady'] = ref(null)
  const contextState: EntryInputs['contextState'] = ref({
    interface_version: 'valkama-ui-state',
    status: 'loading',
  })
  const modulesSettled = ref(false)
  const written: PlatformRoute[] = []
  usePlatformEntryRestore({
    blocked: ref(true),
    contextReady,
    contextState,
    defaultRoute: { module_id: 'planning', scope: { kind: 'global' } },
    entryRestorePending: ref(true),
    modules: ref(moduleRegistrations().map((item) => item.manifest)),
    modulesSettled,
    route: ref({ module_id: 'planning', scope: { kind: 'global' } }),
    writeRoute: (route) => written.push(route),
  })
  const settleContext = async () => {
    contextReady.value = preferred
    contextState.value = {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: preferred,
    }
    await nextTick()
  }
  const settleModules = async () => {
    modulesSettled.value = true
    await nextTick()
  }
  await (first === 'context' ? settleContext() : settleModules())
  assert.deepEqual(written, [])
  await (first === 'context' ? settleModules() : settleContext())
  return written
}

test('clean entry waits when context resolves before modules', async () => {
  assert.deepEqual(await restoreInOrder('context'), [preferred.ui_prefs])
})

test('clean entry waits when modules resolve before context', async () => {
  assert.deepEqual(await restoreInOrder('modules'), [preferred.ui_prefs])
})

function restoredProjectResource(mappedResourceId: string) {
  const scope = { kind: 'project' as const, project_ref: { project_id: 'project-alpha' } }
  const preferredResource = { kind: 'planning-space' as const, resource_id: 'opaque-resource-1' }
  const context = {
    primary: { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', is_writable: true },
    projects: [
      {
        binding_state: 'mapped',
        project_id: 'project-alpha',
        resources: [
          {
            resource_ref: { kind: 'planning-space', resource_id: mappedResourceId },
            state: 'mapped',
          },
        ],
        title: 'Alpha',
      },
    ],
    ui_prefs: { module_id: 'planning', resource_ref: preferredResource, scope },
  } as unknown as ContextReady
  return usePlatformEntryRestore({
    blocked: ref(true),
    contextReady: ref(context),
    contextState: ref({
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: context,
    }),
    defaultRoute: { module_id: 'planning', scope: { kind: 'global' } },
    entryRestorePending: ref(false),
    modules: ref(moduleRegistrations().map((item) => item.manifest)),
    modulesSettled: ref(true),
    route: ref({ module_id: 'planning', scope: { kind: 'global' } }),
    writeRoute: () => {},
  }).restoredEntryRoute()
}

test('entry restore treats a mapped resource id as opaque neutral identity', () => {
  assert.deepEqual(restoredProjectResource('opaque-resource-1'), {
    module_id: 'planning',
    scope: { kind: 'project', project_ref: { project_id: 'project-alpha' } },
    entity: { kind: 'planning-space', resource_id: 'opaque-resource-1' },
  })
})

test('entry restore drops a resource preference that is no longer mapped', () => {
  assert.deepEqual(restoredProjectResource('different-resource'), {
    module_id: 'planning',
    scope: { kind: 'project', project_ref: { project_id: 'project-alpha' } },
  })
})

test('entry restore removes an entity the authoritative module cannot consume', () => {
  const context = {
    primary: { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', is_writable: true },
    projects: [],
    ui_prefs: null,
  } as ContextReady
  assert.deepEqual(
    resolvedPreferredRoute(
      context,
      {
        module_id: 'skills',
        scope: { kind: 'global' },
        resource_ref: { kind: 'planning-space', resource_id: 'opaque-resource' },
      },
      moduleRegistrations().map((item) => item.manifest),
    ),
    { module_id: 'skills', scope: { kind: 'global' } },
  )
})

test('entry restore retains a valid scoped Skill entity', () => {
  const context = {
    primary: { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', is_writable: true },
    projects: [],
    ui_prefs: null,
  } as ContextReady
  const resource_ref = {
    kind: 'skill' as const,
    skill_key: 'catalogue.skill',
    source_scope: 'global' as const,
  }
  assert.deepEqual(
    resolvedPreferredRoute(
      context,
      { module_id: 'skills', scope: { kind: 'global' }, resource_ref },
      moduleRegistrations().map((item) => item.manifest),
    ),
    { module_id: 'skills', scope: { kind: 'global' }, entity: resource_ref },
  )
})
