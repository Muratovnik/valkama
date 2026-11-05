/**
 * The searching field the new-task dialog chooses its epic and its labels with.
 *
 * One value: typing only searches, and only an option becomes the value; the words in
 * the field go back to the chosen option's once the list is left. Several: chips that a
 * press or Backspace on an empty field removes, an option chosen again comes out, and
 * typed words that no option says can be added. Escape closes an open list and nothing
 * else, and Enter on an open list never sends the form round it.
 */
import { defineComponent, h, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

const EPICS: ChoiceOption[] = [
  { value: '', label: 'No epic' },
  { value: 'MAIN-12', label: 'MAIN-12 · Parser rework', description: 'Dev' },
  { value: 'MAIN-30', label: 'MAIN-30 · Search', description: 'Backlog' },
]
const LABELS: ChoiceOption[] = ['backend', 'frontend', 'docs'].map((label) => ({
  value: label,
  label,
}))

const mounted: { unmount: () => void }[] = []

/** The form round the field, which counts each time it would have been sent. */
const refuse = (submitted: number[]) => (event: Event) => {
  event.preventDefault()
  submitted.push(1)
}

const chips = (wrapper: { findAll: (selector: string) => { text: () => string }[] }) =>
  wrapper.findAll('.combo-chip-name').map((chip) => chip.text())

function host<T extends string | string[]>(start: T, extra: Record<string, unknown> = {}) {
  const value = ref(start) as { value: T }
  const submitted: number[] = []
  const wrapper = mount(
    defineComponent({
      render: () =>
        h('form', { onSubmit: refuse(submitted) }, [
          h(SearchCombobox, {
            'label': 'Field',
            'emptyLabel': 'Nothing here',
            'options': Array.isArray(start) ? LABELS : EPICS,
            'modelValue': value.value,
            'onUpdate:modelValue': (next: string | string[]) => {
              value.value = next as T
            },
            ...extra,
          }),
        ]),
    }),
    { attachTo: document.body },
  )
  mounted.push(wrapper)
  const input = wrapper.get<HTMLInputElement>('input[role="combobox"]')
  return { wrapper, input, value, submitted }
}

const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const optionNames = () => options().map((option) => option.textContent?.trim())

async function type(input: ReturnType<typeof host>['input'], text: string) {
  input.element.focus()
  await input.setValue(text)
  await flushPromises()
}

async function press(input: ReturnType<typeof host>['input'], key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  input.element.dispatchEvent(event)
  await flushPromises()
  return event
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('SearchCombobox with one value', () => {
  it('finds an epic by its number and by its title, and Enter takes it', async () => {
    const { input, value } = host('')
    expect(input.element.value).toBe('No epic')
    await type(input, '30')
    expect(optionNames()).toEqual(['MAIN-30 · SearchBacklog'])
    await type(input, 'pars')
    expect(optionNames()).toEqual(['MAIN-12 · Parser reworkDev'])
    await press(input, 'Enter')
    expect(value.value).toBe('MAIN-12')
    expect(options()).toHaveLength(0)
    expect(input.element.value).toBe('MAIN-12 · Parser rework')
  })

  it('takes nothing that is only typed, and puts the chosen words back on Escape', async () => {
    const { input, value, submitted } = host('MAIN-12')
    await type(input, 'MAIN-99')
    expect(options()).toHaveLength(0)
    expect(document.body.textContent).toContain('Nothing here')
    const enter = await press(input, 'Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(submitted).toEqual([])
    const escape = await press(input, 'Escape')
    // Prevented, so the dialog round the field leaves it open.
    expect(escape.defaultPrevented).toBe(true)
    expect(value.value).toBe('MAIN-12')
    expect(input.element.value).toBe('MAIN-12 · Parser rework')
    expect(document.body.textContent).not.toContain('Nothing here')
    // With the list closed the key is the dialog's.
    const again = await press(input, 'Escape')
    expect(again.defaultPrevented).toBe(false)
  })

  it('goes back to no epic through its own option, by the arrows', async () => {
    const { input, value } = host('MAIN-30')
    await press(input, 'ArrowDown')
    expect(optionNames()).toHaveLength(3)
    await press(input, 'Home')
    await press(input, 'Enter')
    expect(value.value).toBe('')
    expect(input.element.value).toBe('No epic')
  })

  it('is named by its label and described by its hint', () => {
    const { wrapper, input } = host('', { hint: 'pick one' })
    const label = wrapper.get('label')
    expect(label.text()).toBe('Field')
    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(label.text()).not.toContain('pick one')
    const hint = wrapper.get(`#${input.attributes('aria-describedby') ?? ''}`)
    expect(hint.text()).toBe('pick one')
  })
})

describe('SearchCombobox with several values', () => {
  const create = { createLabel: (label: string) => `Add “${label}”` }

  it('adds an existing label found by typing and a new one typed whole', async () => {
    const { wrapper, input, value, submitted } = host<string[]>([], create)
    await type(input, 'end')
    expect(optionNames()).toEqual(['backend', 'frontend', 'Add “end”'])
    await press(input, 'Enter')
    expect(value.value).toEqual(['backend'])
    expect(input.element.value).toBe('')

    await type(input, 'Release')
    expect(optionNames()).toEqual(['Add “Release”'])
    await press(input, 'Enter')
    expect(value.value).toEqual(['backend', 'Release'])
    expect(chips(wrapper)).toEqual(['backend', 'Release'])
    expect(submitted).toEqual([])

    // Words an option already says, in any case, are that option and not a new one.
    await type(input, 'DOCS')
    expect(optionNames()).toEqual(['docs'])
  })

  it('removes the last chip on Backspace in an empty field, and none while text is there', async () => {
    const { wrapper, input, value } = host<string[]>(['backend', 'docs'], create)
    await type(input, 'x')
    await press(input, 'Backspace')
    expect(value.value).toEqual(['backend', 'docs'])
    await type(input, '')
    const backspace = await press(input, 'Backspace')
    expect(backspace.defaultPrevented).toBe(true)
    expect(value.value).toEqual(['backend'])
    await press(input, 'Backspace')
    expect(value.value).toEqual([])
    expect(chips(wrapper)).toEqual([])
  })

  it('removes a chip by its button and an option chosen again from the list', async () => {
    const { wrapper, input, value } = host<string[]>(['backend', 'docs', 'Release'], create)
    const remove = wrapper.get('button[aria-label="docs"]')
    await remove.trigger('click')
    expect(value.value).toEqual(['backend', 'Release'])
    expect(document.activeElement).toBe(input.element)

    // A label added here and not yet on the list stays on it until it is taken out.
    await type(input, 'release')
    expect(optionNames()).toEqual(['Release'])
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true')
    await press(input, 'Enter')
    expect(value.value).toEqual(['backend'])
  })

  it('offers nothing more once it holds as many as it may', async () => {
    const { input } = host<string[]>(['backend', 'docs'], { ...create, max: 2 })
    await type(input, 'n')
    expect(optionNames()).toEqual(['backend', 'frontend'])
    const frontend = options().find((option) => option.textContent?.includes('frontend'))
    expect(frontend?.hasAttribute('data-disabled')).toBe(true)
  })
})
