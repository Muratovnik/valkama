import fs from 'node:fs'
import path from 'node:path'

import { h } from 'vue'
import type { Component } from 'vue'

/**
 * A session's sign: the glyph of its state, one size and one stroke for every sign, hidden
 * from assistive technology, turning only while motion is allowed and drawn in its host's
 * ink in a forced palette.
 */
import { CircleCheck, CircleDashed, CirclePause, CircleQuestionMark } from '@lucide/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { LiveSign } from '@/shared/lib/liveSign.ts'
import SessionSign from '@/shared/ui/SessionSign.vue'

/** The strokes a glyph draws, which tell one sign's shape from another's, without style scopes. */
const strokes = (html: string) => html.replaceAll(/^<svg[^>]*>|<\/svg>$|\sdata-v-[\da-f]+=""/gu, '')

const drawnBy = (icon: Component) =>
  strokes(mount({ render: () => h(icon, { 'size': 14, 'stroke-width': 2 }) }).html())

const SIGNS: readonly LiveSign[] = ['working', 'asks', 'waiting', 'held', 'quiet']

/**
 * The radii of the ring a sign draws about the centre of its 24-unit square: a circle there, or
 * an arc whose start lies as far from the centre as its radius, which is an arc of that ring. The
 * strokes inside the ring, a question's hook among them, are neither.
 */
function ringRadii(svg: Element): number[] {
  const circles = [...svg.querySelectorAll('circle')]
    .filter((circle) => circle.getAttribute('cx') === '12' && circle.getAttribute('cy') === '12')
    .map((circle) => Number(circle.getAttribute('r')))
  const arcs = [...svg.querySelectorAll('path')].flatMap((path) => {
    const start = /^M([\d.]+)[ ,]([\d.]+)a([\d.]+)[ ,]([\d.]+)[ ,]/u.exec(
      path.getAttribute('d') ?? '',
    )
    if (!start) return []
    const [x, y, rx, ry] = start.slice(1).map(Number)
    const onRing = rx === ry && Math.abs(Math.hypot(x - 12, y - 12) - rx) < 0.01
    return onRing ? [rx] : []
  })
  return [...circles, ...arcs]
}

describe('a session’s sign', () => {
  it('draws every sign on one ring, of radius 10, the working arc included', () => {
    const rings = SIGNS.map((sign) =>
      ringRadii(mount(SessionSign, { props: { sign } }).get('svg').element),
    )
    for (const radii of rings) expect(radii.length).toBeGreaterThan(0)
    expect(rings.map((radii) => [...new Set(radii)])).toEqual(SIGNS.map(() => [10]))
  })

  it('draws the working sign as one open arc, so its turning shows', () => {
    const svg = mount(SessionSign, { props: { sign: 'working' } }).get('svg').element
    expect([svg.querySelectorAll('circle').length, svg.querySelectorAll('path').length]).toEqual([
      0, 1,
    ])
  })

  it.each<[LiveSign, Component]>([
    ['asks', CircleQuestionMark],
    ['waiting', CircleCheck],
    ['held', CirclePause],
    ['quiet', CircleDashed],
  ])('draws %s with its own glyph', (sign, icon) => {
    const svg = mount(SessionSign, { props: { sign } }).get('svg')
    expect(strokes(svg.html())).toBe(drawnBy(icon))
    expect(svg.classes()).toEqual(expect.arrayContaining(['session-sign', `session-sign-${sign}`]))
  })

  it('draws five different shapes', () => {
    const shapes = SIGNS.map((sign) => strokes(mount(SessionSign, { props: { sign } }).html()))
    expect(new Set(shapes).size).toBe(5)
  })

  it('takes its meaning colour from the interface’s one map of states to tones', () => {
    const tones = (['working', 'asks', 'waiting', 'held', 'quiet'] as const).map((sign) =>
      mount(SessionSign, { props: { sign } }).get('svg').attributes('data-tone'),
    )
    expect(tones).toEqual(['info', 'warning', 'neutral', 'neutral', 'neutral'])
  })

  it('is one size and one stroke for every sign, and hidden from assistive technology', () => {
    for (const sign of ['working', 'asks', 'waiting', 'held', 'quiet'] as const) {
      const svg = mount(SessionSign, { props: { sign } }).get('svg')
      expect([svg.attributes('width'), svg.attributes('height')]).toEqual(['14', '14'])
      expect(svg.attributes('viewBox')).toBe('0 0 24 24')
      expect(svg.attributes('stroke-width')).toBe('2')
      expect(svg.attributes('aria-hidden')).toBe('true')
    }
    const large = mount(SessionSign, { props: { sign: 'asks', size: 20 } }).get('svg')
    expect([large.attributes('width'), large.attributes('height')]).toEqual(['20', '20'])
    expect(large.attributes('stroke-width')).toBe('2')
  })

  /*
   * The component suite draws no style, so the motion and palette rules are read from the
   * component's own block: the turning sign stops where the reader asked for less motion,
   * and a forced palette gives every sign its host's ink. A browser spec watches both run
   * (`production-live-work-layout.spec.ts`).
   */
  const style = (() => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/shared/ui/SessionSign.vue'),
      'utf8',
    )
    return source.slice(source.indexOf('<style scoped>')).replaceAll(/\s+/gu, ' ')
  })()

  it('turns only the working sign, and not where the reader asked for less motion', () => {
    const animated = [...style.matchAll(/\.session-sign-(\w+) \{[^}]*animation: session-sign/gu)]
    expect(animated.map(([, sign]) => sign)).toEqual(['working'])
    expect(style).toMatch(
      /\.session-sign-working \{[^}]*@media \(prefers-reduced-motion: reduce\) \{ animation: none; \}/u,
    )
  })

  it('holds still where its host stops motion: a paused graph, a key’s sample', () => {
    expect(mount(SessionSign, { props: { sign: 'working' } }).classes()).not.toContain('still')
    expect(mount(SessionSign, { props: { sign: 'working', still: true } }).classes()).toContain(
      'still',
    )
    expect(style).toMatch(
      /\.session-sign-working \{(?:[^{}]|\{[^{}]*\})*&\.still \{ animation: none; \}/u,
    )
  })

  it('takes its host’s ink in a forced palette', () => {
    expect(style).toMatch(
      /@media \(forced-colors: active\) \{ \.session-sign, \.session-sign\[data-tone\] \{ color: inherit; \} \}/u,
    )
  })
})
