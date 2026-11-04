/**
 * The identifiers and paths agents write into prose, found by their shape.
 *
 * A shape is a candidate and nothing more: `SHA-256` and `UTF-8` have the shape
 * of a work item reference, and a seven-letter hex word has the shape of a
 * commit. Which candidates are real is decided by whoever renders them, from
 * the records it holds (`referenceLinks.ts`); a candidate nobody claims is shown
 * as the text it was.
 */
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'

type IdentifierKind = 'commit' | 'memory' | 'session' | 'work-item'

/**
 * How sure a path's shape alone is that it is a path. `tests/fixtures/document-path-samples.json`
 * is the table of what each text becomes.
 *
 * - strong: a path for certain, so it is always a control, which opens what the
 *   server confirmed and otherwise copies;
 * - weak: looks as much like prose (`owner/repo`), so it is a link only if the
 *   server confirmed it and text otherwise;
 * - copy-only: a network path, which the page copies and never sends to the server.
 */
type DocumentStrength = 'copy-only' | 'strong' | 'weak'

export type TextReference =
  | { kind: IdentifierKind; value: string }
  | {
      kind: 'document'
      strength: DocumentStrength
      /** The written run the control covers, tail included; a link's address as written. */
      value: string
      /**
       * Present on a Markdown link: the path of the document it stands in, from
       * its project's root, or empty outside a document. A link's address is read
       * from there; a path written in the text is read from what the layer holds.
       */
      linkFrom?: string
    }

export type DocumentReference = Extract<TextReference, { kind: 'document' }>

/** What a document reference says: `tests/fixtures/document-path-samples.json` holds examples. */
export interface DocumentParts {
  /** What a click copies when it cannot open; a weak form is never copied. */
  copy: string | null
  /** What the server is asked, without the suffix; the variant without a tail first. */
  paths: string[]
  /** The anchor or line taken off, as written; read it with `suffixTarget`. */
  suffix: string
}

/** Where a suffix leads: an anchor as `RichDocumentBlock.anchors` holds it, or source lines. */
export type SuffixTarget =
  | { column: number | null; first: number; kind: 'lines'; last: number }
  | { id: string; kind: 'anchor' }

/** One run of a text: either plain text or a candidate reference. */
export type TextRun = string | TextReference

/*
 * One pass, longest shapes first. Each alternative is fenced so that it is not
 * the middle of a longer identifier: a key glued to a word, a hash followed by
 * a file extension. A slash is not a fence, so `MAIN-12/MAIN-13` is two.
 *
 * - session: a UUID, which is how every client names a session;
 * - memory: the AgentMemory record and lesson ids (`mem_…`, `lsn_…`);
 * - work item: the planning grammar itself (`WORK_ITEM_REFERENCE`);
 * - commit: 7–40 lowercase hex digits holding at least one digit and one
 *   letter, so neither a number nor an English word qualifies.
 */
const FENCE_BEFORE = String.raw`(?<![\p{L}\p{N}_-])`
const FENCE_AFTER = String.raw`(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])`
const ITEM = WORK_ITEM_REFERENCE.source.replace(/^\^/u, '').replace(/\$$/u, '')
const SHAPES = [
  String.raw`(?<session>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`,
  String.raw`(?<memory>(?:mem|lsn)_[a-z0-9]+(?:_[a-z0-9]+)*)`,
  `(?<item>${ITEM})`,
  String.raw`(?<commit>(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40})`,
]
const PATTERN = new RegExp(`${FENCE_BEFORE}(?:${SHAPES.join('|')})${FENCE_AFTER}`, 'gu')

function kindOf(groups: Record<string, string | undefined>): IdentifierKind {
  if (groups.session) return 'session'
  if (groups.memory) return 'memory'
  if (groups.item) return 'work-item'
  return 'commit'
}

/** A candidate and the place in the text it covers. */
interface Found {
  end: number
  reference: TextReference
  start: number
}

/*
 * A path in prose. The fence refuses a start right after a letter, a digit or
 * `_-./\:@`, so the middle of a URL, `@scope/pkg` and `a:docs/x.md` are not paths.
 * A body stops at a space and at what cannot stand in a path or usually follows
 * one: `,;` and `=` (`key=docs/a.md`), the quotes and dashes of prose, and `:#`,
 * which start a suffix. A bracket, a quote or `@` may not open it, so `(docs/x.md)`
 * starts at the `d`, but `docs/a(b).md` keeps its brackets.
 *
 * The body is greedy and the fence after it refuses only what the body itself
 * takes, so a start that passes its fence always matches: the scan stays linear
 * in the length of the text.
 */
const SEPARATOR = String.raw`[/\\]`
const WORD = String.raw`[\p{L}\p{N}_-]`
/** A line, a line range, a line and column, or an anchor. `#L` with no number is none of them. */
const SUFFIX = String.raw`:\d+(?:-\d+|:\d+)?|#kb:${WORD}+(?:\.${WORD}+)*|#(?!L(?!${WORD}))${WORD}+`
const TAIL = String.raw`[.,;:)»\]"']`
const PROSE_BODY = String.raw`[^\s\p{C}<>|*?"\x60,;:#=«»“”„‘’—–…]`
const PROSE_PATH = new RegExp(
  [
    String.raw`(?<![\p{L}\p{N}_\-./\\:@])`,
    String.raw`(?<path>(?:[A-Za-z]:(?=${SEPARATOR}))?(?![(\[{'@])${PROSE_BODY}+)`,
    `(?<suffix>${SUFFIX})?(?<tail>${TAIL}*)`,
    String.raw`(?![\p{L}\p{N}_\-/\\]|\.\p{L})`,
  ].join(''),
  'gu',
)
/** The page's own limit, the server's first check: a longer run is text and is never sent. */
const MAX_PATH = 1024
const SUFFIX_AT_END = new RegExp(String.raw`(?:${SUFFIX})$`, 'u')
const TAIL_AT_END = new RegExp(`${TAIL}+$`, 'u')
const LINE_AT_END = /:\d+(?:-\d+|:\d+)?$/u
/** A server and a share: `\\n` is an escaped line break and `\\server` alone opens nothing. */
const NETWORK = /^\\\\[^\\/]+[\\/][^\\/]/u
const DRIVE = /^[A-Za-z]:[/\\]/u
/** A drive's root alone, which names no file or folder anyone means: `диски C:/ и D:/`. */
const DRIVE_ROOT = /^[A-Za-z]:[/\\]+$/u
/**
 * What no Windows name holds, so a run holding one is a template — `tmp/<task>/`,
 * `docs/*.md` — and neither it nor a part of it is a path. A quote counts only
 * inside the run: around it, it is the prose quoting a path.
 */
const TEMPLATE = /[<>|*?"]/u
/** Punctuation around a run that belongs to the sentence and not to the path. */
const RUN_EDGES = /^[(["'«“„‘]+|[.,;:!?)\]»"'”’…]+$/gu
const FROM_HOME_OR_HERE = /^(?:~|\.\.?)[/\\]/u
/** A backslash Markdown would read as an escape, as written. */
const ESCAPE = /\\[!-/:-@[-`{-~]/u
const ROOTED = /^[/\\]/u
/** An extension holds a letter, so a version pair like `1.0/2.0` is not a file. */
const EXTENSION = /\.[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*$/u
const MARKDOWN_FILE = /\.(?:md|markdown)$/iu

/**
 * How strong a path written in text or code is, or null when it is not one. `separators`
 * is what a path with no extension needs before it looks like one: in prose
 * `client/server` is two words, and in a code span the author marked it apart.
 */
function strengthOf(path: string, separators: number): DocumentStrength | null {
  if (NETWORK.test(path)) return 'copy-only'
  if (ROOTED.test(path) || DRIVE_ROOT.test(path)) return null
  if (DRIVE.test(path) || FROM_HOME_OR_HERE.test(path)) return 'strong'
  const segments = path.split(/[/\\]/u)
  const count = segments.length - 1
  if (count === 0) return null
  const last = segments.at(-1) ?? ''
  if (last === '' || EXTENSION.test(last)) return 'strong'
  return count >= separators ? 'weak' : null
}

/**
 * Whether a run holds a path whose backslashes Markdown took for escapes. Only a
 * path that says from its first characters that it is one qualifies, so that
 * `1\. item` and `\*bold\*` stay what Markdown made of them.
 */
export function crossesEscape(run: TextRun): boolean {
  if (typeof run === 'string' || run.kind !== 'document') return false
  const { value } = run
  const anchored = NETWORK.test(value) || DRIVE.test(value) || FROM_HOME_OR_HERE.test(value)
  return anchored && ESCAPE.test(value)
}

/** The path, its suffix and its other spelling, from what was written in text or code. */
function writtenParts(value: string): { bare: string; suffix: string; tailed: string | null } {
  const suffix = SUFFIX_AT_END.exec(value)?.[0] ?? ''
  if (suffix) return { bare: value.slice(0, -suffix.length), suffix, tailed: null }
  const bare = value.replace(TAIL_AT_END, '')
  return { bare, suffix, tailed: bare === value ? null : value }
}

/** `a/b/../c` from the folder of `from`, keeping any `..` that climbs above the root. */
function fromDocument(path: string, from: string): string {
  const folder = from.split('/').slice(0, -1)
  const segments: string[] = []
  for (const segment of [...folder, ...path.split(/[/\\]/u)]) {
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop()
      else segments.push(segment)
    } else if (segment !== '.') {
      segments.push(segment)
    }
  }
  return segments.join('/')
}

/** What the server is asked for a link's address: decoded, with no query and no fragment. */
function addressParts(address: string, from: string): { bare: string; suffix: string } {
  const fragment = address.indexOf('#')
  const before = fragment === -1 ? address : address.slice(0, fragment)
  const query = before.indexOf('?')
  const written = query === -1 ? before : before.slice(0, query)
  const line = fragment === -1 ? (LINE_AT_END.exec(written)?.[0] ?? '') : ''
  const suffix = fragment === -1 ? line : address.slice(fragment)
  const path = decoded(line ? written.slice(0, -line.length) : written)
  if (!path) return { bare: from, suffix }
  if (NETWORK.test(path) || DRIVE.test(path) || /^~[/\\]/u.test(path)) return { bare: path, suffix }
  if (ROOTED.test(path)) return { bare: path.replace(/^[/\\]+/u, ''), suffix }
  return { bare: from ? fromDocument(path, from) : path, suffix }
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** What a document reference asks the server, what it leads to and what it copies. */
export function documentParts(reference: DocumentReference): DocumentParts {
  const { linkFrom, strength, value } = reference
  if (linkFrom !== undefined) {
    const { bare, suffix } = addressParts(value, linkFrom)
    return { copy: value, paths: strength === 'copy-only' ? [] : [bare], suffix }
  }
  const { bare, suffix, tailed } = writtenParts(value)
  const asked = tailed === null ? [bare] : [bare, tailed]
  return {
    copy: strength === 'weak' ? null : bare + suffix,
    paths: strength === 'copy-only' ? [] : asked,
    suffix,
  }
}

/** Where a suffix leads, or null for none. A range written backwards reads forwards. */
export function suffixTarget(suffix: string): SuffixTarget | null {
  if (suffix.startsWith('#')) {
    const lines = /^#L(\d+)(?:-L(\d+))?$/u.exec(suffix)
    return lines
      ? lineRange(lines[1], lines[2], undefined)
      : { kind: 'anchor', id: decoded(suffix.slice(1)) }
  }
  const lines = /^:(\d+)(?:-(\d+)|:(\d+))?$/u.exec(suffix)
  return lines && lineRange(lines[1], lines[2], lines[3])
}

function lineRange(
  from: string | undefined,
  to: string | undefined,
  column: string | undefined,
): SuffixTarget {
  const one = Number(from)
  const other = Number(to ?? from)
  return {
    kind: 'lines',
    first: Math.min(one, other),
    last: Math.max(one, other),
    column: column ? Number(column) : null,
  }
}

function documentReference(value: string, strength: DocumentStrength): DocumentReference {
  return { kind: 'document', value, strength }
}

/**
 * The document a Markdown link's address names, or null when it names none: a
 * scheme, a host, or a place in the same text. `x.md:42` is a file and a line,
 * though a URL would read `x.md:` as its scheme, and `tel:123` is a scheme.
 * `from` is the document the link stands in, where a `#…` is a place to go to.
 */
export function documentLink(address: string, from = ''): DocumentReference | null {
  const value = address.trim()
  if (!value || value.length > MAX_PATH) return null
  // A tab or a line end is dropped by a URL's parser, so it can hide a scheme.
  if (/\p{Cc}/u.test(value)) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  // Two backslashes are a network path or nothing: never a path from the root.
  if (decoded(value).startsWith('\\\\') && !NETWORK.test(decoded(value))) return null
  const drive = DRIVE.test(value)
  const fileAndLine = /^[^/\\:]+\.[^/\\:]*:\d+(?:-\d+|:\d+)?(?:[?#]|$)/u.test(value)
  if (!drive && !fileAndLine && /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return null
  const reference: DocumentReference = {
    kind: 'document',
    linkFrom: from,
    strength: NETWORK.test(decoded(value)) ? 'copy-only' : 'strong',
    value,
  }
  return reference.strength === 'strong' && !addressParts(value, from).bare ? null : reference
}

/**
 * What stands right before and after a text in the line it was written in, where
 * the Markdown lexer cut it off: `<task>` in `tmp/<task>/` is an HTML token of
 * its own, and the text it was cut from is `tmp/`.
 */
export interface Around {
  after: string
  before: string
}

const NOTHING_AROUND: Around = { after: '', before: '' }
const RUN_END = /[\s,;]/u
const ANGLED = /<[^<>\n]*>/gu
/** What goes on with a path after a name in angle brackets: a separator or an extension. */
const PATH_GOES_ON = /^(?:[/\\]|\.\p{L})/u

/**
 * Where the tags of a line stand, as [start, end) pairs. A name in angle brackets is a
 * placeholder where a path goes on around it — right after a separator, or before a
 * separator or an extension: `tmp/<task>/`, `<name>.md`. Anywhere else it is markup an
 * agent wrote beside a path, as `<br>` ending a table cell's line, and it bounds the run
 * like a space instead of making the path a template.
 */
function tagsIn(line: string): [number, number][] {
  const tags: [number, number][] = []
  for (const { 0: angled, index } of line.matchAll(ANGLED)) {
    const end = index + angled.length
    const placeholder = /[/\\]/u.test(line.charAt(index - 1)) || PATH_GOES_ON.test(line.slice(end))
    if (!placeholder) tags.push([index, end])
  }
  return tags
}

/** Whether the run of the line a candidate stands in, up to a space, `,;` or a tag, is a template. */
function inTemplate(line: string, start: number, end: number): boolean {
  const tags = tagsIn(line)
  const endsTag = (at: number) => tags.some(([, tagEnd]) => tagEnd === at)
  const startsTag = (at: number) => tags.some(([tagStart]) => tagStart === at)
  let from = start
  while (from > 0 && !RUN_END.test(line.charAt(from - 1)) && !endsTag(from)) from -= 1
  let to = end
  while (to < line.length && !RUN_END.test(line.charAt(to)) && !startsTag(to)) to += 1
  return TEMPLATE.test(line.slice(from, to).replaceAll(RUN_EDGES, ''))
}

/** Every path in a prose text. */
function pathsIn(text: string, around: Around): Found[] {
  const found: Found[] = []
  const line = around.before + text + around.after
  for (const match of text.matchAll(PROSE_PATH)) {
    const { path = '', suffix = '', tail = '' } = match.groups ?? {}
    const value = suffix ? path + suffix : path + tail
    if (match[0].length > MAX_PATH) continue
    const at = around.before.length + match.index
    if (inTemplate(line, at, at + match[0].length)) continue
    const { bare } = writtenParts(value)
    const strength = strengthOf(bare, 2)
    if (strength === null || (strength === 'weak' && isAllIdentifiers(bare))) continue
    const start = match.index
    found.push({ start, end: start + value.length, reference: documentReference(value, strength) })
  }
  return found
}

/** `MAIN-12/MAIN-13/MAIN-14` is a list of work items, however many it holds. */
function isAllIdentifiers(path: string): boolean {
  return path.split(/[/\\]/u).every((segment) => wholeReference(segment) !== null)
}

function identifiersIn(text: string): Found[] {
  return [...text.matchAll(PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    reference: { kind: kindOf(match.groups ?? {}), value: match[0] },
  }))
}

function cut(text: string, found: readonly Found[]): TextRun[] {
  const runs: TextRun[] = []
  let last = 0
  for (const { end, reference, start } of found) {
    if (start > last) runs.push(text.slice(last, start))
    runs.push(reference)
    last = end
  }
  if (last < text.length) runs.push(text.slice(last))
  return runs
}

/** The text cut around its identifiers alone: raw HTML, and a title that must not break inside one. */
export function splitIdentifiers(text: string): TextRun[] {
  return cut(text, identifiersIn(text))
}

/**
 * The text cut into plain runs and candidate references, in order. A path takes
 * what it covers, so `docs/MAIN-12-notes.md` is one candidate and not an item
 * inside a path; a shape that turns out to be no path leaves `MAIN-12/MAIN-13`
 * to the identifiers. `around` is what the lexer cut off either side of it.
 */
export function splitReferences(text: string, around: Around = NOTHING_AROUND): TextRun[] {
  const paths = pathsIn(text, around)
  if (paths.length === 0) return splitIdentifiers(text)
  const outside = identifiersIn(text).filter((identifier) =>
    paths.every(({ end, start }) => identifier.end <= start || identifier.start >= end),
  )
  return cut(
    text,
    [...paths, ...outside].sort((left, right) => left.start - right.start),
  )
}

/** The one identifier a text is, whole, or null; for a code span holding just an id. */
export function wholeReference(text: string): TextReference | null {
  const runs = splitIdentifiers(text.trim())
  const [only] = runs
  return runs.length === 1 && typeof only === 'object' ? only : null
}

/**
 * The one path a code span is, whole, or null. The author marked it apart, so
 * one separator is enough. An absolute or network path may hold spaces here;
 * a relative one never does, which is what `python tools/x.py check` is not.
 */
export function wholeDocument(text: string): DocumentReference | null {
  const value = text.trim()
  if (!value || value.length > MAX_PATH || value.startsWith('@')) return null
  if (/[\p{C}<>|*?"\u{60}]/u.test(value)) return null
  const { bare } = writtenParts(value)
  const spaced = DRIVE.test(bare) || NETWORK.test(bare)
  if (!spaced && /\s/u.test(bare)) return null
  if (bare.lastIndexOf(':') > (DRIVE.test(bare) ? 1 : -1)) return null
  const strength = strengthOf(bare, 1)
  return strength && documentReference(value, strength)
}

/**
 * The path a work item's `source` names, or null where it holds something else.
 * The field is a path by what it is, so a Markdown file proves it by its name
 * alone: one at the root has no separator, and one may hold a space.
 */
export function sourceDocument(text: string): DocumentReference | null {
  const whole = wholeDocument(text)
  if (whole) return whole
  const value = text.trim()
  if (!value || value.length > MAX_PATH || value.startsWith('@')) return null
  if (/[\p{C}<>|*?"\u{60}]/u.test(value)) return null
  const { bare } = writtenParts(value)
  return ROOTED.test(bare) || bare.includes(':') || !MARKDOWN_FILE.test(bare)
    ? null
    : documentReference(value, 'strong')
}
