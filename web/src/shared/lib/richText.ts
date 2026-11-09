/**
 * Markdown, read into a tree the interface can draw without trusting it.
 *
 * Descriptions, comments and reports are written by agents and arrive as
 * markdown full of paths, hashes and references. The parser is `marked`'s
 * lexer; its HTML renderer is never used. Its tokens are copied into the small
 * tree below, and the copy is where the trust boundary sits: raw HTML becomes
 * the text it was written as, an image becomes a link to it, and a link keeps
 * its address only when that address is `http:`, `https:` or `mailto:`. The one
 * image drawn as a picture is one this server keeps for an item — a card's text
 * naming `/api/images/<sha256>`, which is what a paste writes — and the tree holds
 * its hash, never the address as written. What
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
 *
 * A link with no scheme names a file, so it is a candidate like a path written
 * in the text (`textReferences.ts`) and carries no address at all: the tree can
 * hold nothing a browser would follow but those three protocols.
 *
 * `parseRichDocument` reads a whole Markdown file by the same tree and the same
 * trust boundary, and differs where a file is not a card's text: lines wrap by
 * width, headings have levels and anchors, comments are hidden, front matter is
 * facts, and each top block knows the source lines it came from.
 */
import GithubSlugger from 'github-slugger'
import { Lexer } from 'marked'
import type { Token, Tokens } from 'marked'

import { servedImage } from '@/shared/lib/pastedImages.ts'
import {
  crossesEscape,
  documentLink,
  splitIdentifiers,
  splitReferences,
  wholeDocument,
  wholeReference,
} from '@/shared/lib/textReferences.ts'
import type { Around, TextReference, TextRun } from '@/shared/lib/textReferences.ts'

export type RichInline =
  | { kind: 'break' }
  | { kind: 'code'; text: string }
  | { children: RichInline[]; kind: 'del' }
  | { children: RichInline[]; kind: 'em' }
  | { children: RichInline[]; kind: 'strong' }
  | { children: RichInline[]; href: string; kind: 'link' }
  /** A picture this server keeps, by its hash; its children are the words written for it. */
  | { children: RichInline[]; kind: 'image'; sha256: string }
  /**
   * A candidate reference; `code` when it was written as a code span of its own.
   * `caption` is a link's own words, drawn instead of the path.
   */
  | { code: boolean; kind: 'reference'; reference: TextReference; caption?: RichInline[] }
  | { kind: 'text'; text: string }

export interface RichListItem {
  checked: boolean | null
  children: RichBlock[]
  /**
   * The item's own Markdown, as written after its marker and task box and without the
   * lists nested in it: what a point of the list says, for a step to say it again.
   */
  source: string
}

export type RichAlign = 'center' | 'left' | 'right' | null

type RichHeadingLevel = 2 | 3 | 4 | 5 | 6

export type RichBlock =
  /** `language` is the fence's first word, where it names one. */
  | { kind: 'code'; text: string; language?: string }
  /** `level` and `slug` come only from `parseRichDocument`. */
  | { children: RichInline[]; kind: 'heading'; level?: RichHeadingLevel; slug?: string }
  | { children: RichInline[]; kind: 'paragraph' }
  | { items: RichListItem[]; kind: 'list'; ordered: boolean; start: number }
  | { children: RichBlock[]; kind: 'quote' }
  | { kind: 'rule' }
  | { align: RichAlign[]; header: RichInline[][]; kind: 'table'; rows: RichInline[][][] }

/** One top block of a document and what leads to it. */
export interface RichDocumentBlock {
  /** Its `kb:<id>` anchors and heading slugs, as a link's `#…` names them. */
  anchors: string[]
  block: RichBlock
  /** The source lines it came from, counted from 1 in the whole file. */
  firstLine: number
  lastLine: number
}

export interface RichDocument {
  blocks: RichDocumentBlock[]
  /** The front matter's lines, as written. */
  facts: string[]
}

/** What reading a document adds to reading a card's text. */
interface DocumentReading {
  /** The anchors found since the last top block took them. */
  anchors: string[]
  /** The document's path in its project, what its links are read from. */
  from: string
  /** One per document, so a repeat and a real `foo-1` cannot collide. */
  slugger: GithubSlugger
}

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

function runNodes(runs: readonly TextRun[]): RichInline[] {
  return runs.map((run) =>
    typeof run === 'string'
      ? { kind: 'text', text: run }
      : { kind: 'reference', reference: run, code: false },
  )
}

/** Plain text with its candidate references cut out; `around` is what the lexer cut off it. */
function textRuns(text: string, around?: Around): RichInline[] {
  return runNodes(splitReferences(text, around))
}

const ESCAPED = /\\([!-/:-@[-`{-~])/gu

/**
 * Words the lexer cut at a backslash, read again as written when they hold a
 * path: Markdown takes the `\.` of `C:\work\.cache\x` and the `\\` of a network
 * path for escapes, and a path is the characters its author wrote. The words
 * around it keep what Markdown made of them, and with no such path this is null
 * and every token reads as it always did.
 */
function pathsAcrossEscapes(tokens: readonly Token[], outside: Around): RichInline[] | null {
  if (!tokens.some((token) => token.type === 'escape')) return null
  const runs = splitReferences(tokens.map((token) => token.raw).join(''), outside)
  if (!runs.some((run) => crossesEscape(run))) return null
  const nodes: RichInline[] = []
  let around = ''
  for (const run of runs) {
    if (crossesEscape(run)) {
      nodes.push(...textRuns(around.replaceAll(ESCAPED, '$1')), ...runNodes([run]))
      around = ''
    } else {
      around += typeof run === 'string' ? run : run.value
    }
  }
  return [...nodes, ...textRuns(around.replaceAll(ESCAPED, '$1'))]
}

/** The tokens with each stretch of plain words and escapes held together. */
function wordStretches(tokens: readonly Token[]): Token[][] {
  const stretches: Token[][] = []
  let open: Token[] | null = null
  for (const token of tokens) {
    if (token.type !== 'escape' && (token.type !== 'text' || (token as Tokens.Text).tokens)) {
      stretches.push([token])
      open = null
    } else if (open) {
      open.push(token)
    } else {
      open = [token]
      stretches.push(open)
    }
  }
  return stretches
}

/** Inline tokens, where a link's own text is never searched for references. */
function inlines(
  tokens: readonly Token[] | undefined,
  reading: DocumentReading | null,
  inLink = false,
): RichInline[] {
  const all = tokens ?? []
  /** The raw tokens either side of `count` tokens from `at`: what a path there is glued to. */
  const around = (at: number, count: number): Around => ({
    before: all[at - 1]?.raw ?? '',
    after: all[at + count]?.raw ?? '',
  })
  let first = 0
  return wordStretches(all).flatMap((stretch): RichInline[] => {
    const at = first
    first += stretch.length
    return (
      (inLink ? null : pathsAcrossEscapes(stretch, around(at, stretch.length))) ??
      stretch.flatMap((token, offset) => inline(token, reading, inLink, around(at + offset, 1)))
    )
  })
}

/** A comment out of raw HTML, with its anchor taken down when it names one. */
function withoutComments(raw: string, reading: DocumentReading): string {
  return raw.replaceAll(/<!--[\s\S]*?-->/gu, (comment) => {
    const anchor = /^<!--\s*(kb:\S+?)\s*-->$/u.exec(comment)?.[1]
    if (anchor) reading.anchors.push(anchor)
    return ''
  })
}

function inline(
  token: Token,
  reading: DocumentReading | null,
  inLink: boolean,
  around: Around,
): RichInline[] {
  const text = (value: string): RichInline[] =>
    inLink ? [{ kind: 'text', text: value }] : textRuns(value, around)
  switch (token.type) {
    case 'text': {
      const node = token as Tokens.Text
      return node.tokens ? inlines(node.tokens, reading, inLink) : text(node.text)
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
      const reference = inLink ? null : (wholeReference(value) ?? wholeDocument(value))
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
      return [
        { kind: token.type, children: inlines((token as Tokens.Strong).tokens, reading, inLink) },
      ]
    }
    case 'link':
    case 'image': {
      return link(token as Tokens.Image | Tokens.Link, reading, inLink)
    }
    default: {
      // Raw HTML and anything this tree does not know is shown as written, and
      // what stands in its attributes is no path.
      const raw = reading ? withoutComments(token.raw, reading) : token.raw
      if (!raw) return []
      return inLink ? [{ kind: 'text', text: raw }] : runNodes(splitIdentifiers(raw))
    }
  }
}

/**
 * A link's address as its author wrote it. The lexer takes a backslash before
 * punctuation for an escape, which is half a network path and part of
 * `docs\_x.md`; a reference-style link has no address of its own to read.
 */
function writtenAddress(token: Tokens.Image | Tokens.Link): string {
  if (!token.raw.includes('\\')) return token.href
  const inline = /\]\(\s*(?:<([^>]*)>|(\S+))[^)]*\)$/u.exec(token.raw)
  return inline?.[1] ?? inline?.[2] ?? token.href
}

/**
 * A link whose address is safe; else the document its address names; else its
 * text. An image is a link to the picture, never the picture: drawing it would
 * load a remote address that an agent chose, the moment the card is opened.
 */
function link(
  token: Tokens.Image | Tokens.Link,
  reading: DocumentReading | null,
  inLink: boolean,
): RichInline[] {
  const children =
    token.type === 'image'
      ? [{ kind: 'text', text: token.text || token.href } satisfies RichInline]
      : inlines(token.tokens, reading, true)
  // A pasted picture, in a card's own text and outside a link: a document's
  // Markdown names files of its project, and a picture inside a link would be
  // a press inside a press.
  const sha256 = token.type === 'image' && !reading && !inLink && servedImage(token.href)
  if (sha256) return [{ kind: 'image', sha256, children: token.text ? children : [] }]
  const href = safeHref(token.href)
  if (href !== null && !inLink) return [{ kind: 'link', href, children }]
  const reference = inLink ? null : documentLink(writtenAddress(token), reading?.from)
  if (reference) return [{ kind: 'reference', caption: children, code: false, reference }]
  return token.type === 'image' ? children : inlines(token.tokens, reading)
}

function listItem(item: Tokens.ListItem, reading: DocumentReading | null): RichListItem {
  const own = item.tokens.filter((token) => token.type !== 'checkbox')
  return {
    checked: item.task ? Boolean(item.checked) : null,
    children: blocks(own, reading),
    source: own
      .filter((token) => token.type !== 'list')
      .map((token) => token.raw)
      .join('')
      .trim(),
  }
}

function heading(token: Tokens.Heading, reading: DocumentReading | null): RichBlock {
  const children = inlines(token.tokens, reading)
  if (!reading) return { kind: 'heading', children }
  // From its words, without a comment that stood in it, and with no space after
  // them: a space would end the slug in a hyphen.
  const slug = reading.slugger.slug(inlineWords(children).trim())
  if (slug) reading.anchors.push(slug)
  const level = Math.min(token.depth + 1, 6) as RichHeadingLevel
  return { kind: 'heading', children, level, slug }
}

/** A fence's words that say only that the code is plain text, which names nothing. */
const PLAIN_FENCES = new Set(['', 'plain', 'plaintext', 'text', 'txt'])

function codeBlock(token: Tokens.Code): RichBlock {
  const [language = ''] = (token.lang ?? '').trim().split(/\s/u)
  return PLAIN_FENCES.has(language.toLowerCase())
    ? { kind: 'code', text: token.text }
    : { kind: 'code', text: token.text, language }
}

function block(token: Token, reading: DocumentReading | null): RichBlock[] {
  switch (token.type) {
    case 'paragraph': {
      return [{ kind: 'paragraph', children: inlines((token as Tokens.Paragraph).tokens, reading) }]
    }
    case 'text': {
      // A tight list item holds its words as a block-level text token.
      const node = token as Tokens.Text
      return [
        {
          kind: 'paragraph',
          children: node.tokens ? inlines(node.tokens, reading) : textRuns(node.text),
        },
      ]
    }
    case 'heading': {
      return [heading(token as Tokens.Heading, reading)]
    }
    case 'code': {
      return [codeBlock(token as Tokens.Code)]
    }
    case 'blockquote': {
      return [{ kind: 'quote', children: blocks((token as Tokens.Blockquote).tokens, reading) }]
    }
    case 'list': {
      const list = token as Tokens.List
      return [
        {
          kind: 'list',
          ordered: list.ordered,
          start: typeof list.start === 'number' ? list.start : 1,
          items: list.items.map((item) => listItem(item, reading)),
        },
      ]
    }
    case 'table': {
      const table = token as Tokens.Table
      return [
        {
          kind: 'table',
          align: table.align,
          header: table.header.map((cell) => inlines(cell.tokens, reading)),
          rows: table.rows.map((row) => row.map((cell) => inlines(cell.tokens, reading))),
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
      const raw = reading ? withoutComments(token.raw, reading).trim() : token.raw
      return reading && !raw
        ? []
        : [{ kind: 'paragraph', children: lines(raw.replace(/\n+$/u, '')) }]
    }
  }
}

function lines(text: string): RichInline[] {
  return text.split('\n').flatMap((line, index): RichInline[] => {
    const words = runNodes(splitIdentifiers(line))
    return index ? [{ kind: 'break' }, ...words] : words
  })
}

function blocks(tokens: readonly Token[], reading: DocumentReading | null): RichBlock[] {
  return tokens.flatMap((token) => block(token, reading))
}

/** A markdown text as blocks. */
export function parseRichText(source: string): RichBlock[] {
  return blocks(Lexer.lex(source, { gfm: true, breaks: true }), null)
}

/** A markdown text that must stay on its line, such as a label or a short preview. */
export function parseRichInline(source: string): RichInline[] {
  return inlines(Lexer.lexInline(source, { gfm: true, breaks: true }), null)
}

/**
 * The front matter a file opens with, and the Markdown after it. The rule VS Code
 * and micromark share: line 0, no indent, exactly `---` before any trailing
 * spaces, and a closing `---`, which `...` is not. Without one it is Markdown.
 * The lines are counted after the same normalising the lexer does.
 */
function frontMatter(source: string): { body: string; facts: string[]; lines: number } {
  const body = source.replaceAll(/\r\n|\r/gu, '\n')
  const lines = body.split('\n')
  const opens = lines[0]?.trimEnd() === '---'
  const close = opens ? lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---') : -1
  if (close === -1) return { body, facts: [], lines: 0 }
  return {
    body: lines.slice(close + 1).join('\n'),
    facts: lines.slice(1, close).filter((line) => line.trim()),
    lines: close + 1,
  }
}

function lineBreaks(text: string): number {
  return text.split('\n').length - 1
}

/**
 * Where a top token stands, reading on from `cursor`. Together the tokens' `raw`
 * is the normalised text but for one thing: the lexer keeps no token for a link
 * definition that repeats an earlier one, so its lines are skipped to the next
 * line start that holds what comes after.
 */
function placeOf(body: string, raw: string, cursor: number): number {
  if (body.startsWith(raw, cursor)) return cursor
  const after = body.indexOf(`\n${raw}`, cursor)
  return after === -1 ? cursor : after + 1
}

/**
 * A Markdown file as a document, whose `base` is its path from its project's
 * root: links are read from its folder, as in any Markdown.
 *
 * Every top token is placed, drawn or not, because nothing else tells a block
 * where it stands. A comment that stands alone hands its anchor to the next
 * block, or to the last one when nothing follows it.
 */
export function parseRichDocument(source: string, { base }: { base: string }): RichDocument {
  const { body, facts, lines } = frontMatter(source)
  const reading: DocumentReading = { anchors: [], from: base, slugger: new GithubSlugger() }
  const documentBlocks: RichDocumentBlock[] = []
  let line = lines + 1
  let counted = 0
  let cursor = 0
  for (const token of Lexer.lex(body, { gfm: true, breaks: false })) {
    const at = placeOf(body, token.raw, cursor)
    line += lineBreaks(body.slice(counted, at))
    counted = at
    cursor = at + token.raw.length
    const [drawn] = block(token, reading)
    if (drawn) {
      documentBlocks.push({
        anchors: reading.anchors.splice(0),
        block: drawn,
        firstLine: line,
        lastLine: line + lineBreaks(token.raw.replace(/\n+$/u, '')),
      })
    }
  }
  documentBlocks.at(-1)?.anchors.push(...reading.anchors)
  return { blocks: documentBlocks, facts }
}

/**
 * The top block a source line lies in; a line between blocks belongs to the one
 * after it, and one past the end to the last. Null for a document with no blocks.
 */
export function blockAtLine(
  { blocks: list }: RichDocument,
  line: number,
): RichDocumentBlock | null {
  let low = 0
  let high = list.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = list[middle]
    if (candidate && candidate.lastLine < line) low = middle + 1
    else high = middle
  }
  return list[low] ?? null
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

/** The words inline nodes read as, for what must name them, such as a control's name. */
export function inlineWords(nodes: readonly RichInline[]): string {
  return nodes.map((node) => nodeWords(node)).join('')
}

/**
 * A link's words in place of the link, at any depth: for words that stand inside a press of their
 * own, where a link would be a press inside a press.
 */
export function unlinked(nodes: readonly RichInline[]): RichInline[] {
  return nodes.flatMap((node): RichInline[] => {
    // A picture opens when pressed, so inside a press it is the words written for it.
    if (node.kind === 'link' || node.kind === 'image') return unlinked(node.children)
    return 'children' in node ? [{ ...node, children: unlinked(node.children) }] : [node]
  })
}

function nodeWords(node: RichInline): string {
  if (node.kind === 'break') return ' '
  if (node.kind === 'code' || node.kind === 'text') return node.text
  if (node.kind === 'reference')
    return node.caption ? inlineWords(node.caption) : node.reference.value
  return inlineWords(node.children)
}
