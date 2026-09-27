import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningModuleSurface from '@/pages/planning/PlanningModuleSurface.vue'

import { fetchPlanning, transitionWorkItem } from '@/shared/api/planningApi.ts'
import { validateReadModel, validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { fetchPlanningWorkItem, fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningWorkItemPayload } from '@/shared/api/platformPlanningTypes.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages } from '@/shared/i18n/index.ts'

import {
  attachedSpaceRef,
  dataScopeId,
  existingRelation,
  planningReadModel,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from '../browser/planningFixtures.ts'

vi.mock('@/shared/api/planningApi.ts', async (load) => ({
  ...(await load<typeof import('@/shared/api/planningApi.ts')>()),
  fetchPlanning: vi.fn(),
  transitionWorkItem: vi.fn(),
}))
vi.mock('@/shared/api/platformPlanningApi.ts', () => ({
  fetchPlanningWorkItem: vi.fn(),
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

function relations(space: PlanningSpaceRef, label: string): PlanningWorkItemPayload {
  const ref = { space_ref: space, reference: workItemRef.reference }
  return {
    interface_version: 'valkama-planning-work-item',
    scope: projectScope,
    work_item_ref: ref,
    state: {
      interface_version: 'valkama-ui-state',
      status: 'ready',
      payload: {
        work_item: validateWorkItemRecord(structuredClone(workItem)),
        relations: {
          interface_version: 'valkama-relations',
          relations: [
            {
              ...existingRelation,
              source: planningWorkItemEntity(ref),
              presentation: { ...existingRelation.presentation, label },
            },
          ],
        },
      },
    },
  } as PlanningWorkItemPayload
}

const workspace = {
  props: ['model', 'stale', 'writable'],
  template:
    '<div class="workspace-probe" :data-stale="stale"><span v-for="item in model.work_items" :key="item.reference">{{ item.title }}</span><button v-if="writable" class="write-probe">Write</button></div>',
}
const inspector = {
  props: ['kernel'],
  template: '<div class="inspector-probe">{{ kernel?.relations[0]?.presentation.label }}</div>',
}

function surface(open = false) {
  return mount(PlanningModuleSurface, {
    props: {
      context: context(),
      primaryWriteScopeId: dataScopeId,
      registry: null,
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
  vi.mocked(fetchPlanning).mockReset()
  vi.mocked(fetchPlanningWorkItem)
    .mockReset()
    .mockResolvedValue(relations(spaceRef, 'Primary relation'))
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

  it('rejects a delayed old model and old relations with the same item reference', async () => {
    const oldModel = deferred<ReturnType<typeof model>>()
    const oldRelations = deferred<PlanningWorkItemPayload>()
    vi.mocked(fetchPlanning)
      .mockReturnValueOnce(oldModel.promise)
      .mockResolvedValueOnce(model('Attached item'))
    vi.mocked(fetchPlanningWorkItem)
      .mockReturnValueOnce(oldRelations.promise)
      .mockResolvedValue(relations(attachedSpaceRef, 'Attached relation'))
    const wrapper = surface(true)
    await wrapper.setProps({ route: route(attachedSpaceRef, true) })
    await flushPromises()
    expect(wrapper.text()).toContain('Attached item')
    expect(wrapper.text()).toContain('Attached relation')
    expect(wrapper.find('.write-probe').exists()).toBe(false)
    oldModel.resolve(model('Primary item'))
    oldRelations.resolve(relations(spaceRef, 'Primary relation'))
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
    expect(wrapper.emitted('notice')).toContainEqual(['Refresh unavailable'])
    wrapper.unmount()
  })
})
