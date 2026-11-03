/**
 * What must hold for every text, which is where a trust boundary fails.
 *
 * `readBeforePaths` is the reader as it stood before paths became candidates,
 * kept as the oracle for the promise that a text holding none reads as it did.
 */
import { fc, test } from '@fast-check/vitest'
import { Lexer } from 'marked'
import { expect } from 'vitest'

// Fixed, for the reason `contractProperties.test.ts` gives.
fc.configureGlobal({ seed: 0x70_61_74_68 })

import { parseRichDocument, parseRichInline, parseRichText } from '@/shared/lib/richText.ts'
import { documentParts, splitReferences } from '@/shared/lib/textReferences.ts'
import type { TextReference } from '@/shared/lib/textReferences.ts'

import { readBeforePaths } from './fixtures/readBeforePaths.ts'

/** Every value in a tree, however deep. */
function* walk(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) yield* walk(item)
  else if (value && typeof value === 'object') {
    yield value as Record<string, unknown>
    for (const child of Object.values(value)) yield* walk(child)
  }
}

const HOSTILE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  ' javascript:alert(1)',
  'vbscript:x',
  'data:text/html,<b>x</b>',
  'file:///C:/a.md',
  'vscode://file/a.md',
  '//example.com/a.md',
  String.raw`\\server\share\x`,
  'x.md:42',
  'docs/x.md#kb:a',
  '../../x.md',
  'C:/work/x.md',
  '~/x.md',
  '%6Aavascript:alert(1)',
  '#kb:a',
  'https://example.com/a.md',
  'mailto:a@example.com',
]

const fragment = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.constantFrom(...HOSTILE),
  fc.constantFrom(...HOSTILE).map((href) => `[link](${href})`),
  fc.constantFrom(...HOSTILE).map((href) => `[link](<${href}>)`),
  fc.constantFrom(...HOSTILE).map((href) => `![pic](${href})`),
  fc.constantFrom(...HOSTILE).map((href) => `<${href}>`),
  fc.constantFrom(...HOSTILE).map((href) => `[ref]\n\n[ref]: ${href}\n`),
  fc.constantFrom('\n', '\n\n', ' ', '**', '*', '`', '> ', '- ', '# ', '| a |\n|---|\n'),
  fc.constantFrom('<!-- kb:a -->', '---\n', '```\n', 'docs/x.md', 'MAIN-12', 'a1b2c3d'),
)
const anyText = fc.array(fragment, { maxLength: 8 }).map((parts) => parts.join(''))

const SAFE = new Set(['http:', 'https:', 'mailto:'])

function hrefs(tree: unknown): unknown[] {
  return [...walk(tree)].flatMap((node) => ('href' in node ? [node.href] : []))
}

test.prop([anyText])('no text gives an address but http, https or mailto', (text) => {
  const trees = [
    parseRichText(text),
    parseRichInline(text),
    parseRichDocument(text, { base: 'a/b/c.md' }),
  ]
  for (const tree of trees) {
    for (const href of hrefs(tree)) {
      expect(typeof href).toBe('string')
      expect(SAFE).toContain(new URL(href as string).protocol)
    }
  }
})

test.prop([anyText])('a document candidate carries no address to follow', (text) => {
  for (const node of walk(parseRichText(text))) {
    if (node.kind === 'document') {
      expect(Object.keys(node).toSorted((a, b) => a.localeCompare(b))).toEqual(
        expect.arrayContaining(['kind', 'strength', 'value']),
      )
      expect(node).not.toHaveProperty('href')
      const parts = documentParts(node as unknown as Extract<TextReference, { kind: 'document' }>)
      if (node.strength === 'copy-only') expect(parts.paths).toEqual([])
      if (node.strength === 'weak') expect(parts.copy).toBeNull()
    }
  }
})

test.prop([fc.string({ unit: 'grapheme' }), anyText])(
  'cutting a text out loses no character of it',
  (words, text) => {
    for (const whole of [words, text]) {
      const written = splitReferences(whole).map((run) =>
        typeof run === 'string' ? run : run.value,
      )
      expect(written.join('')).toBe(whole)
    }
  },
)

/** A text with no separator or home, where no path and no link to one can stand. */
const pathFreeWords = fc.string({ maxLength: 30 }).map((text) => text.replaceAll(/[/\\~[]/gu, ''))
const pathFreeFragment = fc.oneof(
  pathFreeWords,
  fc.constantFrom(
    '**bold**',
    '*em*',
    '~~gone~~',
    '`code`',
    '`MAIN-12`',
    'MAIN-12',
    'SHA-256',
    'a1b2c3d',
    '0f8fad5b-d9cb-469f-a165-70867728950e',
    'lsn_b66e8d69141aa297',
    '[safe](https://example.org)',
    '[bad](javascript:alert(1))',
    '[bad](data:text/html,x)',
    '![pic](https://example.org)',
    '<b>raw</b>',
    '<!-- note -->',
    String.raw`\*not em\*`,
    String.raw`a \_ b`,
    'one\ntwo',
    '\n\n',
    '\n> quoted\n\n',
    '\n- item\n- [x] done\n\n',
    '\n1. first\n\n',
    '\n# heading\n\n',
    '\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n',
    '\n```\ncode\n```\n\n',
    '\n---\n\n',
    '\n<div>block</div>\n\n',
  ),
)
const pathFreeText = fc.array(pathFreeFragment, { maxLength: 8 }).map((parts) => parts.join(''))

test.prop([pathFreeText])('a text with no paths reads into the tree it always did', (text) => {
  expect(parseRichText(text)).toEqual(readBeforePaths(text))
})

test.prop([fc.oneof(anyText, pathFreeText).map((text) => text.replaceAll(']:', '] :'))])(
  'with no link definition to repeat, the top tokens’ raw text is the normalised source',
  (text) => {
    const normalised = text.replaceAll(/\r\n|\r/gu, '\n')
    const tokens = Lexer.lex(text, { gfm: true, breaks: false })
    expect(tokens.map((token) => token.raw).join('')).toBe(normalised)
  },
)

test.prop([anyText])('top blocks stand in source order, each on a line of its own text', (text) => {
  const lines = text.replaceAll(/\r\n|\r/gu, '\n').split('\n')
  let last = 0
  for (const { firstLine, lastLine } of parseRichDocument(text, { base: 'a.md' }).blocks) {
    expect(firstLine).toBeGreaterThan(last)
    expect(lastLine).toBeGreaterThanOrEqual(firstLine)
    expect(lines[firstLine - 1]?.trim()).not.toBe('')
    last = lastLine
  }
})
