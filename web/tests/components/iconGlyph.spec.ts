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

  it('keeps the host class and the defaults of the component that wraps it', () => {
    const svg = mount(VIcon, { props: { name: 'kind-bug' }, attrs: { class: 'note-icon' } }).get(
      'svg',
    )
    expect(svg.classes()).toContain('note-icon')
    expect(svg.attributes('width')).toBe('20')
    expect(svg.attributes('stroke-width')).toBe('1.8')
  })
})
