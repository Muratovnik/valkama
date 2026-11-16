/**
 * What the shell takes to another scope. The module says what goes along, so the real router
 * and navigation run here on routes a hand cannot make: a card's drawer stands over the
 * scope picker, so a card open at the moment of the move is reached only from here.
 */
import { effectScope } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { usePlatformNavigation } from '@/app/composables/usePlatformNavigation.ts'
import { router } from '@/app/router.ts'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { resolvePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

import { attachedSpaceRef, spaceScope, workItemRef } from '../browser/planningFixtures.ts'

const other = { kind: 'space' as const, space_ref: attachedSpaceRef }

const looked = { view: 'graph', group: 'goal', query: 'gateway', chain: 'MAIN-264', ready: true }

/** The navigation standing on this route, and what the address says after a move. */
async function standingOn(route: PlatformRoute) {
  await router.push(serializePlatformRoute(route))
  const scope = effectScope()
  const navigation = scope.run(() => usePlatformNavigation(() => 'invalid'))
  if (!navigation) throw new Error('the navigation did not start')
  const address = () =>
    resolvePlatformRoute(new URL(router.currentRoute.value.fullPath, location.origin))
  return { address, navigation, stop: () => scope.stop() }
}

describe('a change of scope', () => {
  it.each([
    ['choosing a space', (nav: Navigation) => nav.switchScope(other)],
    ['opening a space', (nav: Navigation) => nav.openSpace(attachedSpaceRef)],
  ])('by %s takes the way of looking and leaves the open card and the rest', async (_, move) => {
    const { address, navigation, stop } = await standingOn({
      module_id: 'planning',
      scope: spaceScope,
      entity: planningWorkItemEntity(workItemRef),
      state: looked,
    })
    move(navigation)
    await flushPromises()
    expect(address()).toEqual({
      module_id: 'planning',
      scope: other,
      state: { view: 'graph', group: 'goal' },
    })
    stop()
  })

  it('by choosing a project of the same space takes the way of looking as well', async () => {
    const { address, navigation, stop } = await standingOn({
      module_id: 'planning',
      scope: spaceScope,
      entity: planningWorkItemEntity(workItemRef),
      state: looked,
    })
    const narrowed = { ...spaceScope, project_ref: { project_id: 'other' } }
    navigation.switchScope(narrowed)
    await flushPromises()
    expect(address()).toEqual({
      module_id: 'planning',
      scope: narrowed,
      state: { view: 'graph', group: 'goal' },
    })
    stop()
  })

  it('going home takes it to all spaces as well', async () => {
    const { address, navigation, stop } = await standingOn({
      module_id: 'planning',
      scope: spaceScope,
      state: looked,
    })
    navigation.goHome()
    await flushPromises()
    expect(address()).toEqual({
      module_id: 'planning',
      scope: { kind: 'global' },
      state: { view: 'graph', group: 'goal' },
    })
    stop()
  })

  it('carries nothing for a module that keeps nothing, and nothing from one module to another', async () => {
    const settings = await standingOn({
      module_id: 'settings',
      scope: spaceScope,
      state: { query: 'theme', view: 'graph' },
    })
    settings.navigation.switchScope({ kind: 'global' })
    await flushPromises()
    expect(settings.address()).toEqual({ module_id: 'settings', scope: { kind: 'global' } })
    settings.stop()

    // Into Planning from another module: its state was never Planning's.
    const fromSettings = await standingOn({
      module_id: 'settings',
      scope: { kind: 'global' },
      state: { view: 'graph' },
    })
    fromSettings.navigation.openSpace(attachedSpaceRef)
    await flushPromises()
    expect(fromSettings.address()).toEqual({ module_id: 'planning', scope: other })
    fromSettings.stop()
  })
})

type Navigation = ReturnType<typeof usePlatformNavigation>
