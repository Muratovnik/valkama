/**
 * Sentences said one after another, each closed by a full stop, as a hint or an accessible name
 * reads several lines of a screen. A sentence that already ends in a stop of its own keeps it and
 * takes no second one: a period named by its days ends in a month cut short, «2–5 нояб.», and
 * «к периоду 2–5 нояб.» followed by a sentence read «нояб..». Empty sentences are left out. The
 * last sentence stays open, as a hint's last line does, unless `closed`, as a name said whole is.
 */
const CLOSED = /[.…!?]$/u

export function sentences(
  parts: readonly (string | null | undefined)[],
  { closed = false }: { closed?: boolean } = {},
): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .map((part, index, all) =>
      (closed || index < all.length - 1) && !CLOSED.test(part) ? `${part}.` : part,
    )
    .join(' ')
}
