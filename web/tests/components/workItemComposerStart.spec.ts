/**
 * What the new-work dialog says a new item is and where it starts: a goal under a parent is
 * a stage, named so; a task changes the project the workspace stands on unless another is
 * chosen, and a goal or stage names none; «Into “Triage”» leaves the new card unsorted.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { triageState } from '@/features/work-item-compose/composerChoices.ts'
import WorkItemComposer from '@/features/work-item-compose/WorkItemComposer.vue'

import { createWorkItem } from '@/shared/api/planningApi.ts'
import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItem } from '../browser/planningFixtures.ts'
import { present } from '../support/present.ts'

vi.mock('@/shared/api/planningApi.ts', () => ({ createWorkItem: vi.fn() }))

const SPACE = '7a1c2f3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

/** The space's projects as the read lists them, the default first. */
const PROJECTS = [
  { project_id: 'main', display_name: 'Main', root: 'C:/work/main', default: true },
  { project_id: 'tools', display_name: 'Tools', root: 'C:/work/tools', default: false },
]

const state = (key: string, category: WorkflowState['category'], position: number) => ({
  state_id: `00000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`,
  key,
  name: key[0]?.toUpperCase() + key.slice(1),
  category,
  is_terminal: category === 'completed',
  position,
})
const TRIAGE = state('triage', 'triage', 0)

const GOAL: WorkItemBrief = {
  ...workItem,
  comment_count: 0,
  kind: 'goal',
  reference: 'MAIN-12',
  title: 'Parser',
  labels: [],
  projects: [],
}

type Props = {
  items?: readonly WorkItemBrief[]
  project?: string
  projects?: typeof PROJECTS | null
  triage?: WorkflowState | null
}

const mounted: ReturnType<typeof mount>[] = []
function mountComposer(props: Props = {}, locale = 'en') {
  const wrapper = mount(WorkItemComposer, {
    attachTo: document.body,
    props: { open: true, space: SPACE, items: [GOAL], ...props },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      stubs: { OverlayHost: { template: '<div><slot /></div>' } },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

const trigger = (label: string) =>
  present(
    document.querySelector<HTMLElement>(`.choice-trigger[aria-label="${label}"]`),
    `the ${label} field`,
  )

/** The words of each option the field `label` offers, its list opened. */
async function offered(label: string) {
  const rows = await openChoices(label)
  return rows.map((row) => row.textContent?.trim())
}

async function openChoices(label: string) {
  trigger(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')]
}

async function choose(label: string, name: string) {
  const rows = await openChoices(label)
  const option = present(
    rows.find((row) => row.textContent?.trim() === name),
    `${label} option ${name}`,
  )
  option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
}

async function chooseParent(wrapper: ReturnType<typeof mountComposer>, words: string) {
  const field = present(
    wrapper.findAll<HTMLInputElement>('input[role="combobox"]').at(-1),
    'the parent field',
  )
  field.element.focus()
  await field.setValue(words)
  await flushPromises()
  await field.trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

async function create(wrapper: ReturnType<typeof mountComposer>) {
  await wrapper.get('input').setValue('Ship it')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  return vi.mocked(createWorkItem).mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  vi.mocked(createWorkItem).mockReset()
  vi.mocked(createWorkItem).mockResolvedValue(validateWorkItemRecord(workItem))
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('the kind of new work', () => {
  it('offers no stage of its own: a stage is a goal with a parent', async () => {
    mountComposer()
    expect(await offered('Kind')).toEqual(['Bug', 'Goal', 'Improvement', 'Task'])
  })

  it('names a goal with a parent a stage, in both languages, and sends it as a goal', async () => {
    for (const [locale, label, goal, stage] of [
      ['en', 'Kind', 'Goal', 'Stage'],
      ['ru', 'Тип', 'Цель', 'Этап'],
    ] as const) {
      const wrapper = mountComposer({}, locale)
      await choose(label, goal)
      expect(trigger(label).textContent?.trim(), locale).toBe(goal)
      await chooseParent(wrapper, 'Parser')
      expect(trigger(label).textContent?.trim(), locale).toBe(stage)
      const kinds = await offered(label)
      expect(kinds, locale).toContain(stage)
      expect(kinds, locale).not.toContain(goal)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(await create(wrapper), locale).toMatchObject({ kind: 'goal', parent: 'MAIN-12' })
      wrapper.unmount()
      document.body.innerHTML = ''
    }
  })
})

describe('the project of new work', () => {
  it('starts on the project the workspace stands on, and sends none for the default', async () => {
    mountComposer({ projects: PROJECTS, project: 'main' })
    expect(trigger('Project').textContent?.trim()).toBe('Main')
    expect(await create(mounted[0] as ReturnType<typeof mountComposer>)).not.toHaveProperty(
      'projects',
    )
  })

  it('sends the project chosen, or the one the workspace is narrowed to, by its id', async () => {
    const chosen = mountComposer({ projects: PROJECTS, project: 'main' })
    await choose('Project', 'Tools')
    expect(await create(chosen)).toMatchObject({ projects: ['tools'] })
    chosen.unmount()
    document.body.innerHTML = ''
    const narrowed = mountComposer({ projects: PROJECTS, project: 'tools' })
    expect(trigger('Project').textContent?.trim()).toBe('Tools')
    expect(await create(narrowed)).toMatchObject({ projects: ['tools'] })
  })

  it('names no project for a goal, says why, and gives the task its choice back', async () => {
    const wrapper = mountComposer({ projects: PROJECTS, project: 'tools' })
    await choose('Kind', 'Goal')
    const field = trigger('Project')
    expect(field.textContent?.trim()).toBe('Any project')
    expect(field.hasAttribute('disabled') || field.getAttribute('aria-disabled') === 'true').toBe(
      true,
    )
    const why = document.querySelector(`[id="${field.getAttribute('aria-describedby')}"]`)
    expect(why?.textContent).toBe('A goal or stage names no project: it holds the work of any.')
    expect(await create(wrapper)).not.toHaveProperty('projects')
    await choose('Kind', 'Task')
    expect(trigger('Project').textContent?.trim()).toBe('Tools')
    expect(trigger('Project').hasAttribute('aria-describedby')).toBe(false)
  })

  it('draws no field where the space has no project, or its projects were not read', () => {
    for (const projects of [[], null]) {
      mountComposer({ projects })
      expect(document.querySelector('.choice-trigger[aria-label="Project"]')).toBeNull()
    }
  })

  it('asks for the project after the kind and the priority, before the labels', () => {
    mountComposer({ projects: PROJECTS, project: 'main' })
    const names = [
      ...document.querySelectorAll<HTMLElement>('input, textarea, button[role="combobox"]'),
    ].map(
      (control) =>
        control.getAttribute('aria-label') ??
        document.querySelector(`label[for="${control.id}"]`)?.textContent?.trim(),
    )
    expect(names).toEqual([
      'Title',
      'Kind',
      'Priority',
      'Project',
      'Labels',
      'Parent',
      'Description',
    ])
  })
})

describe('new work left unsorted', () => {
  it('leaves the card in the workflow’s triage state when the switch is on, and only then', async () => {
    const wrapper = mountComposer({ triage: TRIAGE })
    const toggle = wrapper.get('[role="switch"]')
    expect(toggle.attributes('aria-label')).toBe('Into “Triage”')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(await create(wrapper)).not.toHaveProperty('state')
    await toggle.trigger('click')
    expect(await create(wrapper)).toMatchObject({ state: 'triage' })
  })

  it('names the state as the interface does, in Russian too', () => {
    const wrapper = mountComposer({ triage: TRIAGE }, 'ru')
    expect(wrapper.get('[role="switch"]').text()).toBe('В «Не разобрано»')
  })

  it('starts off each time the dialog opens', async () => {
    const wrapper = mountComposer({ triage: TRIAGE })
    await wrapper.get('[role="switch"]').trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
  })

  it('draws no switch where the workflow has no one triage state', () => {
    mountComposer({ triage: null })
    expect(document.querySelector('[role="switch"]')).toBeNull()
    // Two states of the category, and the server could not tell which one a category meant.
    expect(triageState([TRIAGE, state('inbox', 'triage', 1)])).toBeNull()
    expect(triageState([TRIAGE, state('ready', 'ready', 1)])).toEqual(TRIAGE)
  })
})
