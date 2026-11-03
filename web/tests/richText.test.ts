/**
 * Free text read as markdown into a tree that carries no markup.
 *
 * The oracle is the owner's decision for agent-written text: paragraphs, lists,
 * code, links, emphasis, quotes and tables render; raw HTML never does; a link
 * keeps only an http, https or mailto address; and the identifiers agents write
 * are cut out as candidates for the renderer to resolve.
 */
import { describe, expect, it } from 'vitest'

import { parseRichInline, parseRichText, plainText, safeHref } from '@/shared/lib/richText.ts'

/** Any node of the tree, as far as its words are concerned. */
interface Node {
  kind: string
  caption?: readonly Node[]
  children?: readonly Node[]
  reference?: { value: string }
  text?: string
}

/** The words a tree says, ignoring structure, for asserting nothing was lost. */
function words(nodes: readonly Node[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'break') return '\n'
      if (node.caption) return words(node.caption)
      return node.text ?? node.reference?.value ?? (node.children ? words(node.children) : '')
    })
    .join('')
}

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1)
  return list[0] as T
}

describe('markdown constructs', () => {
  it('keeps a single line break as a break, so one fact per line stays one per line', () => {
    const paragraph = only(parseRichText('Verified: unit tests\nNot verified: browser'))
    expect(paragraph.kind).toBe('paragraph')
    expect(paragraph.kind === 'paragraph' && paragraph.children).toEqual([
      { kind: 'text', text: 'Verified: unit tests' },
      { kind: 'break' },
      { kind: 'text', text: 'Not verified: browser' },
    ])
  })

  it('reads paragraphs, emphasis, strong, strikethrough and inline code', () => {
    const [first, second] = parseRichText('One *two* **three** ~~four~~ `five`\n\nSix')
    expect(first).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'text', text: 'One ' },
        { kind: 'em', children: [{ kind: 'text', text: 'two' }] },
        { kind: 'text', text: ' ' },
        { kind: 'strong', children: [{ kind: 'text', text: 'three' }] },
        { kind: 'text', text: ' ' },
        { kind: 'del', children: [{ kind: 'text', text: 'four' }] },
        { kind: 'text', text: ' ' },
        { kind: 'code', text: 'five' },
      ],
    })
    expect(second).toEqual({ kind: 'paragraph', children: [{ kind: 'text', text: 'Six' }] })
  })

  it('reads ordered, unordered and task lists, with where an ordered list starts', () => {
    const [bullets, numbers, tasks] = parseRichText(
      '- a\n- b\n\n3. c\n4. d\n\n* [x] done\n* [ ] open',
    )
    expect(bullets).toMatchObject({ kind: 'list', ordered: false, start: 1 })
    expect(numbers).toMatchObject({ kind: 'list', ordered: true, start: 3 })
    expect(tasks?.kind === 'list' && tasks.items.map((item) => item.checked)).toEqual([true, false])
    expect(tasks?.kind === 'list' && words(tasks.items[0]?.children ?? [])).toBe('done')
  })

  it('reads a fenced code block as written, markup included', () => {
    expect(parseRichText('```html\n<b>bold</b>\n  indented\n```')).toEqual([
      { kind: 'code', text: '<b>bold</b>\n  indented' },
    ])
  })

  it('reads quotes, rules and tables with their column alignment', () => {
    const [quote, rule, table] = parseRichText(
      '> quoted *text*\n\n---\n\n| a | b |\n|:-:|--:|\n| 1 | `2` |',
    )
    expect(quote).toMatchObject({ kind: 'quote', children: [{ kind: 'paragraph' }] })
    expect(rule).toEqual({ kind: 'rule' })
    expect(table).toEqual({
      kind: 'table',
      align: ['center', 'right'],
      header: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
      rows: [[[{ kind: 'text', text: '1' }], [{ kind: 'code', text: '2' }]]],
    })
  })

  it('keeps a heading as emphasised text with no level, under the section that owns the outline', () => {
    expect(parseRichText('# Big\n###### Small')).toEqual([
      { kind: 'heading', children: [{ kind: 'text', text: 'Big' }] },
      { kind: 'heading', children: [{ kind: 'text', text: 'Small' }] },
    ])
  })

  it('reads an inline text without making blocks of it', () => {
    expect(parseRichInline('**a** `b`')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'a' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'b' },
    ])
  })
})

describe('the trust boundary', () => {
  it('shows raw HTML as the text it was written as, inline and as a block', () => {
    const inline = only(parseRichText('a <b onclick="x()">bold</b> <img src=x onerror=alert(1)>'))
    expect(words([inline])).toBe('a <b onclick="x()">bold</b> <img src=x onerror=alert(1)>')
    expect(JSON.stringify(inline)).not.toContain('"kind":"html"')
    const block = parseRichText('<div>\n<script>alert(1)</script>\n</div>')
    expect(block.every((node) => node.kind === 'paragraph')).toBe(true)
    expect(words(block)).toBe('<div>\n<script>alert(1)</script>\n</div>')
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///C:/secret.txt',
    '/relative/path',
    '#anchor',
  ])('keeps no address for %s and shows the link text', (href) => {
    expect(safeHref(href)).toBeNull()
    const paragraph = only(parseRichText(`[click here](<${href}>)`))
    expect(JSON.stringify(paragraph)).not.toContain('"kind":"link"')
    expect(words([paragraph])).toBe('click here')
  })

  it('keeps http, https and mailto addresses, bare or written as links', () => {
    const paragraph = only(
      parseRichText('[docs](https://example.org/a?b=1) see https://example.org/x. <mailto:a@b.c>'),
    )
    const links = paragraph.kind === 'paragraph' ? paragraph.children : []
    expect(links.filter((node) => node.kind === 'link').map((node) => node.href)).toEqual([
      'https://example.org/a?b=1',
      'https://example.org/x',
      'mailto:a@b.c',
    ])
  })

  it('turns an image into a link to it, never a picture, and an unsafe one into its alt text', () => {
    expect(only(parseRichText('![chart](https://example.org/c.png)'))).toEqual({
      kind: 'paragraph',
      children: [
        {
          kind: 'link',
          href: 'https://example.org/c.png',
          children: [{ kind: 'text', text: 'chart' }],
        },
      ],
    })
    expect(only(parseRichText('![chart](javascript:alert(1))'))).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'chart' }],
    })
  })
})

describe('references in the text', () => {
  it('cuts out item references, commits, sessions and memory ids as candidates', () => {
    const paragraph = only(
      parseRichText(
        'MAIN-12 at a1b2c3d in session 0f8fad5b-d9cb-469f-a165-70867728950e, see mem_mu8ktwyp_62ab5a6fe0cc',
      ),
    )
    const found = paragraph.kind === 'paragraph' ? paragraph.children : []
    expect(found.filter((node) => node.kind === 'reference')).toEqual([
      { kind: 'reference', code: false, reference: { kind: 'work-item', value: 'MAIN-12' } },
      { kind: 'reference', code: false, reference: { kind: 'commit', value: 'a1b2c3d' } },
      {
        kind: 'reference',
        code: false,
        reference: { kind: 'session', value: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      },
      {
        kind: 'reference',
        code: false,
        reference: { kind: 'memory', value: 'mem_mu8ktwyp_62ab5a6fe0cc' },
      },
    ])
  })

  it('treats a code span holding one id as that id, and any other code as code', () => {
    const paragraph = only(parseRichText('`a1b2c3d` and `git show a1b2c3d`'))
    const nodes = paragraph.kind === 'paragraph' ? paragraph.children : []
    expect(nodes[0]).toEqual({
      kind: 'reference',
      code: true,
      reference: { kind: 'commit', value: 'a1b2c3d' },
    })
    expect(nodes[2]).toEqual({ kind: 'code', text: 'git show a1b2c3d' })
  })

  it('does not look for references inside a link or a code block', () => {
    const [link, code] = parseRichText('[MAIN-12 notes](https://example.org)\n\n```\nMAIN-12\n```')
    expect(JSON.stringify([link, code])).not.toContain('"kind":"reference"')
  })
})

describe('plain text', () => {
  it('says a step’s words without its markup, so an accessible name reads as the step', () => {
    expect(plainText('Wait for MAIN-265, then run `npm test`')).toBe(
      'Wait for MAIN-265, then run npm test',
    )
    expect(plainText('**Check** the [notes](https://example.org/notes)')).toBe('Check the notes')
  })

  it('drops the address of an unsafe link and keeps its words', () => {
    expect(plainText('[bad](javascript:alert(1))')).toBe('bad')
  })

  it('reads a heading, a list and a table as their words, one after another', () => {
    expect(plainText('# Title\n- one\n- two')).toBe('Title one two')
    expect(plainText('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a b 1 2')
  })

  it('reads a line break as a space and raw HTML as the text it was written as', () => {
    expect(plainText('one\ntwo')).toBe('one two')
    expect(plainText('<b>raw</b> text')).toBe('<b>raw</b> text')
  })
})
