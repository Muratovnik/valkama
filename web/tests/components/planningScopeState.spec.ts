import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningModuleSurface from '@/pages/planning/PlanningModuleSurface.vue'

import { fetchPlanning, subscribePlanning, transitionWorkItem } from '@/shared/api/planningApi.ts'
import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages } from '@/shared/i18n/index.ts'

import {
  attachedSpaceRef,
  dataScopeId,
  planningReadModel,
  projectId,
  projectScope,
  spaceRef,
  workItemRef,
} from '../browser/planningFixtures.ts'

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
    projects: [
      {
        project_id: projectId,
        title: 'Example',
        binding_state: 'mapped',
        resources: [spaceRef, attachedSpaceRef].map((space) => ({
          resource_ref: planningSpaceEntity(space),
          state: 'mapped',
        })),
      },
    ],
  }
}

function route(space: PlanningSpaceRef, open = false): PlatformRoute {
  return {
    module_id: 'planning',
    scope: projectScope,
    entity: open
      ? planningWorkItemEntity({ space_ref: space, reference: workItemRef.reference })
      : planningSpaceEntity(space),
  }
}

const workspace = {
  props: ['model', 'stale', 'writable'],
  template:
    '<div class="workspace-probe" :data-stale="stale"><span v-for="item in model.work_items" :key="item.reference">{{ item.title }}</span><button v-if="writable" class="write-probe">Write</button></div>',
}
const inspector = {
  props: ['resourceRef'],
  template: '<div class="inspector-probe">{{ resourceRef.resource_id }}</div>',
}

function surface(open = false) {
  return mount(PlanningModuleSurface, {
    props: {
      context: context(),
      primaryWriteScopeId: dataScopeId,
      route: route(spaceRef, open),
      scope: projectScope,
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
  it.each(['older', 'empty'])(
    'applies live snapshots and rejects a delayed %s HTTP response',
    async (response) => {
      const initial = deferred<ReturnType<typeof model>>()
      vi.mocked(fetchPlanning).mockReturnValueOnce(initial.promise)
      const wrapper = surface()
      const subscription = vi.mocked(subscribePlanning).mock.calls[0]
      const result = vi.mocked(subscribePlanning).mock.results[0]
      if (!subscription || !result) throw new Error('Expected initial stream subscription')
      const [target, callbacks] = subscription
      expect(target).toEqual({ project: projectId, ...spaceRef })
      callbacks.snapshot(model('Fresh stream item'))
      callbacks.connection('live')
      await flushPromises()
      expect(wrapper.text()).toContain('Fresh stream item')
      initial.resolve(
        response === 'older'
          ? model('Earlier HTTP item')
          : { ...model('Empty'), planning_space: null },
      )
      await flushPromises()
      expect(wrapper.text()).toContain('Fresh stream item')
      expect(wrapper.text()).not.toContain('Earlier HTTP item')
      const close = result.value
      await wrapper.setProps({ route: route(attachedSpaceRef) })
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

  it('isolates a changed store before loading and does not retain old actions after failure', async () => {
    vi.mocked(fetchPlanning).mockResolvedValueOnce(model('Primary item'))
    const wrapper = surface(true)
    await flushPromises()
    expect(wrapper.text()).toContain('Primary item')
    const next = deferred<ReturnType<typeof model>>()
    vi.mocked(fetchPlanning).mockReturnValueOnce(next.promise)
    await wrapper.setProps({ route: route(attachedSpaceRef, true) })
    expect(fetchPlanning).toHaveBeenLastCalledWith({ project: projectId, ...attachedSpaceRef })
    expect(wrapper.find('.workspace-probe').exists()).toBe(false)
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
    await wrapper.setProps({ route: route(attachedSpaceRef, true) })
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
        await wrapper.setProps({ context: { ...context(), projects: [] } })
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
    updated.projects = updated.projects.map((project) => ({
      ...project,
      title: 'Updated project label',
    }))
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
