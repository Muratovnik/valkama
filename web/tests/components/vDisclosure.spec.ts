/**
 * The product's disclosure: one button that says whether it is open and names what it opens,
 * a body that stays in the document while closed so the browser's find can still reach it,
 * and a host that can hold it open or put its words in a heading.
 */
import { h } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import VDisclosure from '@/shared/ui/VDisclosure.vue'

function disclosure(props: Record<string, unknown> = {}) {
  return mount(VDisclosure, {
    props,
    slots: { summary: () => 'Technical details', default: () => h('p', 'code 42') },
    attachTo: document.body,
  })
}

describe('a disclosure', () => {
  it('opens and closes from its one button, which names the body it opens', async () => {
    const wrapper = disclosure()
    const toggle = wrapper.get('button')
    const body = wrapper.get('.disclosure-body')
    expect(toggle.text()).toBe('Technical details')
    expect(toggle.attributes('type')).toBe('button')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe(body.attributes('id'))
    // Closed, the words stay in the document; that the browser's find reaches them, `hidden`
    // being `until-found`, is a browser's to say, and the Settings spec reads it there.
    expect(body.attributes('hidden')).toBeDefined()
    expect(body.text()).toBe('code 42')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(body.attributes('hidden')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toEqual([[true]])

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(body.attributes('hidden')).toBeDefined()
    wrapper.unmount()
  })

  it('draws the product chevron, turned down while open, beside the words', async () => {
    const wrapper = disclosure()
    const glyph = () => wrapper.get('button svg').classes().join(' ')
    expect(glyph()).toContain('disclosure-closed')
    await wrapper.get('button').trigger('click')
    expect(glyph()).toContain('disclosure-open')
    wrapper.unmount()
  })

  it('holds what its host says is open', () => {
    const wrapper = disclosure({ open: true })
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.disclosure-body').attributes('hidden')).toBeUndefined()
    wrapper.unmount()
  })

  it('puts its button inside a heading of the rank it is given', () => {
    const wrapper = disclosure({ heading: 'h3' })
    expect(wrapper.get('h3').element.contains(wrapper.get('button').element)).toBe(true)
    expect(disclosure().find('h3').exists()).toBe(false)
    wrapper.unmount()
  })
})
