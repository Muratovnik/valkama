/**
 * A hint that says a cut name whole over its detail keeps a space between the two, in the hint
 * and in the copy assistive technology reads. The words stand on a line of their own, so the
 * space shows nothing; without it a ranked row's hint read «…part 132% of the total», its name
 * «part 1» glued to its share «32%». Uncut, the hint is the detail alone, with nothing before it.
 */
import { defineComponent, h, nextTick, withDirectives } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import TooltipHost from '@/shared/ui/TooltipHost.vue'

const NAME = 'Rework the import of very long planning documents, part 1'
const SHARE = '32% of the total'

/** A name with a detail to add, cut by its box or not, and the window's one hint host. */
const surface = defineComponent({
  props: { cut: { type: Boolean, required: true } },
  mounted() {
    // happy-dom lays nothing out, so the box says how much of its text it shows.
    const named = (this.$el as HTMLElement).querySelector('.named')
    if (!named) throw new Error('the name is not drawn')
    Object.defineProperty(named, 'clientWidth', { value: 120 })
    Object.defineProperty(named, 'scrollWidth', { value: this.cut ? 480 : 120 })
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

/** The hint a key's focus on the name holds up: what it says, and what the words line says. */
async function hintOf(cut: boolean) {
  const wrapper = mount(surface, { props: { cut }, attachTo: document.body })
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  wrapper.get<HTMLElement>('.named').element.focus()
  await flushPromises()
  await nextTick()
  const hint = document.querySelector('.tooltip-hint')
  // The hint holds the library's hidden copy for assistive technology; what it shows is the rest.
  const shown = hint?.cloneNode(true) as HTMLElement | undefined
  shown?.querySelector('[role="tooltip"]')?.remove()
  return {
    wrapper,
    says: shown?.textContent ?? null,
    words: hint?.querySelector('.tooltip-words')?.textContent ?? null,
    read: document.querySelector('[role="tooltip"]')?.textContent ?? null,
  }
}

let mounted: { unmount: () => void } | null = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('a hint that says a cut name over its detail', () => {
  it('keeps a space between the name and the share, in the hint and in what is read', async () => {
    const { wrapper, says, words, read } = await hintOf(true)
    mounted = wrapper
    expect(says).toBe(`${NAME} ${SHARE}`)
    expect(read).toBe(`${NAME} ${SHARE}`)
    // The words' own line holds the name and nothing else.
    expect(words).toBe(NAME)
  })

  it('is the share alone while the name stands whole', async () => {
    const { wrapper, says, words } = await hintOf(false)
    mounted = wrapper
    expect(says).toBe(SHARE)
    expect(words).toBeNull()
  })
})
