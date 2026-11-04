/**
 * Free text as the reader sees it: markdown drawn without markup it did not
 * choose, and references that link only where a layer above says they resolve.
 */
import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import InspectorReferenceScope from '@/widgets/work-item-inspector/components/InspectorReferenceScope.vue'

import { messages } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import type { ReferenceResolver } from '@/shared/lib/referenceLinks.ts'
import RichText from '@/shared/ui/RichText.vue'

import { workItemFixture } from '../fixtures/workItem.ts'

const i18n = () => createI18n({ legacy: false, locale: 'en', messages })

type Resolve = Parameters<typeof provideReferenceLinks>[0]

/** A text drawn on its own, with the words every page of the app has. */
const drawn = (source: string) =>
  mount(RichText, { props: { source }, global: { plugins: [i18n()] } })

/** One layer of reference links, as a page provides it, around whatever it holds. */
const Layer = defineComponent({
  props: { resolve: { type: Function as PropType<Resolve>, required: true } },
  setup(props, { slots }) {
    provideReferenceLinks((reference, parent) => props.resolve(reference, parent))
    return () => slots.default?.()
  },
})

function underLayer(source: string, resolve: Resolve) {
  return mount(Layer, {
    props: { resolve },
    slots: { default: () => h(RichText, { source }) },
    global: { plugins: [i18n()] },
  })
}

describe('RichText', () => {
  it('leaves a link with no preview as it was, and gives one with a preview no title', () => {
    const preview = { describe: () => 'Described', render: () => null }
    const wrapper = underLayer('See MAIN-12 and MAIN-13.', (reference) =>
      reference.kind === 'work-item'
        ? {
            title: `Open ${reference.value}`,
            open: () => {},
            ...(reference.value === 'MAIN-12' ? { preview } : {}),
          }
        : null,
    )
    const [held, plain] = wrapper.findAll('button')
    expect(held?.attributes('title')).toBeUndefined()
    expect(held?.attributes('aria-description')).toBe('Open MAIN-12')
    expect(held?.attributes()).toHaveProperty('data-reference-preview')
    expect(held?.attributes()).toHaveProperty('data-grace-area-trigger')

    expect(plain?.attributes('title')).toBe('Open MAIN-13')
    expect(plain?.attributes('aria-description')).toBeUndefined()
    expect(plain?.attributes()).not.toHaveProperty('data-reference-preview')
    expect(plain?.attributes()).not.toHaveProperty('data-grace-area-trigger')
    // Its name is still its text: the preview adds no node to the line.
    expect(wrapper.text()).toBe('See MAIN-12 and MAIN-13.')
  })

  it('draws each construct as its element, and a heading below the section heading', () => {
    const wrapper = mount(RichText, {
      global: { plugins: [i18n()] },
      props: {
        source: [
          '# Title',
          'Some **bold**, *em*, ~~old~~ and `code`.',
          '- one\n- two',
          '1. first',
          '- [x] done',
          '> quoted',
          '```\nconst a = 1\n```',
          '| a | b |\n|---|--:|\n| 1 | 2 |',
          '---',
        ].join('\n\n'),
      },
    })
    expect(wrapper.findAll('h1, h2, h3, h4, h5, h6')).toHaveLength(0)
    expect(wrapper.get('.rich-heading').element.tagName).toBe('P')
    expect(wrapper.get('strong').text()).toBe('bold')
    expect(wrapper.get('em').text()).toBe('em')
    expect(wrapper.get('del').text()).toBe('old')
    expect(wrapper.get('p code').text()).toBe('code')
    expect(wrapper.findAll('ul > li').map((item) => item.text())).toEqual(['one', 'two', 'done'])
    expect(wrapper.get('ol > li').text()).toBe('first')
    const task = wrapper.get<HTMLInputElement>('input[type="checkbox"]')
    expect(task.element.checked).toBe(true)
    expect(task.element.disabled).toBe(true)
    expect(wrapper.find(`#${task.attributes('aria-labelledby')}`).text()).toBe('done')
    expect(wrapper.get('blockquote').text()).toBe('quoted')
    expect(wrapper.get('pre').text()).toBe('const a = 1')
    expect(wrapper.findAll('th').map((cell) => cell.text())).toEqual(['a', 'b'])
    expect(wrapper.findAll('td')[1]?.classes()).toContain('end')
    expect(wrapper.find('hr').exists()).toBe(true)
  })

  it('keeps a line break written as one', () => {
    const wrapper = drawn('first line\nsecond line')
    expect(wrapper.findAll('p')).toHaveLength(1)
    expect(wrapper.findAll('br')).toHaveLength(1)
  })

  it('never renders raw HTML, and shows it as the text it was', () => {
    const source = '<img src=x onerror="alert(1)"> <script>alert(1)</script> <b>bold</b>'
    const wrapper = drawn(source)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toBe(source)
  })

  it('neutralises javascript: and data: links and opens a safe one outside the app', () => {
    const wrapper = mount(RichText, {
      global: { plugins: [i18n()] },
      props: {
        source:
          '[bad](javascript:alert(1)) [worse](data:text/html,x) [good](https://example.org/a)',
      },
    })
    const links = wrapper.findAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]?.attributes()).toMatchObject({
      href: 'https://example.org/a',
      target: '_blank',
      rel: 'noopener noreferrer',
    })
    expect(wrapper.text()).toBe('bad worse good')
  })

  it('is plain text for every reference when nothing above resolves one', () => {
    const wrapper = drawn('MAIN-12 at a1b2c3d')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).toBe('MAIN-12 at a1b2c3d')
  })

  it('links a reference only where its layer resolves it, and opens what the layer says', async () => {
    const open = vi.fn()
    const wrapper = underLayer('MAIN-12, SHA-256 and `a1b2c3d` with ffffff1', (reference) =>
      reference.value === 'MAIN-12' || reference.value === 'a1b2c3d'
        ? { title: `Open ${reference.value}`, open: () => open(reference.value) }
        : null,
    )
    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['MAIN-12', 'a1b2c3d'])
    expect(buttons[0]?.attributes('title')).toBe('Open MAIN-12')
    // An id is compared character by character and set in the metadata font.
    expect(buttons[0]?.classes()).not.toContain('identifier')
    expect(buttons[1]?.classes()).toEqual(expect.arrayContaining(['identifier', 'rich-code']))
    expect(wrapper.text()).toBe('MAIN-12, SHA-256 and a1b2c3d with ffffff1')
    await buttons[1]?.trigger('click')
    expect(open).toHaveBeenCalledExactlyOnceWith('a1b2c3d')
  })
})

describe('the card layer of reference links', () => {
  const item = {
    ...workItemFixture('Task', 1),
    refs: [
      {
        kind: 'commit' as const,
        value: 'repo@a1b2c3d4e5',
        label: 'fix: one thing',
        author: 'agent',
        at: '2026-08-27T18:00:00Z',
      },
    ],
  }

  function inCard(source: string, above: ReferenceResolver) {
    return mount(Layer, {
      props: { resolve: (reference: Parameters<ReferenceResolver>[0]) => above(reference) },
      slots: {
        default: () =>
          h(InspectorReferenceScope, { item }, { default: () => h(RichText, { source }) }),
      },
      global: { plugins: [i18n()], stubs: { InspectorRefPeek: true } },
    })
  }

  it('opens its own space through the card, leaves another space to the shell and itself as text', async () => {
    const shellOpen = vi.fn()
    const wrapper = inCard('QA-320 QA-7 OTHER-3 a1b2c3d ffffff1', (reference) =>
      reference.kind === 'work-item'
        ? { title: reference.value, open: () => shellOpen(reference.value) }
        : null,
    )
    const buttons = wrapper.findAll('button')
    // The card's own reference is not a link; a commit links only as a ref it carries.
    expect(buttons.map((button) => button.text())).toEqual(['QA-7', 'OTHER-3', 'a1b2c3d'])
    await buttons[0]?.trigger('click')
    expect(shellOpen).not.toHaveBeenCalled()
    expect(wrapper.findComponent(InspectorReferenceScope).emitted('open')).toEqual([['QA-7']])
    await buttons[1]?.trigger('click')
    expect(shellOpen).toHaveBeenCalledExactlyOnceWith('OTHER-3')
    await buttons[2]?.trigger('click')
    expect(wrapper.findComponent({ name: 'InspectorRefPeek' }).exists()).toBe(true)
  })
})
