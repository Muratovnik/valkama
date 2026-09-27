import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningModuleSurface from '@/pages/planning/PlanningModuleSurface.vue'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { messages } from '@/shared/i18n/index.ts'

/**
 * Write ownership is one derivation, and this is the case that made it one.
 *
 * Two stores may each hold a space keyed `MAIN`, and their work items may carry
 * the same references. Neither the key nor the reference decides who may write:
 * only the data scope does, and only when it is the confirmed writable primary.
 * The Board era asked that question in three places and got three answers.
 */
const primary: PlanningSpaceRef = {
  data_scope_id: '123e4567-e89b-42d3-a456-426614174000',
  space_key: 'MAIN',
}
const attached: PlanningSpaceRef = {
  data_scope_id: '123e4567-e89b-42d3-a456-426614174001',
  space_key: 'MAIN',
}
const scope = { kind: 'project' as const, project_ref: { project_id: 'example-project' } }
const now = '2026-08-13T09:00:00Z'

const identity = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`

const TODO = {
  state_id: identity(900),
  key: 'todo',
  name: 'Todo',
  category: 'queued' as const,
  is_terminal: false,
}

/** One space's read model, the same whichever store answered for it. */
function readModel(space: PlanningSpaceRef) {
  return {
    interface_version: 'valkama-planning-read-model',
    planning_spaces: [],
    planning_space: {
      planning_space_id: identity(800),
      project_id: scope.project_ref.project_id,
      name: 'Main',
      key: space.space_key,
      provider_kind: 'local',
    },
    workflow: {
      workflow_id: identity(700),
      name: 'Default',
      initial_state_id: TODO.state_id,
      states: [{ ...TODO, position: 0 }],
      transitions: [],
    },
    work_items: [
      {
        work_item_id: identity(1),
        planning_space_id: identity(800),
        reference: 'MAIN-264',
        number: 264,
        title: `Work from ${space.data_scope_id}`,
        kind: 'task',
        state: TODO,
        priority: 'high',
        claim_ref: '',
        parent_id: null,
        container: false,
        ready: true,
        labels: [],
        source: '',
        checklist: [],
        revision: 1,
        created_at: now,
        updated_at: now,
        comment_count: 0,
      },
    ],
    links: [],
    stale_claims: [],
  }
}

/** Both spaces are mapped, so the route's entity is what picks one. */
const context = {
  primary: { data_scope_id: primary.data_scope_id, is_writable: true },
  projects: [
    {
      binding_state: 'mapped',
      project_id: scope.project_ref.project_id,
      resources: [
        { resource_ref: planningSpaceEntity(primary), state: 'mapped' },
        { resource_ref: planningSpaceEntity(attached), state: 'mapped' },
      ],
      title: 'Example',
    },
  ],
  ui_prefs: null,
} as PlatformContextReady

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(JSON.stringify(readModel(primary)), {
          status: input.startsWith('/api/planning') ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as never,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function render(primaryWriteScopeId: string | null, space: PlanningSpaceRef) {
  const i18n = createI18n({ legacy: false, locale: 'en', messages })
  const wrapper = mount(PlanningModuleSurface, {
    props: {
      context,
      primaryWriteScopeId,
      registry: null,
      route: {
        module_id: 'planning' as const,
        scope,
        entity: planningSpaceEntity(space),
        state: { view: 'list' },
      },
      scope,
    },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

const createButtons = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.findAll('button').filter((button) => button.text().includes('New work item'))

describe('planning write ownership', () => {
  it('offers Create only for the exact writable primary space, colliding keys and all', async () => {
    const wrapper = await render(primary.data_scope_id, primary)
    expect(wrapper.text()).toContain('MAIN-264')
    expect(createButtons(wrapper)).toHaveLength(1)
    expect(wrapper.findAll('[data-state="unavailable"]')).toHaveLength(0)
  })

  it('keeps an attached same-key space readable and read-only', async () => {
    const wrapper = await render(primary.data_scope_id, attached)
    expect(createButtons(wrapper)).toHaveLength(0)
    expect(wrapper.findAll('[data-state="unavailable"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('attached data stores remain read-only')
    // Read-only is not a lesser view: every view still reads the whole space.
    expect(wrapper.text()).toContain('MAIN-264')
  })

  it('routes the item it opens, so a reload comes back to it', async () => {
    const wrapper = await render(primary.data_scope_id, primary)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('MAIN-264'))
      ?.trigger('click')
    // The surface asks the shell to route; it never holds the open item itself.
    expect(wrapper.emitted('entity')).toEqual([
      [planningWorkItemEntity({ space_ref: primary, reference: 'MAIN-264' })],
    ])
  })

  it('keeps a trail when a related item opens over the one it came from', async () => {
    const wrapper = await render(primary.data_scope_id, primary)
    const inspector = () => wrapper.findComponent({ name: 'WorkItemInspector' })

    // The shell owns the route, so the test plays the shell: whatever entity the
    // surface asks for comes back as the route it is rendered with.
    async function follow() {
      const emitted = wrapper.emitted('entity') ?? []
      const entity = emitted.at(-1)?.[0]
      await wrapper.setProps({
        route: {
          module_id: 'planning' as const,
          scope,
          entity,
          state: { view: 'list' },
        },
      })
      await flushPromises()
    }

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('MAIN-264'))
      ?.trigger('click')
    await follow()
    expect(inspector().props('reference')).toBe('MAIN-264')
    expect(inspector().props('resourceRef')).toEqual(planningSpaceEntity(primary))
    expect(inspector().props('canGoBack')).toBe(false)
    const firstInspector = inspector().vm

    // A related item, opened from inside the inspector, stacks on the first one.
    inspector().vm.$emit('open', 'MAIN-265')
    await follow()
    expect(inspector().props('reference')).toBe('MAIN-265')
    expect(inspector().props('canGoBack')).toBe(true)
    expect(inspector().vm).not.toBe(firstInspector)
  })

  it('resets the inspector for an equally named item in another planning space', async () => {
    const wrapper = await render(primary.data_scope_id, primary)

    await wrapper.setProps({
      route: {
        module_id: 'planning' as const,
        scope,
        entity: planningWorkItemEntity({ space_ref: primary, reference: 'MAIN-264' }),
        state: { view: 'list' },
      },
    })
    await flushPromises()
    const firstInspector = wrapper.findComponent({ name: 'WorkItemInspector' }).vm

    await wrapper.setProps({
      route: {
        module_id: 'planning' as const,
        scope,
        entity: planningWorkItemEntity({ space_ref: attached, reference: 'MAIN-264' }),
        state: { view: 'list' },
      },
    })
    await flushPromises()

    const secondInspector = wrapper.findComponent({ name: 'WorkItemInspector' })
    expect(secondInspector.vm).not.toBe(firstInspector)
    expect(secondInspector.props('resourceRef')).toEqual(planningSpaceEntity(attached))
  })

  it('closes and discards the composer when the bound planning space changes', async () => {
    const wrapper = await render(primary.data_scope_id, primary)
    await createButtons(wrapper)[0]?.trigger('click')

    const composer = wrapper.findComponent({ name: 'WorkItemComposer' })
    expect(composer.props('open')).toBe(true)
    const title = document.body.querySelector<HTMLInputElement>('.composer input')
    expect(title).not.toBeNull()
    if (title) {
      title.value = 'Draft for the first space'
      title.dispatchEvent(new Event('input'))
      await flushPromises()
    }

    await wrapper.setProps({
      route: {
        module_id: 'planning' as const,
        scope,
        entity: planningSpaceEntity(attached),
        state: { view: 'list' },
      },
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'WorkItemComposer' }).props('open')).toBe(false)
    expect(document.body.textContent).not.toContain('Draft for the first space')
  })

  it('fails closed while primary ownership is unavailable', async () => {
    const wrapper = await render(null, primary)
    expect(createButtons(wrapper)).toHaveLength(0)
    expect(wrapper.findAll('[data-state="unavailable"]')).toHaveLength(1)
  })
})
