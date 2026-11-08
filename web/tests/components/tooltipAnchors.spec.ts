/**
 * What `v-tooltip` tells assistive technology, as `title` did before it: the element's name
 * when nothing else names it, its description when it says more than the name, and nothing
 * when it would only repeat the name. Leaving the page takes back all it wrote.
 */
import { defineComponent, nextTick, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import {
  tooltipAnchorOf,
  tooltipDescriptions,
  tooltipOf,
  vTooltip,
} from '@/shared/ui/tooltipAnchors.ts'

function host(template: string, state: Record<string, unknown> = {}) {
  const values = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, ref(value)]))
  const wrapper = mount(
    defineComponent({ directives: { tooltip: vTooltip }, setup: () => values, template }),
    { attachTo: document.body },
  )
  return { values, wrapper }
}

const described = (element: Element) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => tooltipDescriptions.get(id))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('v-tooltip for assistive technology', () => {
  it('names an icon-only control that nothing else names', () => {
    const { wrapper } = host(
      '<button v-tooltip="\'Refresh now\'"><svg aria-hidden="true" /></button>',
    )
    const button = wrapper.get('button').element
    expect(button.getAttribute('aria-label')).toBe('Refresh now')
    expect(button.hasAttribute('aria-describedby')).toBe(false)
  })

  it('describes a named control when it says more than the name', () => {
    const { wrapper } = host('<button v-tooltip="\'Go to Work\'">Valkama</button>')
    const button = wrapper.get('button').element
    expect(button.hasAttribute('aria-label')).toBe(false)
    expect(described(button)).toEqual(['Go to Work'])
  })

  it('adds nothing when every word is already in the name', () => {
    const { wrapper } = host(
      '<a href="#" aria-label="MAIN-12 Answer a review — working, 2 agents" v-tooltip="hint">12 Answer a review</a>',
      { hint: 'MAIN-12 Answer a review\nworking, 2 agents' },
    )
    const link = wrapper.get('a').element
    expect(link.getAttribute('aria-label')).toBe('MAIN-12 Answer a review — working, 2 agents')
    expect(link.hasAttribute('aria-describedby')).toBe(false)
    expect(tooltipOf(link)?.text).toBe('MAIN-12 Answer a review\nworking, 2 agents')
  })

  it('keeps the description the template writes beside its own, through an update', async () => {
    const { values, wrapper } = host(
      '<button :aria-describedby="note" v-tooltip="hint">Reconnecting</button><p id="note-1">x</p><p id="note-2">y</p>',
      { hint: 'No connection. Refresh now', note: 'note-1' },
    )
    const button = wrapper.get('button').element
    expect(button.getAttribute('aria-describedby')?.split(' ')[0]).toBe('note-1')
    expect(described(button).slice(1)).toEqual(['No connection. Refresh now'])
    values.note.value = 'note-2'
    values.hint.value = 'Still no connection. Refresh now'
    await nextTick()
    expect(button.getAttribute('aria-describedby')?.split(' ')[0]).toBe('note-2')
    expect(described(button).slice(1)).toEqual(['Still no connection. Refresh now'])
  })

  it('reads its side, its mode and dynamic text, and an empty text is no hint', async () => {
    const { values, wrapper } = host(
      '<a href="#" v-tooltip:right.clipped="name"><b>{{ name }}</b></a><span v-tooltip="{ text: hint, clipped: cut }">s</span>',
      { name: 'MAIN · A space with a long name', hint: 'Why', cut: false },
    )
    const link = wrapper.get('a').element
    const span = wrapper.get('span').element
    expect(tooltipOf(link)).toMatchObject({ side: 'right', clipped: true })
    expect(tooltipOf(span)).toMatchObject({ side: 'top', clipped: false, text: 'Why' })
    expect(tooltipAnchorOf(link.querySelector('b'))).toBe(link)
    values.cut.value = true
    values.name.value = ''
    await nextTick()
    expect(tooltipOf(span)?.clipped).toBe(true)
    expect(tooltipOf(link)).toBeUndefined()
    expect(link.dataset.tooltip).toBeUndefined()
  })

  it('takes back what it wrote when the element leaves', () => {
    const { wrapper } = host(
      '<div><button v-tooltip="\'Pin\'"><svg aria-hidden="true" /></button><button v-tooltip="\'Go to Work\'">Valkama</button></div>',
    )
    const [icon, named] = wrapper.findAll('button').map((each) => each.element)
    const id = named.getAttribute('aria-describedby') ?? ''
    expect(tooltipDescriptions.has(id)).toBe(true)
    wrapper.unmount()
    expect(icon.hasAttribute('aria-label')).toBe(false)
    expect(named.hasAttribute('aria-describedby')).toBe(false)
    expect(tooltipDescriptions.has(id)).toBe(false)
  })
})
