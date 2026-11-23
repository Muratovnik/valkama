/**
 * The shell's way to a place a surface over the module asks for: the route is written and the
 * finder and «Needs my answer» give way to it, as they do to a task opened from either.
 */
import { defineComponent, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { useGlobalWorkActions } from '@/app/composables/useGlobalWorkActions.ts'

import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

const spaceRef = { data_scope_id: '22222222-2222-4222-8222-222222222222', space_key: 'ALPHA' }
/** No module on show opens a card over its page. */
const noCardInPlace = () => null
/** The host draws nothing: it is there to run the composable. */
const drawNothing = () => null

function shell() {
  const writeRoute = vi.fn<(route: PlatformRoute) => void>()
  let actions: ReturnType<typeof useGlobalWorkActions> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        actions = useGlobalWorkActions(writeRoute, ref(0), ref(false), noCardInPlace)
        return drawNothing
      },
    }),
  )
  if (!actions) throw new Error('the composable did not run')
  return { actions, writeRoute, wrapper }
}

describe('a place asked for over the module', () => {
  it('is written, and the questions and the finder close for it', () => {
    const { actions, writeRoute, wrapper } = shell()
    actions.requestsOpen.value = true
    actions.finderOpen.value = true
    const board: PlatformRoute = {
      module_id: 'planning',
      scope: { kind: 'space', space_ref: spaceRef },
      state: { triage: true },
    }

    actions.openRoute(board)

    expect(writeRoute.mock.calls).toEqual([[board]])
    expect([actions.requestsOpen.value, actions.finderOpen.value]).toEqual([false, false])
    wrapper.unmount()
  })

  it('is where a task opened from the questions goes too, on its board', () => {
    const { actions, writeRoute, wrapper } = shell()
    actions.requestsOpen.value = true

    actions.openTarget({ space_ref: spaceRef, reference: 'ALPHA-3', writable: true })

    expect(writeRoute.mock.calls).toHaveLength(1)
    expect(writeRoute.mock.calls[0]?.[0]).toMatchObject({
      module_id: 'planning',
      scope: { kind: 'space', space_ref: spaceRef },
    })
    expect(actions.requestsOpen.value).toBe(false)
    wrapper.unmount()
  })
})
