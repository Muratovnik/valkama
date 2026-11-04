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

/** The two date forms the line uses, so it has a date to give way. */
const DAY = { month: 'short', day: '2-digit' } as const
const DATES = {
  en: { day: DAY, activity: { ...DAY, year: 'numeric' } },
  ru: { day: DAY, activity: { ...DAY, year: 'numeric' } },
} as const

function identity(locale: 'en' | 'ru' = 'en') {
  return mount(InspectorIdentity, {
    props: {
      item: { ...workItemFixture('Identity', 12), source: '' },
      reference: 'MAIN-12',
      resourceRef: { kind: 'planning-space', resource_id: 'space' },
    },
    global: {
      plugins: [createI18n({ legacy: false, locale, messages, datetimeFormats: DATES })],
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

    expect(note(wrapper).text()).toBe('Link not copied')
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

/** What each part of the line takes, in px, as a browser would lay them out unshrunk. */
const TAKES = { kind: 60, rest: 100, date: 150, glyph: 20, words: 120 }

/**
 * The line at `room` px: it overflows by whatever its parts present take beyond that,
 * so the component's own measure sees what a browser would.
 */
function lineOf(room: number) {
  const width = (line: HTMLElement) =>
    TAKES.rest +
    (line.querySelector('.identity-kind') ? TAKES.kind : 0) +
    (line.querySelector('.identity-updated') ? TAKES.date : 0) +
    (line.querySelector('.identity-note') ? TAKES.glyph : 0) +
    (line.querySelector('.identity-note-words') ? TAKES.words : 0)
  const isLine = (node: HTMLElement) => node.classList.contains('card-identity')
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLine(this) ? width(this) : 0
  })
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLine(this) ? room : 0
  })
  return () => {
    scroll.mockRestore()
    client.mockRestore()
  }
}

async function copiedLinkWith(room: number) {
  clipboard(async () => {})
  const restore = lineOf(room)
  try {
    const wrapper = identity()
    await flushPromises()
    await linkButton(wrapper).trigger('click')
    await flushPromises()
    return wrapper
  } finally {
    restore()
  }
}

/** What the line still shows: the date, the kind, the note's words. */
const shown = (wrapper: Awaited<ReturnType<typeof copiedLinkWith>>) => ({
  date: wrapper.find('.identity-updated').exists(),
  kind: wrapper.find('.identity-kind').exists(),
  words: wrapper.find('.identity-note-words').exists(),
})

describe('a note on the identity line', () => {
  it('shows nothing and keeps its status region empty but present before a press', () => {
    const wrapper = identity()
    expect(wrapper.find('.identity-note').exists()).toBe(false)
    expect(note(wrapper).text()).toBe('')
  })

  it('keeps everything while the line holds it all', async () => {
    const wrapper = await copiedLinkWith(1000)

    expect(shown(wrapper)).toEqual({ date: true, kind: true, words: true })
    expect(wrapper.get('.identity-note-words').text()).toBe('Link copied')
  })

  it('takes the date out whole before it would cut a word of the note', async () => {
    const wrapper = await copiedLinkWith(TAKES.rest + TAKES.kind + TAKES.glyph + TAKES.words)

    expect(shown(wrapper)).toEqual({ date: false, kind: true, words: true })
  })

  it('takes the kind out next, so a phone-wide line still says the whole sentence', async () => {
    const wrapper = await copiedLinkWith(TAKES.rest + TAKES.glyph + TAKES.words)

    expect(shown(wrapper)).toEqual({ date: false, kind: false, words: true })
  })

  it('drops the words last, and keeps the glyph and the whole sentence', async () => {
    const wrapper = await copiedLinkWith(TAKES.rest + TAKES.glyph)

    expect(shown(wrapper)).toEqual({ date: false, kind: false, words: false })
    expect(glyph(wrapper)).toBe('check')
    expect(wrapper.get('.identity-note').attributes('title')).toBe('Link copied')
    expect(note(wrapper).text()).toBe('Link copied')
  })
})
