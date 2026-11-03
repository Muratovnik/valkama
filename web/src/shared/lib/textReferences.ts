/**
 * The identifiers agents write into prose, found by their shape.
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
  | { kind: 'document'; value: string; strength: DocumentStrength }

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

/** The text cut into plain runs and candidate references, in order. */
export function splitReferences(text: string): TextRun[] {
  const runs: TextRun[] = []
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index
    if (start > last) runs.push(text.slice(last, start))
    runs.push({ kind: kindOf(match.groups ?? {}), value: match[0] })
    last = start + match[0].length
  }
  if (last < text.length) runs.push(text.slice(last))
  return runs
}

/** The one reference a text is, whole, or null; for a code span holding just an id. */
export function wholeReference(text: string): TextReference | null {
  const runs = splitReferences(text.trim())
  const [only] = runs
  return runs.length === 1 && typeof only === 'object' ? only : null
}
