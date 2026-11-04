/**
 * The markdown editor's frame, keys, toolbar and `#` completions.
 *
 * The contract: Ctrl+Enter (or Cmd+Enter) sends; `#` asks the host once typing
 * pauses, whoever wrote it; the arrows walk the rows with focus kept in the field;
 * Enter or Tab writes the chosen reference in place of the query; Escape closes
 * the list without letting the key reach the drawer around it; the preview is the
 * text as the card will draw it. The foot exists for a host's action or a refusal.
 *
 * What the toolbar does to text is `markdownEdits.test.ts`. Undo and the real
 * editing path are a browser's to show, in `production-editor.spec.ts`: here the
 * field has no `execCommand`, so these run the stand-in that keeps the text right.
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

interface EditorOptions {
  error?: string
  hideLabel?: boolean
  hideTools?: boolean
  locale?: 'en' | 'ru'
  maxlength?: number
  preview?: boolean
  slots?: Record<string, string>
  suggest?: typeof rows | null
}

function mountEditor(options: EditorOptions = {}) {
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
      'modelValue': '',
      'preview': options.preview ?? false,
      'error': options.error ?? '',
      'hideLabel': options.hideLabel ?? false,
      'hideTools': options.hideTools ?? false,
      ...(options.maxlength === undefined ? {} : { maxlength: options.maxlength }),
      'suggest': options.suggest === null ? undefined : suggest,
      'onUpdate:modelValue': (value: string) => void wrapper.setProps({ modelValue: value }),
      'onUpdate:preview': (value: boolean) => void wrapper.setProps({ preview: value }),
      'onSubmit': submitted,
    },
    slots: options.slots ?? {},
    global: {
      plugins: [createI18n({ legacy: false, locale: options.locale ?? 'en', messages })],
    },
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

const tool = (wrapper: ReturnType<typeof mountEditor>['wrapper'], name: string) =>
  wrapper.get(`button[aria-label="${name}"]`)

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

  it('closes the list when focus leaves the field, which a press on a row does not do', async () => {
    const { wrapper } = mountEditor()
    await type(wrapper, '#par')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    await wrapper.get('textarea').trigger('focusout')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('does not ask for a # inside a word or a heading, and says when nothing matches', async () => {
    const { wrapper, suggest } = mountEditor({ suggest: [] })
    await type(wrapper, 'issue#12')
    await type(wrapper, '# Heading')
    await type(wrapper, '## Heading')
    await vi.advanceTimersByTimeAsync(250)
    expect(suggest).not.toHaveBeenCalled()
    await type(wrapper, '#zzz')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.get('[role="listbox"]').text()).toContain('No tasks match “zzz”.')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  })

  it('asks the host about a # with nothing after it yet, and says what to type if it has no rows', async () => {
    const { wrapper, suggest } = mountEditor({ suggest: [] })
    await type(wrapper, 'See #')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(suggest).toHaveBeenCalledExactlyOnceWith('', expect.any(AbortSignal))
    expect(wrapper.get('[role="listbox"]').text()).toBe('Type a number or a word from the title.')
  })

  it('previews the text as the card draws it, over the field, and says when there is nothing', async () => {
    const empty = mountEditor({ preview: true })
    expect(empty.wrapper.get('textarea').element.closest('[inert]')).not.toBeNull()
    expect(empty.wrapper.text()).toContain('Nothing to preview yet.')
    const { wrapper } = mountEditor({ preview: true })
    await wrapper.setProps({ modelValue: '**bold** <b>raw</b>' })
    expect(wrapper.get('strong').text()).toBe('bold')
    expect(wrapper.find('b').exists()).toBe(false)
    // The preview is the panel its tab shows, and the tab names it.
    const panel = wrapper.get('.markdown-preview')
    expect(panel.attributes('role')).toBe('tabpanel')
    const tab = wrapper.get(`#${panel.attributes('aria-labelledby') ?? ''}`)
    expect([tab.attributes('role'), tab.text()]).toEqual(['tab', 'Preview'])
    expect(tab.attributes('aria-controls')).toBe(panel.attributes('id'))
  })

  it('names a preview with no toolbar by its field, a group and no tab panel', () => {
    const { wrapper } = mountEditor({ preview: true, hideTools: true })
    const panel = wrapper.get('.markdown-preview')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect([panel.attributes('role'), panel.attributes('aria-label')]).toEqual(['group', 'Comment'])
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false)
  })

  it('switches between writing and preview from its own toolbar, which the host can bind', async () => {
    const { wrapper } = mountEditor()
    // Write and Preview show the text or its preview: tabs over a panel, not a value.
    const switcher = wrapper.get('[role="tablist"][aria-label="Write or preview"]')
    expect(switcher.get('[aria-selected="true"]').text()).toBe('Write')
    const writing = wrapper.get('.markdown-input')
    expect(writing.attributes('role')).toBe('tabpanel')
    expect(writing.attributes('aria-labelledby')).toBe(
      switcher.get('[aria-selected="true"]').attributes('id'),
    )
    await switcher.findAll('button')[1]?.trigger('click')
    expect(wrapper.emitted('update:preview')).toEqual([[true]])
    expect(wrapper.find('.markdown-preview').exists()).toBe(true)
    expect(switcher.get('[aria-selected="true"]').text()).toBe('Preview')
  })

  it('has no foot without a host’s action or a refusal', () => {
    expect(mountEditor().wrapper.find('.markdown-foot').exists()).toBe(false)
  })

  it('puts a host’s action at the end of the foot and the short hint at its start', () => {
    const { wrapper } = mountEditor({ slots: { actions: '<button>Send</button>' } })
    const foot = wrapper.get('.markdown-foot')
    expect(foot.get('.markdown-hint').text()).toBe('Markdown · Ctrl+Enter')
    expect(foot.get('.markdown-actions button').text()).toBe('Send')
    expect(foot.element.lastElementChild?.classList.contains('markdown-actions')).toBe(true)
  })

  it('says a refusal in the foot in place of the hint, and the field names it', () => {
    const { wrapper } = mountEditor({
      error: 'Too long',
      slots: { actions: '<button>Send</button>' },
    })
    expect(wrapper.find('.markdown-hint').exists()).toBe(false)
    const message = wrapper.get('[role="alert"]')
    expect(message.text()).toBe('Too long')
    const field = wrapper.get('textarea')
    expect(field.attributes('aria-invalid')).toBe('true')
    expect(field.attributes('aria-describedby')).toBe(message.attributes('id'))
  })

  it('says a refusal in a foot of its own where the host’s action stands elsewhere', () => {
    const { wrapper } = mountEditor({ error: 'Required' })
    expect(wrapper.get('.markdown-foot').text()).toBe('Required')
    expect(wrapper.find('.markdown-actions').exists()).toBe(false)
  })

  it('names the field on itself, with its label shown or left to a reader', () => {
    const shown = mountEditor().wrapper
    const label = shown.get('label.markdown-label')
    expect(label.text()).toBe('Comment')
    expect(label.attributes('for')).toBe(shown.get('textarea').attributes('id'))
    const hidden = mountEditor({ hideLabel: true }).wrapper
    expect(hidden.find('label.markdown-label').exists()).toBe(false)
    expect(hidden.get('textarea').attributes('aria-label')).toBe('Comment')
  })

  it('draws real, named, titled buttons that cannot submit a form, in either language', () => {
    const names = (locale: 'en' | 'ru') =>
      mountEditor({ locale })
        .wrapper.findAll('[role="group"] button[title]')
        .map((button) => {
          expect(button.attributes('type')).toBe('button')
          return [button.attributes('aria-label'), button.attributes('title')]
        })
    expect(names('en')).toEqual([
      ['Link a task', 'Link a task'],
      ['Bold', 'Bold (Ctrl+B)'],
      ['Italic', 'Italic (Ctrl+I)'],
      ['Code', 'Code'],
      ['Link', 'Link'],
      ['Bulleted list', 'Bulleted list'],
    ])
    expect(names('ru')).toEqual([
      ['Сослаться на задачу', 'Сослаться на задачу'],
      ['Жирный', 'Жирный (Ctrl+B)'],
      ['Курсив', 'Курсив (Ctrl+I)'],
      ['Код', 'Код'],
      ['Ссылка', 'Ссылка'],
      ['Маркированный список', 'Маркированный список'],
    ])
  })

  it('offers no mention where the host has no list to open', () => {
    const { wrapper } = mountEditor({ suggest: null })
    expect(wrapper.find('button[aria-label="Link a task"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Bold"]').exists()).toBe(true)
  })

  it('turns the buttons off in preview and while the text is being sent', async () => {
    const { wrapper } = mountEditor()
    const buttons = () => wrapper.findAll('[role="group"] button[title]')
    expect(buttons().every((button) => button.attributes('disabled') === undefined)).toBe(true)
    await wrapper.setProps({ preview: true })
    expect(buttons().every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.setProps({ preview: false, disabled: true })
    expect(buttons().every((button) => button.attributes('disabled') !== undefined)).toBe(true)
  })

  it('applies a button to the selection and sends the change the way typing does', async () => {
    const { wrapper, text } = mountEditor()
    await type(wrapper, 'a word here')
    const field = wrapper.get<HTMLTextAreaElement>('textarea')
    field.element.setSelectionRange(2, 6)
    await tool(wrapper, 'Bold').trigger('click')
    await flushPromises()
    expect(text.value).toBe('a **word** here')
    expect([field.element.selectionStart, field.element.selectionEnd]).toEqual([4, 8])
    expect(document.activeElement).toBe(field.element)
  })

  it('writes a # from the button and opens the same list a typed one does', async () => {
    const { wrapper, text, suggest } = mountEditor()
    await type(wrapper, 'See')
    await tool(wrapper, 'Link a task').trigger('click')
    await flushPromises()
    // After a word it needs a space to start one of its own.
    expect(text.value).toBe('See #')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(suggest).toHaveBeenCalledExactlyOnceWith('', expect.any(AbortSignal))
    await wrapper.findAll('[role="option"]')[0]?.trigger('click')
    await flushPromises()
    expect(text.value).toBe('See MAIN-12 ')
  })

  it('makes an edit whole or not at all at the length limit', async () => {
    const { wrapper, text } = mountEditor({ maxlength: 6 })
    await type(wrapper, 'abc')
    const field = wrapper.get<HTMLTextAreaElement>('textarea')
    field.element.setSelectionRange(0, 3)
    await tool(wrapper, 'Bold').trigger('click')
    await flushPromises()
    expect(text.value).toBe('abc')
    await tool(wrapper, 'Italic').trigger('click')
    await flushPromises()
    expect(text.value).toBe('*abc*')
  })

  it('takes Ctrl+B and Ctrl+I by the key’s place, whatever letter the layout gives it', async () => {
    const { wrapper, text } = mountEditor()
    await type(wrapper, 'word')
    const field = wrapper.get<HTMLTextAreaElement>('textarea')
    field.element.setSelectionRange(0, 4)
    await field.trigger('keydown', { key: 'и', code: 'KeyB', ctrlKey: true })
    await flushPromises()
    expect(text.value).toBe('**word**')
    await field.trigger('keydown', { key: 'ш', code: 'KeyI', metaKey: true })
    await flushPromises()
    expect(text.value).toBe('***word***')
    // Another modifier makes it another shortcut, which belongs to someone else.
    await field.trigger('keydown', { key: 'и', code: 'KeyB', ctrlKey: true, shiftKey: true })
    await field.trigger('keydown', { key: 'и', code: 'KeyB' })
    await flushPromises()
    expect(text.value).toBe('***word***')
  })
})
