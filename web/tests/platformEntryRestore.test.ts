import assert from 'node:assert/strict'

import { nextTick, ref } from 'vue'

import { test, vi } from 'vitest'

import {
  resolvedPreferredRoute,
  usePlatformEntryRestore,
} from '@/app/composables/usePlatformEntryRestore.ts'

import { savePlatformUiPrefs } from '@/shared/api/platformApi.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'

import { moduleRegistrations } from './support/moduleRegistrations.ts'

vi.mock('@/shared/api/platformApi.ts', () => ({
  savePlatformUiPrefs: vi.fn(() => Promise.resolve({})),
}))

type EntryInputs = Parameters<typeof usePlatformEntryRestore>[0]
type ContextReady = NonNullable<EntryInputs['contextReady']['value']>

const preferred = {
  ui_prefs: { module_id: 'settings', scope: { kind: 'global' } },
  spaces: [],
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
    writeRoute: (route) => {
      written.push(route)
    },
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

test('an address naming no listed section is not remembered as the place to come back to', async () => {
  vi.useFakeTimers()
  try {
    const route: EntryInputs['route'] = ref({ module_id: 'planning', scope: { kind: 'global' } })
    const modulesSettled = ref(false)
    usePlatformEntryRestore({
      blocked: ref(false),
      contextReady: ref(preferred),
      contextState: ref({
        interface_version: 'valkama-ui-state',
        status: 'ready',
        payload: preferred,
      }),
      defaultRoute: { module_id: 'planning', scope: { kind: 'global' } },
      entryRestorePending: ref(false),
      modules: ref(moduleRegistrations().map((item) => item.manifest)),
      modulesSettled,
      route,
      writeRoute: () => {},
    })
    // The lost address arrives before the module list does, as on a direct load.
    route.value = { module_id: 'not-a-module', scope: { kind: 'global' } }
    await nextTick()
    modulesSettled.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    route.value = { module_id: 'settings', scope: { kind: 'global' } }
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    assert.deepEqual(vi.mocked(savePlatformUiPrefs).mock.calls, [
      [{ module_id: 'settings', scope: { kind: 'global' } }],
    ])
  } finally {
    vi.useRealTimers()
  }
})

test('a clean entry stays pending until the restored route has been written', async () => {
  const pending = ref(true)
  const modulesSettled = ref(false)
  const contextState: EntryInputs['contextState'] = ref({
    interface_version: 'valkama-ui-state',
    status: 'ready',
    payload: preferred,
  })
  let moved: (() => void) | undefined
  const written: PlatformRoute[] = []
  usePlatformEntryRestore({
    blocked: ref(true),
    contextReady: ref(preferred),
    contextState,
    defaultRoute: { module_id: 'planning', scope: { kind: 'global' } },
    entryRestorePending: pending,
    modules: ref(moduleRegistrations().map((item) => item.manifest)),
    modulesSettled,
    route: ref({ module_id: 'planning', scope: { kind: 'global' } }),
    writeRoute: (route) => {
      written.push(route)
      return new Promise<void>((done) => {
        moved = done
      })
    },
  })
  modulesSettled.value = true
  await nextTick()
  // The router has not moved yet: the entry still stands on the default route.
  assert.deepEqual(written, [preferred.ui_prefs])
  assert.equal(pending.value, true)
  // A read that lands meanwhile does not write the route a second time.
  contextState.value = { ...contextState.value }
  await nextTick()
  assert.equal(written.length, 1)
  moved?.()
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(pending.value, false)
})

test('clean entry waits when context resolves before modules', async () => {
  assert.deepEqual(await restoreInOrder('context'), [preferred.ui_prefs])
})

test('clean entry waits when modules resolve before context', async () => {
  assert.deepEqual(await restoreInOrder('modules'), [preferred.ui_prefs])
})

const alpha = { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', space_key: 'ALPHA' }
const beta = { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', space_key: 'BETA' }
const listed = (space: typeof alpha, projects: string[]) => ({
  ...space,
  name: space.space_key,
  default_project: projects[0] ?? null,
  projects: projects.map((project_id) => ({ project_id, display_name: project_id })),
  other_space_projects: [{ project_id: 'foreign', display_name: 'Foreign', space_key: 'ROVER' }],
})

/** Where a clean entry lands, with this preference and these spaces listed. */
function restored(scope: OperatingScope | null, spaces: ReturnType<typeof listed>[]) {
  const context = {
    primary: { data_scope_id: alpha.data_scope_id, is_writable: true },
    spaces,
    ui_prefs: scope && { module_id: 'planning', scope },
  } as ContextReady
  return usePlatformEntryRestore({
    blocked: ref(true),
    contextReady: ref(context),
    contextState: ref({ interface_version: 'valkama-ui-state', status: 'ready', payload: context }),
    defaultRoute: { module_id: 'planning', scope: { kind: 'global' } },
    entryRestorePending: ref(false),
    modules: ref(moduleRegistrations().map((item) => item.manifest)),
    modulesSettled: ref(true),
    route: ref({ module_id: 'planning', scope: { kind: 'global' } }),
    writeRoute: () => {},
  }).restoredEntryRoute()
}

test('entry restore comes back to the space and the project it left', () => {
  for (const project_id of ['one', 'foreign']) {
    const scope = { kind: 'space' as const, space_ref: alpha, project_ref: { project_id } }
    assert.deepEqual(restored(scope, [listed(alpha, ['one']), listed(beta, [])]), {
      module_id: 'planning',
      scope,
    })
  }
})

test('entry restore opens the whole space when it no longer lists the project', () => {
  const scope = { kind: 'space' as const, space_ref: alpha, project_ref: { project_id: 'gone' } }
  assert.deepEqual(restored(scope, [listed(alpha, ['one']), listed(beta, [])]), {
    module_id: 'planning',
    scope: { kind: 'space', space_ref: alpha },
  })
})

test('a space that went away falls back to the only space, else to every space', () => {
  const gone = { kind: 'space' as const, space_ref: { ...alpha, space_key: 'GONE' } }
  assert.deepEqual(restored(gone, [listed(beta, [])]), {
    module_id: 'planning',
    scope: { kind: 'space', space_ref: beta },
  })
  assert.deepEqual(restored(null, [listed(alpha, []), listed(beta, [])]), {
    module_id: 'planning',
    scope: { kind: 'global' },
  })
})

test('entry restore removes an entity the authoritative module cannot consume', () => {
  const context = {
    primary: { data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', is_writable: true },
    spaces: [],
    ui_prefs: null,
  } as ContextReady
  assert.deepEqual(
    resolvedPreferredRoute(
      context,
      {
        module_id: 'settings',
        scope: { kind: 'global' },
        resource_ref: { kind: 'planning-space', resource_id: 'opaque-resource' },
      },
      moduleRegistrations().map((item) => item.manifest),
    ),
    { module_id: 'settings', scope: { kind: 'global' } },
  )
})
