/**
 * A picture pasted into a card's text: told by its first bytes, named in Markdown the
 * editor writes, and drawn only where the text names a picture this server keeps.
 *
 * The signatures are the formats' own (PNG, JPEG, GIF87a/89a, RIFF…WEBP); the address
 * is the one the server answers an upload with (`/api/images/<sha256>`).
 */
import { describe, expect, it } from 'vitest'

import { imageKind, imageMarkdown, servedImage } from '@/shared/lib/pastedImages.ts'
import { inlineWords, parseRichDocument, parseRichText, unlinked } from '@/shared/lib/richText.ts'
import type { RichInline } from '@/shared/lib/richText.ts'

const SHA = 'ab'.repeat(32)
const bytes = (...values: number[]) => new Uint8Array(values)
const text = (words: string) => Array.from(new TextEncoder().encode(words))

describe('what a pasted file is', () => {
  it('is a picture by its first bytes', () => {
    expect(imageKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png')
    expect(imageKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(imageKind(bytes(...text('GIF89a')))).toBe('image/gif')
    expect(imageKind(bytes(...text('GIF87a')))).toBe('image/gif')
    expect(imageKind(bytes(...text('RIFF'), 1, 2, 3, 4, ...text('WEBP')))).toBe('image/webp')
  })

  it('is no picture when its bytes say otherwise, whatever it is called', () => {
    expect(imageKind(bytes(...text('not a picture')))).toBeNull()
    expect(imageKind(bytes(...text('RIFF'), 1, 2, 3, 4, ...text('WAVE')))).toBeNull()
    expect(imageKind(bytes(...text('<svg ')))).toBeNull()
    expect(imageKind(bytes(0x89, 0x50, 0x4e))).toBeNull()
  })
})

describe('the Markdown a paste writes', () => {
  it('names the picture by its file name on one line, with nothing that ends the words early', () => {
    expect(imageMarkdown('screen.png', `/api/images/${SHA}`)).toBe(
      `![screen.png](</api/images/${SHA}>)`,
    )
    expect(imageMarkdown('a [b]\\c\nd.png', `/api/images/${SHA}`)).toBe(
      `![a b c d.png](</api/images/${SHA}>)`,
    )
    expect(imageMarkdown('x'.repeat(200), '/p')).toBe(`![${'x'.repeat(80)}](</p>)`)
  })

  it('knows a served address only in its exact form', () => {
    expect(servedImage(`/api/images/${SHA}`)).toBe(SHA)
    expect(servedImage(`/api/images/${SHA.toUpperCase()}`)).toBeNull()
    expect(servedImage(`/api/images/${SHA}/x`)).toBeNull()
    expect(servedImage(`https://example.org/api/images/${SHA}`)).toBeNull()
    expect(servedImage('/api/images/../security/bootstrap')).toBeNull()
  })
})

/** The inline nodes of a one-paragraph text. */
function inline(source: string): RichInline[] {
  const [first] = parseRichText(source)
  return first?.kind === 'paragraph' ? first.children : []
}

describe('a kept picture in a card text', () => {
  it('is drawn by its hash, with the words written for it', () => {
    expect(inline(`![screen.png](</api/images/${SHA}>)`)).toEqual([
      { kind: 'image', sha256: SHA, children: [{ kind: 'text', text: 'screen.png' }] },
    ])
    expect(inline(`![](/api/images/${SHA})`)).toEqual([
      { kind: 'image', sha256: SHA, children: [] },
    ])
    expect(inlineWords(inline(`See ![the bug](/api/images/${SHA}) here`))).toBe('See the bug here')
  })

  it('stays a link when it is any other address, or stands inside a link', () => {
    expect(inline('![chart](https://example.org/c.png)')[0]?.kind).toBe('link')
    expect(inline(`![x](/api/images/${SHA}?x=1)`)[0]?.kind).not.toBe('image')
    const linked = inline(`[![x](/api/images/${SHA})](https://example.org)`)
    expect(linked).toHaveLength(1)
    expect(linked[0]?.kind).toBe('link')
  })

  it('is a link in a document, whose Markdown names its own files', () => {
    const document = parseRichDocument(`![x](/api/images/${SHA})`, { base: 'docs/a.md' })
    expect(JSON.stringify(document)).not.toContain('"kind":"image"')
  })

  it('is its words inside a press', () => {
    const picture: RichInline = {
      kind: 'image',
      sha256: SHA,
      children: [{ kind: 'text', text: 'screen' }],
    }
    expect(unlinked([picture])).toEqual([{ kind: 'text', text: 'screen' }])
  })
})
