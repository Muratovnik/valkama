/**
 * The router's half of the draft guard: which moves ask, and what a refused move
 * leaves behind.
 *
 * The real router and the real navigation composable run here; only the
 * surface holding a draft is a registered check, which is the whole interface
 * between them.
 */
import { effectScope } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { usePlatformNavigation } from '@/app/composables/usePlatformNavigation.ts'
import { router } from '@/app/router.ts'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { registerLeaveCheck } from '@/shared/lib/leaveGuard.ts'

const board: PlatformRoute = {
  module_id: 'planning',
  scope: { kind: 'project', project_ref: { project_id: 'sample' } },
}
const listView: PlatformRoute = { ...board, state: { view: 'list' } }
const settings: PlatformRoute = { module_id: 'settings', scope: { kind: 'global' } }

let unregister: (() => void) | null = null

function holdLeave(answer: boolean) {
  const check = vi.fn(() => Promise.resolve(answer))
  unregister = registerLeaveCheck(check)
  return check
}

describe('the router leave guard', () => {
  beforeAll(async () => {
    await router.push(serializePlatformRoute(board))
  })
  afterEach(async () => {
    unregister?.()
    unregister = null
    await router.replace(serializePlatformRoute(board))
  })

  it('asks before a move that changes what is open and stays put on a refusal', async () => {
    const check = holdLeave(false)
    const scope = effectScope()
    const navigation = scope.run(() => usePlatformNavigation(() => 'invalid'))
    navigation?.writeRoute(settings)
    await flushPromises()

    expect(check).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.fullPath).toBe(serializePlatformRoute(board))
    // The shell's own route did not move ahead of the router, so the open item
    // was never unmounted while the question stood.
    expect(navigation?.activeModule.value).toBe('planning')
    scope.stop()
  })

  it('moves once the answer is to go', async () => {
    const check = holdLeave(true)
    const scope = effectScope()
    const navigation = scope.run(() => usePlatformNavigation(() => 'invalid'))
    navigation?.writeRoute(settings)
    await flushPromises()

    expect(check).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.fullPath).toBe(serializePlatformRoute(settings))
    expect(navigation?.activeModule.value).toBe('settings')
    scope.stop()
  })

  it('does not ask when only the view state changes, nor when nothing holds a draft', async () => {
    const check = holdLeave(false)
    await router.replace(serializePlatformRoute(listView))
    expect(check).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe(serializePlatformRoute(listView))

    unregister?.()
    unregister = null
    await router.push(serializePlatformRoute(settings))
    expect(router.currentRoute.value.fullPath).toBe(serializePlatformRoute(settings))
  })
})
