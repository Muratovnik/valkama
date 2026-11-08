import fs from 'node:fs'
import path from 'node:path'

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

/** The sources, from `web/`, where the suite runs: this environment's own URL is not a file. */
const SRC = path.resolve(process.cwd(), 'src')

/** Every icon name a `VIcon` in the sources spells out, with the files that spell it. */
function writtenNames(): Map<string, string[]> {
  const names = new Map<string, string[]>()
  for (const file of fs.readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.vue')) continue
    const text = fs.readFileSync(path.join(SRC, file), 'utf8')
    for (const [element] of text.matchAll(/<VIcon\b[^>]*>/gu))
      for (const [, name] of element.matchAll(/(?<![\w:-])name="([a-z][\da-z-]*)"/gu))
        names.set(name, [...(names.get(name) ?? []), file])
  }
  return names
}

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

  // An unknown key draws the generic glyph on purpose, for a module's manifest; a name
  // written in the sources is not one, and the generic glyph there is a lost icon. The
  // registry once dropped `external-link` while a button still named it.
  it('draws every name the sources write with a glyph of its own', () => {
    const generic = html(() => iconGlyph('no-such-icon'))
    const names = writtenNames()
    expect(names.size).toBeGreaterThan(10)
    const lost = [...names].filter(([name]) => html(() => iconGlyph(name)) === generic)
    expect(lost).toEqual([])
  })

  // A client's mark is its vendor's filled shapes among outlines: they take the glyph's colour
  // and nothing of the vendor's, and stand in the field a Lucide outline keeps clear.
  it.each([
    ['cursor', 1, 'translate(2 2) scale(0.8333)'],
    ['vscode', 1, 'translate(2 2) scale(0.2)'],
    ['codex', 3, 'scale(1.2)'],
  ])('draws the %s mark in the glyph colour, placed in the outlines field', (name, count, fit) => {
    const svg = mount({ render: () => iconGlyph(name, { size: 24 }) }).get('svg')
    const shapes = svg.findAll('*')
    expect(shapes).toHaveLength(count)
    for (const shape of shapes) {
      expect(shape.element.tagName).toBe('path')
      expect(shape.attributes('d')).toMatch(/^M-?[.\d]+.{40,}$/su)
      expect(shape.attributes('fill')).toBe('currentColor')
      expect(shape.attributes('stroke')).toBe('none')
      expect(shape.attributes('transform')).toBe(fit)
    }
    expect(svg.html()).not.toMatch(/#[\da-f]{3,6}\b|rgb\(|url\(|<mask|<filter|gradient/iu)
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
