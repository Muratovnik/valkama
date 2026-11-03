/**
 * What the sample table does not reach: the grammar of a suffix, the limit on a
 * candidate, what a path takes from the identifiers around it, and a link's
 * address read from the document it stands in.
 */
import { describe, expect, it } from 'vitest'

import { titleRuns } from '@/widgets/work-item-inspector/utils/titleRuns.ts'

import { parseRichText, plainText } from '@/shared/lib/richText.ts'
import {
  documentLink,
  documentParts,
  splitReferences,
  suffixTarget,
  wholeDocument,
} from '@/shared/lib/textReferences.ts'
import type { DocumentReference } from '@/shared/lib/textReferences.ts'

const documents = (text: string) =>
  splitReferences(text).filter(
    (run): run is DocumentReference => typeof run === 'object' && run.kind === 'document',
  )
const first = (text: string) => documents(text)[0] as DocumentReference
const kinds = (text: string) =>
  splitReferences(text).flatMap((run) => (typeof run === 'string' ? [] : [run.kind]))
const linkParts = (address: string, from?: string) => {
  const reference = documentLink(address, from)
  return reference && documentParts(reference)
}

describe('a path among identifiers', () => {
  it('takes what it covers, so no work item is found inside a path', () => {
    expect(kinds('docs/MAIN-12/notes.md and MAIN-13')).toEqual(['document', 'work-item'])
  })

  it('keeps every character of the text, in order', () => {
    const text = 'See (docs/x.md), `a`, C:/work/y.ts:42. Then MAIN-12/MAIN-13.'
    const written = splitReferences(text).map((run) => (typeof run === 'string' ? run : run.value))
    expect(written.join('')).toBe(text)
  })

  it('leaves a list of identifiers alone, however many it holds', () => {
    expect(kinds('MAIN-12/MAIN-13')).toEqual(['work-item', 'work-item'])
    expect(kinds('MAIN-12/MAIN-13/MAIN-14')).toEqual(['work-item', 'work-item', 'work-item'])
    expect(kinds('MAIN-12/notes/MAIN-14')).toEqual(['document'])
  })

  it('reads prose around a path as prose: an assignment, a closing word, a sentence', () => {
    expect(documents('path=docs/x.md').map((run) => run.value)).toEqual(['docs/x.md'])
    expect(documents('docs/a.md,docs/b.md').map((run) => run.value)).toEqual([
      'docs/a.md',
      'docs/b.md',
    ])
    expect(documents('see “docs/x.md” here').map((run) => run.value)).toEqual(['docs/x.md'])
    expect(documents('docs/x.md:abc').map((run) => run.value)).toEqual(['docs/x.md'])
  })

  it('leaves a card title’s path breakable, and keeps an identifier in it whole', () => {
    expect(titleRuns('Move docs/plans/long-name.md after MAIN-12')).toEqual([
      { text: 'Move docs/plans/long-name.md after ', whole: false },
      { text: 'MAIN-12', whole: true },
    ])
  })
})

describe('escapes in prose', () => {
  it('reads a path Markdown took for escapes as written, and the words around it as Markdown', () => {
    const [paragraph] = parseRichText(String.raw`\*not em\* at C:\work\.cache\x and \\s\s\.t`)
    expect(paragraph).toEqual({
      kind: 'paragraph',
      children: [
        { kind: 'text', text: '*not em* at ' },
        {
          kind: 'reference',
          code: false,
          reference: { kind: 'document', strength: 'strong', value: String.raw`C:\work\.cache\x` },
        },
        { kind: 'text', text: ' and ' },
        {
          kind: 'reference',
          code: false,
          reference: { kind: 'document', strength: 'copy-only', value: String.raw`\\s\s\.t` },
        },
      ],
    })
  })

  it.each([
    String.raw`\*bold\*`,
    String.raw`1\. item`,
    String.raw`e\.g\. this`,
    String.raw`a \_ b`,
  ])('leaves %s to Markdown', (text) => {
    expect(JSON.stringify(parseRichText(text))).not.toContain('"kind":"reference"')
  })

  it('reads a network path in a link as written, though the lexer halves its backslashes', () => {
    const [paragraph] = parseRichText(String.raw`[share](\\server\share\x)`)
    expect(paragraph).toMatchObject({
      children: [{ reference: { strength: 'copy-only', value: String.raw`\\server\share\x` } }],
    })
    expect(plainText(String.raw`[share](\\server\share\x "Title")`)).toBe('share')
  })
})

const path = (length: number) => `docs/${'a'.repeat(length - 'docs/.md'.length)}.md`

describe('the limit on a candidate', () => {
  it('takes 1024 characters and refuses 1025, in prose, in code and in a link', () => {
    expect(documents(path(1024)).map((run) => run.value)).toEqual([path(1024)])
    expect(documents(path(1025))).toEqual([])
    expect(wholeDocument(path(1024))?.value).toBe(path(1024))
    expect(wholeDocument(path(1025))).toBeNull()
    expect(documentLink(path(1024))?.value).toBe(path(1024))
    expect(documentLink(path(1025))).toBeNull()
  })

  it('leaves a run over the limit whole, with no shorter path cut out of it', () => {
    const long = path(1025)
    expect(splitReferences(`see ${long} now`)).toEqual([`see ${long} now`])
  })
})

describe('the suffix grammar', () => {
  it.each([
    [':42', { kind: 'lines', first: 42, last: 42, column: null }],
    [':42-50', { kind: 'lines', first: 42, last: 50, column: null }],
    [':42:7', { kind: 'lines', first: 42, last: 42, column: 7 }],
    ['#L42', { kind: 'lines', first: 42, last: 42, column: null }],
    ['#L42-L50', { kind: 'lines', first: 42, last: 50, column: null }],
    ['#kb:a7f3', { kind: 'anchor', id: 'kb:a7f3' }],
    ['#слаг', { kind: 'anchor', id: 'слаг' }],
    ['#foo-1', { kind: 'anchor', id: 'foo-1' }],
  ])('reads %s, in prose as in a link', (suffix, target) => {
    expect(documentParts(first(`docs/x.md${suffix}`)).suffix).toBe(suffix)
    expect(linkParts(`docs/x.md${suffix}`)?.suffix).toBe(suffix)
    expect(suffixTarget(suffix)).toEqual(target)
  })

  it('reads an encoded heading as its words, and a backward range forwards', () => {
    expect(suffixTarget('#%D1%81%D0%BB%D0%B0%D0%B3')).toEqual({ kind: 'anchor', id: 'слаг' })
    expect(suffixTarget(':50-42')).toMatchObject({ first: 42, last: 50 })
  })

  it.each([
    ['docs/x.md:', ['docs/x.md', 'docs/x.md:']],
    ['docs/x.md#L', ['docs/x.md']],
    ['docs/x.md#L.', ['docs/x.md']],
  ])('takes no suffix from %s, where nothing follows the mark', (text, paths) => {
    const [reference] = documents(text)
    expect(documentParts(reference as DocumentReference)).toMatchObject({ paths, suffix: '' })
  })

  it('leaves a glued word out of a suffix, and a sentence’s full stop after one', () => {
    expect(documents('docs/x.md:42x').map((run) => run.value)).toEqual(['docs/x.md'])
    expect(documents('docs/x.md#kb:a7f3.').map((run) => run.value)).toEqual(['docs/x.md#kb:a7f3'])
    expect(documents('docs/x.md#L42x').map((run) => run.value)).toEqual(['docs/x.md#L42x'])
    expect(suffixTarget('#L42x')).toEqual({ kind: 'anchor', id: 'L42x' })
    expect(suffixTarget('')).toBeNull()
  })
})

describe('a code span', () => {
  it('is one path or none, with spaces only in an absolute or network one', () => {
    expect(wholeDocument(String.raw`\\server\share name\x`)?.strength).toBe('copy-only')
    expect(wholeDocument('docs/a b.md')).toBeNull()
    expect(wholeDocument('docs/*.md')).toBeNull()
    expect(wholeDocument('C:/a*b/c')).toBeNull()
    expect(wholeDocument('https://example.com/a/b')).toBeNull()
    expect(wholeDocument('docs/x.md:42.')).toBeNull()
    expect(wholeDocument('/api/documents/read')).toBeNull()
    expect(wholeDocument('')).toBeNull()
  })

  it('keeps what only a code span can hold in a path', () => {
    expect(documentParts(wholeDocument('C:/c#/a,b=c.md') as DocumentReference).paths).toEqual([
      'C:/c#/a,b=c.md',
    ])
  })
})

describe('a link’s address', () => {
  it('reads a file and its line, though a URL would call the file a scheme', () => {
    expect(linkParts('x.md:42')).toEqual({ copy: 'x.md:42', paths: ['x.md'], suffix: ':42' })
    expect(documentLink('tel:123')).toBeNull()
    expect(documentLink('www.example.com:8080/x')).toBeNull()
    expect(documentLink('C:x')).toBeNull()
  })

  it('refuses a control character, which a URL parser drops to reveal a scheme', () => {
    expect(documentLink('java\tscript:alert(1)')).toBeNull()
    expect(documentLink('java\nscript:alert(1)')).toBeNull()
    expect(documentLink('docs/\u0000x.md')).toBeNull()
  })

  it('drops the query and keeps the fragment, whichever a path holds', () => {
    expect(linkParts('docs/a%20b.md?raw=1#kb:a7f3')).toEqual({
      copy: 'docs/a%20b.md?raw=1#kb:a7f3',
      paths: ['docs/a b.md'],
      suffix: '#kb:a7f3',
    })
  })

  it('keeps malformed percent signs as written instead of throwing', () => {
    expect(linkParts('docs/100%.md')?.paths).toEqual(['docs/100%.md'])
  })

  it('does not send a network path an encoding has hidden', () => {
    expect(documentLink('%5C%5Cserver%5Cshare')?.strength).toBe('copy-only')
    expect(linkParts('%5C%5Cserver%5Cshare')?.paths).toEqual([])
  })

  it('refuses a host, and an address with no path, outside a document', () => {
    expect(documentLink('//example.com/a.md')).toBeNull()
    expect(documentLink(String.raw`/\example.com/a.md`)).toBeNull()
    expect(documentLink('#kb:a7f3')).toBeNull()
    expect(documentLink('?raw=1')).toBeNull()
    expect(documentLink('   ')).toBeNull()
  })

  describe('from the folder of a document', () => {
    const FROM = 'a/b/c.md'
    /** Built, because a written climb this deep reads as leaving this repository. */
    const UP = '../'

    it.each([
      ['../x.md', 'a/x.md'],
      ['x.md', 'a/b/x.md'],
      ['./x.md', 'a/b/x.md'],
      ['/x.md', 'x.md'],
      ['plans/', 'a/b/plans/'],
      [String.raw`..\x.md`, 'a/x.md'],
      ['d/../x.md', 'a/b/x.md'],
    ])('reads %s as %s', (address, path) => {
      expect(linkParts(address, FROM)?.paths).toEqual([path])
    })

    it('keeps what climbs above the root, for the server to refuse, instead of clipping it', () => {
      expect(linkParts(`${UP.repeat(3)}x.md`, FROM)?.paths).toEqual(['../x.md'])
      expect(linkParts(`${UP.repeat(4)}y/x.md`, FROM)?.paths).toEqual([`${UP.repeat(2)}y/x.md`])
    })

    it('leaves an absolute path and one from home as written', () => {
      expect(linkParts('C:/work/x.md', FROM)?.paths).toEqual(['C:/work/x.md'])
      expect(linkParts('~/x.md', FROM)?.paths).toEqual(['~/x.md'])
    })

    it('reads a fragment alone as a place in this document, and copies what was written', () => {
      expect(linkParts('#kb:a7f3', FROM)).toEqual({
        copy: '#kb:a7f3',
        paths: [FROM],
        suffix: '#kb:a7f3',
      })
    })
  })
})
