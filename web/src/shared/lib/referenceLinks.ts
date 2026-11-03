/**
 * Which candidate references in a text are real, and what opening one does.
 *
 * A text does not know what it is shown inside. `SHA-256` is a reference to no
 * work item anywhere, `MAIN-12` is one only where a space keyed `MAIN` exists, a
 * commit hash means something only next to the record that carries it, and
 * opening an item from inside a card goes through that card's own departure
 * (its draft guard, its Back trail) while opening it from a dialog does not.
 * So each owner of such knowledge provides one layer, and a layer asks the one
 * above it about whatever it does not own. With no layer at all, every
 * candidate is plain text, which is the safe answer.
 */
import { inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

import type { TextReference } from '@/shared/lib/textReferences.ts'

export interface ReferenceLink {
  /** What the link opens, for its accessible name and tooltip. */
  title: string
  /** The rest of the run, which follows the control as prose. */
  after?: string
  /** Its answer is on its way, and a press waits for it. */
  busy?: boolean
  /** It copies rather than opens, which the text says by its dotted underline. */
  copies?: boolean
  /** The part of the written run the control covers, when that is not all of it. */
  label?: string
  open: () => void
}

export type ReferenceResolver = (reference: TextReference) => ReferenceLink | null

const RESOLVER: InjectionKey<ReferenceResolver> = Symbol('reference-links')
const none: ReferenceResolver = () => null

/** The resolver in force here: the nearest layer, which consults the ones above it. */
export function useReferenceLinks(): ReferenceResolver {
  return inject(RESOLVER, none)
}

/**
 * Add a layer for everything rendered below this component.
 *
 * `resolve` receives the layer above it. A layer answers for what it owns —
 * a link, or null for a candidate it knows is not one — and hands everything
 * else up by returning `parent(reference)`.
 */
export function provideReferenceLinks(
  resolve: (reference: TextReference, parent: ReferenceResolver) => ReferenceLink | null,
): void {
  const parent = useReferenceLinks()
  provide(RESOLVER, (reference) => resolve(reference, parent))
}

/** The space key a work item reference names. */
export function referenceSpaceKey(reference: string): string {
  return reference.slice(0, reference.lastIndexOf('-'))
}

/**
 * A recorded commit value may name its repository before the revision, as
 * `repo@abc1234` or `repo abc1234`: a name that starts with a letter or digit,
 * then `@` or spaces, then one word that is not git's own `@{...}` syntax.
 * Anything else is the revision as written. The server's `/api/ref` reads a
 * value by this same rule (`split_commit_value` in `server/refs.py`), and both
 * test suites hold the same examples.
 */
const NAMED_COMMIT = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:@(?!\{)| +)(\S+)$/

function commitRevision(value: string): string {
  return NAMED_COMMIT.exec(value)?.[1] ?? value
}

/**
 * Whether two commit names are the same commit: one is a prefix of the other,
 * at the seven characters git itself abbreviates to. A repository name in
 * front of either is not compared.
 */
export function sameCommit(left: string, right: string): boolean {
  const a = commitRevision(left).toLowerCase()
  const b = commitRevision(right).toLowerCase()
  return Math.min(a.length, b.length) >= 7 && (a.startsWith(b) || b.startsWith(a))
}
