/**
 * How the shell reads an address that does not quite read: it gives up the
 * module state, then the whole query, and opens the module; only a path that
 * names no section fails. The real router and navigation composable run here.
 */
import { effectScope } from 'vue'

import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { usePlatformNavigation } from '@/app/composables/usePlatformNavigation.ts'
import type { DroppedRoutePart } from '@/app/composables/usePlatformNavigation.ts'
import { router } from '@/app/router.ts'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

const board: PlatformRoute = {
  module_id: 'planning',
  scope: { kind: 'project', project_ref: { project_id: 'sample' } },
}
const BOARD_PATH = serializePlatformRoute(board)

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  stop = undefined
})

async function openAt(path: string) {
  await router.replace(path)
  const dropped: DroppedRoutePart[] = []
  const scope = effectScope()
  const navigation = scope.run(() =>
    usePlatformNavigation(
      () => 'not found',
      (part) => dropped.push(part),
    ),
  )
  stop = () => scope.stop()
  await flushPromises()
  if (!navigation) throw new Error('navigation did not start')
  return { dropped, navigation }
}

describe('an address that does not quite read', () => {
  it('drops a module state that is not readable, opens the module and says so', async () => {
    const { dropped, navigation } = await openAt(`${BOARD_PATH}?state=garbage`)
    expect(dropped).toEqual(['state'])
    expect(navigation.routeFailure.value).toBe('')
    expect(navigation.routeBlocked.value).toBe(false)
    expect(navigation.route.value).toEqual(board)
    // The address no longer carries what was dropped.
    expect(router.currentRoute.value.fullPath).toBe(BOARD_PATH)
  })

  it('drops a state whose text is not even encoded', async () => {
    const view: PlatformRoute = { ...board, state: { view: 'graph' } }
    const good = serializePlatformRoute(view)
    const { dropped, navigation } = await openAt(`${good.replace(/state=[^&]+/u, 'state=%%%')}`)
    expect(dropped).toEqual(['state'])
    expect(navigation.route.value).toEqual(board)
  })

  it('drops a whole query it cannot read once the state alone does not help', async () => {
    const { dropped, navigation } = await openAt(`${BOARD_PATH}?entity=nonsense&extra=1`)
    expect(dropped).toEqual(['query'])
    expect(navigation.routeBlocked.value).toBe(false)
    expect(navigation.route.value).toEqual(board)
  })

  it('says nothing about an address that reads', async () => {
    const { dropped, navigation } = await openAt(BOARD_PATH)
    expect(dropped).toEqual([])
    expect(navigation.route.value).toEqual(board)
  })

  it.each(['/modules/whatever', '/foo/bar', '/modules/analytics'])(
    'fails a path that names no section (%s), whatever its query',
    async (path) => {
      const { dropped, navigation } = await openAt(`${path}?state=garbage`)
      expect(navigation.routeFailure.value).toBe('not found')
      expect(dropped).toEqual([])
    },
  )
})
