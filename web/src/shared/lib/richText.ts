/**
 * Markdown, read into a tree the interface can draw without trusting it.
 *
 * Descriptions, comments and reports are written by agents and arrive as
 * markdown full of paths, hashes and references. The parser is `marked`'s
 * lexer; its HTML renderer is never used. Its tokens are copied into the small
 * tree below, and the copy is where the trust boundary sits: raw HTML becomes
 * the text it was written as, an image becomes a link to it, and a link keeps
 * its address only when that address is `http:`, `https:` or `mailto:`. What
 * reaches a component is therefore text and structure, never markup, and the
 * renderer has no `v-html` to get wrong.
 *
 * A single line break stays a line break (`breaks`), because every one of these
 * texts used to be shown with `pre-wrap` and a report written as one fact per
 * line must not run together into one paragraph.
 *
 * Headings keep no level. The text sits under a section heading the card
 * already owns, and an agent's `#` must not outrank it in the card's outline,
 * so a heading is drawn as an emphasised paragraph.
 */
import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'

import { splitReferences, wholeReference } from '@/shared/lib/textReferences.ts'
import type { TextReference } from '@/shared/lib/textReferences.ts'

export type RichInline =
  | { kind: 'break' }
  | { kind: 'code'; text: string }
  | { children: RichInline[]; kind: 'del' }
  | { children: RichInline[]; kind: 'em' }
  | { children: RichInline[]; kind: 'strong' }
  | { children: RichInline[]; href: string; kind: 'link' }
  /** A candidate reference; `code` when it was written as a code span of its own. */
  | { code: boolean; kind: 'reference'; reference: TextReference }
  | { kind: 'text'; text: string }

export interface RichListItem {
  checked: boolean | null
  children: RichBlock[]
}

export type RichAlign = 'center' | 'left' | 'right' | null

export type RichBlock =
  | { kind: 'code'; text: string }
  | { children: RichInline[]; kind: 'heading' | 'paragraph' }
  | { items: RichListItem[]; kind: 'list'; ordered: boolean; start: number }
  | { children: RichBlock[]; kind: 'quote' }
  | { kind: 'rule' }
  | { align: RichAlign[]; header: RichInline[][]; kind: 'table'; rows: RichInline[][][] }

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * The address a link may carry, or null.
 *
 * Parsed rather than matched: `URL` normalises case, whitespace and entities
 * the way the browser would, so `JaVaScRiPt:` and a tab inside the scheme are
 * read as what they are. A relative address has no base here and is refused.
 */
export function safeHref(href: string): string | null {
  try {
    const url = new URL(href.trim())
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

/** Plain text with its candidate references cut out. */
function textRuns(text: string): RichInline[] {
  return splitReferences(text).map((run) =>
    typeof run === 'string'
      ? { kind: 'text', text: run }
      : { kind: 'reference', reference: run, code: false },
  )
}

/** Inline tokens, where a link's own text is never searched for references. */
function inlines(tokens: readonly Token[] | undefined, inLink = false): RichInline[] {
  return (tokens ?? []).flatMap((token): RichInline[] => inline(token, inLink))
}

function inline(token: Token, inLink: boolean): RichInline[] {
  const text = (value: string): RichInline[] =>
    inLink ? [{ kind: 'text', text: value }] : textRuns(value)
  switch (token.type) {
    case 'text': {
      const node = token as Tokens.Text
      return node.tokens ? inlines(node.tokens, inLink) : text(node.text)
    }
    case 'escape': {
      // The character after the backslash, as written.
      return [{ kind: 'text', text: token.raw.slice(1) }]
    }
    case 'checkbox': {
      // A task item's state is carried by the item.
      return []
    }
    case 'codespan': {
      const value = (token as Tokens.Codespan).text
      const reference = inLink ? null : wholeReference(value)
      return [
        reference ? { kind: 'reference', reference, code: true } : { kind: 'code', text: value },
      ]
    }
    case 'br': {
      return [{ kind: 'break' }]
    }
    case 'strong':
    case 'em':
    case 'del': {
      return [{ kind: token.type, children: inlines((token as Tokens.Strong).tokens, inLink) }]
    }
    case 'link':
    case 'image': {
      return link(token as Tokens.Image | Tokens.Link, inLink)
    }
    default: {
      // Raw HTML and anything this tree does not know is shown as written.
      return text(token.raw)
    }
  }
}

/**
 * A link whose address is safe, else its text. An image is a link to the
 * picture, never the picture: drawing it would load a remote address that an
 * agent chose, the moment the card is opened.
 */
function link(token: Tokens.Image | Tokens.Link, inLink: boolean): RichInline[] {
  const children =
    token.type === 'image'
      ? [{ kind: 'text', text: token.text || token.href } satisfies RichInline]
      : inlines(token.tokens, true)
  const href = safeHref(token.href)
  if (href === null || inLink) return token.type === 'image' ? children : inlines(token.tokens)
  return [{ kind: 'link', href, children }]
}

function listItem(item: Tokens.ListItem): RichListItem {
  return {
    checked: item.task ? Boolean(item.checked) : null,
    children: blocks(item.tokens.filter((token) => token.type !== 'checkbox')),
  }
}

function block(token: Token): RichBlock[] {
  switch (token.type) {
    case 'paragraph': {
      return [{ kind: 'paragraph', children: inlines((token as Tokens.Paragraph).tokens) }]
    }
    case 'text': {
      // A tight list item holds its words as a block-level text token.
      const node = token as Tokens.Text
      return [
        { kind: 'paragraph', children: node.tokens ? inlines(node.tokens) : textRuns(node.text) },
      ]
    }
    case 'heading': {
      return [{ kind: 'heading', children: inlines((token as Tokens.Heading).tokens) }]
    }
    case 'code': {
      return [{ kind: 'code', text: (token as Tokens.Code).text }]
    }
    case 'blockquote': {
      return [{ kind: 'quote', children: blocks((token as Tokens.Blockquote).tokens) }]
    }
    case 'list': {
      const list = token as Tokens.List
      return [
        {
          kind: 'list',
          ordered: list.ordered,
          start: typeof list.start === 'number' ? list.start : 1,
          items: list.items.map((item) => listItem(item)),
        },
      ]
    }
    case 'table': {
      const table = token as Tokens.Table
      return [
        {
          kind: 'table',
          align: table.align,
          header: table.header.map((cell) => inlines(cell.tokens)),
          rows: table.rows.map((row) => row.map((cell) => inlines(cell.tokens))),
        },
      ]
    }
    case 'hr': {
      return [{ kind: 'rule' }]
    }
    case 'space':
    case 'def': {
      return []
    }
    default: {
      // Block HTML and unknown blocks: the text as written, line by line.
      return [{ kind: 'paragraph', children: lines(token.raw.replace(/\n+$/u, '')) }]
    }
  }
}

function lines(text: string): RichInline[] {
  return text
    .split('\n')
    .flatMap((line, index): RichInline[] =>
      index ? [{ kind: 'break' }, ...textRuns(line)] : textRuns(line),
    )
}

function blocks(tokens: readonly Token[]): RichBlock[] {
  return tokens.flatMap((token) => block(token))
}

/** A markdown text as blocks. */
export function parseRichText(source: string): RichBlock[] {
  return blocks(Lexer.lex(source, { gfm: true, breaks: true }))
}

/** A markdown text that must stay on its line, such as a label or a short preview. */
export function parseRichInline(source: string): RichInline[] {
  return inlines(Lexer.lexInline(source, { gfm: true, breaks: true }))
}

/**
 * The words a markdown text reads as, without its markup: what an accessible
 * name or a tooltip says of it. The tree is the one the renderer draws, so
 * what is said is what is shown, and a line break reads as a space.
 */
export function plainText(source: string): string {
  return parseRichText(source)
    .map((block) => blockWords(block))
    .join(' ')
    .trim()
}

function blockWords(block: RichBlock): string {
  if (block.kind === 'code') return block.text
  if (block.kind === 'heading' || block.kind === 'paragraph') return inlineWords(block.children)
  if (block.kind === 'list')
    return block.items
      .map((item) => item.children.map((child) => blockWords(child)).join(' '))
      .join(' ')
  if (block.kind === 'quote') return block.children.map((child) => blockWords(child)).join(' ')
  if (block.kind === 'table')
    return [block.header, ...block.rows]
      .flat()
      .map((cell) => inlineWords(cell))
      .join(' ')
  return ''
}

function inlineWords(nodes: readonly RichInline[]): string {
  return nodes.map((node) => nodeWords(node)).join('')
}

function nodeWords(node: RichInline): string {
  if (node.kind === 'break') return ' '
  if (node.kind === 'code' || node.kind === 'text') return node.text
  if (node.kind === 'reference') return node.reference.value
  if (node.kind === 'link' || node.kind === 'em' || node.kind === 'strong' || node.kind === 'del')
    return inlineWords(node.children)
  return ''
}
