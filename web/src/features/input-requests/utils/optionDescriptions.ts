import type { InputRequestOption } from '@/shared/api/inputRequestModel.ts'
import { parseRichInline } from '@/shared/lib/richText.ts'
import type { RichInline } from '@/shared/lib/richText.ts'

/**
 * How much of its description an option shows, so that the first screen of a question
 * still says what is asked and what the choices are, whatever was written under them.
 *
 * The labels are what is scanned. A description of one line stands whole under its
 * label, because it is read with it. One that runs on shows its first words on one
 * line and opens on its own press. Past a handful of described options even that takes
 * the last labels off the screen, so every description there waits behind its press.
 *
 * A line stands inside the option's `<label>`, where a link has no place: a press on it
 * neither selects nor reads as selecting, and its words join the option's name. So a line
 * holding a link opens like one that runs on, and the link works where it opened.
 */
export type DescriptionView = 'excerpt' | 'folded' | 'line' | 'none'

/** Longer than this it wraps past two lines in a drawer, and is a text rather than a line. */
const LINE_LENGTH = 120
/** Six rows with a line under the label are what a laptop's drawer holds beside a prompt. */
const DESCRIBED_ON_SCREEN = 6

function holdsLink(nodes: readonly RichInline[]): boolean {
  return nodes.some(
    (node) => node.kind === 'link' || ('children' in node && holdsLink(node.children)),
  )
}

function isLine(description: string) {
  const text = description.trim()
  return text.length <= LINE_LENGTH && !text.includes('\n') && !holdsLink(parseRichInline(text))
}

export function descriptionViews(
  options: readonly InputRequestOption[],
): ReadonlyMap<string, DescriptionView> {
  const crowded = options.filter((option) => option.description).length > DESCRIBED_ON_SCREEN
  return new Map(
    options.map(({ id, description }) => {
      if (!description) return [id, 'none']
      if (crowded) return [id, 'folded']
      return [id, isLine(description) ? 'line' : 'excerpt']
    }),
  )
}
