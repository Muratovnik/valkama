/**
 * Sentences said one after another, each closed by a full stop, as a hint or an accessible name
 * reads several lines of a screen. A sentence that already ends in a stop of its own keeps it and
 * takes no second one: a period named by its days ends in a month cut short, «2–5 нояб.», and
 * «к периоду 2–5 нояб.» followed by a sentence read «нояб..». Empty sentences are left out.
 */
const CLOSED = /[.…!?]$/u

export function sentences(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .map((part, index, all) => (index < all.length - 1 && !CLOSED.test(part) ? `${part}.` : part))
    .join(' ')
}
