import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningModuleSurface from '@/pages/planning/PlanningModuleSurface.vue'

import { fetchPlanning, subscribePlanning, transitionWorkItem } from '@/shared/api/planningApi.ts'
import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages } from '@/shared/i18n/index.ts'

import {
  attachedSpaceRef,
  dataScopeId,
  planningReadModel,
  projectId,
  spaceRef,
  spaceScope,
  workItemRef,
} from '../browser/planningFixtures.ts'

// The card asks for its chain on every open; this spec is about something else.
vi.mock('@/shared/api/planningChainApi.ts', async () => {
  const { noChainModule } = await import('../support/noChain.ts')
  return noChainModule()
})

// «All spaces» and its empty state read the project registry; this spec is about something else.
vi.mock('@/shared/api/spaceWindowApi.ts', async () => {
  const { noRegistryModule } = await import('../support/noRegistry.ts')
  return noRegistryModule()
})

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchPlanning: vi.fn(),
  subscribePlanning: vi.fn(() => vi.fn()),
  transitionWorkItem: vi.fn(),
}))
vi.mock('@/shared/api/platformPlanningApi.ts', () => ({
  fetchPlatformPlanning: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

function model(title: string) {
  const result = validateReadModel(structuredClone(planningReadModel))
  result.work_items = result.work_items.slice(0, 1).map((item) => ({ ...item, title }))
  return result
}

function context(): PlatformContextReady {
  return {
    primary: { data_scope_id: dataScopeId, is_writable: true },
    ui_prefs: null,
    spaces: [spaceRef, attachedSpaceRef].map((space) => ({
      ...space,
      name: 'Example',
      default_project: projectId,
      projects: [{ project_id: projectId, display_name: 'Example' }],
      other_space_projects: [],
    })),
  }
}

/** The address of a space, with its item open or not, and the scope it stands in. */
function place(space: PlanningSpaceRef, open = false) {
  const scope: OperatingScope = { kind: 'space', space_ref: space }
  const route: PlatformRoute = {
    module_id: 'planning',
    scope,
    ...(open
      ? { entity: planningWorkItemEntity({ space_ref: space, reference: workItemRef.reference }) }
      : {}),
  }
  return { route, scope }
}

const workspace = {
  props: ['model', 'reading', 'stale', 'writable'],
  template:
    '<div class="workspace-probe" :data-stale="stale" :data-reading="reading"><span v-for="item in model.work_items" :key="item.reference">{{ item.title }}</span><button v-if="writable" class="write-probe">Write</button></div>',
}
const inspector = {
  props: ['resourceRef'],
  template: '<div class="inspector-probe">{{ resourceRef.resource_id }}</div>',
}

function surface(open = false, scope: OperatingScope = spaceScope) {
  return mount(PlanningModuleSurface, {
    props: {
      context: context(),
      primaryWriteScopeId: dataScopeId,
      stateBytes: 2048,
      ...place(spaceRef, open),
      scope,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: {
        PlanningWorkspace: workspace,
        WorkItemInspector: inspector,
        WorkItemComposer: true,
        PlanningPortfolio: true,
      },
    },
  })
}

beforeEach(() => {
  vi.mocked(subscribePlanning).mockClear()
  vi.mocked(fetchPlanning).mockReset()
  vi.mocked(fetchPlatformPlanning)
    .mockReset()
    .mockResolvedValue({
      interface_version: 'valkama-planning',
      scope: { kind: 'global' },
      state: { interface_version: 'valkama-ui-state', status: 'empty' },
    })
  vi.mocked(transitionWorkItem).mockReset()
})

describe('Planning exact resource lifecycle', () => {
  it('opens the stream once the read has answered, with the revision it answered', async () => {
    const initial = deferred<ReturnType<typeof model>>()
    vi.mocked(fetchPlanning).mockReturnValueOnce(initial.promise)
    const wrapper = surface()
    await flushPromises()
    // Opened beside the read, the stream would build and send the same model again.
    expect(subscribePlanning).not.toHaveBeenCalled()
    // Still the space's stream, connecting: the shell opens no live-work stream meanwhile.
    expect(wrapper.emitted('connection')?.at(-1)).toEqual(['connecting'])
    const revision = 'a'.repeat(64)
    initial.resolve({ ...model('Read item'), revision })
    await flushPromises()
    expect(wrapper.text()).toContain('Read item')
    expect(subscribePlanning).toHaveBeenCalledOnce()
    const [target, , since] = vi.mocked(subscribePlanning).mock.calls[0] ?? []
    // The whole space: no project narrows what the views read.
    expect(target).toEqual(spaceRef)
    expect(fetchPlanning).toHaveBeenCalledWith(spaceRef)
    expect(since).toBe(revision)
    wrapper.unmount()
  })

  it('reads and streams only the project the scope narrows the space to', async () => {
    vi.mocked(fetchPlanning).mockResolvedValueOnce(model('Project item'))
    const wrapper = surface(false, { ...spaceScope, project_ref: { project_id: projectId } })
    await flushPromises()
    expect(fetchPlanning).toHaveBeenCalledWith({ project: projectId, ...spaceRef })
    expect(vi.mocked(subscribePlanning).mock.calls[0]?.[0]).toEqual({
      project: projectId,
      ...spaceRef,
    })
    wrapper.unmount()
  })

  it('opens the stream after a read that failed, to bring the space when it can', async () => {
    vi.mocked(fetchPlanning).mockRejectedValueOnce(new Error('Read failed'))
    const wrapper = surface()
    await flushPromises()
    expect(subscribePlanning).toHaveBeenCalledOnce()
    expect(vi.mocked(subscribePlanning).mock.calls[0]?.[2]).toBeUndefined()
    wrapper.unmount()
  })

  it.each(['older', 'empty'])(
    'applies live snapshots and rejects a delayed %s HTTP response',
    async (response) => {
      vi.mocked(fetchPlanning).mockResolvedValueOnce(model('Initial HTTP item'))
      const wrapper = surface()
      await flushPromises()
      const subscription = vi.mocked(subscribePlanning).mock.calls[0]
      const result = vi.mocked(subscribePlanning).mock.results[0]
      if (!subscription || !result) throw new Error('Expected initial stream subscription')
      const [target, callbacks] = subscription
      expect(target).toEqual(spaceRef)
      // A read of the space the page holds keeps its stream open, and a frame may beat it.
      const refresh = deferred<ReturnType<typeof model>>()
      vi.mocked(fetchPlanning).mockReturnValueOnce(refresh.promise)
      const renamed = context()
      renamed.spaces = renamed.spaces.map((space) => ({ ...space, name: 'Renamed' }))
      await wrapper.setProps({ context: renamed })
      expect(fetchPlanning).toHaveBeenCalledTimes(2)
      expect(subscribePlanning).toHaveBeenCalledOnce()
      callbacks.snapshot(model('Fresh stream item'))
      callbacks.connection('live')
      await flushPromises()
      expect(wrapper.text()).toContain('Fresh stream item')
      refresh.resolve(
        response === 'older'
          ? model('Earlier HTTP item')
          : { ...model('Empty'), planning_space: null },
      )
      await flushPromises()
      expect(wrapper.text()).toContain('Fresh stream item')
      expect(wrapper.text()).not.toContain('Earlier HTTP item')
      const close = result.value
      await wrapper.setProps(place(attachedSpaceRef))
      expect(close).toHaveBeenCalledOnce()
      callbacks.snapshot(model('Old stream item'))
      await flushPromises()
      expect(wrapper.text()).not.toContain('Old stream item')
      wrapper.unmount()
      expect(vi.mocked(subscribePlanning).mock.results.at(-1)?.value).toHaveBeenCalledOnce()
    },
  )

  it('awaits a manual reload and refuses success when the retained model could not refresh', async () => {
    vi.mocked(fetchPlanning).mockResolvedValueOnce(model('Initial'))
    const wrapper = surface()
    await flushPromises()
    vi.mocked(fetchPlanning).mockResolvedValueOnce(model('Manually refreshed'))
    await wrapper.vm.refresh()
    await flushPromises()
    expect(wrapper.text()).toContain('Manually refreshed')
    vi.mocked(fetchPlanning).mockRejectedValueOnce(new Error('Read failed'))
    await expect(wrapper.vm.refresh()).rejects.toThrow('Planning refresh failed')
    expect(wrapper.text()).toContain('Manually refreshed')
    wrapper.unmount()
  })

  it('isolates a changed store while it loads and does not retain old actions after failure', async () => {
    vi.mocked(fetchPlanning).mockResolvedValueOnce(model('Primary item'))
    const wrapper = surface(true)
    await flushPromises()
    expect(wrapper.text()).toContain('Primary item')
    const next = deferred<ReturnType<typeof model>>()
    vi.mocked(fetchPlanning).mockReturnValueOnce(next.promise)
    await wrapper.setProps(place(attachedSpaceRef, true))
    expect(fetchPlanning).toHaveBeenLastCalledWith(attachedSpaceRef)
    // The views stand while the next store is read, and hold nothing of the one they left.
    expect(wrapper.get('.workspace-probe').attributes('data-reading')).toBe('true')
    expect(wrapper.get('.workspace-probe').text()).toBe('')
    expect(wrapper.find('.inspector-probe').exists()).toBe(false)
    expect(wrapper.find('.write-probe').exists()).toBe(false)
    next.reject(new Error('Attached unavailable'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Primary item')
    expect(wrapper.find('.platform-state-retry').exists()).toBe(true)
    wrapper.unmount()
  })

  it('rejects a delayed old model with the same item reference', async () => {
    const oldModel = deferred<ReturnType<typeof model>>()
    vi.mocked(fetchPlanning)
      .mockReturnValueOnce(oldModel.promise)
      .mockResolvedValueOnce(model('Attached item'))
    const wrapper = surface(true)
    await wrapper.setProps(place(attachedSpaceRef, true))
    await flushPromises()
    expect(wrapper.text()).toContain('Attached item')
    expect(wrapper.find('.write-probe').exists()).toBe(false)
    oldModel.resolve(model('Primary item'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Primary')
    wrapper.unmount()
  })

  it.each(['unavailable', 'global'] as const)(
    'invalidates outstanding reads when entering %s',
    async (destination) => {
      const old = deferred<ReturnType<typeof model>>()
      vi.mocked(fetchPlanning).mockReturnValueOnce(old.promise)
      const wrapper = surface(true)
      if (destination === 'unavailable')
        await wrapper.setProps({ context: { ...context(), spaces: [] } })
      else
        await wrapper.setProps({
          scope: { kind: 'global' },
          route: { module_id: 'planning', scope: { kind: 'global' } },
        })
      old.resolve(model('Late primary'))
      await flushPromises()
      expect(wrapper.find('.workspace-probe').exists()).toBe(false)
      expect(wrapper.find('.inspector-probe').exists()).toBe(false)
      expect(wrapper.find('work-item-composer-stub').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Late primary')
      wrapper.unmount()
    },
  )

  it('retains only the same-key model during refresh and refresh failure', async () => {
    vi.mocked(fetchPlanning).mockResolvedValueOnce(model('Retained item'))
    const wrapper = surface()
    await flushPromises()
    const refresh = deferred<ReturnType<typeof model>>()
    vi.mocked(fetchPlanning).mockReturnValueOnce(refresh.promise)
    const updated = context()
    updated.spaces = updated.spaces.map((space) => ({ ...space, name: 'Updated space name' }))
    await wrapper.setProps({ context: updated })
    expect(wrapper.text()).toContain('Retained item')
    expect(wrapper.get('.workspace-probe').attributes('data-stale')).toBe('true')
    refresh.reject(new Error('Refresh unavailable'))
    await flushPromises()
    expect(wrapper.text()).toContain('Retained item')
    expect(wrapper.get('.workspace-probe').attributes('data-stale')).toBe('false')
    expect(wrapper.emitted('notice')).toContainEqual([
      'The local service did not complete the request.',
    ])
    wrapper.unmount()
  })
})

describe('an address that names a space this workstation does not have', () => {
  it('says which space is missing, offers the spaces that exist, and asks for no retry', async () => {
    const wrapper = mount(PlanningModuleSurface, {
      props: {
        context: context(),
        primaryWriteScopeId: dataScopeId,
        stateBytes: 2048,
        ...place({ data_scope_id: dataScopeId, space_key: 'NONE' }),
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages })],
        stubs: { PlanningWorkspace: true, WorkItemInspector: true, WorkItemComposer: true },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Space NONE was not found. Choose a space below.')
    expect(wrapper.text()).not.toContain('Retry')
    // The picker is «All spaces», the directory of every space.
    expect(vi.mocked(fetchPlatformPlanning)).toHaveBeenCalledOnce()
    expect(fetchPlanning).not.toHaveBeenCalled()
    expect(wrapper.find('[data-scroll-owner="planning-portfolio"]').exists()).toBe(true)
    // No space is open, so no space stream is opened, and the shell's own
    // connection is the one the rail shows.
    expect(vi.mocked(subscribePlanning)).not.toHaveBeenCalled()
    expect(wrapper.emitted('connection')?.at(-1)).toEqual([null])
    wrapper.unmount()
  })
})
