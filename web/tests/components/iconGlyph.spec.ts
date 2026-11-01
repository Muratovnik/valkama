import { h } from 'vue'
import type { Component, VNode } from 'vue'

/**
 * A glyph drawn as a plain element is the element the icon's own component
 * draws: the same attributes and the same strokes, whatever the key, size and
 * stroke, so nothing about it can drift from the package it comes from.
 */
import { Bug, ChevronUp, CircleHelp, ListChecks, User } from '@lucide/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { iconGlyph } from '@/shared/ui/iconGlyph.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const html = (draw: () => VNode) => mount({ render: draw }).html()

describe('a glyph drawn as a plain element', () => {
  it.each<[string, Component]>([
    ['kind-bug', Bug],
    ['priority-high', ChevronUp],
    ['steps', ListChecks],
    ['holder', User],
    ['no-such-icon', CircleHelp],
  ])('draws %s as its component does', (name, icon) => {
    expect(html(() => iconGlyph(name, { class: 'facet-glyph', size: 14, strokeWidth: 2 }))).toBe(
      html(() =>
        h(icon, { 'class': 'facet-glyph', 'size': 14, 'stroke-width': 2, 'aria-hidden': 'true' }),
      ),
    )
  })

  it('keeps the host class and the defaults of the component that wraps it', () => {
    const svg = mount(VIcon, { props: { name: 'kind-bug' }, attrs: { class: 'note-icon' } }).get(
      'svg',
    )
    expect(svg.classes()).toContain('note-icon')
    expect(svg.attributes('width')).toBe('20')
    expect(svg.attributes('stroke-width')).toBe('1.8')
  })
})
