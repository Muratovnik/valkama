/**
 * A hint that says a cut name whole over its detail keeps a space between the two, in the hint
 * and in the copy assistive technology reads. The words stand on a line of their own, so the
 * space shows nothing; without it a ranked row's hint read «…part 132% of the total», its name
 * «part 1» glued to its share «32%». Uncut, the hint is the detail alone, with nothing before it.
 *
 * The hint is its own tooltip and holds its words once: a hidden copy of them for assistive
 * technology once stood beside the words it shows, so its text read every hint twice, the last
 * word run into the first. The name is described by the detail once, whether or not it shows.
 */
import { defineComponent, h, nextTick, withDirectives } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import TooltipHost from '@/shared/ui/TooltipHost.vue'

const NAME = 'Rework the import of very long planning documents, part 1'
const SHARE = '32% of the total'

/** A name with a detail to add, cut by its box or not, and the window's one hint host. */
const surface = defineComponent({
  props: { cut: { type: Boolean, required: true } },
  mounted() {
    // happy-dom lays nothing out, so the box says how much of its text it shows, and its text
    // is laid out as wide as all it holds (`laidOut`).
    const named = (this.$el as HTMLElement).querySelector<HTMLElement>('.named')
    if (!named) throw new Error('the name is not drawn')
    Object.defineProperty(named, 'clientWidth', { value: 120 })
    Object.defineProperty(named, 'scrollWidth', { value: this.cut ? 480 : 120 })
    named.getBoundingClientRect = () => line(120)
  },
  render() {
    return h('main', [
      withDirectives(
        h('span', { class: 'named', tabindex: 0, style: 'overflow-x: hidden' }, NAME),
        [[vTooltip, { text: SHARE, words: NAME }, undefined, { detail: true }]],
      ),
      h(TooltipHost),
    ])
  },
})

/**
 * The hint a key's focus on the name holds up: what it says, what the words line says, every
 * tooltip the page holds, and what the name is described by.
 */
async function hintOf(cut: boolean) {
  const wrapper = mount(surface, { props: { cut }, attachTo: document.body })
  const named = wrapper.get<HTMLElement>('.named').element
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  named.focus()
  await flushPromises()
  await nextTick()
  const hint = document.querySelector('.tooltip-hint')
  const ids = (named.getAttribute('aria-describedby') ?? '').split(/ +/u).filter(Boolean)
  return {
    wrapper,
    hint,
    says: hint?.textContent ?? null,
    words: hint?.querySelector('.tooltip-words')?.textContent ?? null,
    tooltips: [...document.querySelectorAll('[role="tooltip"]')],
    described: ids
      .map((id) => document.querySelector(`#${CSS.escape(id)}`)?.textContent ?? '')
      .join(' '),
  }
}

/** A line's box from the left edge, `width` wide. */
const line = (width: number) =>
  ({ left: 0, right: width, top: 0, bottom: 16, width, height: 16, x: 0, y: 0 }) as DOMRect

let mounted: { unmount: () => void } | null = null

// The hint asks whether the name's text stands past its box, which is where a cut hides it.
beforeEach(() => {
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function laidOut(this: Range) {
    const box = this.startContainer.parentElement?.closest<HTMLElement>('.named')
    return [line(box?.scrollWidth ?? 0)] as unknown as DOMRectList
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('a hint that says a cut name over its detail', () => {
  it('keeps a space between the name and the share, in the hint and in what is read', async () => {
    const { wrapper, hint, says, words, tooltips } = await hintOf(true)
    mounted = wrapper
    expect(says).toBe(`${NAME} ${SHARE}`)
    // The hint is the one tooltip, and what it reads is what it shows.
    expect(tooltips).toEqual([hint])
    // The words' own line holds the name and nothing else.
    expect(words).toBe(NAME)
  })

  it('holds its words once, and the name is described by the share once', async () => {
    const { wrapper, says, tooltips, described } = await hintOf(false)
    mounted = wrapper
    expect(says).toBe(SHARE)
    expect(tooltips).toHaveLength(1)
    expect(tooltips[0]?.textContent).toBe(SHARE)
    expect(described).toBe(SHARE)
  })

  it('is the share alone while the name stands whole', async () => {
    const { wrapper, says, words } = await hintOf(false)
    mounted = wrapper
    expect(says).toBe(SHARE)
    expect(words).toBeNull()
  })
})
