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
import type { InjectionKey, VNodeChild } from 'vue'

import type { TextReference } from '@/shared/lib/textReferences.ts'

/**
 * What a reference shows while the pointer rests on it, drawn by the layer that
 * knows the data: this module does not know what kind of thing it links to.
 */
export interface ReferencePreview {
  /** What a screen reader hears while it shows, in place of the drawing. */
  describe: () => string
  /**
   * Read what it draws; absent where the page already holds it. The card waits for
   * this a moment before showing, and closing it aborts the signal.
   */
  prepare?: (signal: AbortSignal) => Promise<void>
  render: () => VNodeChild
}

export interface ReferenceLink {
  /** What the link opens, for its accessible name and tooltip. */
  title: string
  /** The rest of the run, which follows the control as prose. */
  after?: string
  /** Its answer is on its way, and a press waits for it. */
  busy?: boolean
  /** It copies rather than opens, which the text says by its dotted underline. */
  copies?: boolean
  /**
   * The address of what it opens, on this origin, where it has one: the link is then a
   * link, which a modified press or a middle one takes elsewhere as any link is taken.
   * Without one, what it does is an action, and the control is a button.
   */
  href?: string
  /** The part of the written run the control covers, when that is not all of it. */
  label?: string
  /** Hover text of its own: where there is one, the link has no native `title`. */
  preview?: ReferencePreview
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
