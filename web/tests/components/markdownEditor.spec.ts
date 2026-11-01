/**
 * The markdown editor's keys and its `#` completions.
 *
 * The contract: Ctrl+Enter (or Cmd+Enter) sends; `#` and a query asks the host
 * once typing pauses; the arrows walk the rows with focus kept in the field;
 * Enter or Tab writes the chosen reference in place of the query; Escape closes
 * the list without letting the key reach the drawer around it; the preview is
 * the text as the card will draw it.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'
import MarkdownEditor from '@/shared/ui/MarkdownEditor.vue'
import type { EditorSuggestion } from '@/shared/ui/MarkdownEditor.vue'

const rows: EditorSuggestion[] = [
  { key: '1', reference: 'MAIN-12', title: 'Parser', detail: 'Doing' },
  { key: '2', reference: 'MAIN-13', title: 'Renderer', detail: 'Done' },
]

function mountEditor(options: { preview?: boolean; suggest?: typeof rows | null } = {}) {
  const submitted = vi.fn()
  const suggest = vi.fn(async () => options.suggest ?? rows)
  const escapes = vi.fn()
  // The drawer the field stands in, which closes on an Escape that reaches it.
  const drawer = document.createElement('div')
  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') escapes()
  })
  document.body.append(drawer)
  const wrapper = mount(MarkdownEditor, {
    attachTo: drawer,
    props: {
      'label': 'Comment',
      'action': 'Add note',
      'modelValue': '',
      'preview': options.preview ?? false,
      'suggest': options.suggest === null ? undefined : suggest,
      'onUpdate:modelValue': (value: string) => void wrapper.setProps({ modelValue: value }),
      'onSubmit': submitted,
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  const text = {
    get value() {
      return wrapper.props('modelValue')
    },
  }
  return { wrapper, text, submitted, suggest, escapes }
}

/** Type as a person does: the value changes, the caret stays at its end. */
async function type(wrapper: ReturnType<typeof mountEditor>['wrapper'], value: string) {
  const field = wrapper.get<HTMLTextAreaElement>('textarea')
  field.element.focus()
  await field.setValue(value)
  field.element.setSelectionRange(value.length, value.length)
  await field.trigger('input')
}

describe('MarkdownEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('sends on Ctrl+Enter and on Cmd+Enter, and a plain Enter is a new line', async () => {
    const { wrapper, submitted } = mountEditor({ suggest: null })
    const field = wrapper.get('textarea')
    await field.trigger('keydown', { key: 'Enter' })
    expect(submitted).not.toHaveBeenCalled()
    await field.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await field.trigger('keydown', { key: 'Enter', metaKey: true })
    expect(submitted).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Ctrl+Enter: Add note')
  })

  it('offers tasks for # and a query, walks them with the keys and writes the chosen one', async () => {
    const { wrapper, text, suggest } = mountEditor()
    await type(wrapper, 'See #pars')
    expect(suggest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(suggest).toHaveBeenCalledExactlyOnceWith('pars', expect.any(AbortSignal))
    const field = wrapper.get('textarea')
    const options = wrapper.findAll('[role="option"]')
    expect(options).toHaveLength(2)
    // A multi-line text box stays one; it names the list and says what arrived.
    expect(field.attributes('role')).toBeUndefined()
    expect(field.attributes('aria-autocomplete')).toBe('list')
    expect(field.attributes('aria-controls')).toBe(wrapper.get('[role="listbox"]').attributes('id'))
    expect(wrapper.get('[role="status"]').text()).toBe('2 tasks found')
    expect(field.attributes('aria-activedescendant')).toBe(options[0]?.attributes('id'))
    await field.trigger('keydown', { key: 'ArrowDown' })
    expect(field.attributes('aria-activedescendant')).toBe(options[1]?.attributes('id'))
    expect(options[1]?.attributes('aria-selected')).toBe('true')
    await field.trigger('keydown', { key: 'ArrowDown' })
    expect(field.attributes('aria-activedescendant')).toBe(options[0]?.attributes('id'))
    await field.trigger('keydown', { key: 'ArrowUp' })
    await field.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(text.value).toBe('See MAIN-13 ')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(field.attributes('aria-controls')).toBeUndefined()
    expect(wrapper.get('[role="status"]').text()).toBe('')
    expect(document.activeElement).toBe(field.element)
  })

  it('takes a row on Tab and by pointer, keeping the text around the query', async () => {
    const { wrapper, text } = mountEditor()
    await type(wrapper, '#ren')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    await wrapper.get('textarea').trigger('keydown', { key: 'Tab' })
    await flushPromises()
    expect(text.value).toBe('MAIN-12 ')
    await type(wrapper, 'Fixed (#ren')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    await wrapper.findAll('[role="option"]')[1]?.trigger('click')
    await flushPromises()
    expect(text.value).toBe('Fixed (MAIN-13 ')
  })

  it('closes the list on Escape and keeps the key from closing what the field stands in', async () => {
    const { wrapper, escapes } = mountEditor()
    await type(wrapper, '#par')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(escapes).not.toHaveBeenCalled()
    // With no list open, Escape is the drawer's again.
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })
    expect(escapes).toHaveBeenCalledTimes(1)
  })

  it('does not ask for a # inside a word or a heading, and says when nothing matches', async () => {
    const { wrapper, suggest } = mountEditor({ suggest: [] })
    await type(wrapper, 'issue#12')
    await type(wrapper, '# Heading')
    await vi.advanceTimersByTimeAsync(250)
    expect(suggest).not.toHaveBeenCalled()
    await type(wrapper, '#zzz')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.get('[role="listbox"]').text()).toContain('No tasks match “zzz”.')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })

  it('previews the text as the card draws it, and says when there is nothing yet', async () => {
    const empty = mountEditor({ preview: true })
    expect(empty.wrapper.find('textarea').exists()).toBe(false)
    expect(empty.wrapper.text()).toContain('Nothing to preview yet.')
    const { wrapper } = mountEditor({ preview: true })
    await wrapper.setProps({ modelValue: '**bold** <b>raw</b>' })
    expect(wrapper.get('strong').text()).toBe('bold')
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('Comment')
  })
})
