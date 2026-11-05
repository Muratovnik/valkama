/**
 * The card's reader as it stood before paths became candidates: the oracle for
 * the promise that a text holding no path reads into the tree it always did.
 *
 * It is a copy on purpose, because comparing the reader with itself would prove
 * nothing. A change to what a card's text means changes the reader and this file
 * together, and the property that reads this file says which one was meant.
 */
import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'

import { safeHref } from '@/shared/lib/richText.ts'
import type { RichBlock, RichInline, RichListItem } from '@/shared/lib/richText.ts'
import { splitIdentifiers, wholeReference } from '@/shared/lib/textReferences.ts'

/** Plain text with its candidate references cut out. */
function textRuns(text: string): RichInline[] {
  return splitIdentifiers(text).map((run) =>
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
  const own = item.tokens.filter((token) => token.type !== 'checkbox')
  return {
    checked: item.task ? Boolean(item.checked) : null,
    children: blocks(own),
    // The item's own Markdown, which paths never touched: its words as written, no lists.
    source: own
      .filter((token) => token.type !== 'list')
      .map((token) => token.raw)
      .join('')
      .trim(),
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

export function readBeforePaths(source: string): RichBlock[] {
  return blocks(Lexer.lex(source, { gfm: true, breaks: true }))
}
