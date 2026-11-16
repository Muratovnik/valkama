import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import AppContextBar from '@/app/components/AppContextBar.vue'

import type { ShellSpace } from '@/shared/api/platformApiTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'

const STORE = '123e4567-e89b-42d3-a456-426614174000'

const main: ShellSpace = {
  data_scope_id: STORE,
  space_key: 'MAIN',
  name: 'Main work',
  default_project: 'alpha',
  projects: [
    { project_id: 'alpha', display_name: 'Alpha' },
    { project_id: 'beta', display_name: 'Beta' },
  ],
  other_space_projects: [
    { project_id: 'delta', display_name: 'Delta', space_key: 'SIDE' },
    { project_id: 'loose', display_name: 'Loose', space_key: null },
  ],
}
const side: ShellSpace = {
  data_scope_id: STORE,
  space_key: 'SIDE',
  name: 'Side work',
  default_project: 'delta',
  projects: [{ project_id: 'delta', display_name: 'Delta' }],
  other_space_projects: [],
}
const SPACES = [main, side]

const inMain: OperatingScope = {
  kind: 'space',
  space_ref: { data_scope_id: STORE, space_key: 'MAIN' },
}

const wrappers: VueWrapper[] = []

function mountBar(
  scope: OperatingScope | null,
  spaces: readonly ShellSpace[] | null = SPACES,
): VueWrapper {
  const wrapper = mount(AppContextBar, {
    attachTo: document.body,
    props: { scope, spaces, title: 'Work' },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

/** The choice a selector offers, by the box that holds it. */
function choice(wrapper: VueWrapper, which: 'space' | 'project') {
  const box = wrapper.find(`[data-scope-choice="${which}"]`)
  if (!box.exists()) return null
  const select = box.findComponent(ChoiceSelect)
  const props = select.props() as { modelValue: string; options: ChoiceOption[] }
  return { box, select, options: props.options, value: props.modelValue }
}

describe('the scope choice in the context bar', () => {
  it('offers «All spaces» first and then every space by its key and name', () => {
    const space = choice(mountBar({ kind: 'global' }), 'space')
    expect(space?.options.map((option) => [option.label, option.description])).toEqual([
      ['All spaces', undefined],
      ['MAIN', 'Main work'],
      ['SIDE', 'Side work'],
    ])
    expect(space?.options[0]?.value).toBe(space?.value)
  })

  it('shows no project choice at «All spaces»', () => {
    expect(choice(mountBar({ kind: 'global' }), 'project')).toBeNull()
  })

  it('offers the projects of a space with several, a project of another space with its key', () => {
    const project = choice(mountBar(inMain), 'project')
    expect(
      project?.options.map((option) => [option.label, option.description, option.title]),
    ).toEqual([
      ['All projects', undefined, undefined],
      ['Alpha', undefined, undefined],
      ['Beta', undefined, undefined],
      ['Delta', 'SIDE', undefined],
      // A project whose space the registry does not name says so on hover, with no key.
      ['Loose', undefined, 'A project of another space'],
    ])
    expect(project?.value).toBe(project?.options[0]?.value)
  })

  it('hides the project choice in a space with one project to choose', () => {
    const wrapper = mountBar({
      kind: 'space',
      space_ref: { data_scope_id: STORE, space_key: 'SIDE' },
    })
    expect(choice(wrapper, 'space')).not.toBeNull()
    expect(choice(wrapper, 'project')).toBeNull()
  })

  it('keeps the project choice on show while the address narrows to a project', () => {
    const wrapper = mountBar({
      kind: 'space',
      space_ref: { data_scope_id: STORE, space_key: 'SIDE' },
      project_ref: { project_id: 'delta' },
    })
    const project = choice(wrapper, 'project')
    expect(project?.value).toBe(project?.options[1]?.value)
    expect(project?.options[1]?.label).toBe('Delta')
  })

  it('asks for the chosen scope: a space, a project in it, the whole space and all spaces', async () => {
    const wrapper = mountBar(inMain)
    /** Chooses the option at this place in a selector's list. */
    const pick = (which: 'space' | 'project', index: number) => {
      const shown = choice(wrapper, which)
      shown?.select.vm.$emit('update:modelValue', shown.options[index]?.value)
    }
    pick('space', 2)
    pick('project', 3)
    pick('project', 0)
    pick('space', 0)
    await nextTick()
    expect(wrapper.emitted('scope')).toEqual([
      [{ kind: 'space', space_ref: { data_scope_id: STORE, space_key: 'SIDE' } }],
      [{ ...inMain, project_ref: { project_id: 'delta' } }],
      [inMain],
      [{ kind: 'global' }],
    ])
  })

  it('names a space or project the address asks for and this workstation lacks, not choosable', () => {
    const wrapper = mountBar({
      kind: 'space',
      space_ref: { data_scope_id: STORE, space_key: 'GONE' },
    })
    const space = choice(wrapper, 'space')
    const missing = space?.options.at(-1)
    expect(missing).toMatchObject({ label: 'GONE', disabled: true, value: space?.value })
    expect(choice(wrapper, 'project')).toBeNull()

    const project = choice(
      mountBar({ ...inMain, project_ref: { project_id: 'retired' } }),
      'project',
    )
    expect(project?.options.at(-1)).toMatchObject({
      label: 'retired',
      disabled: true,
      value: project?.value,
    })
  })

  it('keeps the space choice in place and unnamed until the spaces have been read', () => {
    const box = choice(mountBar(inMain, null), 'space')?.box
    expect(box?.classes()).toContain('is-unknown')
    expect(choice(mountBar(inMain, null), 'project')).toBeNull()
  })

  it('offers no space choice at «All spaces» when there is no space at all', () => {
    expect(choice(mountBar({ kind: 'global' }, []), 'space')).toBeNull()
  })

  it('opens the space choice when a page asks for a space to be chosen', async () => {
    const wrapper = mountBar({ kind: 'global' })
    const trigger = wrapper.get('[data-scope-choice="space"] .choice-trigger')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    ;(wrapper.vm as unknown as { chooseSpace: () => void }).chooseSpace()
    await nextTick()
    expect(trigger.attributes('aria-expanded')).toBe('true')
  })
})
