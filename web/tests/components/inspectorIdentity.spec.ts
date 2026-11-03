/**
 * The card's identity line copies two things: the reference as it is written, and
 * the item's short address, which the desktop app has no address bar to give. Each
 * says beside the line, to a screen reader too, whether the copy happened.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspectorIdentity from '@/widgets/work-item-inspector/components/InspectorIdentity.vue'

import { messages } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function clipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText)
  vi.stubGlobal('navigator', { clipboard: { writeText: spy } })
  return spy
}

function identity(locale: 'en' | 'ru' = 'en') {
  return mount(InspectorIdentity, {
    props: {
      item: { ...workItemFixture('Identity', 12), source: '' },
      reference: 'MAIN-12',
      resourceRef: { kind: 'planning-space', resource_id: 'space' },
    },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages })],
      stubs: { VIcon: true },
    },
  })
}

const linkButton = (wrapper: ReturnType<typeof identity>) => wrapper.get('button.identity-link')
const note = (wrapper: ReturnType<typeof identity>) => wrapper.get('[role="status"]')
/** The glyph the line shows for the note: `check`, `alert`, or null for none. */
const glyph = (wrapper: ReturnType<typeof identity>) =>
  wrapper.find('.identity-note v-icon-stub').attributes('name') ?? null

describe('copying the link to an item', () => {
  it('puts the short address on this origin on the clipboard and says so', async () => {
    const writeText = clipboard(async () => {})
    const wrapper = identity()
    expect(linkButton(wrapper).attributes('aria-label')).toBe('Copy link to MAIN-12')

    await linkButton(wrapper).trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledExactlyOnceWith(`${location.origin}/open/MAIN-12`)
    expect(note(wrapper).text()).toBe('Link copied')
    expect(glyph(wrapper)).toBe('check')
  })

  it('says the copy failed when the clipboard refuses, and never that it was copied', async () => {
    clipboard(async () => {
      throw new DOMException('Write permission denied.', 'NotAllowedError')
    })
    const wrapper = identity()

    await linkButton(wrapper).trigger('click')
    await flushPromises()

    expect(note(wrapper).text()).toBe('Could not copy the link')
    expect(glyph(wrapper)).toBe('alert')
  })

  it('speaks the language of the interface', async () => {
    clipboard(async () => {})
    const wrapper = identity('ru')
    expect(linkButton(wrapper).attributes('aria-label')).toBe('Копировать ссылку на MAIN-12')

    await linkButton(wrapper).trigger('click')
    await flushPromises()

    expect(note(wrapper).text()).toBe('Ссылка скопирована')
  })

  it('leaves the reference copying the reference alone', async () => {
    const writeText = clipboard(async () => {})
    const wrapper = identity()

    await wrapper.get('button.head-reference').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledExactlyOnceWith('MAIN-12')
    expect(note(wrapper).text()).toBe('MAIN-12 copied')
    expect(glyph(wrapper)).toBe('check')
  })
})

describe('a note on the identity line', () => {
  it('shows nothing and keeps its status region empty but present before a press', () => {
    const wrapper = identity()
    expect(wrapper.find('.identity-note').exists()).toBe(false)
    expect(note(wrapper).text()).toBe('')
  })

  it('drops words that would be cut, and keeps the glyph and the whole sentence', async () => {
    clipboard(async () => {})
    // The line leaves 40px for words 120px long.
    const room = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('identity-note-words') ? 40 : 0
    })
    const length = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('identity-note-words') ? 120 : 0
      })
    try {
      const wrapper = identity()
      await linkButton(wrapper).trigger('click')
      await flushPromises()

      expect(wrapper.find('.identity-note-words').exists()).toBe(false)
      expect(glyph(wrapper)).toBe('check')
      expect(wrapper.get('.identity-note').attributes('title')).toBe('Link copied')
      expect(note(wrapper).text()).toBe('Link copied')
    } finally {
      room.mockRestore()
      length.mockRestore()
    }
  })
})
