/**
 * Every character the chain section prints is one the interface font carries.
 *
 * The font is loaded by unicode range, so a character outside every range the
 * stylesheet declares is drawn by the next family in the stack — a 193 kB file
 * fetched for one glyph, and then not even that family's — or by whatever the
 * system has. A check mark in the lane counts did exactly that. The ranges are
 * read from the stylesheet the app imports, so a font update moves the oracle
 * with it.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { dayFormat } from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import { messages } from '@/shared/i18n/index.ts'

const FONT_CSS = new URL('../node_modules/@fontsource-variable/inter/index.css', import.meta.url)
const SECTION = new URL('../src/widgets/work-item-inspector/components/', import.meta.url)
const COMPONENTS = [
  'InspectorChain.vue',
  'ChainBranchMap.vue',
  'ChainBranchTip.vue',
  'ChainMembers.vue',
  'ChainScopeChart.vue',
]

/** Every `unicode-range` the stylesheet declares, as inclusive code point pairs. */
function loadedRanges(): [number, number][] {
  const css = fs.readFileSync(fileURLToPath(FONT_CSS), 'utf8')
  return [...css.matchAll(/unicode-range:\s*([^;]+);/gu)].flatMap(([, list]) =>
    list.split(',').map((entry) => {
      const [from, to = from] = entry.trim().replace(/^U\+/iu, '').split('-')
      return [Number.parseInt(from, 16), Number.parseInt(to, 16)] as [number, number]
    }),
  )
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return value && typeof value === 'object'
    ? Object.values(value).flatMap((child) => strings(child))
    : []
}

/** What the section's own templates write, outside any message. */
function templates(): string[] {
  return COMPONENTS.map((name) => {
    const source = fs.readFileSync(fileURLToPath(new URL(name, SECTION)), 'utf8')
    return /<template>([\s\S]*)<\/template>/u.exec(source)?.[1] ?? ''
  })
}

const november = (day: number) => new Date(Date.UTC(2026, 10, day))

describe('the chain section’s characters', () => {
  const ranges = loadedRanges()
  const carried = (character: string) => {
    const point = character.codePointAt(0) ?? 0
    return point < 0x20 || ranges.some(([from, to]) => point >= from && point <= to)
  }

  it('reads the ranges the interface font is loaded in', () => {
    // A stylesheet that stopped matching would pass every character below.
    expect(ranges.length).toBeGreaterThan(5)
    expect(carried('✓')).toBe(false)
    expect(carried('≈')).toBe(false)
    expect(carried('ж')).toBe(true)
  })

  it('stay inside them, in both languages, in the templates and in the dates it formats', () => {
    const texts = [
      ...strings(messages.en.workItem.chain),
      ...strings(messages.ru.workItem.chain),
      ...templates(),
      ...['en', 'ru'].flatMap((locale) => [
        dayFormat(locale).format(november(9)),
        dayFormat(locale).formatRange(november(6), november(26)),
        dayFormat(locale).formatRange(november(26), new Date(Date.UTC(2026, 11, 3))),
      ]),
    ]
    const outside = new Set(texts.flatMap((text) => [...text].filter((ch) => !carried(ch))))
    expect([...outside]).toEqual([])
  })
})
