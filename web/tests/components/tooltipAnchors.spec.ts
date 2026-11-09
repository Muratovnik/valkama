/**
 * What `v-tooltip` tells assistive technology, as `title` did before it: the element's name
 * when nothing else names it, its description when it says more than the name, and nothing
 * when it would only repeat the name. Leaving the page takes back all it wrote. Every hint
 * states its kind, and one that states none is no hint.
 */
import { defineComponent, nextTick, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import {
  textIsClipped,
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
      '<button v-tooltip.name="\'Refresh now\'"><svg aria-hidden="true" /></button>',
    )
    const button = wrapper.get('button').element
    expect(button.getAttribute('aria-label')).toBe('Refresh now')
    expect(button.hasAttribute('aria-describedby')).toBe(false)
  })

  it('describes a named control when it says more than the name', () => {
    const { wrapper } = host('<button v-tooltip.detail="\'Go to Work\'">Valkama</button>')
    const button = wrapper.get('button').element
    expect(button.hasAttribute('aria-label')).toBe(false)
    expect(described(button)).toEqual(['Go to Work'])
  })

  it('adds nothing when the value a separator reads out already says the hint', async () => {
    const { values, wrapper } = host(
      '<div role="separator" tabindex="0" aria-label="Document" :aria-valuetext="value" v-tooltip.detail="hint" />',
      { hint: 'Folded. Enter shows it again', value: 'Folded. Enter shows it again' },
    )
    const edge = wrapper.get('[role="separator"]').element
    expect(edge.hasAttribute('aria-describedby')).toBe(false)
    expect(tooltipOf(edge)?.text).toBe('Folded. Enter shows it again')
    // Once the value says something else, the hint is described again.
    values.value.value = '40%'
    values.hint.value = 'Drag to resize'
    await nextTick()
    expect(described(edge)).toEqual(['Drag to resize'])
  })

  it('adds nothing when every word is already in the name', () => {
    const { wrapper } = host(
      '<a href="#" aria-label="MAIN-12 Answer a review — working, 2 agents" v-tooltip.clipped="hint">12 Answer a review</a>',
      { hint: 'MAIN-12 Answer a review\nworking, 2 agents' },
    )
    const link = wrapper.get('a').element
    expect(link.getAttribute('aria-label')).toBe('MAIN-12 Answer a review — working, 2 agents')
    expect(link.hasAttribute('aria-describedby')).toBe(false)
    expect(tooltipOf(link)?.text).toBe('MAIN-12 Answer a review\nworking, 2 agents')
  })

  it('keeps the description the template writes beside its own, through an update', async () => {
    const { values, wrapper } = host(
      '<button :aria-describedby="note" v-tooltip.detail="hint">Reconnecting</button><p id="note-1">x</p><p id="note-2">y</p>',
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

  it('reads its side, its kind and dynamic text, and an empty text is no hint', async () => {
    const { values, wrapper } = host(
      '<a href="#" v-tooltip:right.clipped="name"><b>{{ name }}</b></a><span v-tooltip.detail="{ text: hint, clipped: cut }">s</span>',
      { name: 'MAIN · A space with a long name', hint: 'Why', cut: false },
    )
    const link = wrapper.get('a').element
    const span = wrapper.get('span').element
    expect(tooltipOf(link)).toMatchObject({ side: 'right', kind: 'clipped', clipped: true })
    expect(tooltipOf(span)).toMatchObject({
      side: 'top',
      kind: 'detail',
      clipped: false,
      text: 'Why',
    })
    expect(span.dataset.tooltip).toBe('Why')
    expect(span.dataset.tooltipKind).toBe('detail')
    expect(tooltipAnchorOf(link.querySelector('b'))).toBe(link)
    // A detail decided as the page runs to wait for its element to be cut.
    values.cut.value = true
    values.name.value = ''
    await nextTick()
    expect(tooltipOf(span)?.clipped).toBe(true)
    expect(tooltipOf(link)).toBeUndefined()
    expect(link.dataset.tooltip).toBeUndefined()
    expect(link.dataset.tooltipKind).toBeUndefined()
  })

  it('keeps a detail’s own words apart, and with no detail makes them a clipped hint', async () => {
    const { values, wrapper } = host(
      '<span v-tooltip.detail="{ text: detail, words: name }" aria-label="Copy">{{ name }}</span>',
      { detail: 'Copy the path', name: 'docs/a/long/path.md' },
    )
    const span = wrapper.get('span').element
    // The words are the element's own: they show only while cut, and are never its description.
    expect(tooltipOf(span)).toMatchObject({
      kind: 'detail',
      clipped: false,
      text: 'Copy the path',
      words: 'docs/a/long/path.md',
    })
    expect(span.dataset.tooltip).toBe('Copy the path')
    expect(described(span)).toEqual(['Copy the path'])
    values.detail.value = ''
    await nextTick()
    expect(tooltipOf(span)).toMatchObject({
      kind: 'detail',
      clipped: true,
      text: 'docs/a/long/path.md',
      words: '',
    })
  })

  it('shows nothing for a hint that states no kind', () => {
    const { wrapper } = host(
      '<button v-tooltip="\'Refresh now\'"><svg aria-hidden="true" /></button>',
    )
    const button = wrapper.get('button').element
    expect(tooltipOf(button)).toBeUndefined()
    expect(button.dataset.tooltip).toBeUndefined()
    expect(button.hasAttribute('aria-label')).toBe(false)
  })

  it('draws a note as a line of its own and gives both lines to assistive technology', () => {
    const { wrapper } = host(
      '<button aria-label="claude · 5937aa01" v-tooltip.detail="{ text: \'Open in VS Code\', note: \'running\' }">claude · 5937aa01</button>',
    )
    const button = wrapper.get('button').element
    expect(tooltipOf(button)).toMatchObject({ text: 'Open in VS Code', note: 'running' })
    expect(button.dataset.tooltip).toBe('Open in VS Code\nrunning')
    expect(described(button)).toEqual(['Open in VS Code\nrunning'])
  })

  it('takes back what it wrote when the element leaves', () => {
    const { wrapper } = host(
      '<div><button v-tooltip.name="\'Pin\'"><svg aria-hidden="true" /></button><button v-tooltip.detail="\'Go to Work\'">Valkama</button></div>',
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

/** A box that holds more than it shows, as a browser would measure it. */
function overflowing(element: HTMLElement) {
  element.style.overflowX = 'hidden'
  Object.defineProperty(element, 'scrollWidth', { value: 200 })
  Object.defineProperty(element, 'clientWidth', { value: 1 })
}

describe('textIsClipped', () => {
  it('counts a label hidden for want of room, and not the copy kept for a screen reader', () => {
    document.body.innerHTML =
      '<button id="narrow">+<span class="label">Create</span></button><span id="short">MAIN-12<span class="visually-hidden">Waiting on MAIN-12</span></span>'
    const label = document.querySelector<HTMLElement>('.label')
    const copy = document.querySelector<HTMLElement>('.visually-hidden')
    if (!label || !copy) throw new Error('the boxes are missing')
    overflowing(label)
    overflowing(copy)
    expect(textIsClipped(document.querySelector<HTMLElement>('#narrow') as HTMLElement)).toBe(true)
    expect(textIsClipped(document.querySelector<HTMLElement>('#short') as HTMLElement)).toBe(false)
  })
})
