/**
 * A whole Markdown file read as a document.
 *
 * The line numbers below are counted by hand against the text beside them, so
 * they do not depend on the lexer they check. The slug samples are the package's
 * README: its `test/fixtures.json` is not in the published package.
 */
import { describe, expect, it } from 'vitest'

import { blockAtLine, parseRichDocument, parseRichText, plainText } from '@/shared/lib/richText.ts'
import type { RichDocument } from '@/shared/lib/richText.ts'

const read = (source: string, base = 'docs/plan.md') => parseRichDocument(source, { base })
const headings = (source: string) =>
  read(source).blocks.flatMap(({ block }) => (block.kind === 'heading' ? [block] : []))
const slugs = (...titles: string[]) =>
  headings(titles.map((title) => `# ${title}`).join('\n\n')).map((heading) => heading.slug)
const kinds = (document: RichDocument) => document.blocks.map(({ block }) => block.kind)
const spans = (document: RichDocument) =>
  document.blocks.map(({ firstLine, lastLine }) => [firstLine, lastLine])

describe('headings', () => {
  it('take a level, with the card’s title above the first one', () => {
    expect(
      headings('# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f').map((h) => h.level),
    ).toEqual([2, 3, 4, 5, 6, 6])
  })

  it('stay levelless in a card', () => {
    expect(parseRichText('# Big')).toEqual([
      { kind: 'heading', children: [{ kind: 'text', text: 'Big' }] },
    ])
  })

  it('take the slugs of the package’s README', () => {
    expect(slugs('foo', 'foo', 'bar', 'foo')).toEqual(['foo', 'foo-1', 'bar', 'foo-2'])
    expect(slugs('Привет non-latin 你好')).toEqual(['привет-non-latin-你好'])
    expect(slugs('😄 emoji')).toEqual(['-emoji'])
    expect(slugs('foo bar baz')).toEqual(['foo-bar-baz'])
  })

  it('keep latin and cyrillic words, and lose punctuation', () => {
    expect(slugs('Какие формы становятся ссылкой?')).toEqual(['какие-формы-становятся-ссылкой'])
    expect(slugs('U2: разбор, текст')).toEqual(['u2-разбор-текст'])
  })

  it('do not collide with a real heading that looks like a repeat', () => {
    expect(slugs('foo', 'foo-1', 'foo')).toEqual(['foo', 'foo-1', 'foo-2'])
    expect(slugs('foo', 'foo', 'foo-1')).toEqual(['foo', 'foo-1', 'foo-1-1'])
  })

  it('slug the words a reader sees, with no comment and no markup', () => {
    expect(slugs('Цель <!-- kb:v25d-goal -->')).toEqual(['цель'])
    expect(slugs('**Bold** and `code`')).toEqual(['bold-and-code'])
    expect(slugs('[A caption](docs/x.md) tail')).toEqual(['a-caption-tail'])
  })

  it('count a heading inside a quote, in the order they are read', () => {
    const { blocks } = read('# foo\n\n> # foo\n\n# foo')
    expect(blocks.map(({ anchors }) => anchors)).toEqual([['foo'], ['foo-1'], ['foo-2']])
  })

  it('share no counter between two documents', () => {
    expect(slugs('foo')).toEqual(['foo'])
    expect(slugs('foo')).toEqual(['foo'])
  })
})

describe('comments', () => {
  it('are never drawn, inline or as a block, and raw HTML still is', () => {
    const source = 'One <!-- note --> two\n\n<!-- alone -->\n\n<b>raw</b> text'
    const document = read(source)
    expect(plainText(source)).toContain('<!-- note -->')
    expect(JSON.stringify(document)).not.toContain('<!--')
    expect(JSON.stringify(document)).toContain('<b>')
  })

  it('make the block they stand in the anchor’s target', () => {
    const { blocks } = read('# Goal <!-- kb:goal -->\n\nText <!-- kb:in-text --> more\n')
    expect(blocks.map(({ anchors }) => anchors)).toEqual([['kb:goal', 'goal'], ['kb:in-text']])
  })

  it('hand their anchor to the next block when they stand alone', () => {
    const { blocks } = read('First\n\n<!-- kb:a -->\n\n<!-- kb:b -->\nSecond\n')
    expect(blocks.map(({ anchors }) => anchors)).toEqual([[], ['kb:a', 'kb:b']])
  })

  it('give the words after them on one line the anchor, and draw those words', () => {
    const { blocks } = read('<!-- kb:a --> trail\n')
    expect(blocks.map(({ anchors }) => anchors)).toEqual([['kb:a']])
    expect(blocks[0]?.block).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'trail' }],
    })
  })

  it('leave an anchor at the very end with the last block', () => {
    const { blocks } = read('Only\n\n<!-- kb:end -->\n')
    expect(blocks.map(({ anchors }) => anchors)).toEqual([['kb:end']])
  })

  it('take an anchor from a list or a table for the top block that holds it', () => {
    const { blocks } = read('- a <!-- kb:li -->\n- b\n\n| h |\n|---|\n| c <!-- kb:cell --> |\n')
    expect(blocks.map(({ anchors }) => anchors)).toEqual([['kb:li'], ['kb:cell']])
  })

  it('are no anchors in code, where they are what the code says', () => {
    const { blocks } = read('`<!-- kb:a -->`\n\n```\n<!-- kb:b -->\n```\n')
    expect(blocks.map(({ anchors }) => anchors)).toEqual([[], []])
    expect(JSON.stringify(blocks)).toContain('<!-- kb:a -->')
  })
})

describe('front matter', () => {
  const FACTS = ['status: proposed', 'card: 1379']

  it('is facts as written, and neither a rule nor a heading', () => {
    const document = read('---\nstatus: proposed\ncard: 1379\n---\n\n# Title\n')
    expect(document.facts).toEqual(FACTS)
    expect(kinds(document)).toEqual(['heading'])
  })

  it.each([
    ['a trailing space on the fence', '--- \nstatus: proposed\ncard: 1379\n---  \n\nText'],
    ['CRLF line ends', '---\r\nstatus: proposed\r\ncard: 1379\r\n---\r\n\r\nText'],
    ['bare CR line ends', '---\rstatus: proposed\rcard: 1379\r---\r\rText'],
  ])('opens with %s', (_name, source) => {
    const document = read(source)
    expect(document.facts).toEqual(FACTS)
    expect(kinds(document)).toEqual(['paragraph'])
  })

  it.each([
    ['indented', ' ---\nstatus: x\n---\n'],
    ['not on line 0', '\n---\nstatus: x\n---\n'],
    ['with no closing fence', '---\nstatus: x\n\nText\n'],
    ['closed only by dots', '---\nstatus: x\n...\n'],
    ['closed only by an indented fence', '---\nstatus: x\n ---\n'],
    ['opened by a longer rule', '----\nstatus: x\n---\n'],
  ])('is not recognised %s', (_name, source) => {
    expect(read(source).facts).toEqual([])
  })

  it('reads on past a line of dots to the real close', () => {
    expect(read('---\nstatus: x\n...\nmore: y\n---\nText').facts).toEqual([
      'status: x',
      '...',
      'more: y',
    ])
  })

  it('is empty facts, not Markdown, when it holds nothing', () => {
    const document = read('---\n---\nText')
    expect(document.facts).toEqual([])
    expect(kinds(document)).toEqual(['paragraph'])
  })
})

describe('line breaks', () => {
  const WRAPPED = 'One paragraph wrapped\nby width, as plans are.'

  it('are one paragraph with no break nodes in a document', () => {
    const [only] = read(WRAPPED).blocks
    expect(only?.block).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: WRAPPED }],
    })
  })

  it('stay break nodes in a card', () => {
    expect(JSON.stringify(parseRichText(WRAPPED))).toContain('"kind":"break"')
  })
})

describe('source lines', () => {
  // Each document's lines are numbered by hand in `PLAN`, `NOTES` and `README`.
  const PLAN = [
    /*  1 */ '---',
    /*  2 */ 'status: proposed',
    /*  3 */ 'date: 2026-11-03',
    /*  4 */ '---',
    /*  5 */ '',
    /*  6 */ '# Plan <!-- kb:plan -->',
    /*  7 */ '',
    /*  8 */ 'A paragraph',
    /*  9 */ 'wrapped by width.',
    /* 10 */ '',
    /* 11 */ '| a | b |',
    /* 12 */ '| --- | --- |',
    /* 13 */ '| 1 | 2 |',
    /* 14 */ '',
    /* 15 */ '- one',
    /* 16 */ '- two',
    /* 17 */ '  - nested',
    /* 18 */ '',
    /* 19 */ '```ts',
    /* 20 */ 'const a = 1',
    /* 21 */ '',
    /* 22 */ 'const b = 2',
    /* 23 */ '```',
    /* 24 */ '',
    /* 25 */ 'The end.',
    /* 26 */ '',
  ].join('\n')
  const PLAN_SPANS = [
    [6, 6],
    [8, 9],
    [11, 13],
    [15, 17],
    [19, 23],
    [25, 25],
  ]

  // No front matter, an anchor comment and a link definition that draw nothing,
  // and a setext heading and a quote that span lines.
  const NOTES = [
    /*  1 */ 'Title',
    /*  2 */ '=====',
    /*  3 */ '',
    /*  4 */ '<!-- kb:a -->',
    /*  5 */ '> quoted',
    /*  6 */ '> twice',
    /*  7 */ '',
    /*  8 */ '[ref]: docs/x.md',
    /*  9 */ '',
    /* 10 */ '***',
    /* 11 */ '',
    /* 12 */ 'After',
  ].join('\n')
  const NOTES_SPANS = [
    [1, 2],
    [5, 6],
    [10, 10],
    [12, 12],
  ]

  // A long table, code holding what looks like a fence, and text glued to a list.
  const README = [
    /*  1 */ '---',
    /*  2 */ 'card: 1',
    /*  3 */ '---',
    /*  4 */ '## Top',
    /*  5 */ 'Text',
    /*  6 */ '- item',
    /*  7 */ '',
    /*  8 */ '~~~',
    /*  9 */ '---',
    /* 10 */ '~~~',
    /* 11 */ '',
    /* 12 */ '',
    /* 13 */ '',
    /* 14 */ 'Last',
  ].join('\n')
  const README_SPANS = [
    [4, 4],
    [5, 5],
    [6, 6],
    [8, 10],
    [14, 14],
  ]

  describe.each([
    ['a plan', PLAN, PLAN_SPANS],
    ['a plan with CRLF', PLAN.replaceAll('\n', '\r\n'), PLAN_SPANS],
    ['notes', NOTES, NOTES_SPANS],
    ['notes with CRLF', NOTES.replaceAll('\n', '\r\n'), NOTES_SPANS],
    ['a readme', README, README_SPANS],
    ['a readme with bare CR', README.replaceAll('\n', '\r'), README_SPANS],
  ])('in %s', (_name, source, expected) => {
    const document = read(source)

    it('stand beside each top block', () => {
      expect(spans(document)).toEqual(expected)
    })

    it('find the block each of its lines lies in', () => {
      for (const [first = 0, last = 0] of expected) {
        for (let line = first; line <= last; line++) {
          expect(blockAtLine(document, line)?.firstLine).toBe(first)
        }
      }
    })
  })

  it('keep their place after a link definition the lexer drops for repeating an earlier one', () => {
    const document = read('[r]: a.md\n\nOne\n\n[r]: b.md\nTwo\n\n[r]: c.md\n\nThree')
    expect(spans(document)).toEqual([
      [3, 3],
      [6, 6],
      [10, 10],
    ])
  })

  it('find the next block from a blank line, the first from before it, the last from past it', () => {
    const document = read(PLAN)
    expect(blockAtLine(document, 7)?.firstLine).toBe(8)
    expect(blockAtLine(document, 2)?.firstLine).toBe(6)
    expect(blockAtLine(document, 9999)?.firstLine).toBe(25)
  })

  it('find nothing in a document with no blocks', () => {
    expect(blockAtLine(read(''), 1)).toBeNull()
  })
})

describe('links in a document', () => {
  it('are read from its folder, and in the text stay as they are written', () => {
    const document = parseRichDocument('[x](../y.md) and web/src/a.ts', { base: 'a/b/c.md' })
    expect(document.blocks[0]?.block).toMatchObject({
      children: [
        { kind: 'reference', reference: { value: '../y.md', linkFrom: 'a/b/c.md' } },
        { kind: 'text', text: ' and ' },
        { kind: 'reference', reference: { value: 'web/src/a.ts' } },
      ],
    })
    expect(JSON.stringify(document.blocks[0]?.block)).not.toContain('"linkFrom":""')
  })

  it('carry a safe address, and refuse any other, as in a card', () => {
    const { blocks } = read('[a](https://example.com) [b](javascript:alert(1))')
    expect(blocks[0]?.block).toEqual({
      kind: 'paragraph',
      children: [
        {
          kind: 'link',
          href: 'https://example.com/',
          children: [{ kind: 'text', text: 'a' }],
        },
        { kind: 'text', text: ' ' },
        { kind: 'text', text: 'b' },
      ],
    })
  })

  it('are a file when they are a picture, with the alt text as the caption', () => {
    const { blocks } = read('![схема](a.png)')
    expect(blocks[0]?.block).toMatchObject({
      children: [{ kind: 'reference', caption: [{ kind: 'text', text: 'схема' }] }],
    })
  })
})
